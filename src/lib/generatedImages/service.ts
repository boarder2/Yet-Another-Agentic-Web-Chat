import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  type SQL,
} from 'drizzle-orm';
import db from '@/lib/db';
import { chats, generatedImages, messages } from '@/lib/db/schema';
import { UPLOADS_DIR } from '@/lib/dataDir';

const IMAGE_ID_REGEX = /^[a-f0-9]{32}$/;
const EXTENSIONS = ['png', 'jpg', 'gif', 'webp'] as const;

export type GeneratedImageExtension = (typeof EXTENSIONS)[number];

type GeneratedImageRow = typeof generatedImages.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type BlobRow = Pick<GeneratedImageRow, 'id' | 'extension'>;

const MIME_TO_EXTENSION: Record<string, GeneratedImageExtension> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export interface CreateGeneratedImageInput {
  buffer: Buffer | Uint8Array;
  mimeType: string;
  prompt: string;
  assistantMessageId: string;
  chatId: string;
  workspaceId?: string | null;
  createdAt?: Date;
}

export interface GeneratedImageSummary {
  id: string;
  extension: GeneratedImageExtension;
  mimeType: string;
  prompt: string;
  assistantMessageId: string;
  chatId: string | null;
  workspaceId: string | null;
  createdAt: Date;
  imageUrl: string;
}

export interface GeneratedImageListSummary extends GeneratedImageSummary {
  chatTitle: string | null;
}

export interface GeneratedImageListFilter {
  workspaceIds?: readonly string[];
}

/** Map a provider MIME type to the extension understood by the image route. */
export function extensionForMimeType(
  mimeType: string,
): GeneratedImageExtension {
  const normalized = mimeType.split(';', 1)[0].trim().toLowerCase();
  const extension = MIME_TO_EXTENSION[normalized];
  if (!extension) {
    throw new Error(`Unsupported generated image MIME type: ${mimeType}`);
  }
  return extension;
}

function assertImageId(imageId: string): void {
  if (!IMAGE_ID_REGEX.test(imageId)) {
    throw new Error('Invalid generated image id');
  }
}

function assertExtension(
  extension: string,
): asserts extension is GeneratedImageExtension {
  if (!(EXTENSIONS as readonly string[]).includes(extension)) {
    throw new Error('Invalid generated image extension');
  }
}

/** The filename is derived from validated metadata, never caller-supplied paths. */
export function generatedImageFilename(
  imageId: string,
  extension: string,
): string {
  assertImageId(imageId);
  assertExtension(extension);
  return `${imageId}.${extension}`;
}

function generatedImagePath(imageId: string, extension: string): string {
  return path.join(UPLOADS_DIR, generatedImageFilename(imageId, extension));
}

/** The local API URL for a persisted generated image. */
export function generatedImageUrl(imageId: string): string {
  assertImageId(imageId);
  return `/api/uploads/images/${imageId}`;
}

function toSummary(row: GeneratedImageRow): GeneratedImageSummary {
  return {
    id: row.id,
    extension: row.extension as GeneratedImageExtension,
    mimeType: row.mimeType,
    prompt: row.prompt,
    assistantMessageId: row.assistantMessageId,
    chatId: row.chatId,
    workspaceId: row.workspaceId,
    createdAt: row.createdAt,
    imageUrl: generatedImageUrl(row.id),
  };
}

function requireScopeValue(value: string, name: string): string {
  if (!value) throw new Error(`Generated image ${name} is required`);
  return value;
}

/**
 * Save the blob before inserting its row. If the metadata insert fails, the
 * newly-created blob is removed; an old upload can never become history data.
 */
export function createGeneratedImage(
  input: CreateGeneratedImageInput,
): GeneratedImageSummary {
  const chatId = requireScopeValue(input.chatId, 'chatId');
  const assistantMessageId = requireScopeValue(
    input.assistantMessageId,
    'assistantMessageId',
  );
  if (typeof input.prompt !== 'string') {
    throw new Error('Generated image prompt is required');
  }

  const extension = extensionForMimeType(input.mimeType);
  const workspaceId =
    input.workspaceId === undefined || input.workspaceId === null
      ? null
      : requireScopeValue(input.workspaceId, 'workspaceId');
  const id = crypto.randomBytes(16).toString('hex');
  const blobPath = generatedImagePath(id, extension);
  fs.writeFileSync(blobPath, Buffer.from(input.buffer), { flag: 'wx' });

  try {
    const [row] = db.transaction((tx) => {
      const [chat] = tx
        .select({ workspaceId: chats.workspaceId })
        .from(chats)
        .where(eq(chats.id, chatId))
        .limit(1)
        .all();
      if (!chat) throw new Error('Generated image chat does not exist');
      if (chat.workspaceId !== workspaceId) {
        throw new Error('Generated image workspace does not match chat');
      }

      const [assistantMessage] = tx
        .select({ messageId: messages.messageId })
        .from(messages)
        .where(
          and(
            eq(messages.messageId, assistantMessageId),
            eq(messages.chatId, chatId),
            eq(messages.role, 'assistant'),
          ),
        )
        .limit(1)
        .all();
      if (!assistantMessage) {
        throw new Error(
          'Generated image assistant message does not exist in chat',
        );
      }

      return tx
        .insert(generatedImages)
        .values({
          id,
          extension,
          mimeType: input.mimeType,
          prompt: input.prompt,
          assistantMessageId,
          chatId,
          workspaceId,
          createdAt: input.createdAt ?? new Date(),
        })
        .returning()
        .all();
    });
    if (!row) throw new Error('Generated image metadata was not created');
    return toSummary(row);
  } catch (error) {
    removeBlob({ id, extension });
    throw error;
  }
}

/** A metadata projection for one persisted image. */
export function getGeneratedImage(
  imageId: string,
): GeneratedImageSummary | null {
  if (!IMAGE_ID_REGEX.test(imageId)) return null;
  const [row] = db
    .select()
    .from(generatedImages)
    .where(eq(generatedImages.id, imageId))
    .limit(1)
    .all();
  return row ? toSummary(row) : null;
}

function workspaceCondition(workspaceIds?: readonly string[]): SQL | undefined {
  if (!workspaceIds?.length) return undefined;

  const realIds = workspaceIds.filter((id) => id !== 'none');
  const includeNone = workspaceIds.includes('none');
  if (realIds.length > 0 && includeNone) {
    return or(
      inArray(generatedImages.workspaceId, realIds),
      isNull(generatedImages.workspaceId),
    );
  }
  if (realIds.length > 0) return inArray(generatedImages.workspaceId, realIds);
  return includeNone ? isNull(generatedImages.workspaceId) : undefined;
}

const listSelect = {
  id: generatedImages.id,
  extension: generatedImages.extension,
  mimeType: generatedImages.mimeType,
  prompt: generatedImages.prompt,
  assistantMessageId: generatedImages.assistantMessageId,
  chatId: generatedImages.chatId,
  workspaceId: generatedImages.workspaceId,
  createdAt: generatedImages.createdAt,
  chatTitle: chats.title,
};

type ListRow = Omit<GeneratedImageRow, 'createdAt'> & {
  createdAt: Date;
  chatTitle: string | null;
};

function toListSummary(row: ListRow): GeneratedImageListSummary {
  const { chatTitle, ...image } = row;
  return { ...toSummary(image), chatTitle };
}

function listImages(where?: SQL): GeneratedImageListSummary[] {
  return db
    .select(listSelect)
    .from(generatedImages)
    .leftJoin(chats, eq(chats.id, generatedImages.chatId))
    .where(where)
    .orderBy(desc(generatedImages.createdAt), desc(generatedImages.id))
    .all()
    .map((row) => toListSummary(row as ListRow));
}

/** Every generated image, optionally filtered to workspace scopes. */
export function listAllGeneratedImages(
  filter: GeneratedImageListFilter = {},
): GeneratedImageListSummary[] {
  return listImages(workspaceCondition(filter.workspaceIds));
}

/** Images created by a chat, including workspace-owned images it created. */
export function listGeneratedImages(
  chatId: string,
): GeneratedImageListSummary[] {
  return listImages(eq(generatedImages.chatId, chatId));
}

/** Images owned by one workspace, regardless of their originating chat. */
export function listWorkspaceGeneratedImages(
  workspaceId: string,
): GeneratedImageListSummary[] {
  return listImages(eq(generatedImages.workspaceId, workspaceId));
}

/** Pure lifecycle decision used by chat and rewind cleanup. */
export function shouldDeleteForChat(
  image: Pick<GeneratedImageRow, 'workspaceId'>,
): boolean {
  return image.workspaceId == null;
}

/** Workspace-owned images survive a rewind; chat-scoped images do not. */
export function shouldDeleteForMessages(
  image: Pick<GeneratedImageRow, 'workspaceId'>,
): boolean {
  return image.workspaceId == null;
}

function removeBlob(row: BlobRow): boolean {
  let blobPath: string;
  try {
    blobPath = generatedImagePath(row.id, row.extension);
  } catch (error) {
    console.warn('[generatedImages] refusing unsafe blob path:', error);
    return false;
  }

  try {
    fs.unlinkSync(blobPath);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return true;
    console.warn(`[generatedImages] failed to remove ${blobPath}:`, error);
    return false;
  }
}

function removeBlobs(rows: BlobRow[]): BlobRow[] {
  return rows.filter(removeBlob);
}

function deleteRows(tx: Tx, rows: BlobRow[]): void {
  if (rows.length === 0) return;
  tx.delete(generatedImages)
    .where(
      inArray(
        generatedImages.id,
        rows.map((row) => row.id),
      ),
    )
    .run();
}

/** Delete chat-scoped images and detach workspace-owned provenance. */
export function deleteForChat(chatId: string): void {
  const rows = db
    .select({
      id: generatedImages.id,
      extension: generatedImages.extension,
      workspaceId: generatedImages.workspaceId,
    })
    .from(generatedImages)
    .where(eq(generatedImages.chatId, chatId))
    .all();
  const doomed = removeBlobs(rows.filter(shouldDeleteForChat));

  db.transaction((tx) => {
    deleteRows(tx, doomed);
    tx.update(generatedImages)
      .set({ chatId: null })
      .where(
        and(
          eq(generatedImages.chatId, chatId),
          // Workspace-owned rows are the only rows that survive this cleanup.
          isNotNull(generatedImages.workspaceId),
        ),
      )
      .run();
  });
}

/** Delete every image owned by a workspace, including its blob files. */
export function deleteForWorkspace(workspaceId: string): void {
  const rows = db
    .select({ id: generatedImages.id, extension: generatedImages.extension })
    .from(generatedImages)
    .where(eq(generatedImages.workspaceId, workspaceId))
    .all();
  const deleted = removeBlobs(rows);
  db.transaction((tx) => deleteRows(tx, deleted));
}

/** Delete chat-scoped images anchored to discarded assistant messages. */
export function deleteForMessages(messageIds: string[]): void {
  const ids = [...new Set(messageIds.filter(Boolean))];
  if (ids.length === 0) return;

  const rows = db
    .select({
      id: generatedImages.id,
      extension: generatedImages.extension,
      workspaceId: generatedImages.workspaceId,
    })
    .from(generatedImages)
    .where(
      and(
        inArray(generatedImages.assistantMessageId, ids),
        isNull(generatedImages.workspaceId),
      ),
    )
    .all();
  const deleted = removeBlobs(rows);
  db.transaction((tx) => deleteRows(tx, deleted));
}
