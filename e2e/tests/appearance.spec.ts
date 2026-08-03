import { test, expect } from '../fixtures';
import { SettingsPage } from '../pages/SettingsPage';
import { seedWorkspace, seedWorkspaceFile } from '../utils/seed';

/**
 * Theme state is device-local (localStorage), so each Playwright context starts
 * clean and specs here don't pollute the shared test DB.
 */

// Nord, straight from the registry — asserting the *intended* palette, not
// whatever the app happens to emit.
const NORD = { bg: '#2e3440', accent: '#88c0d0' };

const cssVar = (page: SettingsPage['page'], name: string) =>
  page.evaluate(
    (n) =>
      getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
    name,
  );

const themeAttr = (page: SettingsPage['page'], name: string) =>
  page.evaluate((n) => document.documentElement.getAttribute(n), name);

async function openAppearance(page: SettingsPage['page']) {
  const settings = new SettingsPage(page);
  await settings.goto();
  await settings.openSection('Appearance');
  return settings;
}

/** Copy a built-in into the empty custom slot — no confirmation is due. */
async function copyIntoCustom(page: SettingsPage['page'], name: string) {
  await page.getByRole('button', { name: `Copy ${name} into Custom` }).click();
  await expect.poll(() => themeAttr(page, 'data-theme-id')).toBe('custom');
}

test.describe('appearance', () => {
  test('picking a built-in theme applies it and survives a reload', async ({
    page,
  }) => {
    await openAppearance(page);

    await page.getByRole('button', { name: 'Nord', exact: true }).click();

    await expect.poll(() => cssVar(page, '--color-bg')).toBe(NORD.bg);
    expect(await cssVar(page, '--color-accent')).toBe(NORD.accent);
    expect(await themeAttr(page, 'data-theme')).toBe('dark');
    expect(await themeAttr(page, 'data-theme-id')).toBe('nord');

    // The boot script must restore it before hydration, so the value is already
    // correct on a fresh document.
    await page.reload();
    await expect.poll(() => cssVar(page, '--color-bg')).toBe(NORD.bg);
    expect(await themeAttr(page, 'data-theme-id')).toBe('nord');
  });

  test('a light theme flips the mode and the meta theme-color', async ({
    page,
  }) => {
    await openAppearance(page);

    await page
      .getByRole('button', { name: 'Solarized Light', exact: true })
      .click();

    await expect.poll(() => themeAttr(page, 'data-theme')).toBe('light');
    expect(await cssVar(page, '--color-bg')).toBe('#fdf6e3');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
      'content',
      '#fdf6e3',
    );
  });

  test('a built-in theme cannot be edited in place', async ({ page }) => {
    await openAppearance(page);
    await page.getByRole('button', { name: 'Nord', exact: true }).click();
    await expect.poll(() => themeAttr(page, 'data-theme-id')).toBe('nord');

    // The pickers mirror the built-in read-only — the only way to change a
    // colour is to copy it into Custom first.
    await expect(page.getByLabel('Accent')).toBeDisabled();
    await expect(page.getByLabel('Syntax style')).toBeDisabled();
    await expect(page.getByLabel('Dark mode')).toBeDisabled();
  });

  test('copying a built-in into Custom applies it and unlocks editing', async ({
    page,
  }) => {
    await openAppearance(page);
    await page.getByRole('button', { name: 'Nord', exact: true }).click();

    // No custom theme yet, so there is nothing to overwrite and no confirmation.
    await copyIntoCustom(page, 'Nord');

    expect(await cssVar(page, '--color-bg')).toBe(NORD.bg);
    await page.getByLabel('Accent').fill('#00ff00');
    await expect.poll(() => cssVar(page, '--color-accent')).toBe('#00ff00');
    // The rest of the copied palette is kept rather than starting blank.
    expect(await cssVar(page, '--color-bg')).toBe(NORD.bg);

    await page.reload();
    await expect.poll(() => cssVar(page, '--color-accent')).toBe('#00ff00');
    expect(await themeAttr(page, 'data-theme-id')).toBe('custom');
  });

  test('overwriting an existing custom theme is confirmed first', async ({
    page,
  }) => {
    await openAppearance(page);
    await page.getByRole('button', { name: 'Nord', exact: true }).click();
    await copyIntoCustom(page, 'Nord');
    await page.getByLabel('Accent').fill('#00ff00');
    await expect.poll(() => cssVar(page, '--color-accent')).toBe('#00ff00');

    await page
      .getByRole('button', { name: 'Copy Dracula into Custom' })
      .click();

    // Cancelling leaves the existing custom theme untouched.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect.poll(() => cssVar(page, '--color-accent')).toBe('#00ff00');
    expect(await cssVar(page, '--color-bg')).toBe(NORD.bg);

    await page
      .getByRole('button', { name: 'Copy Dracula into Custom' })
      .click();
    await page.getByRole('button', { name: 'Replace' }).click();

    await expect.poll(() => cssVar(page, '--color-bg')).toBe('#282a36');
    expect(await cssVar(page, '--color-accent')).toBe('#bd93f9');
  });

  test('the custom theme survives trying other built-ins', async ({ page }) => {
    await openAppearance(page);
    await page.getByRole('button', { name: 'Nord', exact: true }).click();
    await copyIntoCustom(page, 'Nord');
    await page.getByLabel('Accent').fill('#00ff00');
    await expect.poll(() => cssVar(page, '--color-accent')).toBe('#00ff00');

    await page.getByRole('button', { name: 'Dracula', exact: true }).click();
    await expect.poll(() => themeAttr(page, 'data-theme-id')).toBe('dracula');

    // One click back — no reset, nothing lost.
    await page.getByRole('button', { name: 'Custom', exact: true }).click();
    await expect.poll(() => cssVar(page, '--color-accent')).toBe('#00ff00');
  });

  test('the mode toggle flips a custom theme between light and dark', async ({
    page,
  }) => {
    await openAppearance(page);
    await page.getByRole('button', { name: 'Nord', exact: true }).click();
    await copyIntoCustom(page, 'Nord');
    expect(await themeAttr(page, 'data-theme')).toBe('dark');

    await page.getByLabel('Dark mode').click();

    await expect.poll(() => themeAttr(page, 'data-theme')).toBe('light');
    await page.reload();
    expect(await themeAttr(page, 'data-theme')).toBe('light');
  });

  test('the syntax style is part of the custom theme and persists', async ({
    page,
  }) => {
    await openAppearance(page);
    await page.getByRole('button', { name: 'Nord', exact: true }).click();
    await copyIntoCustom(page, 'Nord');

    await page.getByLabel('Syntax style').selectOption('dracula');

    await page.reload();
    await openAppearance(page);
    await expect(page.getByLabel('Syntax style')).toHaveValue('dracula');
  });

  test('the syntax style reaches the code editor, not just the fences', async ({
    page,
    request,
  }) => {
    const wsId = await seedWorkspace(request);
    await seedWorkspaceFile(request, wsId, {
      name: 'widget.js',
      content: 'const x = 1;',
    });

    // A light app theme with a dark code style: the editor must follow the
    // *style*, which is exactly what the old `theme={mode}` could not do.
    await openAppearance(page);
    await page.getByRole('button', { name: 'Light', exact: true }).click();
    await copyIntoCustom(page, 'Light');
    await page.getByLabel('Syntax style').selectOption('dracula');

    await page.goto(`/workspaces/${wsId}`);
    const sidebar = page.locator('aside');
    await sidebar.getByRole('button', { name: 'Files' }).click();
    await sidebar.getByRole('button', { name: 'Edit' }).click();

    const editor = page.getByRole('dialog').locator('.cm-editor');
    // Dracula's own fill and keyword colour, straight from the upstream style.
    await expect(editor).toHaveCSS('background-color', 'rgb(40, 42, 54)');
    await expect(editor.locator('span', { hasText: /^const$/ })).toHaveCSS(
      'color',
      'rgb(139, 233, 253)',
    );
  });

  test('a theme copied on one device can be pasted on another', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openAppearance(page);
    await page.getByRole('button', { name: 'Dracula', exact: true }).click();
    await copyIntoCustom(page, 'Dracula');
    await page.getByLabel('Accent').fill('#123456');
    await page.getByLabel('Syntax style').selectOption('nord');

    await page.getByRole('button', { name: 'Copy', exact: true }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(JSON.parse(copied)).toMatchObject({
      mode: 'dark',
      accent: '#123456',
      bg: '#282a36',
      syntax: 'nord',
    });

    // A different device: same app, clean storage.
    const other = await context.browser()!.newContext();
    const otherPage = await other.newPage();
    await openAppearance(otherPage);
    await otherPage.getByRole('button', { name: 'Paste' }).click();
    await otherPage.getByLabel('Paste a theme').fill(copied);
    await otherPage.getByRole('button', { name: 'Apply theme' }).click();

    await expect
      .poll(() => cssVar(otherPage, '--color-accent'))
      .toBe('#123456');
    expect(await cssVar(otherPage, '--color-bg')).toBe('#282a36');
    await expect(otherPage.getByLabel('Syntax style')).toHaveValue('nord');
    await other.close();
  });

  test('pasting over an existing custom theme is confirmed too', async ({
    page,
  }) => {
    await openAppearance(page);
    await page.getByRole('button', { name: 'Nord', exact: true }).click();
    await copyIntoCustom(page, 'Nord');

    await page.getByRole('button', { name: 'Paste' }).click();
    await page.getByLabel('Paste a theme').fill(
      JSON.stringify({
        mode: 'dark',
        bg: '#101010',
        fg: '#fafafa',
        surface: '#202020',
        accent: '#ff00ff',
        danger: '#ff0000',
        success: '#00ff00',
        warning: '#ffff00',
      }),
    );
    await page.getByRole('button', { name: 'Apply theme' }).click();

    await page.getByRole('button', { name: 'Cancel' }).click();
    expect(await cssVar(page, '--color-bg')).toBe(NORD.bg);
  });

  test('pasting malformed JSON reports the problem instead of applying it', async ({
    page,
  }) => {
    await openAppearance(page);
    const before = await cssVar(page, '--color-bg');

    await page.getByRole('button', { name: 'Paste' }).click();
    await page.getByLabel('Paste a theme').fill('{ not json');
    await page.getByRole('button', { name: 'Apply theme' }).click();

    await expect(page.getByText(/valid JSON/i)).toBeVisible();
    expect(await cssVar(page, '--color-bg')).toBe(before);
  });

  test('a low-contrast colour is warned about but still applied', async ({
    page,
  }) => {
    await openAppearance(page);
    await page.getByRole('button', { name: 'Nord', exact: true }).click();
    await copyIntoCustom(page, 'Nord');

    // Text nearly the same as the background.
    await page.getByLabel('Text', { exact: true }).fill('#333a48');

    await expect(page.getByText(/Text on background is .*:1/)).toBeVisible();
    // Warned, never blocked — the user's choice still takes effect.
    await expect.poll(() => cssVar(page, '--color-fg')).toBe('#333a48');
  });
});
