import fs from 'node:fs';
import path from 'node:path';
import type { APIRequestContext } from '@playwright/test';
import { test, expect } from '../fixtures/api';
import { seedWorkspace, seedWorkspaceFile, fileSha } from '../utils/seed';

// The test server runs with DATA_DIR=e2e/.test-data on this same filesystem, so
// the storage layout itself is assertable — several of these bugs were invisible
// through the API alone.
const BLOB_ROOT = path.resolve('./e2e/.test-data/workspace-files');

const blobDir = (wsId: string, fileId: string) =>
  path.join(BLOB_ROOT, wsId, fileId);

async function getContent(
  request: APIRequestContext,
  wsId: string,
  fileId: string,
) {
  const res = await request.get(`/api/workspaces/${wsId}/files/${fileId}`);
  expect(res.status()).toBe(200);
  return (await res.json()).content;
}

function put(
  request: APIRequestContext,
  wsId: string,
  fileId: string,
  content: string,
  expectedSha: string,
) {
  return request.put(`/api/workspaces/${wsId}/files/${fileId}`, {
    data: { content, expectedSha },
  });
}

test.describe('workspace file storage integrity', () => {
  test('saving identical content twice keeps the file readable', async ({
    request,
  }) => {
    // Regression: GC counted references *excluding* the row being written, so an
    // unchanged sha looked unreferenced and its blob was unlinked out from under
    // the live row.
    const wsId = await seedWorkspace(request);
    const fileId = await seedWorkspaceFile(request, wsId, {
      name: 'same.txt',
      content: 'unchanged',
    });

    const first = await put(
      request,
      wsId,
      fileId,
      'unchanged',
      await fileSha(request, wsId, fileId),
    );
    expect(first.status()).toBe(200);

    const second = await put(
      request,
      wsId,
      fileId,
      'unchanged',
      await fileSha(request, wsId, fileId),
    );
    expect(second.status()).toBe(200);

    expect(await getContent(request, wsId, fileId)).toBe('unchanged');
  });

  test('two files with identical content survive deleting one', async ({
    request,
  }) => {
    // Regression: blobs were shared by content across files, so deleting one file
    // GC'd the bytes its twin was still using.
    const wsId = await seedWorkspace(request);
    const keepId = await seedWorkspaceFile(request, wsId, {
      name: 'keep.txt',
      content: 'twins',
    });
    const dropId = await seedWorkspaceFile(request, wsId, {
      name: 'drop.txt',
      content: 'twins',
    });

    const del = await request.delete(`/api/workspaces/${wsId}/files/${dropId}`);
    expect(del.status()).toBe(200);

    expect(await getContent(request, wsId, keepId)).toBe('twins');
    expect(fs.existsSync(blobDir(wsId, dropId))).toBe(false);
    expect(fs.existsSync(blobDir(wsId, keepId))).toBe(true);
  });

  test('a stale expectedSha is rejected and the winning write survives', async ({
    request,
  }) => {
    const wsId = await seedWorkspace(request);
    const fileId = await seedWorkspaceFile(request, wsId, {
      name: 'cas.txt',
      content: 'v1',
    });
    const staleSha = await fileSha(request, wsId, fileId);

    const winner = await put(request, wsId, fileId, 'v2', staleSha);
    expect(winner.status()).toBe(200);
    const winnerSha = (await winner.json()).file.sha256;

    const loser = await put(request, wsId, fileId, 'v3-clobber', staleSha);
    expect(loser.status()).toBe(409);
    expect(await loser.json()).toMatchObject({ currentSha: winnerSha });

    expect(await getContent(request, wsId, fileId)).toBe('v2');
  });

  test('concurrent writes: exactly one wins, the other is told to re-read', async ({
    request,
  }) => {
    const wsId = await seedWorkspace(request);
    const fileId = await seedWorkspaceFile(request, wsId, {
      name: 'race.txt',
      content: 'base',
    });
    const sha = await fileSha(request, wsId, fileId);

    const [a, b] = await Promise.all([
      put(request, wsId, fileId, 'from-a', sha),
      put(request, wsId, fileId, 'from-b', sha),
    ]);

    const codes = [a.status(), b.status()].sort();
    expect(codes).toEqual([200, 409]);

    // The survivor is whichever one committed — never a mix, never empty.
    const content = await getContent(request, wsId, fileId);
    expect(['from-a', 'from-b']).toContain(content);
    const winner = a.status() === 200 ? a : b;
    expect((await winner.json()).file.sha256).toBe(
      await fileSha(request, wsId, fileId),
    );
  });

  test('concurrent writes of identical content leave the blob intact', async ({
    request,
  }) => {
    // The loser must not clean up a staged blob the winner published — same bytes
    // hash to the same name, so a blind unlink would delete live content.
    const wsId = await seedWorkspace(request);
    const fileId = await seedWorkspaceFile(request, wsId, {
      name: 'same-race.txt',
      content: 'base',
    });
    const sha = await fileSha(request, wsId, fileId);

    const [a, b] = await Promise.all([
      put(request, wsId, fileId, 'identical', sha),
      put(request, wsId, fileId, 'identical', sha),
    ]);
    expect([a.status(), b.status()].sort()).toEqual([200, 409]);

    expect(await getContent(request, wsId, fileId)).toBe('identical');
  });

  test('deleting a workspace reclaims its blobs', async ({ request }) => {
    // Regression: the GC path joined an already-absolute blob path onto the root,
    // producing a path that never existed — every blob leaked forever.
    const wsId = await seedWorkspace(request);
    await seedWorkspaceFile(request, wsId, { name: 'a.txt', content: 'a' });
    await seedWorkspaceFile(request, wsId, { name: 'b.txt', content: 'b' });

    const wsDir = path.join(BLOB_ROOT, wsId);
    expect(fs.existsSync(wsDir)).toBe(true);

    const del = await request.delete(`/api/workspaces/${wsId}`);
    expect(del.status()).toBe(204);

    expect(fs.existsSync(wsDir)).toBe(false);
  });
});
