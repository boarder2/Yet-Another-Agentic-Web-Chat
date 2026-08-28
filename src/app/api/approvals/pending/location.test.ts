import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
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
import { LocationApprovalPayloadSchema } from '@/lib/maps/locationSchemas';

const dbFile = new Database(':memory:');
const testDb = drizzle(dbFile, { schema });

const runHostMocks = vi.hoisted(() => ({
  expireLocationApproval: vi.fn().mockResolvedValue(true),
  markLocationApprovalStale: vi.fn().mockResolvedValue(undefined),
  resumeLocationApprovalStale: vi.fn().mockResolvedValue(undefined),
}));

let pendingRoute: typeof import('./route');

beforeAll(async () => {
  vi.doMock('@/lib/db', () => ({ default: testDb }));
  vi.doMock('@/lib/runs/runHost', () => runHostMocks);
  vi.resetModules();
  migrate(testDb, { migrationsFolder: 'drizzle' });
  pendingRoute = await import('./route');
});

afterAll(() => {
  dbFile.close();
  vi.doUnmock('@/lib/db');
  vi.doUnmock('@/lib/runs/runHost');
});

const validPayload = (overrides: Record<string, unknown> = {}) => {
  const now = Date.now();
  return LocationApprovalPayloadSchema.parse({
    authorizedPurposes: ['nearby', 'routing', 'tiles'],
    authorizedHosts: ['maps.example.test', 'tiles.example.test'],
    providerHosts: ['maps.example.test'],
    tileHosts: ['tiles.example.test'],
    configHash: 'config-hash',
    clientSessionId: 'page-1',
    aiMessageId: 'assistant-1',
    allowSave: true,
    createdAt: now - 1_000,
    expiresAt: now + 60_000,
    ...overrides,
  });
};

function seedChat(): void {
  testDb
    .insert(schema.chats)
    .values({
      id: 'chat-1',
      title: 'Location chat',
      createdAt: Date.now(),
      focusMode: 'webSearch',
    })
    .run();
}

function seedApproval(
  values: Partial<typeof schema.approvalRequests.$inferInsert> = {},
): void {
  testDb
    .insert(schema.approvalRequests)
    .values({
      id: 'approval-1',
      chatId: 'chat-1',
      messageId: 'message-1',
      threadId: 'thread-1',
      toolCallId: 'request-location-1',
      toolKind: 'location',
      payload: validPayload(),
      snapshot: null,
      response: null,
      createdAt: Date.now(),
      ...values,
    })
    .run();
}

beforeEach(() => {
  testDb.delete(schema.approvalRequests).run();
  testDb.delete(schema.chats).run();
  vi.clearAllMocks();
  runHostMocks.expireLocationApproval.mockResolvedValue(true);
  runHostMocks.markLocationApprovalStale.mockResolvedValue(undefined);
  runHostMocks.resumeLocationApprovalStale.mockResolvedValue(undefined);
});

describe('GET /api/approvals/pending location handling', () => {
  it('returns only coordinate-free disclosure data and strips legacy precise fields', async () => {
    seedChat();
    seedApproval();

    const result = await pendingRoute.GET(
      new Request('http://localhost/api/approvals/pending?chatId=chat-1'),
    );
    const body = await result.json();

    expect(result.status).toBe(200);
    expect(body.pending).toHaveLength(1);
    expect(body.pending[0]).toMatchObject({
      approvalId: 'approval-1',
      toolKind: 'location',
      payload: {
        clientSessionId: 'page-1',
        authorizedHosts: ['maps.example.test', 'tiles.example.test'],
      },
    });
    expect(JSON.stringify(body)).not.toContain('40.1234');
    expect(JSON.stringify(body)).not.toContain('secret-token');
  });

  it('closes tampered or malformed location approvals instead of exposing them', async () => {
    seedChat();
    seedApproval({
      payload: {
        ...validPayload(),
        coordinates: { lat: 40, lon: -75 },
        locationToken: 'secret-token',
      },
      snapshot: { coordinates: { lat: 40, lon: -75 } },
      response: { approved: true, locationToken: 'secret-token' },
    });

    let result = await pendingRoute.GET(
      new Request('http://localhost/api/approvals/pending'),
    );
    expect((await result.json()).pending).toEqual([]);
    expect(runHostMocks.resumeLocationApprovalStale).toHaveBeenCalledWith(
      'approval-1',
      expect.any(String),
    );

    testDb.delete(schema.approvalRequests).run();
    seedApproval({ payload: { clientSessionId: 'page-1' } });
    result = await pendingRoute.GET(
      new Request('http://localhost/api/approvals/pending'),
    );
    expect((await result.json()).pending).toEqual([]);
    expect(runHostMocks.resumeLocationApprovalStale).toHaveBeenCalledTimes(2);
  });

  it('expires an abandoned location approval and does not return it as pending', async () => {
    seedChat();
    seedApproval({
      payload: validPayload({
        createdAt: 1_000,
        expiresAt: 2_000,
      }),
    });

    const result = await pendingRoute.GET(
      new Request('http://localhost/api/approvals/pending?chatId=chat-1'),
    );

    expect(result.status).toBe(200);
    expect((await result.json()).pending).toEqual([]);
    expect(runHostMocks.expireLocationApproval).toHaveBeenCalledWith(
      'approval-1',
    );
    expect(runHostMocks.resumeLocationApprovalStale).not.toHaveBeenCalled();
  });
});
