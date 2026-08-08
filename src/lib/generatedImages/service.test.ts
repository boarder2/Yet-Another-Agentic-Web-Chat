import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import * as schema from '@/lib/db/schema';

const sqlite = new Database(':memory:');
sqlite.pragma('foreign_keys = ON');
const testDb = drizzle(sqlite, { schema });
const dataDir = mkdtempSync(join(tmpdir(), 'yaawc-generated-images-'));
let generatedImages: typeof import('./service');

beforeAll(async () => {
  vi.stubEnv('DATA_DIR', dataDir);
  vi.doMock('@/lib/db', () => ({ default: testDb }));
  vi.resetModules();
  migrate(testDb, { migrationsFolder: 'drizzle' });
  generatedImages = await import('./service');
});

afterAll(() => {
  sqlite.close();
  rmSync(dataDir, { recursive: true, force: true });
  vi.doUnmock('@/lib/db');
  vi.unstubAllEnvs();
});

beforeEach(() => {
  testDb.delete(schema.generatedImages).run();
  testDb.delete(schema.chats).run();
});

function seedChat(
  id: string,
  title = id,
  workspaceId: string | null = null,
): void {
  testDb
    .insert(schema.chats)
    .values({
      id,
      title,
      createdAt: Date.now(),
      focusMode: 'chat',
      workspaceId,
    })
    .run();
}

function createImage(
  chatId: string,
  assistantMessageId: string,
  options: {
    workspaceId?: string | null;
    mimeType?: string;
    prompt?: string;
    createdAt?: Date;
  } = {},
) {
  testDb
    .insert(schema.messages)
    .values({
      content: 'assistant result',
      chatId,
      messageId: assistantMessageId,
      role: 'assistant',
    })
    .run();

  return generatedImages.createGeneratedImage({
    buffer: Buffer.from('image-bytes'),
    mimeType: options.mimeType ?? 'image/png',
    prompt: options.prompt ?? 'A generated image',
    assistantMessageId,
    chatId,
    workspaceId: options.workspaceId,
    createdAt: options.createdAt,
  });
}

function blobPath(image: { id: string; extension: string }): string {
  return join(dataDir, 'uploads', `${image.id}.${image.extension}`);
}

describe('generated image MIME and URL projections', () => {
  it('normalizes supported MIME types and rejects unsupported types', () => {
    expect(generatedImages.extensionForMimeType(' IMAGE/JPEG ; name=x')).toBe(
      'jpg',
    );
    expect(generatedImages.extensionForMimeType('image/png')).toBe('png');
    expect(
      generatedImages.extensionForMimeType('image/webp; charset=utf-8'),
    ).toBe('webp');
    expect(() => generatedImages.extensionForMimeType('image/svg+xml')).toThrow(
      'Unsupported generated image MIME type',
    );
  });

  it('validates IDs when constructing filenames and local URLs', () => {
    const id = 'a'.repeat(32);
    expect(generatedImages.generatedImageFilename(id, 'png')).toBe(`${id}.png`);
    expect(generatedImages.generatedImageUrl(id)).toBe(
      `/api/uploads/images/${id}`,
    );
    expect(() => generatedImages.generatedImageUrl('../escape')).toThrow(
      'Invalid generated image id',
    );
    expect(() => generatedImages.generatedImageFilename(id, 'svg')).toThrow(
      'Invalid generated image extension',
    );
  });

  it('rejects images without durable chat and assistant-message context', () => {
    const uploads = join(dataDir, 'uploads');
    const before = new Set(readdirSync(uploads));

    expect(() =>
      generatedImages.createGeneratedImage({
        buffer: Buffer.from('image-bytes'),
        mimeType: 'image/png',
        prompt: 'orphan',
        assistantMessageId: 'message-1',
        chatId: '',
      }),
    ).toThrow('Generated image chatId is required');
    expect(() =>
      generatedImages.createGeneratedImage({
        buffer: Buffer.from('image-bytes'),
        mimeType: 'image/png',
        prompt: 'orphan',
        assistantMessageId: '',
        chatId: 'chat-1',
      }),
    ).toThrow('Generated image assistantMessageId is required');
    expect(() =>
      generatedImages.createGeneratedImage({
        buffer: Buffer.from('image-bytes'),
        mimeType: 'image/png',
        prompt: 'orphan',
        assistantMessageId: 'message-1',
        chatId: 'missing-chat',
      }),
    ).toThrow('Generated image chat does not exist');
    expect(new Set(readdirSync(uploads))).toEqual(before);
  });

  it('rejects an assistant message that is missing from the durable chat', () => {
    seedChat('chat-without-assistant');
    const uploads = join(dataDir, 'uploads');
    const before = new Set(readdirSync(uploads));

    expect(() =>
      generatedImages.createGeneratedImage({
        buffer: Buffer.from('image-bytes'),
        mimeType: 'image/png',
        prompt: 'orphan',
        assistantMessageId: 'missing-assistant',
        chatId: 'chat-without-assistant',
      }),
    ).toThrow('Generated image assistant message does not exist in chat');
    expect(new Set(readdirSync(uploads))).toEqual(before);
  });

  it('rejects a workspace scope that does not match the owning chat', () => {
    seedChat('chat-without-workspace');
    testDb
      .insert(schema.messages)
      .values({
        content: 'assistant result',
        chatId: 'chat-without-workspace',
        messageId: 'assistant-with-wrong-workspace',
        role: 'assistant',
      })
      .run();
    const uploads = join(dataDir, 'uploads');
    const before = new Set(readdirSync(uploads));

    expect(() =>
      generatedImages.createGeneratedImage({
        buffer: Buffer.from('image-bytes'),
        mimeType: 'image/png',
        prompt: 'wrong workspace',
        assistantMessageId: 'assistant-with-wrong-workspace',
        chatId: 'chat-without-workspace',
        workspaceId: 'workspace-1',
      }),
    ).toThrow('Generated image workspace does not match chat');
    expect(new Set(readdirSync(uploads))).toEqual(before);
  });

  it('persists a blob and returns its metadata projection', () => {
    seedChat('chat-1', 'Origin chat');
    const image = createImage('chat-1', 'message-1', {
      mimeType: 'image/jpeg',
      prompt: 'A full prompt',
    });

    expect(image).toMatchObject({
      extension: 'jpg',
      mimeType: 'image/jpeg',
      prompt: 'A full prompt',
      assistantMessageId: 'message-1',
      chatId: 'chat-1',
      workspaceId: null,
      imageUrl: `/api/uploads/images/${image.id}`,
    });
    expect(existsSync(blobPath(image))).toBe(true);
    expect(generatedImages.getGeneratedImage(image.id)).toEqual(image);
  });
});

describe('generated image scope filtering', () => {
  it('filters by workspace, unscoped images, or both and includes chat titles', () => {
    seedChat('chat-a', 'Chat A');
    seedChat('chat-b', 'Chat B', 'workspace-one');
    seedChat('chat-c', 'Chat C', 'workspace-two');
    const unscoped = createImage('chat-a', 'message-a', {
      createdAt: new Date('2024-01-01T00:00:00Z'),
    });
    const workspaceOne = createImage('chat-b', 'message-b', {
      workspaceId: 'workspace-one',
      createdAt: new Date('2024-01-02T00:00:00Z'),
    });
    const workspaceTwo = createImage('chat-c', 'message-c', {
      workspaceId: 'workspace-two',
      createdAt: new Date('2024-01-03T00:00:00Z'),
    });

    expect(
      generatedImages.listAllGeneratedImages().map((image) => image.id),
    ).toEqual([workspaceTwo.id, workspaceOne.id, unscoped.id]);
    expect(
      generatedImages
        .listAllGeneratedImages({ workspaceIds: ['workspace-one'] })
        .map((image) => [image.id, image.chatTitle]),
    ).toEqual([[workspaceOne.id, 'Chat B']]);
    expect(
      generatedImages
        .listAllGeneratedImages({ workspaceIds: ['none'] })
        .map((image) => image.id),
    ).toEqual([unscoped.id]);
    expect(
      generatedImages
        .listAllGeneratedImages({
          workspaceIds: ['workspace-one', 'none'],
        })
        .map((image) => image.id),
    ).toEqual([workspaceOne.id, unscoped.id]);
    expect(
      generatedImages.listGeneratedImages('chat-b').map((image) => image.id),
    ).toEqual([workspaceOne.id]);
    expect(
      generatedImages
        .listWorkspaceGeneratedImages('workspace-two')
        .map((image) => image.id),
    ).toEqual([workspaceTwo.id]);
  });
});

describe('generated image cleanup', () => {
  it('deletes chat-owned images while detaching workspace-owned images', () => {
    seedChat('chat-cleanup');
    seedChat('workspace-cleanup', 'workspace-cleanup', 'workspace-cleanup');
    const chatOwned = createImage('chat-cleanup', 'message-chat');
    const workspaceOwned = createImage(
      'workspace-cleanup',
      'message-workspace',
      {
        workspaceId: 'workspace-cleanup',
      },
    );

    generatedImages.deleteForChat('chat-cleanup');

    expect(generatedImages.getGeneratedImage(chatOwned.id)).toBeNull();
    expect(existsSync(blobPath(chatOwned))).toBe(false);
    generatedImages.deleteForChat('workspace-cleanup');

    expect(generatedImages.getGeneratedImage(workspaceOwned.id)).toMatchObject({
      id: workspaceOwned.id,
      chatId: null,
      workspaceId: 'workspace-cleanup',
    });
    expect(existsSync(blobPath(workspaceOwned))).toBe(true);
  });

  it('removes chat-owned message images, preserves workspace images, and tolerates missing blobs', () => {
    seedChat('chat-rewind');
    seedChat('workspace-rewind', 'workspace-rewind', 'workspace-rewind');
    const chatOwned = createImage('chat-rewind', 'discarded-message');
    const workspaceOwned = createImage(
      'workspace-rewind',
      'discarded-message',
      {
        workspaceId: 'workspace-rewind',
      },
    );
    unlinkSync(blobPath(chatOwned));

    expect(() =>
      generatedImages.deleteForMessages(['discarded-message']),
    ).not.toThrow();
    expect(generatedImages.getGeneratedImage(chatOwned.id)).toBeNull();
    expect(generatedImages.getGeneratedImage(workspaceOwned.id)).not.toBeNull();
    expect(existsSync(blobPath(workspaceOwned))).toBe(true);
  });

  it('removes workspace metadata and blobs', () => {
    seedChat('chat-workspace', 'chat-workspace', 'workspace-delete');
    const workspaceImage = createImage('chat-workspace', 'message-workspace', {
      workspaceId: 'workspace-delete',
    });

    generatedImages.deleteForWorkspace('workspace-delete');

    expect(generatedImages.getGeneratedImage(workspaceImage.id)).toBeNull();
    expect(existsSync(blobPath(workspaceImage))).toBe(false);
  });

  it('classifies only unscoped images for chat and message cleanup', () => {
    expect(generatedImages.shouldDeleteForChat({ workspaceId: null })).toBe(
      true,
    );
    expect(
      generatedImages.shouldDeleteForChat({ workspaceId: 'workspace' }),
    ).toBe(false);
    expect(generatedImages.shouldDeleteForMessages({ workspaceId: null })).toBe(
      true,
    );
    expect(
      generatedImages.shouldDeleteForMessages({ workspaceId: 'workspace' }),
    ).toBe(false);
  });
});
