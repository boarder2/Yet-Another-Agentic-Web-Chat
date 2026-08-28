import { EventEmitter } from 'node:events';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import * as schema from '@/lib/db/schema';
import {
  mappingLocationHosts,
  resolveMappingConfiguration,
} from '@/lib/maps/config';
import { mappingConfigurationFingerprint } from '@/lib/maps/runtime';
import {
  LocationApprovalPayloadSchema,
  type LocationSessionBinding,
} from '@/lib/maps/locationSessions';
import {
  createAgentRunConfig,
  type AgentRunConfigInput,
} from '@/lib/search/agentRunConfig';

const dbFile = new Database(':memory:');
const testDb = drizzle(dbFile, { schema });

const mocks = vi.hoisted(() => {
  const tracker = {
    seed: vi.fn(),
    statsV2: vi.fn(() => ({ version: 2, perModel: [] })),
  };
  return {
    tracker,
    createTurnTracker: vi.fn(() => ({
      tracker,
      chatRecorder: {},
      systemRecorder: {},
    })),
    resolveChatAndEmbedding: vi.fn().mockResolvedValue({
      chatLlm: {},
      systemLlm: {},
      embedding: {},
    }),
    agentConstructor: vi.fn(),
    doResume: vi.fn().mockResolvedValue(undefined),
    enqueueRunEvent: vi.fn(),
    flushRunEvents: vi.fn().mockResolvedValue(undefined),
    dropRunEventBuffer: vi.fn(),
    insertPartialAssistantRow: vi.fn().mockResolvedValue(undefined),
    updateAssistantRow: vi.fn().mockResolvedValue(undefined),
    sumMessageContentChars: vi.fn().mockResolvedValue(0),
    deleteCheckpoint: vi.fn().mockResolvedValue(undefined),
    cleanupCancelToken: vi.fn(),
    registerCancelToken: vi.fn(),
    cleanupRun: vi.fn(),
    registerRetrieval: vi.fn(),
    clearSoftStop: vi.fn(),
    getMappingConfiguration: vi.fn(),
  };
});

class TestSimplifiedAgent {
  constructor(params: unknown) {
    mocks.agentConstructor(params);
  }

  doResume(params: unknown): Promise<void> {
    return mocks.doResume(params);
  }
}

let host: typeof import('./runHost');
let hub: typeof import('./runHub');
let sessions: typeof import('@/lib/maps/locationSessions');

const mappingConfig = resolveMappingConfiguration(
  {
    mappingEnabled: 'true',
    mappingProvider: 'test',
  },
  { testProviderEnabled: true },
);
const configHash = mappingConfigurationFingerprint(mappingConfig);
const hosts = mappingLocationHosts(mappingConfig);

beforeAll(async () => {
  vi.doMock('@/lib/db', () => ({ default: testDb }));
  vi.doMock('@/lib/db/queries', () => ({
    insertPartialAssistantRow: mocks.insertPartialAssistantRow,
    updateAssistantRow: mocks.updateAssistantRow,
    sumMessageContentChars: mocks.sumMessageContentChars,
  }));
  vi.doMock('@/lib/runs/runEventsPersistence', () => ({
    enqueueRunEvent: mocks.enqueueRunEvent,
    flushRunEvents: mocks.flushRunEvents,
    dropRunEventBuffer: mocks.dropRunEventBuffer,
    sanitizeLocationMilestone: (event: unknown) => event,
  }));
  vi.doMock('@/lib/runs/checkpointer', () => ({
    deleteCheckpoint: mocks.deleteCheckpoint,
  }));
  vi.doMock('@/lib/cancel-tokens', () => ({
    cleanupCancelToken: mocks.cleanupCancelToken,
    registerCancelToken: mocks.registerCancelToken,
  }));
  vi.doMock('@/lib/utils/runControl', () => ({
    cleanupRun: mocks.cleanupRun,
    registerRetrieval: mocks.registerRetrieval,
    clearSoftStop: mocks.clearSoftStop,
  }));
  vi.doMock('@/lib/search/agentStreamDriver', () => ({
    deduplicateDocuments: (documents: unknown[]) => documents,
  }));
  vi.doMock('@/lib/utils/chatTitle', () => ({
    generateChatTitle: vi.fn(),
  }));
  vi.doMock('@/lib/sandbox/codeExecutionCorrelation', () => ({
    popCallbackRunId: vi.fn(),
  }));
  vi.doMock('@/lib/userQuestion/questionCorrelation', () => ({
    popCallbackRunId: vi.fn(),
  }));
  vi.doMock('@/lib/settings/server', () => ({
    getMappingConfiguration: mocks.getMappingConfiguration,
  }));
  vi.doMock('@/lib/providers/resolveModels', () => ({
    resolveChatAndEmbedding: mocks.resolveChatAndEmbedding,
  }));
  vi.doMock('@/lib/tokens/tracker', () => ({
    createTurnTracker: mocks.createTurnTracker,
  }));
  vi.doMock('@/lib/search/simplifiedAgent', () => ({
    SimplifiedAgent: TestSimplifiedAgent,
  }));

  vi.resetModules();
  migrate(testDb, { migrationsFolder: 'drizzle' });
  [host, hub, sessions] = await Promise.all([
    import('./runHost'),
    import('./runHub'),
    import('@/lib/maps/locationSessions'),
  ]);
});

afterAll(() => {
  sessions.locationTokenStore.clear();
  dbFile.close();
  vi.doUnmock('@/lib/db');
  vi.doUnmock('@/lib/db/queries');
  vi.doUnmock('@/lib/runs/runEventsPersistence');
  vi.doUnmock('@/lib/runs/checkpointer');
  vi.doUnmock('@/lib/cancel-tokens');
  vi.doUnmock('@/lib/utils/runControl');
  vi.doUnmock('@/lib/search/agentStreamDriver');
  vi.doUnmock('@/lib/utils/chatTitle');
  vi.doUnmock('@/lib/sandbox/codeExecutionCorrelation');
  vi.doUnmock('@/lib/userQuestion/questionCorrelation');
  vi.doUnmock('@/lib/settings/server');
  vi.doUnmock('@/lib/providers/resolveModels');
  vi.doUnmock('@/lib/tokens/tracker');
  vi.doUnmock('@/lib/search/simplifiedAgent');
});

const runConfigInput = (): AgentRunConfigInput => ({
  chatModelRef: { provider: 'test', name: 'test-chat' },
  systemModelRef: { provider: 'test', name: 'test-system' },
  focusMode: 'webSearch',
  fileIds: [],
  personaInstructions: '',
  methodologyInstructions: '',
  userLocation: null,
  userProfile: null,
  workspaceId: null,
  isPrivate: false,
  chatId: 'chat-1',
  messageId: 'message-1',
  aiMessageId: 'assistant-1',
  interactiveSession: true,
  workspaceSuffix: '',
  memoryEnabled: false,
  panel: null,
  mappingAvailable: true,
  mappingSavedLocationEnabled: false,
  mappingConfigHash: configHash,
});

function seedPausedRun(): {
  run: import('./runHub').Run;
  token: string;
  approvalId: string;
  coordinate: { lat: number; lon: number };
} {
  const startedAt = Date.now();
  const runConfig = createAgentRunConfig(runConfigInput());
  testDb
    .insert(schema.chats)
    .values({
      id: 'chat-1',
      title: 'Location chat',
      createdAt: startedAt,
      focusMode: 'webSearch',
      isPrivate: 0,
      activeRunMessageId: 'message-1',
      activeRunStartedAt: startedAt,
      activeRunStatus: 'awaiting_user',
      activeRunThreadId: 'thread-1',
      activeRunConfigSnapshot: runConfig,
    })
    .run();

  const approvalId = 'approval-1';
  const coordinate = { lat: 40.1234, lon: -75.5678 };
  const payload = LocationApprovalPayloadSchema.parse({
    authorizedPurposes: ['nearby', 'routing', 'tiles'],
    authorizedHosts: hosts,
    providerHosts: [],
    tileHosts: hosts,
    configHash,
    clientSessionId: 'page-1',
    aiMessageId: 'assistant-1',
    allowSave: true,
    createdAt: startedAt - 1_000,
    expiresAt: startedAt + 60_000,
  });
  testDb
    .insert(schema.approvalRequests)
    .values({
      id: approvalId,
      chatId: 'chat-1',
      messageId: 'message-1',
      threadId: 'thread-1',
      toolCallId: 'request-location-1',
      engineInterruptId: 'interrupt-1',
      toolKind: 'location',
      payload,
      snapshot: null,
      response: null,
      createdAt: startedAt,
    })
    .run();

  const binding: LocationSessionBinding = {
    approvalId,
    runId: 'thread-1',
    chatId: 'chat-1',
    messageId: 'message-1',
    aiMessageId: 'assistant-1',
    clientSessionId: 'page-1',
  };
  const session = sessions.locationTokenStore.mint({
    coordinate,
    binding,
    authorizedPurposes: ['nearby', 'routing'],
    authorizedHosts: hosts,
    configHash,
    retention: 'once',
  });

  const run = hub.startRun({
    chatId: 'chat-1',
    messageId: 'message-1',
    aiMessageId: 'assistant-1',
    threadId: 'thread-1',
    emitter: new EventEmitter(),
    abortController: new AbortController(),
    retrievalController: new AbortController(),
    mappingConfig,
    clientSessionId: 'page-1',
  }).run;
  hub.pauseRun(run);
  return { run, token: session.token, approvalId, coordinate };
}

afterEach(() => {
  hub.evictByChatId('chat-1');
});

beforeEach(() => {
  testDb.delete(schema.approvalRequests).run();
  testDb.delete(schema.chats).run();
  sessions.locationTokenStore.clear();
  mocks.getMappingConfiguration.mockReset();
  mocks.getMappingConfiguration.mockReturnValue(mappingConfig);
  mocks.resolveChatAndEmbedding.mockClear();
  mocks.agentConstructor.mockClear();
  mocks.doResume.mockClear();
  mocks.createTurnTracker.mockClear();
  mocks.tracker.seed.mockClear();
  mocks.tracker.statsV2.mockClear();
});

describe('runHost location resume privacy', () => {
  it('stores and resumes only the opaque approval choice while keeping the coordinate in the token store', async () => {
    const { run, token, approvalId, coordinate } = seedPausedRun();

    await host.resumeRun(approvalId, {
      locationToken: token,
      retention: 'once',
      clientSessionId: 'page-1',
    });

    const approval = testDb
      .select()
      .from(schema.approvalRequests)
      .where(eq(schema.approvalRequests.id, approvalId))
      .get();
    const agentArgs = mocks.agentConstructor.mock.calls[0]?.[0] as {
      context?: Record<string, unknown>;
    };
    const resumeArgs = mocks.doResume.mock.calls[0]?.[0] as {
      resumeArg?: Record<string, unknown>;
    };
    const event = run.eventLog.find(
      ({ ev }) => ev.type === 'location_answered',
    )?.ev;

    expect(run.status).toBe('running');
    expect(approval).toMatchObject({
      resolvedAt: expect.any(Number),
      resolutionKind: 'user',
      response: { approved: true, retention: 'once' },
      snapshot: null,
    });
    expect(JSON.stringify(approval)).not.toContain(String(coordinate.lat));
    expect(JSON.stringify(approval)).not.toContain(String(coordinate.lon));
    expect(event).toEqual({
      type: 'location_answered',
      data: {
        approvalId,
        response: { approved: true, retention: 'once' },
      },
    });
    expect(JSON.stringify(run.eventLog)).not.toContain(String(coordinate.lat));
    expect(resumeArgs.resumeArg).toEqual({
      locationToken: token,
      retention: 'once',
      clientSessionId: 'page-1',
    });
    expect(agentArgs.context).toMatchObject({
      locationToken: token,
      clientSessionId: 'page-1',
    });
    expect(JSON.stringify(resumeArgs)).not.toContain(String(coordinate.lat));
    expect(sessions.getLocationSession(token)?.coordinate).toEqual(coordinate);
  });

  it('scrubs the token and approval payload when a paused run is interrupted for restart', async () => {
    const { run, token, approvalId, coordinate } = seedPausedRun();

    await host.markOpenApprovalsInterrupted(run.messageId);

    const approval = testDb
      .select()
      .from(schema.approvalRequests)
      .where(eq(schema.approvalRequests.id, approvalId))
      .get();
    expect(approval).toMatchObject({
      resolutionKind: 'interrupted',
      payload: {},
      snapshot: null,
      response: null,
      resolvedAt: expect.any(Number),
    });
    expect(JSON.stringify(approval)).not.toContain(String(coordinate.lat));
    expect(sessions.getLocationSession(token)).toBeNull();
  });

  it('rejects a token from another page session before resolving the approval', async () => {
    const { run, token, approvalId } = seedPausedRun();

    await expect(
      host.resumeRun(approvalId, {
        locationToken: token,
        retention: 'once',
        clientSessionId: 'page-2',
      }),
    ).rejects.toBeInstanceOf(host.StaleSnapshotError);

    const approval = testDb
      .select()
      .from(schema.approvalRequests)
      .where(eq(schema.approvalRequests.id, approvalId))
      .get();
    expect(run.status).toBe('awaiting_user');
    expect(approval?.resolvedAt).toBeNull();
    expect(mocks.doResume).not.toHaveBeenCalled();
  });

  it('fails a token closed when mapping configuration changes while approval is pending', async () => {
    const { run, token, approvalId } = seedPausedRun();
    mocks.getMappingConfiguration.mockReturnValue({
      ...mappingConfig,
      tileAttribution: 'Changed while paused',
    });

    await expect(
      host.resumeRun(approvalId, {
        locationToken: token,
        retention: 'once',
        clientSessionId: 'page-1',
      }),
    ).rejects.toThrow(/configuration changed/i);

    const approval = testDb
      .select()
      .from(schema.approvalRequests)
      .where(eq(schema.approvalRequests.id, approvalId))
      .get();
    expect(run.status).toBe('awaiting_user');
    expect(approval?.resolvedAt).toBeNull();
    expect(mocks.doResume).not.toHaveBeenCalled();
  });

  it('persists coordinate-free denial responses and forwards only the denial to the graph', async () => {
    const { run, approvalId } = seedPausedRun();
    // A real browser denial never minted a token. Remove the fixture token so
    // the assertion also proves the denial path does not need exact state.
    sessions.locationTokenStore.clear();

    await host.resumeRun(approvalId, {
      approved: false,
      retention: 'once',
      reason: 'permission_denied',
      clientSessionId: 'page-1',
    });

    const approval = testDb
      .select()
      .from(schema.approvalRequests)
      .where(eq(schema.approvalRequests.id, approvalId))
      .get();
    const resumeArgs = mocks.doResume.mock.calls[0]?.[0] as {
      resumeArg?: Record<string, unknown>;
    };

    expect(run.status).toBe('running');
    expect(approval).toMatchObject({
      resolutionKind: 'user',
      response: {
        approved: false,
        retention: 'once',
        reason: 'permission_denied',
      },
      snapshot: null,
    });
    expect(JSON.stringify(approval?.response)).not.toContain('page-1');
    expect(resumeArgs.resumeArg).toEqual({
      approved: false,
      retention: 'once',
      reason: 'permission_denied',
    });
    expect(JSON.stringify(run.eventLog)).not.toContain('page-1');
  });
});
