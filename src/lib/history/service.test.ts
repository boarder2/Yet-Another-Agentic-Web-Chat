import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listAllArtifacts: vi.fn(),
  listAllGeneratedImages: vi.fn(),
}));

vi.mock('@/lib/artifacts/service', () => ({
  listAllArtifacts: mocks.listAllArtifacts,
}));
vi.mock('@/lib/generatedImages/service', () => ({
  listAllGeneratedImages: mocks.listAllGeneratedImages,
}));

import { isHistoryType, listHistory } from './service';

const page = (id: string, updatedAt: string) => ({
  id,
  chatId: `chat-${id}`,
  workspaceId: null,
  title: `Page ${id}`,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date(updatedAt),
  latestVersion: 1,
  versionCount: 1,
  chatTitle: `Chat ${id}`,
});

const image = (id: string, createdAt: string) => ({
  id,
  extension: 'png' as const,
  mimeType: 'image/png',
  prompt: '  A\n skyline  ',
  assistantMessageId: `assistant-${id}`,
  chatId: `chat-${id}`,
  workspaceId: 'workspace-1',
  createdAt: new Date(createdAt),
  imageUrl: `/api/uploads/images/${id}`,
  chatTitle: `Chat ${id}`,
});

describe('history aggregation', () => {
  beforeEach(() => {
    mocks.listAllArtifacts.mockReset();
    mocks.listAllGeneratedImages.mockReset();
    mocks.listAllArtifacts.mockReturnValue([]);
    mocks.listAllGeneratedImages.mockReturnValue([]);
  });

  it('combines page and image summaries and sorts by their activity timestamps', () => {
    const oldPage = page('page-1', '2024-01-02T00:00:00Z');
    const newImage = image('image-1', '2024-01-03T00:00:00Z');
    mocks.listAllArtifacts.mockReturnValue([oldPage]);
    mocks.listAllGeneratedImages.mockReturnValue([newImage]);

    const result = listHistory({ workspaceIds: ['workspace-1', 'none'] });

    expect(mocks.listAllArtifacts).toHaveBeenCalledWith({
      workspaceIds: ['workspace-1', 'none'],
    });
    expect(mocks.listAllGeneratedImages).toHaveBeenCalledWith({
      workspaceIds: ['workspace-1', 'none'],
    });
    expect(result.map((item) => [item.type, item.id])).toEqual([
      ['image', 'image-1'],
      ['page', 'page-1'],
    ]);
    expect(result[0]).toMatchObject({
      type: 'image',
      title: 'A skyline',
      prompt: '  A\n skyline  ',
      assistantMessageId: 'assistant-image-1',
      chatTitle: 'Chat image-1',
      imageUrl: '/api/uploads/images/image-1',
      latestVersion: 1,
      versionCount: 1,
    });
  });

  it('applies pages and images type filters without querying the excluded kind', () => {
    const seededPage = page('page-1', '2024-01-02T00:00:00Z');
    const seededImage = image('image-1', '2024-01-03T00:00:00Z');
    mocks.listAllArtifacts.mockReturnValue([seededPage]);
    mocks.listAllGeneratedImages.mockReturnValue([seededImage]);

    const pages = listHistory({ type: 'pages' });
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ type: 'page', id: 'page-1' });
    expect(mocks.listAllArtifacts).toHaveBeenCalledTimes(1);
    expect(mocks.listAllGeneratedImages).not.toHaveBeenCalled();

    mocks.listAllArtifacts.mockClear();
    mocks.listAllGeneratedImages.mockClear();

    const images = listHistory({ type: 'images' });
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ type: 'image', id: 'image-1' });
    expect(mocks.listAllArtifacts).not.toHaveBeenCalled();
    expect(mocks.listAllGeneratedImages).toHaveBeenCalledTimes(1);
  });

  it('recognizes only the public history type values', () => {
    expect(isHistoryType('all')).toBe(true);
    expect(isHistoryType('pages')).toBe(true);
    expect(isHistoryType('images')).toBe(true);
    expect(isHistoryType('artifacts')).toBe(false);
    expect(isHistoryType('')).toBe(false);
  });
});
