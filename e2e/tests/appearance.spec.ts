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

/**
 * Select a built-in and edit it into the empty custom slot — Customize edits
 * whatever is active, and with nothing to overwrite no confirmation is due.
 */
async function editIntoCustom(page: SettingsPage['page'], name: string) {
  await page.getByRole('button', { name, exact: true }).click();
  await page
    .getByRole('button', { name: `Edit ${name} as your custom theme` })
    .click();
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
    // colour is to edit it into Custom first.
    await expect(page.getByLabel('Accent')).toBeDisabled();
    await expect(page.getByLabel('Syntax style')).toBeDisabled();
    await expect(page.getByLabel('Dark mode')).toBeDisabled();
  });

  test('editing a built-in copies it into Custom and unlocks editing', async ({
    page,
  }) => {
    await openAppearance(page);

    // No custom theme yet, so there is nothing to overwrite and no confirmation.
    await editIntoCustom(page, 'Nord');

    // Nothing left to enable, so the button that did it stands down.
    await expect(
      page.getByRole('button', { name: /^Edit .* as your custom theme$/ }),
    ).toBeHidden();

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
    await editIntoCustom(page, 'Nord');
    await page.getByLabel('Accent').fill('#00ff00');
    await expect.poll(() => cssVar(page, '--color-accent')).toBe('#00ff00');

    const edit = page.getByRole('button', {
      name: 'Edit Dracula as your custom theme',
    });
    await page.getByRole('button', { name: 'Dracula', exact: true }).click();
    await edit.click();
    await page.getByRole('button', { name: 'Cancel' }).click();

    // Cancelling leaves the existing custom theme untouched — Dracula is merely
    // the theme being previewed, so it takes going back to see that.
    await page.getByRole('button', { name: 'Custom', exact: true }).click();
    await expect.poll(() => cssVar(page, '--color-accent')).toBe('#00ff00');
    expect(await cssVar(page, '--color-bg')).toBe(NORD.bg);

    await page.getByRole('button', { name: 'Dracula', exact: true }).click();
    await edit.click();
    await page.getByRole('button', { name: 'Replace' }).click();

    await expect.poll(() => cssVar(page, '--color-bg')).toBe('#282a36');
    expect(await cssVar(page, '--color-accent')).toBe('#bd93f9');
  });

  test('the custom theme survives trying other built-ins', async ({ page }) => {
    await openAppearance(page);
    await editIntoCustom(page, 'Nord');
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
    await editIntoCustom(page, 'Nord');
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
    await editIntoCustom(page, 'Nord');

    await page.getByLabel('Syntax style').selectOption('Dracula');

    await page.reload();
    await openAppearance(page);
    await expect(page.getByLabel('Syntax style')).toHaveValue('Dracula');
    await expect(page.getByLabel('Syntax variant')).toHaveValue('dracula');
  });

  test('a syntax family’s accent variant recolours only its accent roles', async ({
    page,
  }) => {
    await openAppearance(page);
    await editIntoCustom(page, 'Nord');

    await page.getByLabel('Syntax style').selectOption('Catppuccin');
    await page.getByLabel('Syntax variant').selectOption('catppuccinMochaBlue');

    const fence = page
      .locator('#appearance div', { hasText: 'export function main' })
      .last();
    // Blue replaces mauve on keywords; the flavour's own string green and fill
    // are untouched, which is what makes it an accent rather than a new theme.
    await expect(fence.locator('span', { hasText: /^export$/ })).toHaveCSS(
      'color',
      'rgb(137, 180, 250)',
    );
    await expect(fence).toHaveCSS('background-color', 'rgb(49, 50, 68)');
    await expect(fence.locator('span', { hasText: /^'\.\/greet'$/ })).toHaveCSS(
      'color',
      'rgb(166, 227, 161)',
    );
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
    await editIntoCustom(page, 'Light');
    await page.getByLabel('Syntax style').selectOption('Dracula');

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

  test('a syntax style change reaches views already on screen', async ({
    page,
    request,
  }) => {
    const wsId = await seedWorkspace(request);
    const fileId = await seedWorkspaceFile(request, wsId, {
      name: 'widget.js',
      content: 'const x = 1;',
    });
    await page.goto(`/workspaces/${wsId}/files/${fileId}`);
    const fence = page.locator('pre');
    await expect(fence).toBeVisible();

    // Settings is a modal over the page it was opened from, so the fence stays
    // mounted throughout — a style change has to reach it without a remount.
    const settings = new SettingsPage(page);
    await page.getByLabel('Settings').first().click();
    await settings.openSection('Appearance');
    await editIntoCustom(page, 'Light');
    await page.getByLabel('Syntax style').selectOption('Dracula');
    await settings.close();

    await expect(fence).toHaveCSS('background-color', 'rgb(40, 42, 54)');
    await expect(fence.locator('span', { hasText: /^const$/ })).toHaveCSS(
      'color',
      'rgb(139, 233, 253)',
    );
  });

  test('a tile’s chip names its variant and remembers the last one picked', async ({
    page,
  }) => {
    await openAppearance(page);

    // The visible chip is the transparent select's sibling — same wrapper, so
    // the label the tile shows and the value the dropdown holds can't disagree.
    const chip = (n: number) =>
      page
        .getByLabel('Catppuccin variant')
        .nth(n)
        .locator('xpath=following-sibling::span');

    await expect(chip(0)).toHaveText('Frappé · Blue');
    await expect(chip(1)).toHaveText('Latte · Blue');

    await page
      .getByLabel('Catppuccin variant')
      .first()
      .selectOption('catppuccin-macchiato');
    await expect(chip(0)).toHaveText('Macchiato · Mauve');

    // Browsing to another theme leaves the tile showing what was picked here —
    // and the light tile, a different family instance, is untouched by it.
    await page.getByRole('button', { name: 'Nord', exact: true }).click();
    await expect.poll(() => themeAttr(page, 'data-theme-id')).toBe('nord');
    await expect(chip(0)).toHaveText('Macchiato · Mauve');
    await expect(chip(1)).toHaveText('Latte · Blue');
  });

  test('a family tile’s variant dropdown applies that theme', async ({
    page,
  }) => {
    await openAppearance(page);

    // Catppuccin's dark flavours share one tile; the dropdown is how you reach
    // the ones the tile isn't currently showing.
    await page
      .getByLabel('Catppuccin variant')
      .first()
      .selectOption('catppuccin-macchiato');

    await expect
      .poll(() => themeAttr(page, 'data-theme-id'))
      .toBe('catppuccin-macchiato');
    expect(await cssVar(page, '--color-bg')).toBe('#24273a');

    await page.reload();
    await expect
      .poll(() => themeAttr(page, 'data-theme-id'))
      .toBe('catppuccin-macchiato');
  });

  test('a theme accent variant moves the accent and its syntax style together', async ({
    page,
  }) => {
    await openAppearance(page);

    await page
      .getByLabel('Catppuccin variant')
      .first()
      .selectOption('catppuccin-mocha-blue');

    await expect
      .poll(() => themeAttr(page, 'data-theme-id'))
      .toBe('catppuccin-mocha-blue');
    // Blue replaces mauve as the accent seed; the rest of Mocha is untouched.
    expect(await cssVar(page, '--color-accent')).toBe('#89b4fa');
    expect(await cssVar(page, '--color-bg')).toBe('#1e1e2e');

    // The theme's syntax style follows its accent, so keywords match the UI.
    const fence = page
      .locator('#appearance div', { hasText: 'export function main' })
      .last();
    await expect(fence.locator('span', { hasText: /^export$/ })).toHaveCSS(
      'color',
      'rgb(137, 180, 250)',
    );
  });

  test('an authored syntax style paints both a fence and the editor', async ({
    page,
    request,
  }) => {
    const wsId = await seedWorkspace(request);
    await seedWorkspaceFile(request, wsId, {
      name: 'widget.js',
      content: 'const x = 1;',
    });

    await openAppearance(page);
    await page
      .getByLabel('Catppuccin variant')
      .first()
      .selectOption('catppuccin-mocha');

    // Mocha's surface0 fill and mauve keyword, from the Catppuccin palette —
    // the style is authored in-repo, so this is the only check that it renders.
    const fence = page
      .locator('#appearance div', { hasText: 'export function main' })
      .last();
    await expect(fence).toHaveCSS('background-color', 'rgb(49, 50, 68)');
    await expect(fence.locator('span', { hasText: /^export$/ })).toHaveCSS(
      'color',
      'rgb(203, 166, 247)',
    );

    await page.goto(`/workspaces/${wsId}`);
    const sidebar = page.locator('aside');
    await sidebar.getByRole('button', { name: 'Files' }).click();
    await sidebar.getByRole('button', { name: 'Edit' }).click();

    const editor = page.getByRole('dialog').locator('.cm-editor');
    await expect(editor).toHaveCSS('background-color', 'rgb(49, 50, 68)');
    await expect(editor.locator('span', { hasText: /^const$/ })).toHaveCSS(
      'color',
      'rgb(203, 166, 247)',
    );
  });

  test('a theme copied on one device can be pasted on another', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openAppearance(page);
    await editIntoCustom(page, 'Dracula');
    await page.getByLabel('Accent').fill('#123456');
    await page.getByLabel('Syntax style').selectOption('Nord');

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
    await expect(otherPage.getByLabel('Syntax style')).toHaveValue('Nord');
    await other.close();
  });

  test('pasting over an existing custom theme is confirmed too', async ({
    page,
  }) => {
    await openAppearance(page);
    await editIntoCustom(page, 'Nord');

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
    await editIntoCustom(page, 'Nord');

    // Text nearly the same as the background.
    await page.getByLabel('Text', { exact: true }).fill('#333a48');

    await expect(page.getByText(/Text on background is .*:1/)).toBeVisible();
    // Warned, never blocked — the user's choice still takes effect.
    await expect.poll(() => cssVar(page, '--color-fg')).toBe('#333a48');
  });
});
