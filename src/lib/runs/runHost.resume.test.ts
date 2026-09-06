import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { CachedEmbeddings } from '@/lib/utils/cachedEmbeddings';
import {
  createAgentRunConfig,
  type AgentRunConfig,
} from '@/lib/search/agentRunConfig';

const mocks = vi.hoisted(() => ({
  insertPartialAssistantRow: vi.fn(),
  updateAssistantRow: vi.fn(),
  sumMessageContentChars: vi.fn(),
  findApproval: vi.fn(),
  findChat: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  execute: vi.fn(),
  enqueueRunEvent: vi.fn(),
  flushRunEvents: vi.fn(),
  dropRunEventBuffer: vi.fn(),
  deleteCheckpoint: vi.fn(),
  cleanupCancelToken: vi.fn(),
  cleanupRun: vi.fn(),
  createTurnTracker: vi.fn(),
  SimplifiedAgent: vi.fn(),
  doResume: vi.fn(),
  resolveChatAndEmbedding: vi.fn(),
}));

vi.mock('@/lib/db/queries', () => ({
  insertPartialAssistantRow: mocks.insertPartialAssistantRow,
  updateAssistantRow: mocks.updateAssistantRow,
  sumMessageContentChars: mocks.sumMessageContentChars,
}));
vi.mock('@/lib/db', () => ({
  default: {
    query: {
      approvalRequests: { findFirst: mocks.findApproval },
      chats: { findFirst: mocks.findChat },
    },
    select: mocks.select,
    update: mocks.update,
  },
}));
vi.mock('@/lib/db/schema', () => ({
  chats: { id: 'chats.id' },
  approvalRequests: {
    id: 'approvalRequests.id',
    messageId: 'approvalRequests.messageId',
    resolvedAt: 'approvalRequests.resolvedAt',
  },
  runEvents: { messageId: 'runEvents.messageId', seq: 'runEvents.seq' },
  messages: {
    messageId: 'messages.messageId',
    chatId: 'messages.chatId',
    role: 'messages.role',
    id: 'messages.id',
  },
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
vi.mock('@/lib/search/simplifiedAgent', () => ({
  SimplifiedAgent: mocks.SimplifiedAgent,
}));
vi.mock('@/lib/tokens/tracker', () => ({
  createTurnTracker: mocks.createTurnTracker,
}));
vi.mock('@/lib/providers/resolveModels', () => ({
  resolveChatAndEmbedding: mocks.resolveChatAndEmbedding,
}));

import { evictByChatId, pauseRun, startRun } from './runHub';
import { resumeRun } from './runHost';

function makeConfig(
  chatId: string,
  messageId: string,
  aiMessageId: string,
): AgentRunConfig {
  const ref = {
    provider: 'openai-compatible:provider-1',
    name: 'local-model',
  };
  return createAgentRunConfig({
    chatModelRef: ref,
    systemModelRef: ref,
    focusMode: 'chat',
    fileIds: [],
    personaInstructions: '',
    methodologyInstructions: '',
    userLocation: null,
    userProfile: null,
    workspaceId: null,
    isPrivate: false,
    chatId,
    messageId,
    aiMessageId,
    interactiveSession: true,
    workspaceSuffix: '',
    memoryEnabled: false,
    panel: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.execute.mockResolvedValue({ changes: 1 });
  mocks.flushRunEvents.mockResolvedValue(undefined);
  mocks.doResume.mockResolvedValue(undefined);
  mocks.SimplifiedAgent.mockImplementation(function () {
    return { doResume: mocks.doResume };
  });
  mocks.createTurnTracker.mockReturnValue({
    tracker: { seed: vi.fn() },
    chatRecorder: { record: vi.fn() },
    systemRecorder: { record: vi.fn() },
  });
  mocks.update.mockReturnValue({
    set: vi.fn(() => ({
      where: vi.fn(() => ({ execute: mocks.execute })),
    })),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('interactive run model snapshots', () => {
  it.each(['disabled', 'deleted'] as const)(
    'resumes the start-time compatible model after its provider is %s while approval is pending',
    async (providerMutation) => {
      const chatId = `chat-provider-${providerMutation}-${crypto.randomUUID()}`;
      const messageId = crypto.randomUUID();
      const aiMessageId = crypto.randomUUID();
      const threadId = `${messageId}:1`;
      const config = makeConfig(chatId, messageId, aiMessageId);
      const approval = {
        id: crypto.randomUUID(),
        chatId,
        messageId,
        threadId,
        toolCallId: 'ask-user-call',
        engineInterruptId: 'engine-interrupt',
        toolKind: 'ask_user',
        payload: { question: 'Which color?' },
        snapshot: null,
        resolvedAt: null,
        response: null,
        resolutionKind: null,
        createdAt: Date.now(),
      };
      const chat = {
        id: chatId,
        activeRunThreadId: threadId,
        activeRunConfigSnapshot: config,
      };
      const chatLlm = {
        marker: 'start-time-chat-model',
      } as unknown as BaseChatModel;
      const systemLlm = {
        marker: 'start-time-system-model',
      } as unknown as BaseChatModel;
      const embedding = {
        marker: 'start-time-embedding-model',
      } as unknown as CachedEmbeddings;

      mocks.findApproval.mockResolvedValue(approval);
      mocks.findChat.mockResolvedValue(chat);
      mocks.select.mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([approval]),
        })),
      });
      // This is what the live resolver would report after disabling or deleting
      // the provider. A paused run must not call it for its pinned snapshot.
      mocks.resolveChatAndEmbedding.mockRejectedValue(
        new Error('Invalid chat model'),
      );

      const { run } = startRun({
        chatId,
        messageId,
        aiMessageId,
        threadId,
        emitter: new EventEmitter(),
        abortController: new AbortController(),
        retrievalController: new AbortController(),
        configSnapshot: config,
        modelSnapshot: {
          chatLlm,
          systemLlm,
          embedding,
          chatModelRef: config.chatModelRef,
          systemModelRef: config.systemModelRef!,
        },
      });
      pauseRun(run);

      try {
        await resumeRun(approval.id, { selectedOptions: ['Red'] });

        expect(mocks.resolveChatAndEmbedding).not.toHaveBeenCalled();
        expect(mocks.SimplifiedAgent).toHaveBeenCalledOnce();
        expect(mocks.SimplifiedAgent).toHaveBeenCalledWith(
          expect.objectContaining({
            dependencies: expect.objectContaining({
              chatLlm,
              systemLlm,
              embeddings: embedding,
            }),
          }),
        );
        expect(mocks.doResume).toHaveBeenCalledWith(
          expect.objectContaining({
            resumeArg: { selectedOptions: ['Red'] },
          }),
        );
        expect(run.status).toBe('running');
      } finally {
        evictByChatId(chatId);
      }
    },
  );
});
