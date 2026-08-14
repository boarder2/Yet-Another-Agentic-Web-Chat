import { test, expect } from '../fixtures';
import { ChatPage } from '../pages/ChatPage';

test.describe('capability documentation chat treatment', () => {
  test.afterEach(async ({ request }) => {
    const response = await request.patch('/api/settings', {
      data: { chatModelProvider: 'test', chatModel: 'test-direct' },
    });
    expect(response.ok()).toBe(true);
  });

  test('shows the docs tool, internal source treatment, and an openable section citation', async ({
    page,
  }) => {
    const chat = new ChatPage(page);
    await chat.goto('/');
    await chat.selectChatModel('Test (YAAWC docs search)');
    await chat.sendMessage('What focus modes does YAAWC provide?');

    const tool = page
      .locator('[data-execution]')
      .filter({ hasText: 'Searching YAAWC documentation' });
    await expect(tool).toBeVisible({ timeout: 15_000 });
    await expect(tool.locator('svg.lucide-book-open')).toBeVisible();
    await chat.waitForStreamComplete();
    await expect(
      page
        .locator('[data-answer]')
        .getByText(
          'YAAWC capability claims are grounded in the bundled documentation',
        ),
    ).toBeVisible();
    await expect(tool.locator('svg.text-success')).toBeVisible();

    await chat.openSources();
    const source = page
      .locator(
        'a[href="/docs/capabilities/chat-and-research#choose-a-focus-mode"]',
      )
      .filter({ has: page.locator('h3') })
      .first();
    await expect(source).toHaveAttribute(
      'href',
      '/docs/capabilities/chat-and-research#choose-a-focus-mode',
    );
    await expect(
      source.getByRole('heading', {
        name: 'Chat and research — Choose a focus mode',
        exact: true,
      }),
    ).toBeVisible();
    await expect(source.locator('svg.lucide-book-open')).toBeVisible();

    const citation = page
      .locator(
        '[data-answer] a[href="/docs/capabilities/chat-and-research#choose-a-focus-mode"]',
      )
      .first();
    await expect(citation).toHaveAttribute(
      'href',
      '/docs/capabilities/chat-and-research#choose-a-focus-mode',
    );
    const popupPromise = page.waitForEvent('popup');
    await citation.click();
    const docsPage = await popupPromise;
    await expect(docsPage).toHaveURL(
      /\/docs\/capabilities\/chat-and-research#choose-a-focus-mode$/,
    );
    await expect(docsPage.locator('h2#choose-a-focus-mode')).toBeVisible();
    await docsPage.close();
  });
});
