import { test, expect } from '../fixtures';

test.describe('capability documentation', () => {
  test('renders the index and a page with stable headings, tables, and code', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/docs/capabilities');

    await expect(page).toHaveTitle(/YAAWC capabilities - YAAWC$/);
    await expect(
      page.getByRole('heading', { name: 'YAAWC capabilities', exact: true }),
    ).toHaveAttribute('id', 'yaawc-capabilities');

    const content = page.locator('#capability-docs-content');
    await expect(content.locator('table')).toBeVisible();
    await expect(
      content.getByRole('link', {
        name: 'Chat and research',
        exact: true,
      }),
    ).toHaveAttribute('href', '/docs/capabilities/chat-and-research');

    await page.goto('/docs/capabilities/automation');
    await expect(page).toHaveTitle(/Automation - YAAWC$/);
    await expect(
      page.getByRole('heading', { name: 'Automation', exact: true }),
    ).toHaveAttribute('id', 'automation');
    await expect(
      page.getByRole('button', { name: 'Copy code to clipboard' }),
    ).toBeVisible();

    await page.goto('/docs/capabilities/chat-and-research#choose-a-focus-mode');
    await expect(page.locator('h2#choose-a-focus-mode')).toBeVisible();
  });

  test('keeps the documentation body at normal chat width while navigation extends beyond it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto('/');
    const chatWidth = await page
      .locator('main > div')
      .evaluate((container) => container.getBoundingClientRect().width);

    await page.goto('/docs/capabilities/chat-and-research');
    const categories = page.locator(
      'nav[aria-label="Capability categories"]:visible',
    );
    const toc = page.locator('nav[aria-label="On this page"]:visible');
    await expect(categories).toBeVisible();
    await expect(toc).toBeVisible();

    const [documentBody, categoryNavigation, tableOfContents] =
      await Promise.all([
        page.locator('#capability-docs-content').boundingBox(),
        categories.boundingBox(),
        toc.boundingBox(),
      ]);
    if (!documentBody || !categoryNavigation || !tableOfContents) {
      throw new Error('Capability docs navigation did not render');
    }

    expect(documentBody.width).toBeGreaterThan(chatWidth - 1);
    expect(documentBody.width).toBeLessThan(chatWidth + 1);
    expect(categoryNavigation.x).toBeLessThan(documentBody.x);
    expect(tableOfContents.x).toBeGreaterThan(
      documentBody.x + documentBody.width,
    );
  });

  test('uses category navigation and the page table of contents', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/docs/capabilities');

    const categories = page.locator(
      'nav[aria-label="Capability categories"]:visible',
    );
    await expect(categories).toBeVisible();
    const chatAndResearch = categories.getByRole('link', {
      name: 'Chat and research',
      exact: true,
    });
    await chatAndResearch.click();

    await expect(page).toHaveURL(/\/docs\/capabilities\/chat-and-research$/);
    await expect(chatAndResearch).toHaveAttribute('aria-current', 'page');

    const toc = page.locator('nav[aria-label="On this page"]:visible');
    await expect(toc).toBeVisible();
    const focusMode = toc.getByRole('link', {
      name: 'Choose a focus mode',
      exact: true,
    });
    await expect(focusMode).toHaveAttribute('href', '#choose-a-focus-mode');
    await focusMode.click();

    await expect(page).toHaveURL(
      /\/docs\/capabilities\/chat-and-research#choose-a-focus-mode$/,
    );
    await expect(
      page.getByRole('heading', {
        name: 'Choose a focus mode',
        exact: true,
      }),
    ).toHaveAttribute('id', 'choose-a-focus-mode');
  });

  test('keeps the active category and TOC on direct desktop and mobile page loads', async ({
    page,
  }) => {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 375, height: 700 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/docs/capabilities/chat-and-research');

      const categories = page.locator(
        'nav[aria-label="Capability categories"]:visible',
      );
      await expect(
        categories.getByRole('link', {
          name: 'Chat and research',
          exact: true,
        }),
      ).toHaveAttribute('aria-current', 'page');

      const toc = page.locator('nav[aria-label="On this page"]:visible');
      await expect(toc).toBeVisible();
      await expect(
        toc.getByRole('link', {
          name: 'Choose a focus mode',
          exact: true,
        }),
      ).toHaveAttribute('href', '#choose-a-focus-mode');
    }
  });

  test('returns 404 for an unknown capability page', async ({ page }) => {
    const response = await page.goto(
      '/docs/capabilities/not-a-real-capability',
    );

    expect(response?.status()).toBe(404);
    await expect(page.getByText('This page could not be found.')).toBeVisible();
  });

  test('exposes Help & capabilities in the desktop secondary navigation', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    const help = page
      .locator('div.hidden.lg\\:fixed')
      .first()
      .getByRole('link', {
        name: 'Help & capabilities',
        exact: true,
      });
    await expect(help).toBeVisible();
    await expect(help).toHaveAttribute('href', '/docs/capabilities');
    await expect(page.locator('div.fixed.bottom-0.lg\\:hidden')).toBeHidden();

    await help.click();
    await expect(page).toHaveURL(/\/docs\/capabilities$/);
    await expect(
      page.getByRole('heading', { name: 'YAAWC capabilities', exact: true }),
    ).toBeVisible();
  });

  test('reaches Help from mobile Settings without adding a bottom-nav item', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await page.goto('/');

    const bottomNav = page.locator('div.fixed.bottom-0.lg\\:hidden');
    await expect(bottomNav).toBeVisible();
    const hrefs = await bottomNav
      .locator('a')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    expect(hrefs).toEqual([
      '/',
      '/dashboard',
      '/workspaces',
      '/automations',
      '/history',
    ]);
    await expect(bottomNav.getByRole('link')).toHaveCount(5);
    await expect(
      bottomNav.getByRole('link', {
        name: 'Help & capabilities',
        exact: true,
      }),
    ).toHaveCount(0);

    await page.locator('[aria-label="Settings"]:visible').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const help = dialog.getByRole('link', {
      name: 'Help & capabilities',
      exact: true,
    });
    await expect(help).toBeVisible();
    await help.click();

    await expect(page).toHaveURL(/\/docs\/capabilities$/);
    await expect(dialog).toBeHidden();
    await expect(
      page.locator('div.fixed.bottom-0.lg\\:hidden').getByRole('link'),
    ).toHaveCount(5);
    await expect(
      page.locator('div.fixed.bottom-0.lg\\:hidden').getByRole('link', {
        name: 'Help & capabilities',
        exact: true,
      }),
    ).toHaveCount(0);
  });
});
