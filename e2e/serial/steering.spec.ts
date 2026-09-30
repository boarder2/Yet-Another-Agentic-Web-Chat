import { test, expect } from '../fixtures';
import { ChatPage } from '../pages/ChatPage';

const WAIT_TEXT = 'Checking the documents.';

test.describe('steering a running agent', () => {
  // Switches the composer's chat model, an instance-wide DB-synced setting.
  test.afterEach(async ({ request }) => {
    await request.patch('/api/settings', {
      data: { chatModelProvider: 'test', chatModel: 'test-direct' },
    });
  });

  async function startSteerableRun(chat: ChatPage, query: string) {
    await chat.goto('/');
    await chat.selectChatModel('Test (steerable)');
    await chat.sendMessage(query);
    await expect(chat.message(WAIT_TEXT)).toBeVisible({ timeout: 10_000 });
  }

  async function steer(chat: ChatPage, text: string) {
    await chat.input.fill(text);
    await chat.input.press('Enter');
  }

  test('a steer shows as queued, then inline where the agent received it', async ({
    page,
  }) => {
    const chat = new ChatPage(page);
    await startSteerableRun(chat, `steer-inline-${Date.now()}`);

    await steer(chat, 'Only cover 2024');
    await expect(page.getByTestId('pending-steer')).toHaveText(
      /Only cover 2024/,
    );
    await expect(chat.input).toHaveValue('');

    await expect(page.getByTestId('steer-message')).toHaveText(
      /Only cover 2024/,
      { timeout: 10_000 },
    );
    await expect(page.getByTestId('pending-steer')).toHaveCount(0);
    await expect(chat.message('Acting on: Only cover 2024')).toBeVisible({
      timeout: 10_000,
    });
    await chat.waitForStreamComplete();
  });

  test('a queued steer can be removed before the agent receives it', async ({
    page,
  }) => {
    const chat = new ChatPage(page);
    const query = `steer-remove-${Date.now()}`;
    await startSteerableRun(chat, query);

    await steer(chat, 'Never mind this');
    const chip = page.getByTestId('pending-steer');
    await expect(chip).toBeVisible();
    await chip.getByRole('button', { name: 'Remove queued message' }).click();
    await expect(chip).toHaveCount(0);

    await expect(chat.message(`Acting on: ${query}`)).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId('steer-message')).toHaveCount(0);
  });

  test('cancelling hands an undelivered steer back to the composer', async ({
    page,
  }) => {
    const chat = new ChatPage(page);
    await startSteerableRun(chat, `steer-cancel-${Date.now()}`);

    await steer(chat, 'Try another angle');
    await expect(page.getByTestId('pending-steer')).toBeVisible();
    await chat.cancelButton.click();

    await expect(chat.input).toHaveValue('Try another angle');
    await expect(page.getByTestId('pending-steer')).toHaveCount(0);
  });

  test('a steer sent while the final answer streams becomes the next turn', async ({
    page,
    request,
  }) => {
    const chat = new ChatPage(page);
    const query = `steer-followup-${Date.now()}`;
    await chat.goto('/');
    await chat.selectChatModel('Test (slow stream)');
    await chat.sendMessage(query);
    await expect(chat.cancelButton).toBeVisible();
    // The answer has started streaming: no model call remains to receive a
    // steer.
    await expect(page.getByText(/^This\b/)).toBeVisible({ timeout: 10_000 });

    await steer(chat, 'Now answer in French');

    await expect(
      page.getByText('Now answer in French', { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('steer-message')).toHaveCount(0);

    const chatId = new URL(page.url()).pathname.split('/').pop()!;
    await expect
      .poll(
        async () => {
          const body = await (await request.get(`/api/chats/${chatId}`)).json();
          const msgs: Array<{ role: string; content: string }> = body.messages;
          return {
            users: msgs.filter((m) => m.role === 'user').map((m) => m.content),
            answers: msgs.filter((m) => m.role === 'assistant').length,
            idle: body.chat.activeRunMessageId === null,
          };
        },
        { timeout: 20_000 },
      )
      .toEqual({
        users: [query, 'Now answer in French'],
        answers: 2,
        idle: true,
      });
    await chat.waitForStreamComplete();
  });
});
