import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';
import { seedChat, seedToolChat } from '../utils/seed';
import { HistoryPage } from '../pages/HistoryPage';

/**
 * Type a search query and return once the list has rendered exactly the rows
 * that query's own response carried. Waiting for the response alone is not
 * enough: it resolves before React re-renders, which would let a "no match"
 * assertion pass against the previous query's rows. In search mode the browser
 * renders `response.chats` verbatim (ChatBrowser's `displayedChats`), so the
 * row count is an exact settle signal rather than a heuristic.
 */
async function search(page: Page, query: string) {
  const response = page.waitForResponse((r) => {
    const url = new URL(r.url());
    return (
      url.pathname === '/api/chats' &&
      url.searchParams.get('q') === query &&
      r.ok()
    );
  });
  await page.locator('input[aria-label="Search chats"]').fill(query);
  const { chats } = (await (await response).json()) as { chats: unknown[] };
  await expect(page.locator('[data-list-row]')).toHaveCount(chats.length);
}

test.describe('history: library', () => {
  test('seeded chats appear with titles and counts in the history list', async ({
    page,
    request,
  }) => {
    // Seed 3 chats with distinct first-message contents.
    // The chat title is derived from the first user message.
    const seedContents = [
      `history-test-alpha-${Date.now()}`,
      `history-test-beta-${Date.now()}`,
      `history-test-gamma-${Date.now()}`,
    ];

    for (const content of seedContents) {
      await seedChat(request, { content });
    }

    const historyPage = new HistoryPage(page);
    await historyPage.goto();
    await historyPage.waitForChats();

    // Assert each seeded chat's title is present.
    const titles = await historyPage.chatTitles();
    for (const content of seedContents) {
      // The title may be a truncation/summary of the content; assert the
      // content appears somewhere in the rendered titles list.
      const found = titles.some((t) => t.includes(content));
      expect(
        found,
        `chat with content "${content}" should appear in titles`,
      ).toBe(true);
    }

    // Assert the summary counts account for our seeded chats. The history
    // summary's "messages" figure counts user messages only (see the chats
    // route: it filters messagesTable.role === 'user'), so each single-turn
    // seeded chat contributes exactly one conversation and one message.
    const counts = await historyPage.summaryCounts();
    expect(counts).not.toBeNull();
    expect(counts!.conversations).toBeGreaterThanOrEqual(seedContents.length);
    expect(counts!.messages).toBeGreaterThanOrEqual(seedContents.length);

    // Rows navigate via a real anchor, so they honour cmd/middle-click and
    // "open in new tab" rather than only a JS click handler.
    await expect(
      historyPage.chatRowWithTitle(seedContents[0]).getByRole('link').first(),
    ).toHaveAttribute('href', /\/c\//);
  });

  test('text search finds matching chats and excludes non-matching', async ({
    page,
    request,
  }) => {
    // Seed chats where only ONE contains the unique search token.
    const token = `needle-${Date.now()}`;
    await seedChat(request, { content: `irrelevant one ${Date.now()}` });
    await seedChat(request, { content: `the target ${token} is here` });
    await seedChat(request, { content: `irrelevant two ${Date.now()}` });

    const historyPage = new HistoryPage(page);
    await historyPage.goto();
    await historyPage.waitForChats();

    await search(page, token);

    // Only the matching chat should appear.
    const titles = await historyPage.chatTitles();
    expect(titles.length).toBe(1);
    expect(titles[0]).toContain(token);

    // Clear the search and verify all chats reappear.
    await page.getByLabel('Clear search').click();
    await expect
      .poll(() => historyPage.chatTitles().then((t) => t.length))
      .toBeGreaterThanOrEqual(3);
  });

  test('text search shows empty message when no chats match', async ({
    page,
    request,
  }) => {
    // Seed one chat then search for a token it does not contain.
    await seedChat(request, { content: `only-chat-${Date.now()}` });

    const historyPage = new HistoryPage(page);
    await historyPage.goto();
    await historyPage.waitForChats();

    await search(page, `no-match-${Date.now()}`);

    // The empty-search message is shown.
    await expect(
      page.getByText('No conversations match your search.'),
    ).toBeVisible();

    // No chat rows are rendered.
    const titles = await historyPage.chatTitles();
    expect(titles.length).toBe(0);
  });

  test('search excludes execution markup and matches only visible conversation prose', async ({
    page,
    request,
  }) => {
    const promptMarker = `toolchat-${Date.now()}`;
    const docMarker = `docmarker-${Date.now()}`;
    await seedToolChat(request, {
      promptContent: `${promptMarker} tell me about the document`,
      fileContent: `The secret document marker is ${docMarker}.`,
    });

    const historyPage = new HistoryPage(page);
    await historyPage.goto();
    await historyPage.waitForChats();

    // The tool name lives only inside the widget envelope, never in visible prose.
    await search(page, 'file_search');
    expect(
      (await historyPage.chatTitles()).some((t) => t.includes(promptMarker)),
    ).toBe(false);

    // The file_search result content is persisted only in a system-role row.
    await search(page, docMarker);
    expect(
      (await historyPage.chatTitles()).some((t) => t.includes(promptMarker)),
    ).toBe(false);

    // Serialized widget-fence syntax must not match either.
    await search(page, 'yaawc:tool_call');
    expect(
      (await historyPage.chatTitles()).some((t) => t.includes(promptMarker)),
    ).toBe(false);

    // A phrase from the visible assistant answer matches, with a leak-free preview.
    await search(page, 'the answer is deterministic');
    expect(
      (await historyPage.chatTitles()).some((t) => t.includes(promptMarker)),
    ).toBe(true);

    const excerpt = await historyPage
      .chatRowWithTitle(promptMarker)
      .locator('p.line-clamp-2')
      .textContent();
    expect(excerpt).toContain('the answer is deterministic');
    expect(excerpt).not.toContain('yaawc:');
    expect(excerpt).not.toContain(docMarker);
  });
});
