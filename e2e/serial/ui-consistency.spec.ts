import { test, expect } from '../fixtures';
import { ChatPage } from '../pages/ChatPage';
import { SettingsPage } from '../pages/SettingsPage';
import {
  seedChat,
  seedSystemPrompt,
  seedWorkflow,
  seedWorkspace,
} from '../utils/seed';
import { uniq } from '../utils/helpers';
import { expectComposerPopover } from '../utils/composerPopover';
import type { APIRequestContext, Locator, Page } from '@playwright/test';

type Settings = Record<string, string | undefined>;

async function readSettings(request: APIRequestContext): Promise<Settings> {
  const response = await request.get('/api/settings');
  expect(response.status()).toBe(200);
  return (await response.json()) as Settings;
}

async function patchSettings(
  request: APIRequestContext,
  data: Record<string, string | null>,
) {
  const response = await request.patch('/api/settings', { data });
  expect(response.status()).toBe(204);
}

async function waitForSetting(
  request: APIRequestContext,
  key: string,
  value: string | null,
) {
  await expect
    .poll(async () => {
      const settings = await readSettings(request);
      return settings[key] ?? null;
    })
    .toBe(value);
}

async function resolvedBackgroundClass(page: Page, className: string) {
  return page.evaluate((className) => {
    const probe = document.createElement('span');
    probe.className = className;
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return value;
  }, className);
}

async function expectComposerActionButton(
  button: Locator,
  geometry: 'compact' | 'content',
) {
  await expect(button).toHaveClass(/(^|\s)rounded-control(\s|$)/);
  await expect(button).toHaveClass(/(^|\s)active:scale-95(\s|$)/);
  await expect(button).toHaveClass(/(^|\s)focus-visible:outline-2(\s|$)/);
  await expect(button).toHaveClass(/(^|\s)focus-visible:outline-accent(\s|$)/);
  await expect(button).toHaveClass(
    /(^|\s)focus-visible:outline-offset-2(\s|$)/,
  );

  if (geometry === 'compact') {
    await expect(button).toHaveClass(/(^|\s)h-8(\s|$)/);
    await expect(button).toHaveClass(/(^|\s)w-8(\s|$)/);
    await expect(button).not.toHaveClass(/(^|\s)min-h-8(\s|$)/);
  } else {
    await expect(button).toHaveClass(/(^|\s)min-h-8(\s|$)/);
    await expect(button).toHaveClass(/(^|\s)px-2(\s|$)/);
    await expect(button).not.toHaveClass(/(^|\s)w-8(\s|$)/);
  }
}

async function expectComposerActionState(
  button: Locator,
  { configured, open }: { configured: boolean; open: boolean },
) {
  if (configured || open) {
    await expect(button).toHaveClass(/(^|\s)text-accent(\s|$)/);
  } else {
    await expect(button).toHaveClass(/(^|\s)text-fg\/60(\s|$)/);
  }

  if (open) {
    await expect(button).toHaveClass(/(^|\s)bg-surface-2(\s|$)/);
  } else {
    await expect(button).not.toHaveClass(/(^|\s)bg-surface-2(\s|$)/);
  }
}

async function switchStyles(toggle: Locator) {
  return toggle.evaluate((element) => {
    const track = getComputedStyle(element);
    const thumb = element.querySelector('span');
    const thumbStyle = thumb ? getComputedStyle(thumb) : null;
    return {
      width: track.width,
      height: track.height,
      background: track.backgroundColor,
      outlineWidth: track.outlineWidth,
      outlineStyle: track.outlineStyle,
      outlineColor: track.outlineColor,
      outlineOffset: track.outlineOffset,
      thumbWidth: thumbStyle?.width,
      thumbHeight: thumbStyle?.height,
      thumbBackground: thumbStyle?.backgroundColor,
    };
  });
}

async function expectCanonicalSwitch(
  page: Page,
  toggle: Locator,
  checked: boolean,
) {
  await expect(toggle).toHaveAttribute('role', 'switch');
  await expect(toggle).toHaveAttribute('aria-checked', String(checked));

  const expectedBackground = await resolvedBackgroundClass(
    page,
    checked ? 'bg-accent' : 'bg-surface-2',
  );
  await expect
    .poll(async () => (await switchStyles(toggle)).background)
    .toBe(expectedBackground);

  const styles = await switchStyles(toggle);
  expect(styles.width).toBe('40px');
  expect(styles.height).toBe('20px');
  expect(styles.thumbWidth).toBe('16px');
  expect(styles.thumbHeight).toBe('16px');
  expect(styles.thumbBackground).toBe(
    await resolvedBackgroundClass(page, 'bg-bg'),
  );
}

async function expectKeyboardFocusOutline(
  page: Page,
  previous: Locator,
  toggle: Locator,
) {
  for (const control of [previous, toggle]) {
    await expect(control).toHaveClass(/focus-visible:outline-2/);
    await expect(control).toHaveClass(/focus-visible:outline-accent/);
    await expect(control).toHaveClass(/focus-visible:outline-offset-2/);
  }

  await previous.focus();
  await page.keyboard.press('Tab');
  await expect(toggle).toBeFocused();

  const styles = await switchStyles(toggle);
  await previous.focus();
  const buttonFocus = await previous.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      width: style.outlineWidth,
      offset: style.outlineOffset,
      style: style.outlineStyle,
      color: style.outlineColor,
    };
  });
  await toggle.focus();
  await expect(toggle).toBeFocused();

  expect(styles.outlineStyle).not.toBe('none');
  expect(styles.outlineWidth).toBe('2px');
  expect(styles.outlineOffset).toBe('2px');
  expect(styles.outlineColor).toBe(buttonFocus.color);
}

test.describe('canonical AppSwitch migrations', () => {
  test('Image Generation keeps its callback and canonical keyboard focus treatment', async ({
    page,
    request,
  }) => {
    const before = await readSettings(request);
    const original = before.imageGenerationEnabled ?? null;

    try {
      await patchSettings(request, { imageGenerationEnabled: 'false' });

      const settings = new SettingsPage(page);
      await settings.goto();
      await settings.openSection('Image Generation');

      const dialog = page.getByRole('dialog');
      const toggle = dialog.getByRole('switch', {
        name: 'Enable image generation',
      });
      await expect(toggle).toBeVisible();
      await expect(toggle).toHaveAttribute('title', 'Enable image generation');
      await expectCanonicalSwitch(page, toggle, false);
      await expectKeyboardFocusOutline(
        page,
        dialog.getByRole('button', { name: 'Refresh', exact: true }),
        toggle,
      );

      // Pointer activation is the public callback seam: it changes the switch
      // state and preserves the existing success toast.
      await toggle.click();
      await expectCanonicalSwitch(page, toggle, true);
      await expect(
        page.getByText(
          'Image generation enabled. Configure your model below.',
          { exact: true },
        ),
      ).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(() => localStorage.getItem('imageGenerationEnabled')),
        )
        .toBe('true');
      await waitForSetting(request, 'imageGenerationEnabled', 'true');
    } finally {
      // Let the debounced browser write settle before restoring the DB source of
      // truth; the next serial test receives a clean setting.
      await page.waitForTimeout(600);
      await patchSettings(request, {
        imageGenerationEnabled: original,
      });
    }
  });

  test('Personalization preserves disabled and checked switch semantics', async ({
    page,
    request,
  }) => {
    const before = await readSettings(request);
    const keys = [
      'personalization.location',
      'personalization.about',
      'personalization.sendLocationEnabled',
      'personalization.sendProfileEnabled',
    ];
    const original = Object.fromEntries(
      keys.map((key) => [key, before[key] ?? null]),
    );

    try {
      await patchSettings(request, {
        'personalization.location': null,
        'personalization.about': null,
        'personalization.sendLocationEnabled': 'false',
        'personalization.sendProfileEnabled': 'false',
      });

      await page.goto('/');
      const input = page.locator('#message-input');
      await expect(input).toBeVisible();
      await page.getByTitle('Personalization options').click();

      const location = page.getByRole('switch', { name: 'Send location' });
      const profile = page.getByRole('switch', {
        name: 'Send personalization',
      });
      await expect(location).toBeDisabled();
      await expect(profile).toBeDisabled();
      await expectCanonicalSwitch(page, location, false);
      await expectCanonicalSwitch(page, profile, false);
      await expect(location).toHaveAttribute('disabled', '');
      await expect(profile).toHaveAttribute('disabled', '');

      // Supply both saved values, then exercise the two callbacks through the
      // composer instead of mutating the component's props in test setup.
      await patchSettings(request, {
        'personalization.location': 'Seattle, WA',
        'personalization.about': 'A deterministic test user.',
        'personalization.sendLocationEnabled': 'false',
        'personalization.sendProfileEnabled': 'false',
      });
      await page.reload({ waitUntil: 'networkidle' });
      await page.getByTitle('Personalization options').click();

      await expect(location).toBeEnabled();
      await expect(profile).toBeEnabled();
      await location.click();
      await profile.click();
      await expectCanonicalSwitch(page, location, true);
      await expectCanonicalSwitch(page, profile, true);
      await expect
        .poll(() =>
          page.evaluate(() => ({
            location: localStorage.getItem(
              'personalization.sendLocationEnabled',
            ),
            profile: localStorage.getItem('personalization.sendProfileEnabled'),
          })),
        )
        .toEqual({ location: 'true', profile: 'true' });
      await waitForSetting(
        request,
        'personalization.sendLocationEnabled',
        'true',
      );
      await waitForSetting(
        request,
        'personalization.sendProfileEnabled',
        'true',
      );
    } finally {
      await page.waitForTimeout(600);
      await patchSettings(request, original);
    }
  });

  test('widget Thinking and schedule Enabled keep checked callback behavior', async ({
    page,
    request,
  }) => {
    const workflowId = await seedWorkflow(request, {
      name: uniq('switch-schedule-workflow'),
    });

    try {
      await page.goto('/dashboard');
      await expect(
        page.getByRole('heading', { name: 'Dashboard', exact: true }),
      ).toBeVisible();
      await page
        .getByRole('button', { name: 'Create Your First Widget' })
        .click();

      const widgetDialog = page.getByRole('dialog');
      const thinking = widgetDialog.getByRole('switch', {
        name: 'Show thinking tags',
      });
      await expect(thinking).toBeVisible();
      await expectCanonicalSwitch(page, thinking, false);
      await thinking.click();
      await expectCanonicalSwitch(page, thinking, true);

      const toolsTrigger = widgetDialog.getByTitle('Select Tools');
      await expect(toolsTrigger).toBeVisible();
      await toolsTrigger.click();
      const toolsPopover = await expectComposerPopover(page, 'Select Tools');
      await expect(
        toolsPopover.getByText('Choose tools to assist the AI.', {
          exact: true,
        }),
      ).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(toolsPopover).toBeHidden();

      await widgetDialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(widgetDialog).toBeHidden();

      await page.goto(`/automations/schedules/new?workflow=${workflowId}`);
      await expect(
        page.getByRole('heading', { name: 'New Schedule', exact: true }),
      ).toBeVisible();
      const enabled = page.getByRole('switch', { name: 'Toggle enabled' });
      await expectCanonicalSwitch(page, enabled, true);
      await enabled.click();
      await expectCanonicalSwitch(page, enabled, false);
    } finally {
      const response = await request.delete(`/api/workflows/${workflowId}`);
      expect([200, 404]).toContain(response.status());
    }
  });
});

test.describe('composer popover shell', () => {
  test('Focus and right-aligned selectors use the canonical floating shell', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('#message-input')).toBeVisible();

    const controls = [
      { triggerTitle: 'Focus Mode', shellTitle: 'Focus Mode' },
      { triggerTitle: 'Select Prompts', shellTitle: 'Persona Prompts' },
      {
        triggerTitle: 'Select Research Methodology',
        shellTitle: 'Research Methodology',
      },
      {
        triggerTitle: 'Personalization options',
        shellTitle: 'Personalization',
      },
    ];

    for (const { triggerTitle, shellTitle } of controls) {
      await page.getByTitle(triggerTitle).click();
      const shell = await expectComposerPopover(page, shellTitle);
      await page.keyboard.press('Escape');
      await expect(shell).toBeHidden();
    }
  });

  test('Agent Panel keeps its nested Model Field shell independently visible', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('#message-input')).toBeVisible();

    await page.getByRole('button', { name: 'Configure agent panel' }).click();
    const panel = await expectComposerPopover(page, 'Agent Panel');
    const modelFieldTrigger = panel.getByRole('button', {
      name: 'Select Model',
    });
    await expect(modelFieldTrigger).toBeVisible();
    await modelFieldTrigger.click();

    const modelField = await expectComposerPopover(page, 'Select Chat Model');
    await expect(panel).toBeVisible();
    await expect(modelField).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(modelField).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  });

  test('Model Configurator preset popover uses the canonical floating shell', async ({
    page,
    request,
  }) => {
    const before = await readSettings(request);
    const original = before.modelPresets ?? null;
    const preset = {
      id: 'ui-consistency-model-preset',
      name: 'UI consistency preset',
      chatProvider: 'test',
      chatModel: 'test-direct',
      systemProvider: 'test',
      systemModel: 'test-direct',
      imageCapable: false,
      contextWindowSize: 32768,
      createdAt: 0,
    };

    try {
      await patchSettings(request, { modelPresets: JSON.stringify([preset]) });
      await page.goto('/');
      await expect(page.locator('#message-input')).toBeVisible();

      const trigger = page.getByRole('button', { name: 'Choose model preset' });
      await expect(trigger).toBeVisible();
      await trigger.click();
      const shell = await expectComposerPopover(page, 'Model Presets');
      await expect(shell.getByText('UI consistency preset')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(shell).toBeHidden();
    } finally {
      await patchSettings(request, { modelPresets: original });
    }
  });
});

test.describe('composer action triggers', () => {
  test('shares compact states, focus treatment, pointer press, and panel joining', async ({
    page,
    request,
  }) => {
    const before = await readSettings(request);
    const keys = [
      'panelSelection',
      'ttsAutoplay',
      'selectedSystemPromptIds',
      'selectedMethodologyId',
      'modelPresets',
    ];
    const original = Object.fromEntries(
      keys.map((key) => [key, before[key] ?? null]),
    );

    try {
      await patchSettings(request, {
        panelSelection: JSON.stringify({
          enabled: true,
          executors: [
            { provider: 'test', name: 'test-direct', contextWindowSize: 32768 },
            { provider: 'test', name: 'test-tool', contextWindowSize: 32768 },
          ],
        }),
        ttsAutoplay: 'false',
        selectedSystemPromptIds: null,
        selectedMethodologyId: null,
        modelPresets: null,
      });

      await page.goto('/');
      await expect(page.locator('#message-input')).toBeVisible();

      const focus = page.getByTitle('Focus Mode');
      const panelToggle = page.getByRole('switch', { name: /^Agent Panel/ });
      const panelConfig = page.getByRole('button', {
        name: 'Configure agent panel',
      });
      const attach = page.getByRole('button', {
        name: 'Attach files',
        exact: true,
      });
      const model = page.getByRole('button', {
        name: 'Configure models',
        exact: true,
      });
      const prompts = page.getByTitle('Select Prompts');
      const methodology = page.getByTitle('Select Research Methodology');
      const personalization = page.getByTitle('Personalization options');
      const autoRead = page.locator('button[aria-pressed="false"]');

      for (const button of [
        focus,
        panelToggle,
        panelConfig,
        attach,
        model,
        prompts,
        methodology,
        personalization,
        autoRead,
      ]) {
        await expectComposerActionButton(button, 'compact');
      }

      // A configured control is accent-colored while closed; opening it adds
      // the raised surface without changing the state meaning.
      await expectComposerActionState(panelToggle, {
        configured: true,
        open: false,
      });
      await expectComposerActionState(focus, {
        configured: false,
        open: false,
      });
      await panelConfig.click();
      await expectComposerActionState(panelConfig, {
        configured: true,
        open: true,
      });
      await page.keyboard.press('Escape');
      await expectComposerActionState(panelConfig, {
        configured: true,
        open: false,
      });

      const chat = new ChatPage(page);
      await chat.selectFocusMode('Local Research');
      await expectComposerActionState(focus, {
        configured: true,
        open: false,
      });
      await focus.click();
      await expectComposerActionState(focus, {
        configured: true,
        open: true,
      });
      await page.keyboard.press('Escape');

      // The shared keyboard treatment is present on the real action, not only
      // on a wrapper: Tab from the composer input produces the 2px accent ring.
      await page.locator('#message-input').focus();
      await page.keyboard.press('Tab');
      await expect(focus).toBeFocused();
      const outline = await focus.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          width: style.outlineWidth,
          offset: style.outlineOffset,
          style: style.outlineStyle,
          color: style.outlineColor,
        };
      });
      expect(outline).toMatchObject({
        width: '2px',
        offset: '2px',
      });
      expect(outline.style).not.toBe('none');
      expect(outline.color).not.toBe('transparent');
      expect(outline.color).not.toBe('rgba(0, 0, 0, 0)');

      // Pointer activation exposes the explicit active:scale-95 state and
      // still invokes Auto-read's existing aria/localStorage callback.
      await expectComposerActionState(autoRead, {
        configured: false,
        open: false,
      });
      const autoBox = await autoRead.boundingBox();
      expect(autoBox).not.toBeNull();
      await page.mouse.move(
        autoBox!.x + autoBox!.width / 2,
        autoBox!.y + autoBox!.height / 2,
      );
      await page.mouse.down();
      try {
        await expect
          .poll(async () =>
            autoRead.evaluate((element) => {
              const style = getComputedStyle(element);
              return style.scale === '0.95' || style.transform.includes('0.95');
            }),
          )
          .toBe(true);
      } finally {
        await page.mouse.up();
      }
      await expect(page.locator('button[aria-pressed="true"]')).toBeVisible();
      await expect(page.locator('button[aria-pressed="true"]')).toHaveClass(
        /(^|\s)text-accent(\s|$)/,
      );
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem('ttsAutoplay')))
        .toBe('true');
      await waitForSetting(request, 'ttsAutoplay', 'true');

      // Panel remains a joined split control, and unsupported focus modes mute
      // both halves instead of making a disabled action look configured.
      await expect(panelToggle).toHaveClass(/(^|\s)rounded-r-none(\s|$)/);
      await expect(panelConfig).toHaveClass(/(^|\s)sm:rounded-l-none(\s|$)/);
      await chat.selectFocusMode('Chat');
      await expect(panelConfig).toBeDisabled();
      await expect(panelConfig).toHaveCSS('cursor', 'not-allowed');
      await expect(panelConfig).toHaveClass(/(^|\s)disabled:opacity-40(\s|$)/);
      await expect(panelConfig).toHaveClass(/(^|\s)disabled:text-fg\/30(\s|$)/);
    } finally {
      await page.waitForTimeout(600);
      await patchSettings(request, original);
      for (const [key, value] of Object.entries(original)) {
        await page.evaluate(
          ({ key, value }) => {
            if (value === null) localStorage.removeItem(key);
            else localStorage.setItem(key, value);
          },
          { key, value },
        );
      }
    }
  });

  test('content-width triggers retain selected-count and attachment status', async ({
    page,
    request,
  }) => {
    const promptName = uniq('composer-content-prompt');
    const promptId = await seedSystemPrompt(request, { name: promptName });
    const before = await readSettings(request);
    const original = {
      selectedSystemPromptIds: before.selectedSystemPromptIds ?? null,
      selectedMethodologyId: before.selectedMethodologyId ?? null,
    };

    try {
      await patchSettings(request, {
        selectedSystemPromptIds: null,
        selectedMethodologyId: null,
      });
      await page.goto('/');
      await expect(page.locator('#message-input')).toBeVisible();

      const prompts = page.getByTitle('Select Prompts');
      await expectComposerActionButton(prompts, 'compact');
      await prompts.click();
      const promptPopover = await expectComposerPopover(
        page,
        'Persona Prompts',
      );
      await expect(
        promptPopover.getByText(promptName, { exact: true }),
      ).toBeVisible();
      await promptPopover.getByText(promptName, { exact: true }).click();
      await expectComposerActionButton(prompts, 'content');
      await expectComposerActionState(prompts, {
        configured: true,
        open: true,
      });
      await page.keyboard.press('Escape');
      await expectComposerActionState(prompts, {
        configured: true,
        open: false,
      });

      const fileName = 'att.txt';
      const chat = new ChatPage(page);
      await chat.attachFile(fileName, 'A deterministic attachment.');
      const attachment = page.getByRole('button', {
        name: fileName,
        exact: true,
      });
      await expectComposerActionButton(attachment, 'content');
      await expectComposerActionState(attachment, {
        configured: true,
        open: false,
      });
      await attachment.click();
      await expect(
        page.getByRole('heading', { name: 'Attached files' }),
      ).toBeVisible();
      await expectComposerActionState(attachment, {
        configured: true,
        open: true,
      });
      await page.keyboard.press('Escape');
      await expect(
        page.getByRole('heading', { name: 'Attached files' }),
      ).toBeHidden();
    } finally {
      await page.waitForTimeout(600);
      await patchSettings(request, original);
      await request.delete(`/api/system-prompts/${promptId}`);
      await page.evaluate(
        ({ selectedSystemPromptIds, selectedMethodologyId }) => {
          for (const [key, value] of Object.entries({
            selectedSystemPromptIds,
            selectedMethodologyId,
          })) {
            if (value === null) localStorage.removeItem(key);
            else localStorage.setItem(key, value);
          }
        },
        original,
      );
    }
  });

  test('widget tools, model fields, and context usage use content or compact geometry', async ({
    page,
    request,
  }) => {
    await page.goto('/dashboard');
    await expect(
      page.getByRole('heading', { name: 'Dashboard', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Create Your First Widget' })
      .click();
    const widgetDialog = page.getByRole('dialog');
    const tools = widgetDialog.getByTitle('Select Tools');
    await expectComposerActionButton(tools, 'content');
    await tools.click();
    await expectComposerPopover(page, 'Select Tools');
    await page.keyboard.press('Escape');
    await widgetDialog.getByRole('button', { name: 'Cancel' }).click();

    await page.goto('/');
    await expect(page.locator('#message-input')).toBeVisible();
    await page.getByRole('button', { name: 'Configure models' }).click();
    const dialog = page.getByRole('dialog');
    const chatModelField = dialog.locator('button:has(svg.lucide-cpu)').first();
    await expectComposerActionButton(chatModelField, 'content');
    await chatModelField.click();
    const modelPopover = await expectComposerPopover(page, 'Select Chat Model');
    await expectComposerActionState(chatModelField, {
      configured: true,
      open: true,
    });
    await page.keyboard.press('Escape');
    await expect(modelPopover).toBeHidden();
    await dialog.getByLabel('Close').click();

    const chatId = await seedChat(request, {
      content: 'Context indicator geometry fixture',
      focusMode: 'webSearch',
    });

    try {
      await page.goto(`/c/${chatId}`);
      await expect(page.locator('#message-input')).toBeVisible();
      const context = page.locator('button[title^="Context usage:"]');
      await expect(context).toHaveCount(1);
      await expectComposerActionButton(context, 'compact');
      await context.click();
      await expectComposerActionState(context, {
        configured: false,
        open: true,
      });
      await page.keyboard.press('Escape');
    } finally {
      const response = await request.delete(`/api/chats/${chatId}`);
      expect([200, 204, 404]).toContain(response.status());
    }
  });
});

test.describe('ordinary selection checkboxes', () => {
  test('WidgetChatPanel, workspace instructions, and MCP scopes remain checkboxes', async ({
    page,
    request,
  }) => {
    const workspaceName = uniq('checkbox-workspace');
    const promptName = uniq('checkbox-prompt');
    const workspaceId = await seedWorkspace(request, { name: workspaceName });
    const promptId = await seedSystemPrompt(request, { name: promptName });
    const serverResponse = await request.post('/api/mcp/servers', {
      data: { name: uniq('checkbox-mcp'), url: 'https://example.com/mcp' },
    });
    expect(serverResponse.status()).toBe(201);
    const server = (await serverResponse.json()).server as {
      id: string;
      name: string;
    };

    try {
      await page.goto(`/workspaces/${workspaceId}`);
      const sidebar = page.locator('aside');
      await sidebar.getByRole('button', { name: 'Instructions' }).click();
      const linkedPrompt = page.getByRole('checkbox', {
        name: `Link system prompt: ${promptName}`,
      });
      await expect(linkedPrompt).toBeVisible();
      await expect(linkedPrompt).toHaveAttribute('type', 'checkbox');
      await expect(linkedPrompt).not.toHaveAttribute('role', 'switch');

      const settings = new SettingsPage(page);
      await settings.goto();
      await settings.openSection('MCP Servers');
      const serverCard = page
        .locator('div.border.border-surface-2.rounded-surface.p-4')
        .filter({ hasText: server.name });
      await expect(serverCard).toBeVisible();
      await serverCard.getByRole('button', { name: /Workspaces/ }).click();
      const workspaceScope = page.getByRole('checkbox', {
        name: `Scope to workspace: ${workspaceName}`,
      });
      await expect(workspaceScope).toBeVisible();
      await expect(workspaceScope).toHaveAttribute('type', 'checkbox');
      await expect(workspaceScope).not.toHaveAttribute('role', 'switch');

      // The code widget is opened with a mocked config response only to expose
      // its existing assistant panel; no LLM or sandbox request is made.
      await page.route('**/api/config', async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        await route.fulfill({
          response,
          json: {
            ...body,
            codeExecution: { ...(body.codeExecution ?? {}), enabled: true },
          },
        });
      });
      await page.addInitScript(() => {
        localStorage.setItem('codeExecutionWarningAccepted', 'true');
      });
      await page.goto('/dashboard');
      await page
        .getByRole('heading', { name: 'Dashboard', exact: true })
        .waitFor({ state: 'visible' });
      await page
        .getByRole('button', { name: 'Create Your First Widget' })
        .click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: /Code Widget/ })
        .click();
      const codeDialog = page.getByRole('dialog');
      await expect(
        codeDialog.getByRole('heading', { name: 'Create Code Widget' }),
      ).toBeVisible();
      await codeDialog.getByRole('button', { name: 'Assistant' }).click();
      const autoApply = codeDialog.getByRole('checkbox', {
        name: 'Auto-apply proposals',
      });
      await expect(autoApply).toBeVisible();
      await expect(autoApply).toHaveAttribute('type', 'checkbox');
      await expect(autoApply).not.toHaveAttribute('role', 'switch');
    } finally {
      const serverDelete = await request.delete(
        `/api/mcp/servers/${server.id}`,
      );
      expect([200, 404]).toContain(serverDelete.status());
      const promptDelete = await request.delete(
        `/api/system-prompts/${promptId}`,
      );
      expect([200, 404]).toContain(promptDelete.status());
      const workspaceDelete = await request.delete(
        `/api/workspaces/${workspaceId}`,
      );
      expect([200, 204, 404]).toContain(workspaceDelete.status());
    }
  });
});
