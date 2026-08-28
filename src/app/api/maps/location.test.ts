import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import {
  afterAll,
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
import { LocationApprovalPayloadSchema } from '@/lib/maps/locationSchemas';

const dbFile = new Database(':memory:');
const testDb = drizzle(dbFile, { schema });

const runHostMocks = vi.hoisted(() => {
  class TestStaleSnapshotError extends Error {}
  class TestRaceError extends Error {}
  class TestRunGoneError extends Error {}
  return {
    resumeRun: vi.fn().mockResolvedValue(undefined),
    resumeLocationApprovalStale: vi.fn().mockResolvedValue(undefined),
    markLocationApprovalStale: vi.fn().mockResolvedValue(undefined),
    StaleSnapshotError: TestStaleSnapshotError,
    RaceError: TestRaceError,
    RunGoneError: TestRunGoneError,
  };
});

const settingsMocks = vi.hoisted(() => ({
  getMappingConfiguration: vi.fn(),
}));

let locationRoute: typeof import('./location/route');
let locationSessions: typeof import('@/lib/maps/locationSessions');

const mappingConfig = resolveMappingConfiguration(
  {
    mappingEnabled: 'true',
    mappingPublicServicesAcknowledged: 'true',
  },
  { testProviderEnabled: true },
);
const disclosedHosts = mappingLocationHosts(mappingConfig);
const disclosedProviderHosts = disclosedHosts.slice(0, 3);
const disclosedTileHosts = disclosedHosts.slice(3);

beforeAll(async () => {
  vi.doMock('@/lib/db', () => ({ default: testDb }));
  vi.doMock('@/lib/settings/server', () => settingsMocks);
  vi.doMock('@/lib/runs/runHost', () => runHostMocks);
  vi.resetModules();
  migrate(testDb, { migrationsFolder: 'drizzle' });
  [locationRoute, locationSessions] = await Promise.all([
    import('./location/route'),
    import('@/lib/maps/locationSessions'),
  ]);
});

afterAll(() => {
  locationSessions.locationTokenStore.clear();
  dbFile.close();
  vi.doUnmock('@/lib/db');
  vi.doUnmock('@/lib/settings/server');
  vi.doUnmock('@/lib/runs/runHost');
});

function request(body: unknown): Request {
  return new Request('http://localhost/api/maps/location', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function pendingPayload(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return LocationApprovalPayloadSchema.parse({
    reason: 'Find nearby places',
    authorizedPurposes: ['nearby', 'routing', 'tiles'],
    authorizedHosts: disclosedHosts,
    providerHosts: disclosedProviderHosts,
    tileHosts: disclosedTileHosts,
    configHash: mappingConfigurationFingerprint(mappingConfig),
    clientSessionId: 'page-1',
    aiMessageId: 'assistant-1',
    allowSave: true,
    createdAt: now - 1_000,
    expiresAt: now + 60_000,
    ...overrides,
  });
}

function seedChat(isPrivate = false): void {
  testDb
    .insert(schema.chats)
    .values({
      id: 'chat-1',
      title: 'Location chat',
      createdAt: Date.now(),
      focusMode: 'webSearch',
      isPrivate: isPrivate ? 1 : 0,
      activeRunMessageId: 'message-1',
      activeRunThreadId: 'thread-1',
      activeRunStatus: 'awaiting_user',
    })
    .run();
}

function seedApproval(
  overrides: Partial<typeof schema.approvalRequests.$inferInsert> = {},
): void {
  testDb
    .insert(schema.approvalRequests)
    .values({
      id: 'approval-1',
      chatId: 'chat-1',
      messageId: 'message-1',
      threadId: 'thread-1',
      toolCallId: 'request-location-1',
      engineInterruptId: 'interrupt-1',
      toolKind: 'location',
      payload: pendingPayload(),
      snapshot: null,
      response: null,
      createdAt: Date.now(),
      ...overrides,
    })
    .run();
}

function clearRows(): void {
  testDb.delete(schema.approvalRequests).run();
  testDb.delete(schema.chats).run();
  locationSessions.locationTokenStore.clear();
  vi.clearAllMocks();
  settingsMocks.getMappingConfiguration.mockReturnValue(mappingConfig);
}

beforeEach(clearRows);

describe('POST /api/maps/location', () => {
  it('accepts coordinates only for the matching pending approval and resumes with an opaque token', async () => {
    seedChat();
    seedApproval();

    const result = await locationRoute.POST(
      request({
        approvalId: 'approval-1',
        clientSessionId: 'page-1',
        coordinates: { lat: 40.1234, lon: -75.5678 },
        retention: 'once',
      }),
    );
    const body = await result.json();
    const resumeResponse = runHostMocks.resumeRun.mock.calls[0]?.[1] as
      Record<string, unknown> | undefined;
    const token = resumeResponse?.locationToken;

    expect(result.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(typeof token).toBe('string');
    expect(token).toMatch(/^[A-Za-z0-9_-]{32,200}$/);
    expect(resumeResponse).toMatchObject({
      retention: 'once',
      clientSessionId: 'page-1',
    });
    expect(resumeResponse).not.toHaveProperty('coordinates');
    expect(JSON.stringify(body)).not.toContain('40.1234');
    expect(JSON.stringify(runHostMocks.resumeRun.mock.calls)).not.toContain(
      '40.1234',
    );

    const session = locationSessions.getLocationSession(token, {
      binding: {
        approvalId: 'approval-1',
        runId: 'thread-1',
        chatId: 'chat-1',
        messageId: 'message-1',
        aiMessageId: 'assistant-1',
        clientSessionId: 'page-1',
      },
      purpose: 'routing',
      authorizedHosts: disclosedHosts,
      configHash: mappingConfigurationFingerprint(mappingConfig),
    });
    expect(session?.coordinate).toEqual({ lat: 40.1234, lon: -75.5678 });

    const row = testDb
      .select()
      .from(schema.approvalRequests)
      .where(eq(schema.approvalRequests.id, 'approval-1'))
      .get();
    expect(JSON.stringify(row)).not.toContain('40.1234');
  });

  it('rejects a different page session and never mints a token', async () => {
    seedChat();
    seedApproval();

    const result = await locationRoute.POST(
      request({
        approvalId: 'approval-1',
        clientSessionId: 'page-2',
        coordinates: { lat: 40, lon: -75 },
        retention: 'once',
      }),
    );

    expect(result.status).toBe(403);
    expect(await result.json()).toMatchObject({
      error: expect.stringContaining('another page session'),
    });
    expect(runHostMocks.resumeRun).not.toHaveBeenCalled();
    expect(locationSessions.locationTokenStore.size).toBe(0);
  });

  it('does not allow precise-route saving in private chats', async () => {
    seedChat(true);
    seedApproval();

    const result = await locationRoute.POST(
      request({
        approvalId: 'approval-1',
        clientSessionId: 'page-1',
        coordinates: { lat: 40, lon: -75 },
        retention: 'save',
      }),
    );

    expect(result.status).toBe(400);
    expect(await result.json()).toMatchObject({
      error: expect.stringContaining('unavailable in this chat'),
    });
    expect(runHostMocks.resumeRun).not.toHaveBeenCalled();
    expect(locationSessions.locationTokenStore.size).toBe(0);
  });

  it('marks a pending approval stale when mapping configuration changes', async () => {
    seedChat();
    seedApproval();
    settingsMocks.getMappingConfiguration.mockReturnValue({
      ...mappingConfig,
      tileAttribution: 'Changed attribution',
    });

    const result = await locationRoute.POST(
      request({
        approvalId: 'approval-1',
        clientSessionId: 'page-1',
        coordinates: { lat: 40, lon: -75 },
        retention: 'once',
      }),
    );

    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({
      error: expect.stringContaining('configuration changed'),
    });
    expect(runHostMocks.resumeLocationApprovalStale).toHaveBeenCalledWith(
      'approval-1',
      expect.any(String),
    );
    expect(locationSessions.locationTokenStore.size).toBe(0);
  });

  it('fails closed when a supposedly pending approval already has durable state', async () => {
    for (const durableFields of [
      { snapshot: { coordinates: { lat: 40.1234, lon: -75.5678 } } },
      {
        response: {
          approved: false,
          retention: 'once',
          reason: 'cancelled',
        },
      },
    ]) {
      clearRows();
      seedChat();
      seedApproval(durableFields);

      const result = await locationRoute.POST(
        request({
          approvalId: 'approval-1',
          clientSessionId: 'page-1',
          coordinates: { lat: 40, lon: -75 },
          retention: 'once',
        }),
      );

      expect(result.status).toBe(409);
      expect(await result.json()).toMatchObject({
        error: expect.stringContaining('invalid or expired'),
      });
      expect(runHostMocks.resumeRun).not.toHaveBeenCalled();
      expect(locationSessions.locationTokenStore.size).toBe(0);
    }
  });

  it('does not return a raw coordinate when resume reports a stale error', async () => {
    seedChat();
    seedApproval();
    const error = new runHostMocks.StaleSnapshotError(
      'stale coordinate 40.1234,-75.5678',
    );
    runHostMocks.resumeRun.mockRejectedValueOnce(error);

    const result = await locationRoute.POST(
      request({
        approvalId: 'approval-1',
        clientSessionId: 'page-1',
        coordinates: { lat: 40.1234, lon: -75.5678 },
        retention: 'once',
      }),
    );
    const body = await result.json();

    expect(result.status).toBe(409);
    expect(JSON.stringify(body)).not.toContain('40.1234');
    expect(JSON.stringify(body)).not.toContain('-75.5678');
    expect(locationSessions.locationTokenStore.size).toBe(0);
  });

  it('fails closed for invalid coordinates, resolved approvals, and non-location approvals', async () => {
    seedChat();
    seedApproval();

    const invalidCoordinate = await locationRoute.POST(
      request({
        approvalId: 'approval-1',
        clientSessionId: 'page-1',
        coordinates: { lat: 91, lon: -75 },
        retention: 'once',
      }),
    );
    expect(invalidCoordinate.status).toBe(400);

    clearRows();
    seedChat();
    seedApproval({ resolvedAt: Date.now(), resolutionKind: 'user' });
    const resolved = await locationRoute.POST(
      request({
        approvalId: 'approval-1',
        clientSessionId: 'page-1',
        coordinates: { lat: 40, lon: -75 },
        retention: 'once',
      }),
    );
    expect(resolved.status).toBe(409);

    clearRows();
    seedChat();
    seedApproval({ toolKind: 'ask_user', payload: {} });
    const wrongKind = await locationRoute.POST(
      request({
        approvalId: 'approval-1',
        clientSessionId: 'page-1',
        coordinates: { lat: 40, lon: -75 },
        retention: 'once',
      }),
    );
    expect(wrongKind.status).toBe(404);
    expect(runHostMocks.resumeRun).not.toHaveBeenCalled();
  });

  it('rejects a coordinate when the chat is no longer waiting on the matching run', async () => {
    seedChat();
    seedApproval();
    testDb
      .update(schema.chats)
      .set({ activeRunStatus: 'running' })
      .where(eq(schema.chats.id, 'chat-1'))
      .run();

    const result = await locationRoute.POST(
      request({
        approvalId: 'approval-1',
        clientSessionId: 'page-1',
        coordinates: { lat: 40, lon: -75 },
        retention: 'once',
      }),
    );

    expect(result.status).toBe(410);
    expect(await result.json()).toMatchObject({
      error: expect.stringContaining('no longer active'),
    });
    expect(runHostMocks.resumeRun).not.toHaveBeenCalled();
    expect(locationSessions.locationTokenStore.size).toBe(0);
  });

  it('expires a bounded pending approval before minting an exact-location token', async () => {
    seedChat();
    seedApproval({
      payload: pendingPayload({
        createdAt: Date.now() - 5_000,
        expiresAt: Date.now() - 1,
      }),
    });

    const result = await locationRoute.POST(
      request({
        approvalId: 'approval-1',
        clientSessionId: 'page-1',
        coordinates: { lat: 40, lon: -75 },
        retention: 'once',
      }),
    );

    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({
      error: expect.stringContaining('expired'),
    });
    expect(runHostMocks.resumeRun).not.toHaveBeenCalled();
    expect(locationSessions.locationTokenStore.size).toBe(0);
  });

  it('does not accept a save choice when the approval payload disallows retention', async () => {
    seedChat();
    seedApproval({ payload: pendingPayload({ allowSave: false }) });

    const result = await locationRoute.POST(
      request({
        approvalId: 'approval-1',
        clientSessionId: 'page-1',
        coordinates: { lat: 40, lon: -75 },
        retention: 'save',
      }),
    );

    expect(result.status).toBe(400);
    expect(await result.json()).toMatchObject({
      error: expect.stringContaining('unavailable'),
    });
    expect(runHostMocks.resumeRun).not.toHaveBeenCalled();
    expect(locationSessions.locationTokenStore.size).toBe(0);
  });

  it('stales a pending request when mapping is disabled before the browser submits', async () => {
    seedChat();
    seedApproval();
    settingsMocks.getMappingConfiguration.mockReturnValue({
      ...mappingConfig,
      enabled: false,
      available: false,
      unavailableReason: 'disabled',
    });

    const result = await locationRoute.POST(
      request({
        approvalId: 'approval-1',
        clientSessionId: 'page-1',
        coordinates: { lat: 40, lon: -75 },
        retention: 'once',
      }),
    );

    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({
      error: expect.stringContaining('configuration changed'),
    });
    expect(runHostMocks.resumeLocationApprovalStale).toHaveBeenCalledWith(
      'approval-1',
      expect.any(String),
    );
    expect(runHostMocks.resumeRun).not.toHaveBeenCalled();
    expect(locationSessions.locationTokenStore.size).toBe(0);
  });
});
