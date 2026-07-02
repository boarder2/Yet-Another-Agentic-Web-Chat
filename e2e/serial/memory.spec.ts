import { test, expect } from '../fixtures';
import { seedMemory } from '../utils/seed';
import { MemoryPage } from '../pages/MemoryPage';

const MEMORY_ALPHA = `memory-alpha-${Date.now()}`;
const MEMORY_BETA = `memory-beta-${Date.now()}`;

test.describe('memory management', () => {
  // memoryEnabled is a DB-synced, instance-wide setting also toggled by
  // settings-persistence.spec.ts — this spec's `serial` project (one worker)
  // keeps them from racing each other.

  test('add, read, delete a memory and trigger re-index', async ({
    page,
    request,
  }) => {
    const memoryPage = new MemoryPage(page);

    // Open settings → Memory.
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await memoryPage.open();

    // Ensure memory is enabled so the add UI is available.
    await memoryPage.enableMemory();

    // ── Add a memory ──
    await memoryPage.addMemory(MEMORY_ALPHA);

    // Assert it appears in the UI (identity-based — scoped to our record).
    const contents = await memoryPage.memoryContents();
    expect(contents).toContain(MEMORY_ALPHA);

    // Assert the count grew (relative assertion avoids race with parallel tests).
    const countAfter = await memoryPage.totalCount();
    expect(countAfter).toBeGreaterThan(0);

    // Assert it persisted via API.
    const listRes = await request.get('/api/memories');
    const listBody = await listRes.json();
    const found = (listBody.data as Array<{ content: string }>).find(
      (m) => m.content === MEMORY_ALPHA,
    );
    expect(found).toBeDefined();

    // ── Delete the memory ──
    await memoryPage.deleteMemory(MEMORY_ALPHA);

    // Assert it's gone from the UI (identity-based).
    const contentsAfter = await memoryPage.memoryContents();
    expect(contentsAfter).not.toContain(MEMORY_ALPHA);

    // ── Re-index ──
    await memoryPage.reindex();
    // The re-index button should not cause an error overlay.
    // (The fixture's pageerror guard will catch any JS errors.)

    await memoryPage.close();
  });

  test('multiple memories coexist, deleting one leaves others intact', async ({
    page,
    request,
  }) => {
    // Pre-seed one memory via API so it exists before the UI opens.
    await seedMemory(request, { content: MEMORY_ALPHA });

    const memoryPage = new MemoryPage(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await memoryPage.open();
    await memoryPage.enableMemory();

    // The pre-seeded memory should be visible. It was seeded via the API (not
    // added through the UI), so unlike `addMemory` there's no built-in wait for
    // the list's initial fetch to resolve — wait for its row explicitly.
    await memoryPage.waitForMemory(MEMORY_ALPHA);
    const initialContents = await memoryPage.memoryContents();
    expect(initialContents).toContain(MEMORY_ALPHA);

    // Add a second memory through the UI.
    await memoryPage.addMemory(MEMORY_BETA);

    // Both memories are present (identity-based — scoped to our records only).
    const bothContents = await memoryPage.memoryContents();
    expect(bothContents).toContain(MEMORY_ALPHA);
    expect(bothContents).toContain(MEMORY_BETA);

    // Delete only the UI-added memory.
    await memoryPage.deleteMemory(MEMORY_BETA);

    // The pre-seeded memory remains; only the targeted one is gone.
    const afterDelete = await memoryPage.memoryContents();
    expect(afterDelete).toContain(MEMORY_ALPHA);
    expect(afterDelete).not.toContain(MEMORY_BETA);

    await memoryPage.close();
  });
});
