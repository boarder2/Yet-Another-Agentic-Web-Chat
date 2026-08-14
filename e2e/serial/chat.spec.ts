import { test, expect } from '../fixtures';
import { ChatPage } from '../pages/ChatPage';
import { HistoryPage } from '../pages/HistoryPage';
import { seedChat, seedExpandableToolChat } from '../utils/seed';

const DETERMINISTIC_ANSWER = 'This is a deterministic test answer.';
const TOOL_ANSWER = 'Based on the document, the answer is deterministic.';

test.describe('chat conversation flow', () => {
  // These tests switch the composer's chat model (a DB-synced, instance-wide
  // setting — see src/lib/settings/keys.ts), and one that doesn't expects the
  // seeded default. This spec's `serial` project (one worker, declaration
  // order) keeps a model switch in one from leaking into another test before
  // its own cleanup runs, and from racing any other spec touching the same
  // settings row. Reset after each test so the next test starts clean.
  test.afterEach(async ({ request }) => {
    await request.patch('/api/settings', {
      data: { chatModelProvider: 'test', chatModel: 'test-direct' },
    });
  });

  test('submit on Home streams an answer, persists, and appears in history', async ({
    page,
    request,
  }) => {
    const chat = new ChatPage(page);
    const query = `home-stream-${Date.now()}`;

    await chat.goto('/');
    await chat.sendMessage(query);

    // test-direct streams synchronously (no artificial delay), so the run
    // routinely completes before the Cancel button would be observable —
    // just wait for the composer to revert to Submit (run finished).
    await chat.waitForStreamComplete();

    await expect(chat.message(DETERMINISTIC_ANSWER)).toBeVisible({
      timeout: 10_000,
    });

    // The URL is rewritten in place from "/" to "/c/{chatId}" without a
    // navigation (see NewChatWindow) — read the chat id back out of it.
    const chatId = new URL(page.url()).pathname.split('/').pop()!;
    const getRes = await request.get(`/api/chats/${chatId}`);
    expect(getRes.status()).toBe(200);
    const body = await getRes.json();
    const msgs: Array<{ role: string; content: string }> = body.messages;
    expect(msgs.find((m) => m.role === 'user')?.content).toBe(query);
    expect(msgs.find((m) => m.role === 'assistant')?.content).toBe(
      DETERMINISTIC_ANSWER,
    );

    const history = new HistoryPage(page);
    await history.goto();
    await history.waitForChats();
    expect(await history.chatTitles()).toContain(query);
  });

  test('switching focus mode changes the active mode and is sent with the next message', async ({
    page,
    request,
  }) => {
    const chat = new ChatPage(page);
    const query = `focus-switch-${Date.now()}`;

    await chat.goto('/');

    // Default is "All" (webSearch); switch to "Chat".
    await chat.selectFocusMode('Chat');
    // The trigger is accent-colored whenever focus mode isn't the default.
    await expect(chat.focusButton).toHaveClass(/text-accent/);

    await chat.sendMessage(query);
    await chat.waitForStreamComplete();

    const chatId = new URL(page.url()).pathname.split('/').pop()!;
    const getRes = await request.get(`/api/chats/${chatId}`);
    const body = await getRes.json();
    expect(body.chat.focusMode).toBe('chat');
  });

  test('stop mid-stream halts the run before it completes', async ({
    page,
    request,
  }) => {
    const chat = new ChatPage(page);
    const query = `cancel-mid-stream-${Date.now()}`;

    await chat.goto('/');
    await chat.selectChatModel('Test (slow stream)');
    await chat.sendMessage(query);

    await expect(chat.cancelButton).toBeVisible();
    await chat.cancelButton.click();
    await chat.waitForStreamComplete();

    const chatId = new URL(page.url()).pathname.split('/').pop()!;
    await expect
      .poll(
        async () => {
          const res = await request.get(`/api/chats/${chatId}`);
          return (await res.json()).chat.lastRunStatus;
        },
        { timeout: 10_000 },
      )
      .toBe('cancelled');

    // The run was actually interrupted, not merely raced to completion: the
    // persisted assistant message must not be the full deterministic answer.
    const body = await (await request.get(`/api/chats/${chatId}`)).json();
    const msgs: Array<{ role: string; content: string }> = body.messages;
    const assistantMsg = msgs.find((m) => m.role === 'assistant');
    expect(assistantMsg?.content ?? '').not.toBe(DETERMINISTIC_ANSWER);
  });

  test('a follow-up message threads into the same chat', async ({
    page,
    request,
  }) => {
    const chat = new ChatPage(page);
    const first = `followup-first-${Date.now()}`;
    const second = `followup-second-${Date.now()}`;

    await chat.goto('/');
    await chat.sendMessage(first);
    await chat.waitForStreamComplete();

    const chatId = new URL(page.url()).pathname.split('/').pop()!;

    await chat.sendMessage(second);
    await chat.waitForStreamComplete();

    expect(new URL(page.url()).pathname.split('/').pop()).toBe(chatId);

    const body = await (await request.get(`/api/chats/${chatId}`)).json();
    const msgs: Array<{ role: string; content: string }> = body.messages;
    expect(msgs.filter((m) => m.role === 'user')).toHaveLength(2);
    expect(msgs.filter((m) => m.role === 'assistant')).toHaveLength(2);
    expect(msgs.find((m) => m.content === second)).toBeTruthy();
  });

  test('reloading mid-stream reattaches to the active run and the answer still completes', async ({
    page,
    request,
  }) => {
    const chat = new ChatPage(page);
    const query = `resume-${Date.now()}`;

    await chat.goto('/');
    await chat.selectChatModel('Test (slow stream)');
    await chat.sendMessage(query);
    await expect(chat.cancelButton).toBeVisible();

    // The agent run lives server-side, decoupled from this HTTP connection, so
    // a hard reload while the run is still in flight must reattach to it
    // (ChatWindow's mount-time attachToRun) rather than losing the answer.
    const chatId = new URL(page.url()).pathname.split('/').pop()!;
    await page.reload();
    await chat.input.waitFor({ state: 'visible' });

    // Confirm at the data layer that the run actually completes after the
    // reload (independent of the UI's loading-state timing).
    await expect
      .poll(
        async () => {
          const res = await request.get(`/api/chats/${chatId}`);
          const body = await res.json();
          const msgs: Array<{ role: string; content: string }> = body.messages;
          return msgs.find((m) => m.role === 'assistant')?.content;
        },
        { timeout: 15_000 },
      )
      .toBe(DETERMINISTIC_ANSWER);

    await expect(chat.message(DETERMINISTIC_ANSWER)).toBeVisible({
      timeout: 15_000,
    });

    const body = await (await request.get(`/api/chats/${chatId}`)).json();
    expect(body.chat.activeRunMessageId).toBeNull();
  });

  test('Local Research mode renders file_search citations from an attached file', async ({
    page,
  }) => {
    const chat = new ChatPage(page);
    const query = `local-research-${Date.now()}`;
    const fileName = 'doc.txt';

    await chat.goto('/');
    await chat.selectChatModel('Test (tool loop)');
    await chat.selectFocusMode('Local Research');

    // Fake embeddings are a deterministic hash of the text, so an exact
    // content match guarantees similarity 1.0 — well above the file_search
    // tool's threshold — without depending on real semantic embeddings.
    await chat.attachFile(fileName, query);
    await chat.sendMessage(query);
    await chat.waitForStreamComplete();

    // The rendered message also includes a ToolCall summary block ahead of
    // the model's final answer — match it as a substring, not the whole
    // rendered block.
    await expect(page.getByText(TOOL_ANSWER)).toBeVisible();

    await expect(chat.sourcesButton).toBeVisible();
    await chat.openSources();
    await expect(
      page.getByRole('heading', { level: 3, name: fileName, exact: true }),
    ).toBeVisible();
  });

  test('ToolCall disclosures are keyboard buttons and preserve semantic PDF links', async ({
    page,
    request,
  }) => {
    const { chatId, pdfUrl } = await seedExpandableToolChat(request);

    try {
      await page.goto(`/c/${chatId}`);
      const tool = page
        .locator('[data-execution]')
        .filter({ hasText: 'Fetched message' })
        .first();
      const disclosure = tool.getByRole('button');
      await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
      await expect(disclosure).toHaveClass(/focus-border-neutral/);

      const spinner = disclosure.locator('svg.animate-spin');
      await expect(spinner).toBeVisible();
      await expect(spinner).toHaveAttribute('width', '16');
      await expect(spinner).toHaveAttribute('height', '16');

      await disclosure.focus();
      await page.keyboard.press('Enter');
      await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
      await expect(tool).toContainText('Tool call disclosure fixture');
      await expect(
        tool.getByRole('link', { name: 'View chat thread ↗' }),
      ).toHaveAttribute('href', `/c/${chatId}`);

      await page.keyboard.press('Space');
      await expect(disclosure).toHaveAttribute('aria-expanded', 'false');

      const pdf = page
        .locator('[data-execution]')
        .filter({ hasText: 'Loading PDF document' })
        .getByRole('link', { name: pdfUrl });
      await expect(pdf).toHaveAttribute('href', pdfUrl);
      await expect(pdf).toHaveAttribute('target', '_blank');
      await expect(pdf).toHaveClass(/bg-surface-2/);
      await expect(pdf).toHaveClass(/font-mono/);
      await expect(pdf).toHaveClass(/text-accent/);
    } finally {
      const response = await request.delete(`/api/chats/${chatId}`);
      expect([200, 204, 404]).toContain(response.status());
    }
  });

  test('image and video results open their lightboxes from the keyboard', async ({
    page,
    request,
  }) => {
    const chatId = await seedChat(request, {
      content: `keyboard-media-${Date.now()}`,
    });
    const pixel =
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

    await page.route('**/api/config', async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as Record<string, unknown> & {
        searchCapabilitiesRegular?: Record<string, boolean>;
        searchCapabilitiesPrivate?: Record<string, boolean>;
      };
      await route.fulfill({
        response,
        json: {
          ...body,
          searchCapabilitiesRegular: {
            ...body.searchCapabilitiesRegular,
            images: true,
            videos: true,
          },
          searchCapabilitiesPrivate: {
            ...body.searchCapabilitiesPrivate,
            images: true,
            videos: true,
          },
        },
      });
    });
    await page.route('**/api/images', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          images: [
            {
              url: 'https://example.com/deterministic-image',
              img_src: pixel,
              title: 'Deterministic image',
            },
          ],
        }),
      });
    });
    await page.route('**/api/videos', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          videos: [
            {
              url: 'https://example.com/deterministic-video',
              img_src: pixel,
              title: 'Deterministic video',
              iframe_src: 'https://example.com/embed/deterministic-video',
            },
          ],
        }),
      });
    });

    try {
      await page.goto(`/c/${chatId}`);
      const imagesTab = page.getByTitle('Images');
      const videosTab = page.getByTitle('Videos');
      await expect(imagesTab).toBeVisible();
      await expect(videosTab).toBeVisible();

      await imagesTab.focus();
      await page.keyboard.press('Enter');
      await expect(imagesTab).toHaveAttribute('aria-pressed', 'true');
      const imageTrigger = page.getByRole('button', {
        name: 'Open image Deterministic image',
        exact: true,
      });
      await expect(imageTrigger).toBeVisible();
      await imageTrigger.focus();
      await page.keyboard.press('Enter');
      const imageLightbox = page.getByRole('dialog', { name: 'Lightbox' });
      await expect(imageLightbox).toBeVisible();
      await expect(imageLightbox.locator('img').first()).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(imageLightbox).toBeHidden();

      await videosTab.focus();
      await page.keyboard.press('Enter');
      await expect(videosTab).toHaveAttribute('aria-pressed', 'true');
      const videoTrigger = page.getByRole('button', {
        name: 'Open video Deterministic video',
        exact: true,
      });
      await expect(videoTrigger).toBeVisible();
      await videoTrigger.focus();
      await page.keyboard.press('Enter');
      const videoLightbox = page.getByRole('dialog', { name: 'Lightbox' });
      await expect(videoLightbox).toBeVisible();
      await expect(videoLightbox.locator('iframe').first()).toHaveAttribute(
        'src',
        /example\.com\/embed\/deterministic-video/,
      );
      await page.keyboard.press('Escape');
      await expect(videoLightbox).toBeHidden();
    } finally {
      const response = await request.delete(`/api/chats/${chatId}`);
      expect([200, 204, 404]).toContain(response.status());
    }
  });

  test('a model-forged yaawc: fence renders as a plain code block, not a widget', async ({
    page,
  }) => {
    const chat = new ChatPage(page);
    const query = `spoof-${Date.now()}`;

    await chat.goto('/');
    await chat.selectChatModel('Test (widget spoof)');
    await chat.sendMessage(query);
    await chat.waitForStreamComplete();

    // The surrounding prose still renders normally.
    await expect(page.getByText('Before.')).toBeVisible();
    await expect(page.getByText('After.')).toBeVisible();
    // No ToolCall widget was created from the forged fence — the icon/label
    // markup a real tool_call widget renders is absent.
    await expect(page.getByText('Using tool:')).toHaveCount(0);
    // The neutralized fence still renders as an (uninterpreted) code block —
    // its raw JSON text is visible on the page, not swallowed or interpreted.
    await expect(page.getByText('"id":"spoofed"')).toBeVisible();
  });
});
