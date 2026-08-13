import { test, expect } from '../fixtures';
import { seedWorkspace, seedChat } from '../utils/seed';
import { ChatPage } from '../pages/ChatPage';
import { expectComposerPopover } from '../utils/composerPopover';

const CONFIGURE_MODELS_BUTTON = { name: 'Configure models' };

test.describe('in-chat model button — workspace override', () => {
  test('a pinned workspace model locks the model button behind a read-only popover', async ({
    page,
    request,
  }) => {
    const wsId = await seedWorkspace(request, {
      name: `ws-locked-${Date.now()}`,
      modelOverride: {
        chatProvider: 'test',
        chatModel: 'test-tool',
        systemProvider: 'test',
        systemModel: 'test-direct',
      },
    });
    const chatId = await seedChat(request, { workspaceId: wsId });

    const chatPage = new ChatPage(page);
    await chatPage.goto(`/workspaces/${wsId}/c/${chatId}`);

    // The editable configurator is replaced by a focusable, read-only button —
    // no disabled control, no reachable ModelPicker/dialog.
    await expect(page.getByRole('button', CONFIGURE_MODELS_BUTTON)).toHaveCount(
      0,
    );
    const button = page.getByRole('button', {
      name: 'Models set by workspace',
    });
    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();

    // Clicking reveals a read-only popover surfacing the pinned models by their
    // display names — the chat model (tool loop) and the system model (direct).
    await button.click();
    const popover = await expectComposerPopover(
      page,
      'Models · set by workspace',
    );
    await expect(popover.getByText('Test (tool loop)')).toBeVisible();
    await expect(popover.getByText('Test (direct)')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test("the composer's image-attach affordance follows the pin, not the global selection", async ({
    page,
    request,
  }) => {
    // Pin a vision-capable model. The global selection is non-vision in the
    // test env, so the composer must accept images only because the pin says so.
    const wsId = await seedWorkspace(request, {
      name: `ws-vision-pin-${Date.now()}`,
      modelOverride: {
        chatProvider: 'test',
        chatModel: 'test-tool',
        systemProvider: 'test',
        systemModel: 'test-direct',
        imageCapable: true,
      },
    });
    const chatId = await seedChat(request, { workspaceId: wsId });

    const chatPage = new ChatPage(page);
    await chatPage.goto(`/workspaces/${wsId}/c/${chatId}`);

    const accept = await page
      .locator('input[aria-label="Attach files"]')
      .getAttribute('accept');
    expect(accept).toContain('.png');
  });

  test('a workspace with no override leaves the model button enabled', async ({
    page,
    request,
  }) => {
    const wsId = await seedWorkspace(request, {
      name: `ws-unlocked-${Date.now()}`,
    });
    const chatId = await seedChat(request, { workspaceId: wsId });

    const chatPage = new ChatPage(page);
    await chatPage.goto(`/workspaces/${wsId}/c/${chatId}`);

    const button = page.getByRole('button', CONFIGURE_MODELS_BUTTON);
    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();

    await button.click();
    await expect(
      page.getByRole('heading', { name: 'Model Configuration' }),
    ).toBeVisible();
  });

  test('an invalid pinned model shows a warning banner and blocks sending', async ({
    page,
    request,
  }) => {
    const wsId = await seedWorkspace(request, {
      name: `ws-invalid-pin-${Date.now()}`,
    });
    const chatId = await seedChat(request, { workspaceId: wsId });

    // Pin to a model absent from the test provider's catalog, after the chat
    // already exists — mirrors an admin editing the pin to a since-removed model.
    const patchRes = await request.patch(`/api/workspaces/${wsId}`, {
      data: {
        modelOverride: {
          chatProvider: 'test',
          chatModel: 'nonexistent-model',
          systemProvider: 'test',
          systemModel: 'nonexistent-model',
        },
      },
    });
    expect(patchRes.ok()).toBe(true);

    const chatPage = new ChatPage(page);
    await chatPage.goto(`/workspaces/${wsId}/c/${chatId}`);

    await expect(
      page.getByText(
        "This workspace's pinned model is no longer available. Update it in workspace settings.",
      ),
    ).toBeVisible();
    await expect(chatPage.submit).toBeDisabled();

    await chatPage.input.fill('Hello there');
    await page.keyboard.press('Enter');
    // Enter-to-send funnels through the same guard as the button — the
    // message should remain in the composer instead of being sent.
    await expect(chatPage.input).toHaveValue('Hello there');
  });
});
