import {
  deleteForChat as deleteArtifactsForChat,
  deleteForWorkspace as deleteArtifactsForWorkspace,
  deleteVersionsForMessages as deleteArtifactVersionsForMessages,
  listAllArtifacts,
  type ArtifactListSummary,
} from '@/lib/artifacts/service';
import {
  deleteForChat as deleteGeneratedImagesForChat,
  deleteForMessages as deleteGeneratedImagesForMessages,
  deleteForWorkspace as deleteGeneratedImagesForWorkspace,
  listAllGeneratedImages,
  type GeneratedImageListSummary,
} from '@/lib/generatedImages/service';

export const HISTORY_TYPES = ['all', 'pages', 'images'] as const;
export type HistoryType = (typeof HISTORY_TYPES)[number];

export interface HistoryFilter {
  type?: HistoryType;
  workspaceIds?: string[];
}

export type HistoryPageItem = ArtifactListSummary & {
  type: 'page';
};

/**
 * Images carry the small common projection used by the existing artifact list
 * while the history UI transitions to the discriminated `type` field. The
 * version values are compatibility metadata: an image is one immutable item,
 * not an artifact with editable versions.
 */
export type HistoryImageItem = GeneratedImageListSummary & {
  type: 'image';
  title: string;
  updatedAt: Date;
  latestVersion: number;
  versionCount: number;
};

export type HistoryItem = HistoryPageItem | HistoryImageItem;

export function isHistoryType(value: string): value is HistoryType {
  return (HISTORY_TYPES as readonly string[]).includes(value);
}

function imageTitle(prompt: string): string {
  const title = prompt.replace(/\s+/g, ' ').trim();
  return title || 'Generated image';
}

function activityTime(item: HistoryItem): number {
  return item.type === 'page'
    ? item.updatedAt.getTime()
    : item.createdAt.getTime();
}

function compareHistoryItems(a: HistoryItem, b: HistoryItem): number {
  const byActivity = activityTime(b) - activityTime(a);
  if (byActivity !== 0) return byActivity;
  return `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`);
}

function imageItem(image: GeneratedImageListSummary): HistoryImageItem {
  return {
    ...image,
    type: 'image',
    title: imageTitle(image.prompt),
    updatedAt: image.createdAt,
    latestVersion: 1,
    versionCount: 1,
  };
}

/** List the shared history projection, newest activity first. */
export function listHistory(filter: HistoryFilter = {}): HistoryItem[] {
  const type = filter.type ?? 'all';
  const pages: HistoryPageItem[] =
    type === 'images'
      ? []
      : listAllArtifacts({ workspaceIds: filter.workspaceIds }).map(
          (page) => ({ ...page, type: 'page' }) as HistoryPageItem,
        );
  const images: HistoryImageItem[] =
    type === 'pages'
      ? []
      : listAllGeneratedImages({ workspaceIds: filter.workspaceIds }).map(
          imageItem,
        );

  return [...pages, ...images].sort(compareHistoryItems);
}

/** Delete all history produced by a chat, preserving workspace-owned items. */
export function deleteForChat(chatId: string): void {
  deleteArtifactsForChat(chatId);
  deleteGeneratedImagesForChat(chatId);
}

/** Delete every history item owned by a workspace. */
export function deleteForWorkspace(workspaceId: string): void {
  deleteArtifactsForWorkspace(workspaceId);
  deleteGeneratedImagesForWorkspace(workspaceId);
}

/** Delete chat-scoped history anchored to discarded assistant messages. */
export function deleteForMessages(messageIds: string[]): void {
  deleteArtifactVersionsForMessages(messageIds);
  deleteGeneratedImagesForMessages(messageIds);
}
