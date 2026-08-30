import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAgentRunConfig,
  type AgentRunConfig,
} from '@/lib/search/agentRunConfig';

const mocks = vi.hoisted(() => ({
  insertPartialAssistantRow: vi.fn(),
  updateAssistantRow: vi.fn(),
  sumMessageContentChars: vi.fn(),
  update: vi.fn(),
  execute: vi.fn(),
  enqueueRunEvent: vi.fn(),
  flushRunEvents: vi.fn(),
  dropRunEventBuffer: vi.fn(),
  deleteCheckpoint: vi.fn(),
  cleanupCancelToken: vi.fn(),
  cleanupRun: vi.fn(),
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
  enqueueRunEvent: mocks.enqueueRunEvent,
  flushRunEvents: mocks.flushRunEvents,
  dropRunEventBuffer: mocks.dropRunEventBuffer,
}));
vi.mock('@/lib/runs/checkpointer', () => ({
  deleteCheckpoint: mocks.deleteCheckpoint,
}));
vi.mock('@/lib/cancel-tokens', () => ({
  cleanupCancelToken: mocks.cleanupCancelToken,
  registerCancelToken: vi.fn(),
}));
vi.mock('@/lib/utils/runControl', () => ({
  cleanupRun: mocks.cleanupRun,
  registerRetrieval: vi.fn(),
  clearSoftStop: vi.fn(),
}));
vi.mock('@/lib/search/agentStreamDriver', () => ({
  deduplicateDocuments: (documents: unknown[]) => documents,
}));

import { emitStreamEvent } from '@/lib/streaming/events';
import { evictByChatId, startRun } from './runHub';
import { attachRunHost } from './runHost';

const makeConfig = (): AgentRunConfig =>
  createAgentRunConfig({
    chatModelRef: {
      provider: 'openai',
      name: 'gpt-5.4',
      reasoningEffort: 'high',
    },
    systemModelRef: {
      provider: 'anthropic',
      name: 'claude-opus-4-6',
      reasoningEffort: 'low',
    },
    focusMode: 'webSearch',
    fileIds: [],
    personaInstructions: '',
    methodologyInstructions: '',
    userLocation: null,
    userProfile: null,
    workspaceId: null,
    isPrivate: false,
    chatId: 'chat-audit',
    messageId: 'message-audit',
    aiMessageId: 'assistant-audit',
    interactiveSession: true,
    workspaceSuffix: '',
    memoryEnabled: false,
    panel: {
      executors: [
        { provider: 'openai', name: 'gpt-5-mini', reasoningEffort: 'medium' },
        {
          provider: 'deepseek',
          name: 'deepseek-v4-flash',
          reasoningEffort: 'off',
        },
      ],
    },
  });

describe('run host model configuration audit', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('persists effective Chat/System/panel effort with terminal assistant metadata', async () => {
    mocks.insertPartialAssistantRow.mockResolvedValue(undefined);
    mocks.updateAssistantRow.mockResolvedValue(undefined);
    mocks.sumMessageContentChars.mockResolvedValue(0);
    mocks.flushRunEvents.mockResolvedValue(undefined);
    mocks.dropRunEventBuffer.mockReturnValue(undefined);
    mocks.deleteCheckpoint.mockResolvedValue(undefined);
    mocks.execute.mockResolvedValue(undefined);
    mocks.update.mockReturnValue({
      set: vi.fn(() => ({
        where: vi.fn(() => ({ execute: mocks.execute })),
      })),
    });

    const chatId = `chat-audit-${crypto.randomUUID()}`;
    const messageId = `message-audit-${crypto.randomUUID()}`;
    const aiMessageId = `assistant-audit-${crypto.randomUUID()}`;
    const emitter = new EventEmitter();
    const config = makeConfig();
    const { run } = startRun({
      chatId,
      messageId,
      aiMessageId,
      threadId: `${messageId}:1`,
      emitter,
      abortController: new AbortController(),
      retrievalController: new AbortController(),
      configSnapshot: config,
    });

    try {
      await attachRunHost({
        run,
        startTime: Date.now(),
        userMessageId: messageId,
        usedLocation: false,
        usedPersonalization: false,
        memoriesUsed: [],
      });

      emitStreamEvent(emitter, {
        type: 'model_stats',
        data: {
          version: 2,
          perModel: [
            {
              provider: 'openai',
              model: 'gpt-5.4',
              usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
            },
          ],
        },
      });
      emitStreamEvent(emitter, { type: 'agent_end' });

      await vi.waitFor(() => {
        expect(
          mocks.updateAssistantRow.mock.calls.some((call) => {
            const update = call[1] as {
              metadata?: Record<string, unknown>;
            };
            return Boolean(update?.metadata?.modelConfig);
          }),
        ).toBe(true);
      });

      const terminalUpdate = mocks.updateAssistantRow.mock.calls.find((call) =>
        Boolean(
          (call[1] as { metadata?: Record<string, unknown> })?.metadata
            ?.modelConfig,
        ),
      )?.[1] as { metadata: Record<string, unknown> } | undefined;
      expect(terminalUpdate?.metadata).toMatchObject({
        modelConfig: {
          chat: {
            provider: 'openai',
            name: 'gpt-5.4',
            reasoningEffort: 'high',
          },
          system: {
            provider: 'anthropic',
            name: 'claude-opus-4-6',
            reasoningEffort: 'low',
          },
          panel: {
            executors: [
              {
                provider: 'openai',
                name: 'gpt-5-mini',
                reasoningEffort: 'medium',
              },
              {
                provider: 'deepseek',
                name: 'deepseek-v4-flash',
                reasoningEffort: 'off',
              },
            ],
          },
        },
        modelStats: {
          version: 2,
          perModel: [
            {
              provider: 'openai',
              model: 'gpt-5.4',
              usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
            },
          ],
        },
      });
    } finally {
      evictByChatId(chatId);
    }
  });
});
