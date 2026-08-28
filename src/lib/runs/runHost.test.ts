import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  insertPartialAssistantRow: vi.fn().mockResolvedValue(undefined),
  updateAssistantRow: vi.fn().mockResolvedValue(undefined),
  sumMessageContentChars: vi.fn().mockResolvedValue(0),
  enqueueRunEvent: vi.fn(),
  flushRunEvents: vi.fn().mockResolvedValue(undefined),
  dropRunEventBuffer: vi.fn(),
  deleteCheckpoint: vi.fn().mockResolvedValue(undefined),
  cleanupCancelToken: vi.fn(),
  registerCancelToken: vi.fn(),
  cleanupRun: vi.fn(),
  registerRetrieval: vi.fn(),
  clearSoftStop: vi.fn(),
  dbUpdate: vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        execute: vi.fn().mockResolvedValue({ changes: 1 }),
      })),
    })),
  })),
}));

vi.mock('@/lib/db', () => ({ default: { update: mocks.dbUpdate } }));
vi.mock('@/lib/db/queries', () => ({
  insertPartialAssistantRow: mocks.insertPartialAssistantRow,
  updateAssistantRow: mocks.updateAssistantRow,
  sumMessageContentChars: mocks.sumMessageContentChars,
}));
vi.mock('@/lib/runs/runEventsPersistence', () => ({
  enqueueRunEvent: mocks.enqueueRunEvent,
  flushRunEvents: mocks.flushRunEvents,
  dropRunEventBuffer: mocks.dropRunEventBuffer,
}));
vi.mock('@/lib/runs/checkpointer', () => ({
  deleteCheckpoint: mocks.deleteCheckpoint,
}));
vi.mock('@/lib/cancel-tokens', () => ({
  cleanupCancelToken: mocks.cleanupCancelToken,
  registerCancelToken: mocks.registerCancelToken,
}));
vi.mock('@/lib/utils/runControl', () => ({
  cleanupRun: mocks.cleanupRun,
  registerRetrieval: mocks.registerRetrieval,
  clearSoftStop: mocks.clearSoftStop,
}));
vi.mock('@/lib/search/agentStreamDriver', () => ({
  deduplicateDocuments: (documents: unknown[]) => documents,
}));
vi.mock('@/lib/utils/chatTitle', () => ({
  generateChatTitle: vi.fn(),
}));
vi.mock('@/lib/sandbox/codeExecutionCorrelation', () => ({
  popCallbackRunId: vi.fn(),
}));
vi.mock('@/lib/userQuestion/questionCorrelation', () => ({
  popCallbackRunId: vi.fn(),
}));

import { attachResumedRunHost, attachRunHost } from './runHost';
import { evictByChatId, setEventPersister, type Run } from './runHub';
import { TurnChartRegistry } from '@/lib/chart/turnChartRegistry';
import { TurnMapRegistry } from '@/lib/maps/turnMapRegistry';
import { emitStreamEvent } from '@/lib/streaming/events';

const mapSpec = {
  places: [
    {
      id: 'node/1',
      name: 'Central Cafe',
      coordinate: { lat: 40, lon: -75 },
      sourceUrl: 'https://www.openstreetmap.org/node/1',
      provider: 'openstreetmap',
      attribution: '© OpenStreetMap contributors',
    },
  ],
  attribution: '© OpenStreetMap contributors',
  retrievedAt: '2026-08-27T12:00:00.000Z',
  title: 'Nearby places',
};

const createdRuns: Run[] = [];
let nextRun = 1;

function makeRun(status: Run['status'] = 'running'): Run {
  const id = `map-host-${nextRun++}`;
  const run: Run = {
    chatId: `${id}-chat`,
    messageId: `${id}-user`,
    aiMessageId: `${id}-assistant`,
    threadId: `${id}:thread`,
    status,
    emitter: new EventEmitter(),
    eventLog: [],
    subscribers: new Map(),
    abortController: new AbortController(),
    retrievalController: new AbortController(),
    seq: 0,
    startedAt: Date.now(),
    recievedMessage: '',
    chartRegistry: new TurnChartRegistry(),
    mapRegistry: new TurnMapRegistry({
      idFactory: (() => {
        let value = 0;
        return () => `private-map-${++value}`;
      })(),
    }),
  };
  createdRuns.push(run);
  return run;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for run host');
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.insertPartialAssistantRow.mockResolvedValue(undefined);
  mocks.updateAssistantRow.mockResolvedValue(undefined);
  mocks.sumMessageContentChars.mockResolvedValue(0);
  mocks.flushRunEvents.mockResolvedValue(undefined);
  mocks.deleteCheckpoint.mockResolvedValue(undefined);
});

afterEach(() => {
  setEventPersister(null);
  for (const run of createdRuns.splice(0)) {
    if (run.ttlTimer !== undefined) clearTimeout(run.ttlTimer);
    evictByChatId(run.chatId);
  }
});

describe('runHost map durability boundary', () => {
  it('writes safe map specs and placements to content/metadata while dropping overlays from durable state', async () => {
    const run = makeRun();
    const registration = run.mapRegistry.register(mapSpec);
    const placement = run.mapRegistry.place(registration.handle);

    await attachRunHost({
      run,
      startTime: run.startedAt,
      userMessageId: run.messageId,
      usedLocation: false,
      usedPersonalization: false,
      memoriesUsed: [],
      isResume: false,
    });

    emitStreamEvent(run.emitter, {
      type: 'map_spec',
      data: {
        mapId: registration.mapId,
        handle: registration.handle,
        spec: mapSpec,
        source: 'mapping-tool',
      },
    });
    emitStreamEvent(run.emitter, {
      type: 'map_placement',
      data: {
        placementId: placement.placementId,
        mapId: placement.mapId,
        handle: placement.handle,
        placementNumber: placement.placementNumber,
      },
    });
    emitStreamEvent(run.emitter, {
      type: 'map_session_overlay',
      data: {
        mapId: registration.mapId,
        origin: { lat: 40.1, lon: -75.1 },
        clientSessionId: 'page-1',
      },
    });
    emitStreamEvent(run.emitter, { type: 'agent_end' });

    await waitFor(() => run.status === 'completed');

    expect(run.recievedMessage).toContain('```yaawc:map');
    expect(run.recievedMessage).not.toContain('40.1');
    expect(run.eventLog.map(({ ev }) => ev.type)).toEqual(
      expect.arrayContaining(['map_spec', 'map_placement', 'messageEnd']),
    );
    expect(run.eventLog.map(({ ev }) => ev.type)).not.toContain(
      'map_session_overlay',
    );
    expect(
      mocks.enqueueRunEvent.mock.calls.some(
        ([, , seqEvent]) => seqEvent.ev.type === 'map_session_overlay',
      ),
    ).toBe(false);

    const finalUpdate = mocks.updateAssistantRow.mock.calls.at(-1);
    expect(finalUpdate?.[0]).toBe(run.aiMessageId);
    expect(finalUpdate?.[1]).toMatchObject({
      content: expect.stringContaining('```yaawc:map'),
      metadata: {
        mapSpecs: {
          [registration.mapId]: expect.objectContaining({
            title: 'Nearby places',
          }),
        },
      },
    });
    expect(JSON.stringify(finalUpdate?.[1].metadata)).not.toContain('40.1');
  });

  it('rebuilds the writer-owned map envelope and registry from persisted milestones', async () => {
    const run = makeRun('awaiting_user');
    run.recievedMessage = 'Answer';
    run.eventLog = [
      {
        seq: 1,
        ev: {
          type: 'map_spec',
          messageId: run.aiMessageId,
          data: {
            mapId: 'private-map-1',
            handle: 'map_1',
            spec: mapSpec,
          },
        },
      },
      {
        seq: 2,
        ev: {
          type: 'map_placement',
          messageId: run.aiMessageId,
          data: {
            placementId: 'map_placement_1',
            mapId: 'private-map-1',
            handle: 'map_1',
            placementNumber: 1,
          },
        },
      },
    ];

    await attachResumedRunHost(run);

    expect(run.mapRegistry.resolve('map_1')).toMatchObject({
      mapId: 'private-map-1',
      title: 'Nearby places',
    });
    expect(run.mapRegistry.isPlacementAccepted('map_placement_1')).toBe(true);
    expect(run.recievedMessage).toContain('Answer');
    expect(run.recievedMessage).toContain('```yaawc:map');
    expect(run.recievedMessage).toContain('Central Cafe');
    expect(mocks.updateAssistantRow).not.toHaveBeenCalled();
  });
});
