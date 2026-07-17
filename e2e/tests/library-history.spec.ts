import { test, expect } from '../fixtures';
import { seedChat, seedToolChat } from '../utils/seed';
import { HistoryPage } from '../pages/HistoryPage';

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

    // Type the search token into the search input.
    const searchInput = page.locator('input[aria-label="Search chats"]');
    await searchInput.fill(token);
    // Wait for the debounce + API response + re-render.
    await page.waitForTimeout(1000);

    // Only the matching chat should appear.
    const titles = await historyPage.chatTitles();
    expect(titles.length).toBe(1);
    expect(titles[0]).toContain(token);

    // Clear the search and verify all chats reappear.
    await page.getByLabel('Clear search').click();
    await page.waitForTimeout(500);
    const allTitles = await historyPage.chatTitles();
    expect(allTitles.length).toBeGreaterThanOrEqual(3);
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

    const searchInput = page.locator('input[aria-label="Search chats"]');
    await searchInput.fill(`no-match-${Date.now()}`);
    await page.waitForTimeout(1000);

    // The empty-search message is shown.
    await expect(
      page.getByText('No matching conversations found.'),
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

    const searchInput = page.locator('input[aria-label="Search chats"]');

    // The tool name lives only inside the widget envelope, never in visible prose.
    await searchInput.fill('file_search');
    await page.waitForTimeout(1000);
    expect(
      (await historyPage.chatTitles()).some((t) => t.includes(promptMarker)),
    ).toBe(false);

    // The file_search result content is persisted only in a system-role row.
    await searchInput.fill(docMarker);
    await page.waitForTimeout(1000);
    expect(
      (await historyPage.chatTitles()).some((t) => t.includes(promptMarker)),
    ).toBe(false);

    // Serialized widget-fence syntax must not match either.
    await searchInput.fill('yaawc:tool_call');
    await page.waitForTimeout(1000);
    expect(
      (await historyPage.chatTitles()).some((t) => t.includes(promptMarker)),
    ).toBe(false);

    // A phrase from the visible assistant answer matches, with a leak-free preview.
    await searchInput.fill('the answer is deterministic');
    await page.waitForTimeout(1000);
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
