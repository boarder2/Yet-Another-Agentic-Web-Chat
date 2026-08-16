import { test, expect } from '../fixtures';
import { ChatPage } from '../pages/ChatPage';
import { SettingsPage } from '../pages/SettingsPage';
import { WorkspaceDetailPage } from '../pages/WorkspaceDetailPage';
import {
  cancelAwaitingRun,
  seedAwaitingApproval,
  seedChat,
  seedSchedule,
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

/**
 * Opens the widget creator from the dashboard empty state. The board is global,
 * DB-backed state, so clear it first — a widget left by another spec replaces
 * the empty-state card with the grid and hides the entry point.
 */
async function openWidgetCreator(page: Page, request: APIRequestContext) {
  await patchSettings(request, {
    yaawc_dashboard_widgets: '[]',
    yaawc_dashboard_cache: '{}',
  });
  await page.goto('/dashboard');
  await expect(
    page.getByRole('heading', { name: 'Dashboard', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Create Your First Widget' }).click();
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

async function resolvedTextClass(page: Page, className: string) {
  return page.evaluate((className) => {
    const probe = document.createElement('span');
    probe.className = className;
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, className);
}

async function expectPrimaryButtonColors(page: Page, button: Locator) {
  const expected = {
    background: await resolvedBackgroundClass(page, 'bg-accent'),
    hoverBackground: await resolvedBackgroundClass(page, 'bg-accent-700'),
    color: await resolvedTextClass(page, 'text-accent-fg'),
  };

  await expect
    .poll(() =>
      button.evaluate((element) => {
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, color: style.color };
      }),
    )
    .toEqual({ background: expected.background, color: expected.color });

  await button.hover();
  await expect
    .poll(() =>
      button.evaluate((element) => {
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, color: style.color };
      }),
    )
    .toEqual({
      background: expected.hoverBackground,
      color: expected.color,
    });
}

async function expectComposerActionButton(
  button: Locator,
  geometry: 'compact' | 'content',
) {
  await expect(button).toHaveClass(/(^|\s)rounded-control(\s|$)/);
  await expect(button).toHaveClass(/(^|\s)border(\s|$)/);
  await expect(button).toHaveClass(/(^|\s)border-transparent(\s|$)/);
  await expect(button).toHaveClass(/(^|\s)active:scale-95(\s|$)/);
  await expect(button).toHaveClass(/(^|\s)focus-border-neutral(\s|$)/);
  await expect(button).not.toHaveClass(/(^|\s)focus-visible:outline/);

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
    await expect(button).toHaveClass(/(^|\s)text-fg-muted(\s|$)/);
  }

  if (open) {
    await expect(button).toHaveClass(/(^|\s)bg-surface-2(\s|$)/);
  } else {
    await expect(button).not.toHaveClass(/(^|\s)bg-surface-2(\s|$)/);
  }
}

function presetPanel(trigger: Locator): Locator {
  return trigger.locator('xpath=..').locator('[class~="w-72"]');
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
      color: track.color,
      borderWidth: track.borderTopWidth,
      borderColor: track.borderTopColor,
      outlineStyle: track.outlineStyle,
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
  expect(styles.borderWidth).toBe('1px');
  expect(styles.thumbBackground).toBe(
    await resolvedBackgroundClass(page, 'bg-bg'),
  );
}

async function expectKeyboardFocusBorder(
  page: Page,
  previous: Locator,
  toggle: Locator,
  tone: 'neutral' | 'contrast',
) {
  await expect(toggle).toHaveClass(
    tone === 'neutral' ? /focus-border-neutral/ : /focus-border-contrast/,
  );
  await expect(toggle).not.toHaveClass(/focus-visible:outline/);

  await previous.focus();
  await page.keyboard.press('Tab');
  await expect(toggle).toBeFocused();

  const expectedBorder =
    tone === 'neutral'
      ? await page.evaluate(() => {
          const probe = document.createElement('span');
          probe.style.border = '1px solid var(--color-accent)';
          document.body.appendChild(probe);
          const color = getComputedStyle(probe).borderTopColor;
          probe.remove();
          return color;
        })
      : (await switchStyles(toggle)).color;
  await expect
    .poll(async () => (await switchStyles(toggle)).borderColor)
    .toBe(expectedBorder);

  const styles = await switchStyles(toggle);
  expect(styles.outlineStyle).toBe('none');
  expect(styles.borderWidth).toBe('1px');
  expect(styles.borderColor).toBe(expectedBorder);
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
      await expectKeyboardFocusBorder(
        page,
        dialog.getByRole('button', { name: 'Refresh', exact: true }),
        toggle,
        'neutral',
      );

      // Pointer activation is the public callback seam: it changes the switch
      // state and preserves the existing success toast.
      await toggle.click();
      await expectCanonicalSwitch(page, toggle, true);
      await expectKeyboardFocusBorder(
        page,
        dialog.getByRole('button', { name: 'Refresh', exact: true }),
        toggle,
        'contrast',
      );
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
      await openWidgetCreator(page, request);

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

      await openWidgetCreator(page, request);
      const validationDialog = page.getByRole('dialog');
      await validationDialog
        .getByRole('button', { name: 'Create Widget' })
        .click();
      const title = validationDialog.getByLabel('Widget Title', {
        exact: true,
      });
      const prompt = validationDialog.getByLabel('LLM Prompt', { exact: true });
      await expect(title).toHaveAttribute('aria-invalid', 'true');
      await expect(prompt).toHaveAttribute('aria-invalid', 'true');
      expect(await title.getAttribute('aria-label')).toBeNull();
      expect(await prompt.getAttribute('aria-label')).toBeNull();
      const titleDescribedBy = await title.getAttribute('aria-describedby');
      const promptDescribedBy = await prompt.getAttribute('aria-describedby');
      expect(titleDescribedBy).not.toBeNull();
      expect(promptDescribedBy).not.toBeNull();
      await expect(
        validationDialog.locator(`[id="${titleDescribedBy}"]`),
      ).toContainText('Title is required');
      await expect(
        validationDialog.locator(`[id="${promptDescribedBy}"]`),
      ).toContainText('Prompt is required');

      const sources = validationDialog.getByRole('group', {
        name: 'Source URLs',
        exact: true,
      });
      const models = validationDialog.getByRole('group', {
        name: 'Model & Provider',
        exact: true,
      });
      const tools = validationDialog.getByRole('group', {
        name: 'Available Tools',
        exact: true,
      });
      const refresh = validationDialog.getByRole('group', {
        name: 'Refresh Frequency',
        exact: true,
      });
      for (const group of [sources, models, tools, refresh]) {
        await expect(group.locator('legend')).toHaveCount(1);
      }
      await expect(sources.locator('label')).toHaveCount(0);
      await expect(refresh.locator('label')).toHaveCount(0);
      await expect(
        validationDialog.getByLabel('Source URL 1', { exact: true }),
      ).toBeVisible();
      await expect(
        validationDialog.getByRole('combobox', { name: 'Refresh unit' }),
      ).toBeVisible();
      await expect(
        validationDialog.locator('input[type="number"]'),
      ).toBeVisible();
      const toolsDescribedBy = await tools.getAttribute('aria-describedby');
      expect(toolsDescribedBy).not.toBeNull();
      await expect(
        validationDialog.locator(`[id="${toolsDescribedBy}"]`),
      ).toContainText(
        'Select tools to assist the AI in processing your widget.',
      );
      await validationDialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(validationDialog).toBeHidden();

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

test.describe('composer option rows', () => {
  test('use keyboard buttons with explicit radio/check selection semantics', async ({
    page,
    request,
  }) => {
    const methodologyName = uniq('keyboard-methodology');
    const promptName = uniq('keyboard-persona');
    const methodologyId = await seedSystemPrompt(request, {
      name: methodologyName,
      type: 'methodology',
    });
    const promptId = await seedSystemPrompt(request, {
      name: promptName,
      type: 'persona',
    });
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

      const chat = new ChatPage(page);
      await chat.goto('/');

      await chat.focusButton.click();
      const focusPanel = await expectComposerPopover(page, 'Focus Mode');
      const all = focusPanel.getByRole('button', { name: /^All\b/ });
      const chatMode = focusPanel.getByRole('button', {
        name: /^Chat\b/,
      });
      const localResearch = focusPanel.getByRole('button', {
        name: /^Local Research\b/,
      });

      for (const option of [all, chatMode, localResearch]) {
        await expect(option).toHaveAttribute('type', 'button');
        await expect(option).toHaveClass(/focus-border-neutral/);
        await expect(option).toHaveClass(/hover:bg-surface-2/);
        await expect(option).toHaveClass(/border-transparent/);
        await expect(option).not.toHaveClass(/focus-visible:outline/);
      }
      await expect(all).toHaveAttribute('aria-pressed', 'true');
      await expect(chatMode).toHaveAttribute('aria-pressed', 'false');
      await expect(localResearch).toHaveAttribute('aria-pressed', 'false');

      // Tab reaches the real option button, and Enter changes the selected
      // radio without dismissing the popover.
      await all.focus();
      await page.keyboard.press('Tab');
      await expect(chatMode).toBeFocused();
      await expect(chatMode).toHaveCSS('border-top-width', '1px');
      await chatMode.press('Enter');
      await expect(chatMode).toBeFocused();
      await expect(chatMode).toHaveAttribute('aria-pressed', 'true');
      await expect(all).toHaveAttribute('aria-pressed', 'false');
      await expect(focusPanel).toBeVisible();

      // Escape is owned by the popover and returns focus to its trigger.
      await page.keyboard.press('Escape');
      await expect(focusPanel).toBeHidden();
      await expect(chat.focusButton).toBeFocused();

      // Switch to a research mode so the methodology selector is mounted.
      await chat.focusButton.click();
      await focusPanel
        .getByRole('button', { name: /^Local Research\b/ })
        .press('Enter');
      await page.keyboard.press('Escape');
      const methodologyTrigger = page.getByTitle('Select Research Methodology');
      await expect(methodologyTrigger).toBeVisible();
      await methodologyTrigger.click();
      const methodologyPanel = await expectComposerPopover(
        page,
        'Research Methodology',
      );
      const methodologyOption = methodologyPanel.getByRole('button', {
        name: new RegExp(`^${methodologyName}$`),
      });
      await expect(methodologyOption).toHaveAttribute('aria-pressed', 'false');
      await methodologyOption.focus();
      await methodologyOption.press('Space');
      await expect(methodologyOption).toBeFocused();
      await expect(methodologyOption).toHaveAttribute('aria-pressed', 'true');

      await page.keyboard.press('Escape');
      const promptsTrigger = page.getByTitle('Select Prompts');
      await promptsTrigger.click();
      const promptsPanel = await expectComposerPopover(page, 'Persona Prompts');
      const promptOption = promptsPanel.getByRole('button', {
        name: promptName,
        exact: true,
      });
      await expect(promptOption).toHaveAttribute('aria-pressed', 'false');
      await promptOption.focus();
      await promptOption.press('Enter');
      await expect(promptOption).toBeFocused();
      await expect(promptOption).toHaveAttribute('aria-pressed', 'true');
      await expect
        .poll(async () =>
          page.evaluate(() => {
            const raw = localStorage.getItem('selectedSystemPromptIds');
            return raw ? (JSON.parse(raw) as string[]) : [];
          }),
        )
        .toContain(promptId);
    } finally {
      await page.keyboard.press('Escape').catch(() => undefined);
      await page.waitForTimeout(600);
      await patchSettings(request, original);
      await request.delete(`/api/system-prompts/${methodologyId}`);
      await request.delete(`/api/system-prompts/${promptId}`);
    }
  });

  test('suggestion rows have no selection indicator and submit by keyboard', async ({
    page,
    request,
  }) => {
    const before = await readSettings(request);
    const original = {
      modelPresets: before.modelPresets ?? null,
      chatModelProvider: before.chatModelProvider ?? null,
      chatModel: before.chatModel ?? null,
      selectedSystemPromptIds: before.selectedSystemPromptIds ?? null,
    };
    let chatId: string | undefined;

    try {
      await patchSettings(request, {
        modelPresets: null,
        chatModelProvider: 'test',
        chatModel: 'test-direct',
        selectedSystemPromptIds: null,
      });

      const chat = new ChatPage(page);
      await chat.goto('/');
      await chat.selectChatModel('Test (structured output)');
      await chat.sendMessage(`suggestion-row-${Date.now()}`);
      await chat.waitForStreamComplete();
      chatId = new URL(page.url()).pathname.split('/').pop();

      await page.getByRole('button', { name: 'Load suggestions' }).click();
      const suggestion = page.getByRole('button', {
        name: 'What else should I know about this topic?',
        exact: true,
      });
      await expect(suggestion).toBeVisible({ timeout: 10_000 });
      await expect(suggestion).toHaveAttribute('type', 'button');
      await expect(suggestion).not.toHaveAttribute('aria-pressed');
      await expect(suggestion).toHaveClass(/focus-border-neutral/);
      await expect(suggestion).toHaveClass(/hover:bg-surface-2/);
      // `mode="none"` leaves only the action icon; no radio/checkbox is
      // exposed as a selection affordance for a one-shot suggestion.
      await expect(suggestion.locator('svg')).toHaveCount(1);
      await expect(suggestion.locator('svg')).toHaveClass(/lucide-plus/);

      const sent = page.waitForRequest(
        (candidate) =>
          candidate.url().includes('/api/chat') &&
          candidate.method() === 'POST' &&
          (candidate.postData() ?? '').includes(
            'What else should I know about this topic?',
          ),
      );
      await suggestion.focus();
      await expect(suggestion).toBeFocused();
      await suggestion.press('Enter');
      const requestBody = JSON.parse((await sent).postData() ?? '{}') as {
        message?: { content?: string };
      };
      expect(requestBody.message?.content).toBe(
        'What else should I know about this topic?',
      );
      await chat.waitForStreamComplete();
    } finally {
      if (chatId) {
        const response = await request.delete(`/api/chats/${chatId}`);
        expect([200, 204, 404]).toContain(response.status());
      }
      await page.waitForTimeout(600);
      await patchSettings(request, original);
    }
  });
});

test.describe('preset popovers', () => {
  test('model presets share the compact empty state and close on save/manage', async ({
    page,
    request,
  }) => {
    const before = await readSettings(request);
    const keys = [
      'modelPresets',
      'chatModelProvider',
      'chatModel',
      'systemModelProvider',
      'systemModel',
      'imageCapable',
      'contextWindowSize',
    ];
    const original = Object.fromEntries(
      keys.map((key) => [key, before[key] ?? null]),
    );

    try {
      await patchSettings(request, {
        modelPresets: JSON.stringify([]),
        chatModelProvider: 'test',
        chatModel: 'test-direct',
        systemModelProvider: 'test',
        systemModel: 'test-direct',
        imageCapable: 'false',
        contextWindowSize: '32768',
      });

      await page.goto('/');
      await page.getByRole('button', { name: 'Configure models' }).click();
      const dialog = page
        .getByRole('heading', {
          name: 'Model Configuration',
          exact: true,
        })
        .locator('xpath=ancestor::*[@role="dialog"]');
      await expect(dialog).toBeVisible();

      const trigger = dialog.getByRole('button', {
        name: 'Select preset',
        exact: true,
      });
      await trigger.focus();
      await page.keyboard.press('Enter');
      const panel = presetPanel(trigger);
      await expect(panel).toBeVisible();
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      await expect(panel).toHaveClass(/(^|\s)w-72(\s|$)/);
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
      await expect(trigger).toBeFocused();
      await trigger.press('Enter');
      await expect(panel).toBeVisible();
      const empty = panel.locator(
        '[data-list-state="empty"][data-list-layout="compact"]',
      );
      await expect(empty).toBeVisible();
      await expect(empty).toContainText(
        'No presets yet. Save the current selection to create one.',
      );
      await expect(
        panel.getByRole('button', { name: 'Save current…', exact: true }),
      ).toBeEnabled();
      await expect(
        panel.getByRole('button', { name: 'Manage', exact: true }),
      ).toBeVisible();

      // Saving the model preset closes the shared popover and preserves the
      // caller's trimmed name through its localStorage-backed state.
      await panel
        .getByRole('button', { name: 'Save current…', exact: true })
        .click();
      const name = panel.getByLabel('Preset name', { exact: true });
      await expect(name).toBeFocused();
      await name.fill('  saved model preset  ');
      await name.press('Enter');
      await expect(panel).toBeHidden();
      await expect
        .poll(async () =>
          page.evaluate(() => {
            const raw = localStorage.getItem('modelPresets');
            return raw
              ? (JSON.parse(raw) as Array<{ name: string }>).map((p) => p.name)
              : [];
          }),
        )
        .toContain('saved model preset');

      // Manage is a real footer action: it closes the preset popover before
      // opening the requested settings section.
      await trigger.click();
      await expect(panel).toBeVisible();
      await panel.getByRole('button', { name: 'Manage', exact: true }).click();
      await expect(panel).toBeHidden();
      const settingsDialog = page
        .getByRole('heading', { name: 'Settings', exact: true })
        .locator('xpath=ancestor::*[@role="dialog"]');
      await expect(
        settingsDialog.getByRole('heading', {
          name: 'Model Presets',
          exact: true,
        }),
      ).toBeVisible();
      await settingsDialog.getByLabel('Close').click();
      await expect(settingsDialog).toBeHidden();
      await dialog
        .getByRole('button', { name: 'Close', exact: true })
        .last()
        .click();
    } finally {
      await page.waitForTimeout(600);
      await patchSettings(request, original);
    }
  });

  test('model preset application updates the selection and closes its popover', async ({
    page,
    request,
  }) => {
    const preset = {
      id: 'ui-consistency-apply-model-preset',
      name: 'Apply model preset',
      chatProvider: 'test',
      chatModel: 'test-slow',
      systemProvider: 'test',
      systemModel: 'test-tool',
      imageCapable: true,
      contextWindowSize: 65536,
      createdAt: 0,
    };
    const unavailable = {
      ...preset,
      id: 'ui-consistency-unavailable-model-preset',
      name: 'Unavailable model preset',
      chatProvider: 'missing-provider',
      systemProvider: 'missing-provider',
    };
    const before = await readSettings(request);
    const keys = [
      'modelPresets',
      'chatModelProvider',
      'chatModel',
      'systemModelProvider',
      'systemModel',
      'imageCapable',
      'contextWindowSize',
    ];
    const original = Object.fromEntries(
      keys.map((key) => [key, before[key] ?? null]),
    );

    try {
      await patchSettings(request, {
        modelPresets: JSON.stringify([unavailable, preset]),
        chatModelProvider: 'test',
        chatModel: 'test-direct',
        systemModelProvider: 'test',
        systemModel: 'test-direct',
        imageCapable: 'false',
        contextWindowSize: '32768',
      });

      await page.goto('/');
      const mainTrigger = page.getByRole('button', {
        name: 'Choose model preset',
        exact: true,
      });
      await mainTrigger.click();
      const mainPanel = await expectComposerPopover(page, 'Model Presets');
      await expect(
        mainPanel.getByText('unavailable', { exact: true }),
      ).toBeVisible();
      await mainPanel
        .getByRole('button', { name: 'Configure models…', exact: true })
        .click();

      const dialog = page
        .getByRole('heading', {
          name: 'Model Configuration',
          exact: true,
        })
        .locator('xpath=ancestor::*[@role="dialog"]');
      const trigger = dialog.getByRole('button', {
        name: 'Select preset',
        exact: true,
      });
      await trigger.click();
      const panel = presetPanel(trigger);
      await expect(panel).toBeVisible();
      const row = panel.getByRole('button').filter({ hasText: preset.name });
      await expect(row).toBeVisible();
      await row.click();
      await expect(panel).toBeHidden();
      await expect
        .poll(async () =>
          page.evaluate(() => ({
            chat: localStorage.getItem('chatModel'),
            system: localStorage.getItem('systemModel'),
            image: localStorage.getItem('imageCapable'),
            context: localStorage.getItem('contextWindowSize'),
          })),
        )
        .toEqual({
          chat: 'test-slow',
          system: 'test-tool',
          image: 'true',
          context: '65536',
        });
      await dialog
        .getByRole('button', { name: 'Close', exact: true })
        .last()
        .click();
    } finally {
      await page.waitForTimeout(600);
      await patchSettings(request, original);
    }
  });

  test('panel presets share the empty state and preserve save/manage closure behavior', async ({
    page,
    request,
  }) => {
    const before = await readSettings(request);
    const original = {
      panelPresets: before.panelPresets ?? null,
      panelSelection: before.panelSelection ?? null,
    };

    try {
      await patchSettings(request, {
        panelPresets: JSON.stringify([]),
        panelSelection: JSON.stringify({
          enabled: false,
          executors: [
            { provider: 'test', name: 'test-direct', contextWindowSize: 32768 },
            { provider: 'test', name: 'test-tool', contextWindowSize: 32768 },
          ],
        }),
      });

      const chat = new ChatPage(page);
      await chat.goto('/');
      await chat.panelConfigButton.click();
      const agentPanel = await expectComposerPopover(page, 'Agent Panel');
      const trigger = agentPanel.getByRole('button', {
        name: 'Select panel preset',
        exact: true,
      });
      await trigger.click();
      const panel = presetPanel(trigger);
      await expect(panel).toBeVisible();
      await expect(panel).toHaveClass(/(^|\s)w-72(\s|$)/);
      await expect(
        panel.locator('[data-list-state="empty"][data-list-layout="compact"]'),
      ).toContainText('No presets yet. Save the current panel to create one.');
      await expect(
        panel.getByRole('button', { name: 'Save current…', exact: true }),
      ).toBeEnabled();

      await panel
        .getByRole('button', { name: 'Save current…', exact: true })
        .click();
      const name = panel.getByLabel('Panel preset name', { exact: true });
      await name.fill('saved panel preset');
      await name.press('Enter');
      // PanelSelector historically keeps its inline naming footer open after
      // saving; the shared shell must not change that caller-owned behavior.
      await expect(panel).toBeVisible();
      await expect
        .poll(async () =>
          page.evaluate(() => {
            const raw = localStorage.getItem('panelPresets');
            return raw
              ? (JSON.parse(raw) as Array<{ name: string }>).map((p) => p.name)
              : [];
          }),
        )
        .toContain('saved panel preset');

      await panel.getByRole('button', { name: 'Manage', exact: true }).click();
      await expect(panel).toBeHidden();
      const settingsDialog = page
        .getByRole('heading', { name: 'Settings', exact: true })
        .locator('xpath=ancestor::*[@role="dialog"]');
      await expect(
        settingsDialog.getByRole('heading', {
          name: 'Agent Panel Presets',
          exact: true,
        }),
      ).toBeVisible();
      await settingsDialog.getByLabel('Close').click();
    } finally {
      await page.waitForTimeout(600);
      await patchSettings(request, original);
    }
  });

  test('panel preset application updates executors and closes its popover', async ({
    page,
    request,
  }) => {
    const preset = {
      id: 'ui-consistency-apply-panel-preset',
      name: 'Apply panel preset',
      executors: [
        { provider: 'test', name: 'test-slow', contextWindowSize: 32768 },
        { provider: 'test', name: 'test-chart', contextWindowSize: 32768 },
      ],
      createdAt: 0,
    };
    const before = await readSettings(request);
    const original = {
      panelPresets: before.panelPresets ?? null,
      panelSelection: before.panelSelection ?? null,
    };

    try {
      await patchSettings(request, {
        panelPresets: JSON.stringify([preset]),
        panelSelection: JSON.stringify({
          enabled: false,
          executors: [
            { provider: 'test', name: 'test-direct', contextWindowSize: 32768 },
            { provider: 'test', name: 'test-tool', contextWindowSize: 32768 },
          ],
        }),
      });

      const chat = new ChatPage(page);
      await chat.goto('/');
      await chat.panelConfigButton.click();
      const agentPanel = await expectComposerPopover(page, 'Agent Panel');
      const trigger = agentPanel.getByRole('button', {
        name: 'Select panel preset',
        exact: true,
      });
      await trigger.click();
      const panel = presetPanel(trigger);
      await expect(panel).toBeVisible();
      const row = panel.getByRole('button', {
        name: `Apply panel preset ${preset.name}`,
        exact: true,
      });
      await expect(row).toBeVisible();
      await row.click();
      await expect(panel).toBeHidden();
      await expect
        .poll(async () =>
          page.evaluate(() => {
            const raw = localStorage.getItem('panelSelection');
            if (!raw) return null;
            const value = JSON.parse(raw) as {
              enabled: boolean;
              executors: Array<{ name: string }>;
            };
            return {
              enabled: value.enabled,
              executors: value.executors.map((executor) => executor.name),
            };
          }),
        )
        .toEqual({
          enabled: true,
          executors: ['test-slow', 'test-chart'],
        });
    } finally {
      await page.waitForTimeout(600);
      await patchSettings(request, original);
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
      const autoRead = page.getByRole('button', {
        name: /^Auto-read replies: (on|off)$/,
      });

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
      // on a wrapper: Tab from the composer input changes one reserved border
      // pixel without drawing an outline or moving the control.
      await page.locator('#message-input').focus();
      const focusBefore = await focus.boundingBox();
      expect(focusBefore).not.toBeNull();
      await page.keyboard.press('Tab');
      await expect(focus).toBeFocused();
      const focusStyle = await focus.evaluate((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          width: style.borderTopWidth,
          color: style.borderTopColor,
          outline: style.outlineStyle,
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
        };
      });
      const accent = await page.evaluate(() => {
        const probe = document.createElement('span');
        probe.style.border = '1px solid var(--color-accent)';
        document.body.appendChild(probe);
        const color = getComputedStyle(probe).borderTopColor;
        probe.remove();
        return color;
      });
      await expect
        .poll(async () =>
          focus.evaluate((element) => getComputedStyle(element).borderTopColor),
        )
        .toBe(accent);
      const settledFocusStyle = await focus.evaluate((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          width: style.borderTopWidth,
          color: style.borderTopColor,
          outline: style.outlineStyle,
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
        };
      });
      expect(settledFocusStyle.width).toBe('1px');
      expect(settledFocusStyle.color).toBe(accent);
      expect(settledFocusStyle.outline).toBe('none');
      expect(settledFocusStyle.rect).toEqual(focusBefore);
      expect(focusStyle.rect).toEqual(focusBefore);

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
      await expect(autoRead).toHaveAttribute('aria-pressed', 'true');
      await expect(autoRead).toHaveClass(/(^|\s)text-accent(\s|$)/);
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
      await expect(panelConfig).toHaveClass(
        /(^|\s)disabled:text-fg-subtle(\s|$)/,
      );
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
      const promptOption = promptPopover.getByRole('button', {
        name: promptName,
        exact: true,
      });
      await expect(promptOption).toBeVisible();
      await promptOption.click();
      await expect(promptOption).toHaveAttribute('aria-pressed', 'true');
      await expectComposerActionButton(prompts, 'content');
      await expectComposerActionState(prompts, {
        configured: true,
        open: true,
      });
      await expect(prompts).toHaveAttribute('aria-expanded', 'true');
      await page.keyboard.press('Escape');
      await expectComposerActionState(prompts, {
        configured: true,
        open: false,
      });
      await expect(prompts).toHaveAttribute('aria-expanded', 'false');
      await expect(prompts).toBeFocused();

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
    await openWidgetCreator(page, request);
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

test.describe('IconButton primitive', () => {
  test('dashboard primary and active icon actions keep contrast foreground and focus in place', async ({
    page,
    request,
  }) => {
    const before = await readSettings(request);
    const original = {
      widgets: before.yaawc_dashboard_widgets ?? null,
      cache: before.yaawc_dashboard_cache ?? null,
    };
    await page.goto('/');
    const originalLocal = await page.evaluate(() => ({
      widgets: localStorage.getItem('yaawc_dashboard_widgets'),
      cache: localStorage.getItem('yaawc_dashboard_cache'),
    }));

    try {
      await patchSettings(request, {
        yaawc_dashboard_widgets: '[]',
        yaawc_dashboard_cache: '{}',
      });
      await page.evaluate(() => {
        localStorage.setItem('yaawc_dashboard_widgets', '[]');
        localStorage.setItem('yaawc_dashboard_cache', '{}');
      });
      await page.goto('/dashboard');
      await expect(
        page.getByRole('heading', { name: 'Dashboard', exact: true }),
      ).toBeVisible();

      const editMode = page.getByRole('button', {
        name: 'Switch to Edit Mode',
        exact: true,
      });
      const refresh = page.getByRole('button', {
        name: 'Refresh All Widgets',
        exact: true,
      });
      await expect(editMode).toHaveClass(/focus-border-neutral/);
      await expect(refresh).toHaveClass(/focus-border-neutral/);
      await expect(refresh).toHaveClass(/text-fg-muted/);

      // Enter edit mode through the keyboard so the following focus traversal
      // exercises the same modality users use for the icon actions.
      await editMode.focus();
      await page.keyboard.press('Enter');
      const viewMode = page.getByRole('button', {
        name: 'Switch to View Mode',
        exact: true,
      });
      const addWidget = page.getByRole('button', {
        name: 'Add New Widget',
        exact: true,
      });
      await expect(viewMode).toHaveAttribute('aria-pressed', 'true');
      await expect(viewMode).toHaveClass(/(^|\s)bg-surface-2(\s|$)/);
      await expect(viewMode).toHaveClass(/(^|\s)text-accent(\s|$)/);
      await expect(viewMode).toHaveClass(/focus-border-neutral/);

      await expect(addWidget).toHaveClass(/(^|\s)bg-accent(\s|$)/);
      await expect(addWidget).toHaveClass(/(^|\s)text-accent-fg(\s|$)/);
      await expect(addWidget).toHaveClass(/(^|\s)hover:bg-accent-700(\s|$)/);
      await expect(addWidget).toHaveClass(/(^|\s)hover:text-accent-fg(\s|$)/);
      await expect(addWidget).toHaveClass(/focus-border-contrast/);
      await expect(addWidget.locator('svg')).toHaveAttribute('width', '15');
      await expect(addWidget.locator('svg')).toHaveAttribute('height', '15');

      const accentBackground = await resolvedBackgroundClass(page, 'bg-accent');
      const accentHoverBackground = await resolvedBackgroundClass(
        page,
        'bg-accent-700',
      );
      const accentForeground = await resolvedTextClass(page, 'text-accent-fg');
      await expect
        .poll(() =>
          addWidget.evaluate((element) => {
            const style = getComputedStyle(element);
            return { background: style.backgroundColor, color: style.color };
          }),
        )
        .toEqual({
          background: accentBackground,
          color: accentForeground,
        });

      const beforeFocus = await addWidget.boundingBox();
      expect(beforeFocus).not.toBeNull();
      const importDashboard = page.getByRole('button', {
        name: 'Import Dashboard Configuration',
        exact: true,
      });
      // Navigate through the real action cluster so :focus-visible is driven by
      // keyboard input rather than a script-assigned focus.
      await expect(viewMode).toBeFocused();
      for (const control of [
        refresh,
        page.getByRole('button', {
          name: /Switch to (Sequential|Parallel) Processing/,
        }),
        page.getByRole('button', {
          name: 'Export Dashboard Configuration',
          exact: true,
        }),
        importDashboard,
        addWidget,
      ]) {
        await page.keyboard.press('Tab');
        await expect(control).toBeFocused();
      }
      await expect
        .poll(() =>
          addWidget.evaluate(
            (element) => getComputedStyle(element).borderTopColor,
          ),
        )
        .toBe(accentForeground);
      const settledFocused = await addWidget.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          borderWidth: style.borderTopWidth,
          borderColor: style.borderTopColor,
          outline: style.outlineStyle,
          rect: {
            x: element.getBoundingClientRect().x,
            y: element.getBoundingClientRect().y,
            width: element.getBoundingClientRect().width,
            height: element.getBoundingClientRect().height,
          },
        };
      });
      expect(settledFocused.borderWidth).toBe('1px');
      expect(settledFocused.borderColor).toBe(accentForeground);
      expect(settledFocused.outline).toBe('none');
      expect(settledFocused.rect).toEqual(beforeFocus);

      await addWidget.hover();
      await expect
        .poll(() =>
          addWidget.evaluate((element) => {
            const style = getComputedStyle(element);
            return { background: style.backgroundColor, color: style.color };
          }),
        )
        .toEqual({
          background: accentHoverBackground,
          color: accentForeground,
        });

      await addWidget.click();
      await expect(
        page.getByRole('heading', { name: 'Create New Widget', exact: true }),
      ).toBeVisible();
      await page.getByLabel('Close').click();
    } finally {
      await page.evaluate(({ widgets, cache }) => {
        for (const [key, value] of [
          ['yaawc_dashboard_widgets', widgets],
          ['yaawc_dashboard_cache', cache],
        ] as const) {
          if (value === null) localStorage.removeItem(key);
          else localStorage.setItem(key, value);
        }
      }, originalLocal);
      await page.waitForTimeout(600);
      await patchSettings(request, {
        yaawc_dashboard_widgets: original.widgets,
        yaawc_dashboard_cache: original.cache,
      });
    }
  });

  test('workspace labeled create and add actions use the primary Button contract', async ({
    page,
    request,
  }) => {
    const workspaceId = await seedWorkspace(request, {
      name: uniq('icon-button-workspace'),
    });

    try {
      await page.goto(`/workspaces/${workspaceId}`);
      await expect(
        page.getByRole('heading', { name: /icon-button-workspace/ }),
      ).toBeVisible();

      const memorySection = page
        .locator('[data-workspace-section]')
        .filter({ hasText: 'Memory' })
        .last();
      await memorySection.getByRole('button').first().click();
      const addMemory = memorySection.getByRole('button', {
        name: 'Add memory',
        exact: true,
      });
      await expect(addMemory).toBeVisible();
      await expect(addMemory).toHaveClass(/(^|\s)bg-accent(\s|$)/);
      await expect(addMemory).toHaveClass(/(^|\s)text-accent-fg(\s|$)/);
      await expect(addMemory).toHaveClass(/focus-border-contrast/);
      await expectPrimaryButtonColors(page, addMemory);
      await addMemory.click();
      await expect(
        memorySection.getByRole('button', { name: 'Save to workspace' }),
      ).toBeVisible();
      await memorySection.getByRole('button', { name: 'Cancel' }).click();

      const filesSection = page
        .locator('[data-workspace-section]')
        .filter({ hasText: 'Files' })
        .first();
      await filesSection.getByRole('button').first().click();
      await filesSection.getByRole('button', { name: 'New file' }).click();
      const create = filesSection.getByRole('button', {
        name: 'Create',
        exact: true,
      });
      await expect(create).toHaveClass(/(^|\s)bg-accent(\s|$)/);
      await expect(create).toHaveClass(/(^|\s)text-accent-fg(\s|$)/);
      await expect(create).toHaveClass(/focus-border-contrast/);
      await expectPrimaryButtonColors(page, create);
      await filesSection.getByRole('button', { name: 'Cancel' }).click();
    } finally {
      const response = await request.delete(`/api/workspaces/${workspaceId}`);
      expect([200, 204, 404]).toContain(response.status());
    }
  });

  test('schedule row icon actions: labels, danger tone, focus, busy state, and navigation', async ({
    page,
    request,
  }) => {
    const workflowId = await seedWorkflow(request, {
      name: uniq('icon-button-workflow'),
    });
    const scheduleId = await seedSchedule(request, workflowId, {
      label: uniq('icon-button-schedule'),
    });

    try {
      await page.goto('/automations/scheduled');
      const row = page.locator(`[data-schedule-id="${scheduleId}"]`);
      await expect(row).toBeVisible();

      const edit = row.getByRole('link', { name: 'Edit', exact: true });
      const remove = row.getByRole('button', { name: 'Delete', exact: true });
      const run = row.getByRole('button', { name: 'Run now', exact: true });

      await test.step('list icon links and danger actions expose labels, 15px icons, and disabled state', async () => {
        await expect(edit).toHaveAttribute('title', 'Edit');
        await expect(edit).toHaveAttribute(
          'href',
          `/automations/schedules/${scheduleId}`,
        );
        await expect(edit).toHaveClass(/focus-border-neutral/);
        await expect(edit.locator('svg')).toHaveAttribute('width', '15');
        await expect(edit.locator('svg')).toHaveAttribute('height', '15');

        await expect(remove).toHaveAttribute('title', 'Delete');
        await expect(remove).toHaveClass(/focus-border-contrast/);
        await expect(remove).toHaveClass(/text-danger/);
        await expect(remove.locator('svg')).toHaveAttribute('width', '15');
        await expect(remove.locator('svg')).toHaveAttribute('height', '15');
      });

      await test.step('danger icon actions keep danger hover and contrast focus without reflow', async () => {
        const danger = await resolvedTextClass(page, 'text-danger');
        const dangerSoft = await resolvedBackgroundClass(
          page,
          'bg-danger-soft',
        );
        const before = await remove.boundingBox();
        expect(before).not.toBeNull();

        await remove.hover();
        await expect
          .poll(() =>
            remove.evaluate((element) => {
              const style = getComputedStyle(element);
              return {
                background: style.backgroundColor,
                color: style.color,
              };
            }),
          )
          .toEqual({ background: dangerSoft, color: danger });

        await page.mouse.move(0, 0);
        await edit.focus();
        await page.keyboard.press('Tab');
        await expect(remove).toBeFocused();
        await expect
          .poll(() =>
            remove.evaluate(
              (element) => getComputedStyle(element).borderTopColor,
            ),
          )
          .toBe(danger);
        await expect(remove).toHaveCSS('border-top-width', '1px');
        await expect(remove).toHaveCSS('outline-style', 'none');
        expect(await remove.boundingBox()).toEqual(before);
      });

      // Continues "list icon links and danger actions expose labels, 15px
      // icons, and disabled state" — the held Run-now busy state and the
      // Edit-link navigation run last, after the danger-tone assertions.
      await test.step('list icon links and danger actions expose labels, 15px icons, and disabled state (busy state, navigation)', async () => {
        let release!: () => void;
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        await page.route(
          `**/api/schedules/${scheduleId}/run`,
          async (route) => {
            if (route.request().method() !== 'POST') return route.fallback();
            await held;
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ status: 'started' }),
            });
          },
        );

        await run.click();
        await expect(run).toBeDisabled();
        await expect(run).toHaveAttribute('aria-busy', 'true');
        await expect(run.locator('svg.animate-spin')).toHaveCount(1);
        await expect(run.locator('svg.animate-spin')).toHaveAttribute(
          'width',
          '15',
        );
        await expect(run.locator('svg.animate-spin')).toHaveAttribute(
          'height',
          '15',
        );
        await expect(run).toHaveClass(/focus-border-neutral/);

        release();
        await expect(run).toBeEnabled();

        // The shared primitive must preserve real link navigation, not only
        // its accessible name and href attributes.
        await edit.click();
        await expect(page).toHaveURL(
          new RegExp(`/automations/schedules/${scheduleId}$`),
        );
      });
    } finally {
      const scheduleDelete = await request.delete(
        `/api/schedules/${scheduleId}`,
      );
      expect([200, 404]).toContain(scheduleDelete.status());
      const workflowDelete = await request.delete(
        `/api/workflows/${workflowId}`,
      );
      expect([200, 404]).toContain(workflowDelete.status());
    }
  });

  test('a loading list action is busy, disabled, and shows the 15px spinner', async ({
    page,
    request,
  }) => {
    const content = uniq('icon-button-loading');
    const awaiting = await seedAwaitingApproval({ content });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    try {
      await page.route('**/api/chat/cancel', async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        await held;
        await route.fallback();
      });
      await page.goto('/history');
      const row = page.locator('[data-list-row]').filter({ hasText: content });
      await expect(row).toBeVisible();

      const stop = row.getByRole('button', { name: 'Stop run', exact: true });
      await expect(stop).toHaveAttribute('title', 'Stop run');
      await expect(stop).toHaveClass(/focus-border-contrast/);
      await stop.click();
      await expect(stop).toBeDisabled();
      await expect(stop).toHaveAttribute('aria-busy', 'true');
      await expect(stop.locator('svg.animate-spin')).toBeVisible();
      await expect(stop.locator('svg.animate-spin')).toHaveAttribute(
        'width',
        '15',
      );

      release();
      await expect(stop).toBeHidden();
    } finally {
      release();
      await cancelAwaitingRun(request, {
        chatId: awaiting.chatId,
        messageId: awaiting.messageId,
      });
      const chatDelete = await request.delete(`/api/chats/${awaiting.chatId}`);
      expect([200, 204, 404]).toContain(chatDelete.status());
    }
  });
});

test.describe('canonical loading and empty states', () => {
  test('settings preserves compact list empty states and their actions', async ({
    page,
  }) => {
    await page.route('**/api/mcp/servers', async (route) => {
      const url = new URL(route.request().url());
      if (
        url.pathname === '/api/mcp/servers' &&
        route.request().method() === 'GET'
      ) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ servers: [] }),
        });
        return;
      }
      await route.fallback();
    });
    await page.route('**/api/memories**', async (route) => {
      const url = new URL(route.request().url());
      if (
        url.pathname === '/api/memories' &&
        !url.searchParams.has('workspaceId')
      ) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [], total: 0 }),
        });
        return;
      }
      await route.fallback();
    });

    const settings = new SettingsPage(page);
    await settings.goto();

    const dialog = page.getByRole('dialog');
    await settings.openSection('MCP Servers');
    let empty = dialog.locator(
      '[data-list-state="empty"][data-list-layout="compact"]',
    );
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('No MCP servers configured yet.');
    await expect(
      dialog.getByRole('button', { name: 'Add MCP Server', exact: true }),
    ).toBeVisible();

    await settings.openSection('Memory');
    empty = dialog.locator(
      '[data-list-state="empty"][data-list-layout="compact"]',
    );
    await expect(empty).toBeVisible();
    await expect(empty).toContainText(
      'No memories yet. Add one above, or enable automatic detection.',
    );
  });
});

test.describe('explicit motion contracts', () => {
  test('names modal, switch, and context-meter motion properties', async ({
    page,
    request,
  }) => {
    const settings = new SettingsPage(page);
    await settings.goto();

    const dialog = page.getByRole('dialog');
    const backdrop = page.locator('[class~="transition-opacity"]').first();
    const panel = dialog
      .locator('[class~="transition-[opacity,transform]"]')
      .first();
    await expect(backdrop).toBeVisible();
    await expect(panel).toBeVisible();
    await expect(backdrop).toHaveClass(/duration-200/);
    await expect(panel).toHaveClass(/duration-200/);
    await expect(panel).toHaveClass(/ease-standard/);

    const computedTransition = (locator: Locator) =>
      locator.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          properties: style.transitionProperty
            .split(',')
            .map((property) => property.trim()),
          duration: style.transitionDuration,
        };
      });
    const backdropTransition = await computedTransition(backdrop);
    const panelTransition = await computedTransition(panel);
    expect(backdropTransition).toMatchObject({
      properties: expect.arrayContaining(['opacity']),
      duration: '0.2s',
    });
    expect(panelTransition).toMatchObject({
      properties: expect.arrayContaining(['opacity', 'transform']),
      duration: '0.2s',
    });

    await settings.openSection('Image Generation');
    const toggle = dialog.getByRole('switch', {
      name: 'Enable image generation',
    });
    const thumb = toggle.locator('span');
    await expect(toggle).toHaveClass(/duration-150/);
    await expect(thumb).toHaveClass(/transition-transform/);
    await expect(thumb).toHaveClass(/duration-200/);
    await expect(thumb).toHaveClass(/ease-standard/);
    const switchTransition = await computedTransition(toggle);
    const thumbTransition = await computedTransition(thumb);
    expect(switchTransition).toMatchObject({
      properties: expect.arrayContaining(['background-color']),
      duration: '0.15s',
    });
    expect(thumbTransition).toMatchObject({
      properties: expect.arrayContaining(['transform']),
      duration: '0.2s',
    });

    await settings.close();

    const chatId = await seedChat(request, {
      content: uniq('motion-context-meter'),
      focusMode: 'webSearch',
    });
    try {
      await page.goto(`/c/${chatId}`);
      await expect(page.locator('#message-input')).toBeVisible();
      const context = page.locator('button[title^="Context usage:"]');
      await expect(context).toHaveCount(1);
      await context.click();
      const meter = page.locator('[class~="transition-[width]"]');
      await expect(meter).toHaveCount(1);
      await expect(meter).toHaveClass(/duration-200/);
      await expect
        .poll(() => computedTransition(meter))
        .toMatchObject({
          properties: expect.arrayContaining(['width']),
          duration: '0.2s',
        });
    } finally {
      const response = await request.delete(`/api/chats/${chatId}`);
      expect([200, 204, 404]).toContain(response.status());
    }
  });
});

test.describe('badges and setting toggle rows', () => {
  test('uses standard and compact badge recipes in dark and light themes', async ({
    page,
    request,
  }) => {
    const before = await readSettings(request);
    const originalPresets = before.modelPresets ?? null;
    const unavailablePreset = {
      id: `ui-consistency-unavailable-${Date.now()}`,
      name: 'Unavailable compact preset',
      chatProvider: 'missing-provider',
      chatModel: 'missing-chat-model',
      systemProvider: 'missing-provider',
      systemModel: 'missing-system-model',
      imageCapable: false,
      contextWindowSize: 32768,
      createdAt: 0,
    };

    try {
      await patchSettings(request, {
        modelPresets: JSON.stringify([unavailablePreset]),
      });

      for (const [themeId, mode] of [
        ['nord', 'dark'],
        ['solarized-light', 'light'],
      ] as const) {
        await page.goto('/');
        await page.evaluate(
          (id) => localStorage.setItem('appTheme', id),
          themeId,
        );
        await page.reload();
        await expect(page.locator('html')).toHaveAttribute('data-theme', mode);

        const settings = new SettingsPage(page);
        await settings.goto();
        await settings.openSection('Search Providers');

        const standard = page.getByText('primary', { exact: true }).first();
        await expect(standard).toBeVisible();
        for (const token of [
          'inline-flex',
          'items-center',
          'rounded-pill',
          'px-2',
          'py-0.5',
          'text-xs',
          'border-transparent',
          'bg-accent-soft',
          'text-accent',
        ]) {
          await expect(standard).toHaveClass(
            new RegExp(`(^|\\s)${token}(\\s|$)`),
          );
        }
        await expect(standard).toHaveCSS(
          'background-color',
          await resolvedBackgroundClass(page, 'bg-accent-soft'),
        );
        await expect(standard).toHaveCSS(
          'color',
          await resolvedTextClass(page, 'text-accent'),
        );

        await settings.close();
        const presetTrigger = page.getByRole('button', {
          name: 'Choose model preset',
          exact: true,
        });
        await presetTrigger.click();
        const presetPopover = await expectComposerPopover(
          page,
          'Model Presets',
        );
        const presetRow = presetPopover
          .getByRole('button')
          .filter({ hasText: unavailablePreset.name });
        await expect(presetRow).toBeVisible();
        const unavailable = presetRow.getByText('unavailable', {
          exact: true,
        });
        await expect(unavailable).toHaveClass(/rounded-control/);
        await expect(unavailable).toHaveClass(/px-1/);
        await expect(unavailable).toHaveClass(/py-0.5/);
        await expect(unavailable).toHaveClass(/text-2xs/);
        await expect(presetRow.locator('p').first()).toHaveClass(/text-2xs/);
        await page.keyboard.press('Escape');
      }
    } finally {
      await patchSettings(request, { modelPresets: originalPresets });
    }
  });

  test('keeps icon, nested, muted, and callback behavior on setting rows', async ({
    page,
    request,
  }) => {
    const before = await readSettings(request);
    const keys = [
      'autoSuggestions',
      'autoTitleEnabled',
      'memoryEnabled',
      'memoryRetrievalEnabled',
      'memoryAutoDetectionEnabled',
    ];
    const original = Object.fromEntries(
      keys.map((key) => [key, before[key] ?? null]),
    );

    try {
      await patchSettings(request, {
        autoSuggestions: 'false',
        autoTitleEnabled: 'false',
        memoryEnabled: 'false',
        memoryRetrievalEnabled: 'false',
        memoryAutoDetectionEnabled: 'false',
      });

      const settings = new SettingsPage(page);
      await settings.goto();
      await settings.openSection('Automation');

      const suggestions = page.getByRole('switch', {
        name: 'Automatic Suggestions',
        exact: true,
      });
      const suggestionRow = suggestions.locator('xpath=..');
      await expect(
        suggestionRow.getByText('Automatic Suggestions', { exact: true }),
      ).toHaveClass(/text-sm/);
      await expect(
        suggestionRow.getByText(
          'Automatically show related suggestions after responses',
          { exact: true },
        ),
      ).toHaveClass(/text-xs/);
      await expect(
        suggestionRow.getByText(
          'Automatically show related suggestions after responses',
          { exact: true },
        ),
      ).toHaveClass(/text-fg-muted/);
      const iconTile = suggestionRow.locator('span.bg-surface-2').first();
      await expect(iconTile).toHaveClass(/rounded-surface/);
      await expect(iconTile).toHaveClass(/p-2/);
      await expect(iconTile.locator('svg')).toHaveAttribute('width', '18');
      await expect(iconTile.locator('svg')).toHaveAttribute('height', '18');

      await suggestions.click();
      await expect(suggestions).toHaveAttribute('aria-checked', 'true');
      await expect
        .poll(() =>
          page.evaluate(() => localStorage.getItem('autoSuggestions')),
        )
        .toBe('true');

      const autoTitle = page.getByRole('switch', {
        name: 'Auto-generate chat titles',
        exact: true,
      });
      await autoTitle.click();
      await expect(autoTitle).toHaveAttribute('aria-checked', 'true');
      await expect
        .poll(() =>
          page.evaluate(() => localStorage.getItem('autoTitleEnabled')),
        )
        .toBe('true');

      await settings.openSection('Memory');
      const memory = page.getByRole('switch', { name: 'Memory', exact: true });
      await memory.click();
      await expect(memory).toHaveAttribute('aria-checked', 'true');

      const nested = page.getByRole('switch', {
        name: 'Use saved memories in chats',
        exact: true,
      });
      const nestedRow = nested.locator('xpath=..');
      await expect(nestedRow).toHaveClass(/border-l-2/);
      await expect(nestedRow).toHaveClass(/border-surface-2/);
      await expect(nestedRow).toHaveClass(/pl-4/);
      await expect(
        nestedRow.getByText('Use saved memories in chats', { exact: true }),
      ).toHaveClass(/text-sm/);
      await expect(
        nestedRow.getByText(
          'Include relevant memories to personalize responses',
          { exact: true },
        ),
      ).toHaveClass(/text-xs/);
      await expect(nestedRow.locator('span.bg-surface-2')).toHaveCount(0);

      await nested.click();
      await expect(nested).toHaveAttribute('aria-checked', 'true');
      await expect
        .poll(() =>
          page.evaluate(() => localStorage.getItem('memoryRetrievalEnabled')),
        )
        .toBe('true');

      const detection = page.getByRole('switch', {
        name: 'Automatic memory detection',
        exact: true,
      });
      await detection.click();
      await expect(detection).toHaveAttribute('aria-checked', 'true');
      await expect
        .poll(() =>
          page.evaluate(() =>
            localStorage.getItem('memoryAutoDetectionEnabled'),
          ),
        )
        .toBe('true');
    } finally {
      await page.waitForTimeout(600);
      await patchSettings(request, original);
    }
  });

  test('workspace setting rows keep canonical typography and callbacks', async ({
    page,
    request,
  }) => {
    const workspaceId = await seedWorkspace(request, {
      name: `ui-consistency-toggle-${Date.now()}`,
      autoAcceptFileEdits: 0,
    });

    try {
      const detail = new WorkspaceDetailPage(page);
      await detail.goto(workspaceId);
      await detail.openSettings();
      const dialog = page.getByRole('dialog');

      const autoMemory = dialog.getByRole('switch', {
        name: 'Auto-memory',
        exact: true,
      });
      const memoryRow = autoMemory.locator('xpath=..');
      await expect(
        memoryRow.getByText('Auto-memory', { exact: true }),
      ).toHaveClass(/text-sm/);
      await expect(
        memoryRow.getByText(
          'Automatically extract memories from chats in this workspace',
          { exact: true },
        ),
      ).toHaveClass(/text-xs/);

      const autoAccept = dialog.getByRole('switch', {
        name: 'Auto-accept file edits',
        exact: true,
      });
      await expect(autoAccept.locator('xpath=..')).toHaveClass(
        /flex items-center justify-between/,
      );

      await autoMemory.click();
      await expect
        .poll(async () => {
          const response = await request.get(`/api/workspaces/${workspaceId}`);
          return (await response.json()).workspace.autoMemoryEnabled;
        })
        .toBe(1);

      await autoAccept.click();
      await expect
        .poll(async () => {
          const response = await request.get(`/api/workspaces/${workspaceId}`);
          return (await response.json()).workspace.autoAcceptFileEdits;
        })
        .toBe(1);
    } finally {
      const response = await request.delete(`/api/workspaces/${workspaceId}`);
      expect([200, 204, 404]).toContain(response.status());
    }
  });

  test('a no-description muted row keeps its switch callback', async ({
    page,
    request,
  }) => {
    const workspaceId = await seedWorkspace(request, {
      name: `ui-consistency-mcp-scope-${Date.now()}`,
    });
    const create = await request.post('/api/mcp/servers', {
      data: {
        name: `ui-consistency-mcp-${Date.now()}`,
        url: 'https://example.com/mcp',
      },
    });
    expect(create.status()).toBe(201);
    const server = (await create.json()).server as {
      id: string;
      name: string;
    };

    try {
      const scope = await request.put(
        `/api/mcp/servers/${server.id}/workspaces`,
        { data: { workspaceIds: [workspaceId] } },
      );
      expect(scope.status()).toBe(200);

      const settings = new SettingsPage(page);
      await settings.goto();
      await settings.openSection('MCP Servers');
      const card = page
        .locator('div.border.border-surface-2.rounded-surface.p-4')
        .filter({ hasText: server.name });
      await expect(card).toBeVisible();
      await card.getByRole('button', { name: /Workspaces/ }).click();

      const showInGeneral = page.getByRole('switch', {
        name: 'Show in chats with no workspace',
        exact: true,
      });
      await expect(showInGeneral).toBeVisible();
      const row = showInGeneral.locator('xpath=..');
      const label = row.getByText('Also show in chats with no workspace', {
        exact: true,
      });
      await expect(label).toHaveClass(/text-xs/);
      await expect(label).toHaveClass(/text-fg-muted/);
      await expect(row.locator('p')).toHaveCount(1);

      await showInGeneral.click();
      await expect(
        page.getByRole('switch', {
          name: 'Hide from chats with no workspace',
          exact: true,
        }),
      ).toBeVisible();
      await expect
        .poll(async () => {
          const response = await request.get(`/api/mcp/servers/${server.id}`);
          return (await response.json()).server.visibleInGeneralChat;
        })
        .toBe(true);
    } finally {
      const serverDelete = await request.delete(
        `/api/mcp/servers/${server.id}`,
      );
      expect([200, 404]).toContain(serverDelete.status());
      const workspaceDelete = await request.delete(
        `/api/workspaces/${workspaceId}`,
      );
      expect([200, 204, 404]).toContain(workspaceDelete.status());
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
      await openWidgetCreator(page, request);
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
