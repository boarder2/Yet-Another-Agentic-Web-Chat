import { test, expect } from '../fixtures';
import { seedChat } from '../utils/seed';
import { expectComposerPopover } from '../utils/composerPopover';

const SETTINGS_KEYS = [
  'chatModelProvider',
  'chatModel',
  'systemModelProvider',
  'systemModel',
  'chatReasoningEffort',
  'systemReasoningEffort',
  'modelPresets',
] as const;

type ModelReferencePayload = {
  provider: string;
  name: string;
  reasoningEffort?: string;
};

function expectChatEffortAndSystemFallback(body: {
  chatModel?: ModelReferencePayload;
  systemModel?: ModelReferencePayload;
}) {
  expect(body.chatModel).toMatchObject({
    provider: 'test',
    name: 'test-reasoning',
    reasoningEffort: 'high',
  });

  // The UI may omit System entirely to let the server copy the complete Chat
  // reference, or send an explicit copy. Either form must retain the effort.
  if (body.systemModel !== undefined) {
    expect(body.systemModel).toMatchObject({
      provider: 'test',
      name: 'test-reasoning',
      reasoningEffort: 'high',
    });
  }
}

test.describe('reasoning effort composer persistence', () => {
  test('inherits Chat effort for send and compaction when System selection is absent', async ({
    page,
    request,
  }) => {
    const before = (await (
      await request.get('/api/settings')
    ).json()) as Record<string, string>;
    const reset = await request.patch('/api/settings', {
      data: {
        chatModelProvider: 'test',
        chatModel: 'test-reasoning',
        systemModelProvider: null,
        systemModel: null,
        chatReasoningEffort: 'high',
        systemReasoningEffort: null,
        modelPresets: null,
      },
    });
    expect(reset.status()).toBe(204);

    let chatId: string | undefined;
    try {
      chatId = await seedChat(request, {
        content: 'Reasoning-effort fallback fixture',
      });
      await page.goto(`/c/${chatId}`);
      await expect(page.locator('#message-input')).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(() => ({
            chatProvider: localStorage.getItem('chatModelProvider'),
            chatModel: localStorage.getItem('chatModel'),
            chatEffort: localStorage.getItem('chatReasoningEffort'),
            systemProvider: localStorage.getItem('systemModelProvider'),
            systemModel: localStorage.getItem('systemModel'),
          })),
        )
        .toEqual({
          chatProvider: 'test',
          chatModel: 'test-reasoning',
          chatEffort: 'high',
          systemProvider: null,
          systemModel: null,
        });

      const sendRequestPromise = page.waitForRequest(
        (candidate) =>
          new URL(candidate.url()).pathname === '/api/chat' &&
          candidate.method() === 'POST',
      );
      await page.locator('#message-input').fill('send fallback request');
      await page.locator('#message-input').press('Enter');
      const sendBody = (await sendRequestPromise).postDataJSON() as {
        chatModel?: ModelReferencePayload;
        systemModel?: ModelReferencePayload;
      };
      expectChatEffortAndSystemFallback(sendBody);
      await expect(page.locator('button[type="submit"]')).toBeVisible({
        timeout: 15_000,
      });

      const context = page.locator('button[title^="Context usage:"]');
      await expect(context).toBeVisible();
      await context.click();
      const compact = page.getByRole('button', {
        name: 'Compact conversation',
        exact: true,
      });
      await expect(compact).toBeEnabled();

      const compactRequestPromise = page.waitForRequest(
        (candidate) =>
          new URL(candidate.url()).pathname === '/api/chat/compact' &&
          candidate.method() === 'POST',
      );
      await compact.click();
      const compactRequest = await compactRequestPromise;
      const compactBody = compactRequest.postDataJSON() as {
        chatModel?: ModelReferencePayload;
        systemModel?: ModelReferencePayload;
      };
      expectChatEffortAndSystemFallback(compactBody);
      const compactResponse = await compactRequest.response();
      expect(compactResponse?.ok()).toBe(true);
    } finally {
      if (chatId) {
        const response = await request.delete(`/api/chats/${chatId}`);
        expect([200, 204, 404]).toContain(response.status());
      }
      const restore = Object.fromEntries(
        SETTINGS_KEYS.map((key) => [key, before[key] ?? null]),
      );
      const restored = await request.patch('/api/settings', {
        data: restore,
      });
      expect(restored.status()).toBe(204);
    }
  });

  test('persists independent Chat and System effort across reload and removes defaults', async ({
    page,
    request,
  }) => {
    const before = (await (
      await request.get('/api/settings')
    ).json()) as Record<string, string>;
    const reset = await request.patch('/api/settings', {
      data: {
        chatModelProvider: 'test',
        chatModel: 'test-direct',
        systemModelProvider: 'test',
        systemModel: 'test-direct',
        chatReasoningEffort: null,
        systemReasoningEffort: null,
        modelPresets: null,
      },
    });
    expect(reset.status()).toBe(204);

    try {
      await page.goto('/');
      await page.locator('#message-input').waitFor({ state: 'visible' });
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem('chatModel')))
        .toBe('test-direct');

      await page.getByRole('button', { name: 'Configure models' }).click();
      const dialog = page.getByRole('dialog');
      await expect(
        dialog.getByRole('heading', { name: 'Model Configuration' }),
      ).toBeVisible();

      await dialog.locator('button:has(svg.lucide-cpu)').first().click();
      const chatPopover = await expectComposerPopover(
        page,
        'Select Chat Model',
      );
      await chatPopover.getByText('Test (reasoning)', { exact: true }).click();
      await expect(page.getByLabel('Chat reasoning effort')).toBeVisible();
      await page.getByLabel('Chat reasoning effort').selectOption('high');

      await dialog.locator('button:has(svg.lucide-cpu)').nth(1).click();
      const systemPopover = await expectComposerPopover(
        page,
        'Select System Model',
      );
      await systemPopover
        .getByText('Test (reasoning)', { exact: true })
        .click();
      await expect(page.getByLabel('System reasoning effort')).toBeVisible();
      await page.getByLabel('System reasoning effort').selectOption('low');

      await expect
        .poll(async () => {
          const settings = await (await request.get('/api/settings')).json();
          return [
            settings.chatModel,
            settings.systemModel,
            settings.chatReasoningEffort,
            settings.systemReasoningEffort,
          ];
        })
        .toEqual(['test-reasoning', 'test-reasoning', 'high', 'low']);

      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('#message-input').waitFor({ state: 'visible' });
      await page.getByRole('button', { name: 'Configure models' }).click();
      const reloadedDialog = page.getByRole('dialog');
      await expect(
        reloadedDialog.getByRole('heading', { name: 'Model Configuration' }),
      ).toBeVisible();
      await expect(page.getByLabel('Chat reasoning effort')).toHaveValue(
        'high',
      );
      await expect(page.getByLabel('System reasoning effort')).toHaveValue(
        'low',
      );

      await page.getByLabel('Chat reasoning effort').selectOption('');
      await page.getByLabel('System reasoning effort').selectOption('');
      await expect
        .poll(() =>
          page.evaluate(() => ({
            chat: localStorage.getItem('chatReasoningEffort'),
            system: localStorage.getItem('systemReasoningEffort'),
          })),
        )
        .toEqual({ chat: null, system: null });
      await expect
        .poll(async () => {
          const settings = await (await request.get('/api/settings')).json();
          return [
            settings.chatReasoningEffort ?? null,
            settings.systemReasoningEffort ?? null,
          ];
        })
        .toEqual([null, null]);
    } finally {
      const restore = Object.fromEntries(
        SETTINGS_KEYS.map((key) => [key, before[key] ?? null]),
      );
      const restored = await request.patch('/api/settings', {
        data: restore,
      });
      expect(restored.status()).toBe(204);
    }
  });
});
