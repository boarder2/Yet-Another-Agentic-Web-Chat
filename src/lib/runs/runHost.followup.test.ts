import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  insertPartialAssistantRow: vi.fn(),
  updateAssistantRow: vi.fn(),
  sumMessageContentChars: vi.fn(),
  update: vi.fn(),
  flushRunEvents: vi.fn(),
}));

vi.mock('@/lib/db/queries', () => ({
  insertPartialAssistantRow: mocks.insertPartialAssistantRow,
  updateAssistantRow: mocks.updateAssistantRow,
  sumMessageContentChars: mocks.sumMessageContentChars,
}));
vi.mock('@/lib/db', () => ({ default: { update: mocks.update } }));
vi.mock('@/lib/db/schema', () => ({
  chats: { id: 'chats.id' },
  approvalRequests: { messageId: 'approvalRequests.messageId' },
  runEvents: { messageId: 'runEvents.messageId', seq: 'runEvents.seq' },
  messages: { messageId: 'messages.messageId' },
}));
vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  asc: vi.fn(),
  eq: vi.fn(),
  isNull: vi.fn(),
  ne: vi.fn(),
  sql: vi.fn(() => 'sql'),
}));
vi.mock('@/lib/runs/runEventsPersistence', () => ({
  enqueueRunEvent: vi.fn(),
  flushRunEvents: mocks.flushRunEvents,
  dropRunEventBuffer: vi.fn(),
}));
vi.mock('@/lib/runs/checkpointer', () => ({
  deleteCheckpoint: vi.fn(async () => undefined),
}));
vi.mock('@/lib/cancel-tokens', () => ({
  cleanupCancelToken: vi.fn(),
  registerCancelToken: vi.fn(),
}));
vi.mock('@/lib/search/agentStreamDriver', () => ({
  deduplicateDocuments: (documents: unknown[]) => documents,
}));

import { emitStreamEvent } from '@/lib/streaming/events';
import { evictByChatId, startRun, type Run } from './runHub';
import { attachRunHost } from './runHost';
import { enqueueSteer } from './steering';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const chatIds: string[] = [];

async function hostedRun(followup: Run['followup']) {
  const chatId = randomUUID();
  chatIds.push(chatId);
  const emitter = new EventEmitter();
  const { run } = startRun({
    chatId,
    messageId: randomUUID(),
    aiMessageId: randomUUID(),
    threadId: 't',
    emitter,
    abortController: new AbortController(),
    retrievalController: new AbortController(),
    followup,
  });
  await attachRunHost({
    run,
    startTime: Date.now(),
    userMessageId: run.messageId,
    usedLocation: false,
    usedPersonalization: false,
    memoriesUsed: [],
  });
  return { run, emitter };
}

const eventsOf = (run: Run, type: string) =>
  run.eventLog.map((e) => e.ev).filter((ev) => ev.type === type);

const terminalMetadata = () =>
  (
    mocks.updateAssistantRow.mock.calls.at(-1)?.[1] as {
      metadata: Record<string, unknown>;
    }
  ).metadata;

beforeEach(() => {
  mocks.insertPartialAssistantRow.mockResolvedValue(undefined);
  mocks.updateAssistantRow.mockResolvedValue(undefined);
  mocks.sumMessageContentChars.mockResolvedValue(0);
  mocks.flushRunEvents.mockResolvedValue(undefined);
  mocks.update.mockReturnValue({
    set: vi.fn(() => ({
      where: vi.fn(() => ({ execute: vi.fn(async () => undefined) })),
    })),
  });
});

afterEach(() => {
  for (const id of chatIds.splice(0)) evictByChatId(id);
  vi.clearAllMocks();
});

describe('run host steering follow-up', () => {
  it('starts the follow-up from leftover steers once the answer is persisted', async () => {
    const followup = vi.fn<NonNullable<Run['followup']>>();
    const { run, emitter } = await hostedRun(followup);
    followup.mockImplementation(async () => {
      expect(mocks.updateAssistantRow).toHaveBeenCalled();
      return { ...run, messageId: 'u2', aiMessageId: 'ai2' };
    });
    enqueueSteer(run, 'first');
    enqueueSteer(run, 'second');

    emitStreamEvent(emitter, { type: 'agent_end' });

    await vi.waitFor(() => expect(run.status).toBe('completed'));
    expect(eventsOf(run, 'messageEnd')[0]).toMatchObject({
      followupPending: true,
    });
    expect(followup).toHaveBeenCalledWith('first\n\nsecond', expect.anything());
    expect(eventsOf(run, 'followup_turn_started')).toEqual([
      {
        type: 'followup_turn_started',
        data: {
          userMessageId: 'u2',
          aiMessageId: 'ai2',
          content: 'first\n\nsecond',
        },
      },
    ]);
  });

  it('keeps accepting steers for a pending follow-up, but closes without one', async () => {
    const projection = deferred<number>();
    mocks.sumMessageContentChars.mockReturnValueOnce(projection.promise);
    const { run, emitter } = await hostedRun(async () => 'unused');

    emitStreamEvent(emitter, { type: 'agent_end' });
    projection.resolve(0);

    await vi.waitFor(() => expect(eventsOf(run, 'messageEnd')).toHaveLength(1));
    expect(eventsOf(run, 'messageEnd')[0]).not.toHaveProperty(
      'followupPending',
    );
    expect(enqueueSteer(run, 'too late')).toBeNull();
  });

  it('Stop after the answer ends cancels only the follow-up and returns its steers', async () => {
    const projection = deferred<number>();
    mocks.sumMessageContentChars.mockReturnValueOnce(projection.promise);
    const followup = vi.fn<NonNullable<Run['followup']>>();
    const { run, emitter } = await hostedRun(followup);
    enqueueSteer(run, 'leftover');

    emitStreamEvent(emitter, { type: 'agent_end' });
    run.abortController.abort();
    projection.resolve(0);

    await vi.waitFor(() => expect(run.status).toBe('completed'));
    expect(followup).not.toHaveBeenCalled();
    expect(eventsOf(run, 'error')).toEqual([
      { type: 'error', data: 'Request cancelled by user' },
    ]);
    expect(terminalMetadata()).not.toHaveProperty('runStatus');
    expect(terminalMetadata()).toHaveProperty('modelStats');
  });

  it('a Stop while the follow-up starts reaches it, and its refusal returns the steers', async () => {
    const started = deferred<string>();
    let signal: AbortSignal | undefined;
    const { run, emitter } = await hostedRun(async (_content, s) => {
      signal = s;
      return started.promise;
    });
    enqueueSteer(run, 'leftover');

    emitStreamEvent(emitter, { type: 'agent_end' });
    await vi.waitFor(() => expect(signal).toBeDefined());
    run.abortController.abort();
    expect(signal!.aborted).toBe(true);
    started.resolve('Request cancelled by user');

    await vi.waitFor(() => expect(run.status).toBe('completed'));
    expect(eventsOf(run, 'error')).toEqual([
      { type: 'error', data: 'Request cancelled by user' },
    ]);
    expect(eventsOf(run, 'followup_turn_started')).toEqual([]);
  });

  it('a failed run never starts a follow-up', async () => {
    const followup = vi.fn<NonNullable<Run['followup']>>();
    const { run, emitter } = await hostedRun(followup);
    enqueueSteer(run, 'leftover');

    emitStreamEvent(emitter, { type: 'agent_error', data: 'boom' });

    await vi.waitFor(() => expect(run.status).toBe('errored'));
    expect(followup).not.toHaveBeenCalled();
    expect(eventsOf(run, 'error')).toEqual([{ type: 'error', data: 'boom' }]);
  });
});
