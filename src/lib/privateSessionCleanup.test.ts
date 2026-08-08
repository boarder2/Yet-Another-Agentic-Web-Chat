import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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

const sqlite = new Database(':memory:');
sqlite.pragma('foreign_keys = ON');
const testDb = drizzle(sqlite, { schema });
const dataDir = mkdtempSync(join(tmpdir(), 'yaawc-private-cleanup-'));
let cleanupExpiredPrivateSessions: typeof import('./privateSessionCleanup').cleanupExpiredPrivateSessions;
let generatedImages: typeof import('./generatedImages/service');

beforeAll(async () => {
  vi.stubEnv('DATA_DIR', dataDir);
  vi.doMock('@/lib/db', () => ({ default: testDb, sqlite }));
  vi.doMock('@/lib/settings/server', () => ({
    getPrivateSessionDurationMinutes: () => 60,
  }));
  vi.doMock('@/lib/runs/runHub', () => ({
    getRunByChatId: () => undefined,
  }));
  vi.resetModules();
  migrate(testDb, { migrationsFolder: 'drizzle' });
  ({ cleanupExpiredPrivateSessions } = await import('./privateSessionCleanup'));
  generatedImages = await import('./generatedImages/service');
});

afterAll(() => {
  sqlite.close();
  rmSync(dataDir, { recursive: true, force: true });
  vi.doUnmock('@/lib/db');
  vi.doUnmock('@/lib/settings/server');
  vi.doUnmock('@/lib/runs/runHub');
  vi.unstubAllEnvs();
});

beforeEach(() => {
  testDb.delete(schema.generatedImages).run();
  testDb.delete(schema.messages).run();
  testDb.delete(schema.chats).run();
});

function seedPrivateChat(id: string, createdAt: number): void {
  testDb
    .insert(schema.chats)
    .values({
      id,
      title: id,
      createdAt,
      focusMode: 'chat',
      isPrivate: 1,
      workspaceId: null,
    })
    .run();
}

describe('private generated-image cleanup', () => {
  it('removes expired private chats, image metadata, and physical blobs', async () => {
    const chatId = 'expired-private-chat';
    seedPrivateChat(chatId, Date.now() - 2 * 60 * 60 * 1000);
    testDb
      .insert(schema.messages)
      .values([
        {
          content: 'private prompt',
          chatId,
          messageId: 'private-user-message',
          role: 'user',
        },
        {
          content: 'private answer',
          chatId,
          messageId: 'private-assistant-message',
          role: 'assistant',
        },
      ])
      .run();
    const image = generatedImages.createGeneratedImage({
      buffer: Buffer.from('private-image'),
      mimeType: 'image/png',
      prompt: 'private generated image',
      assistantMessageId: 'private-assistant-message',
      chatId,
    });
    const blobPath = join(dataDir, 'uploads', `${image.id}.${image.extension}`);
    expect(existsSync(blobPath)).toBe(true);

    expect(await cleanupExpiredPrivateSessions()).toBe(1);
    expect(generatedImages.getGeneratedImage(image.id)).toBeNull();
    expect(existsSync(blobPath)).toBe(false);
    expect(
      testDb
        .select()
        .from(schema.chats)
        .where(eq(schema.chats.id, chatId))
        .all(),
    ).toHaveLength(0);
  });

  it('leaves a still-live private image listed until expiry', async () => {
    const chatId = 'live-private-chat';
    seedPrivateChat(chatId, Date.now());
    testDb
      .insert(schema.messages)
      .values({
        content: 'live private answer',
        chatId,
        messageId: 'live-private-assistant',
        role: 'assistant',
      })
      .run();
    const image = generatedImages.createGeneratedImage({
      buffer: Buffer.from('private-image'),
      mimeType: 'image/png',
      prompt: 'live private generated image',
      assistantMessageId: 'live-private-assistant',
      chatId,
    });

    expect(await cleanupExpiredPrivateSessions()).toBe(0);
    expect(generatedImages.getGeneratedImage(image.id)).not.toBeNull();
    expect(
      existsSync(join(dataDir, 'uploads', `${image.id}.${image.extension}`)),
    ).toBe(true);

    generatedImages.deleteForChat(chatId);
  });
});
