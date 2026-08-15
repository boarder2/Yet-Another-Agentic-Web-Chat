import { test, expect } from '../fixtures';

const githubMain =
  'https://github.com/boarder2/Yet-Another-Agentic-Web-Chat/blob/main/';

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

  test('renders promoted operator guides in the corpus and category navigation', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/docs/capabilities');

    const content = page.locator('#capability-docs-content');
    const categoryNavigation = page.locator(
      'nav[aria-label="Capability categories"]:visible',
    );
    for (const [name, href] of [
      ['Configuration', '/docs/capabilities/configuration'],
      ['Updating YAAWC', '/docs/capabilities/updating'],
    ] as const) {
      await expect(
        content.getByRole('link', { name, exact: true }),
      ).toHaveAttribute('href', href);
      await expect(
        categoryNavigation.getByRole('link', { name, exact: true }),
      ).toHaveAttribute('href', href);
    }

    await page.goto('/docs/capabilities/configuration');
    await expect(page).toHaveTitle(/Configuration - YAAWC$/);
    await expect(
      page.getByRole('heading', { name: 'Configuration', exact: true }),
    ).toHaveAttribute('id', 'configuration');
    await expect(
      page.locator('h2#configuration-file-and-precedence'),
    ).toBeVisible();
    await expect(page.locator('h2#data-directory')).toBeVisible();
    await expect(page.locator('#capability-docs-content')).toContainText(
      'DATA_DIR',
    );
    expect(
      await page
        .getByRole('button', { name: 'Copy code to clipboard' })
        .count(),
    ).toBeGreaterThan(0);

    await page.goto('/docs/capabilities/updating');
    await expect(page).toHaveTitle(/Updating YAAWC - YAAWC$/);
    await expect(
      page.getByRole('heading', { name: 'Updating YAAWC', exact: true }),
    ).toHaveAttribute('id', 'updating-yaawc');
    await expect(page.locator('h2#before-an-update')).toBeVisible();
    await expect(page.locator('h2#verify-and-recover')).toBeVisible();
    await expect(page.locator('#capability-docs-content')).toContainText(
      'docker compose pull app',
    );
    expect(
      await page
        .getByRole('button', { name: 'Copy code to clipboard' })
        .count(),
    ).toBeGreaterThan(0);
  });

  test('keeps capability cross-links in-app and contributor references on GitHub main', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    const pagesAndLinks = [
      {
        path: '/docs/capabilities/administration-and-settings',
        links: [
          ['Configuration', '/docs/capabilities/configuration'],
          ['Updating YAAWC', '/docs/capabilities/updating'],
        ],
      },
      {
        path: '/docs/capabilities/agent-capabilities',
        links: [['Configuration', '/docs/capabilities/configuration']],
      },
      {
        path: '/docs/capabilities/artifacts-and-dashboards',
        links: [['Configuration', '/docs/capabilities/configuration']],
      },
      {
        path: '/docs/capabilities/models-and-providers',
        links: [['Configuration', '/docs/capabilities/configuration']],
      },
    ] as const;

    for (const { path, links } of pagesAndLinks) {
      await page.goto(path);
      const content = page.locator('#capability-docs-content');
      for (const [name, href] of links) {
        await expect(
          content.getByRole('link', { name, exact: true }),
        ).toHaveAttribute('href', href);
      }
    }

    await page.goto('/docs/capabilities');
    for (const [name, href] of [
      ['Built-in themes', `${githubMain}docs/THEMES.md`],
      ['Contributing', `${githubMain}CONTRIBUTING.md`],
    ] as const) {
      const link = page.getByRole('link', { name, exact: true });
      await expect(link).toHaveAttribute('href', href);
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }

    for (const obsoleteReference of [
      'Configuration guide',
      'Tracing and observability',
      'Developer architecture',
    ]) {
      await expect(
        page.getByRole('link', { name: obsoleteReference, exact: true }),
      ).toHaveCount(0);
    }
  });

  test('renders a copyable code-widget contract and defensive example', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/docs/capabilities/artifacts-and-dashboards');

    const content = page.locator('#capability-docs-content');
    await expect(
      content.getByRole('heading', { name: 'Code widgets', exact: true }),
    ).toBeVisible();
    expect(
      await content
        .getByRole('button', { name: 'Copy code to clipboard' })
        .count(),
    ).toBeGreaterThanOrEqual(5);

    const renderBlock = content
      .locator('div.rounded-control')
      .filter({
        hasText: 'async function render({ sources, now, location, theme })',
      })
      .first();
    await expect(renderBlock).toBeVisible();
    await renderBlock
      .getByRole('button', { name: 'Copy code to clipboard' })
      .click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain('async function render({ sources, now, location, theme })');

    const exampleBlock = content
      .locator('div.rounded-control')
      .filter({
        hasText: 'const inputSources = Array.isArray(sources) ? sources : []',
      })
      .first();
    await expect(exampleBlock).toBeVisible();
    await exampleBlock
      .getByRole('button', { name: 'Copy code to clipboard' })
      .click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toMatch(/const chartMarkdown = chart\([\s\S]*chartMarkdown/);
    await expect(content).toContainText('<Chart id="cN"/>');
    await expect(content).toContainText('2,000,000');
    await expect(content).toContainText('4,000,000');
    await expect(content).toContainText('512,000');
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

  test('keeps desktop document navigation visible and internally scrollable', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 420 });
    await page.goto('/docs/capabilities/artifacts-and-dashboards');

    const categories = page.locator(
      'nav[aria-label="Capability categories"]:visible',
    );
    const toc = page.locator('nav[aria-label="On this page"]:visible');
    await expect(categories).toBeVisible();
    await expect(toc).toBeVisible();

    await page.evaluate(() => window.scrollTo(0, 600));

    for (const navigation of [categories, toc]) {
      await expect
        .poll(() =>
          navigation.evaluate((element) =>
            Math.round(element.getBoundingClientRect().top),
          ),
        )
        .toBe(24);
    }

    for (const [navigation, list] of [
      [categories, categories.locator(':scope > div')],
      [toc, toc.locator(':scope > ul')],
    ] as const) {
      await expect
        .poll(() =>
          list.evaluate(
            (element) => element.scrollHeight > element.clientHeight,
          ),
        )
        .toBe(true);
      await list.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await expect
        .poll(() => list.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(0);
      await expect
        .poll(() =>
          navigation.evaluate((element) =>
            Math.round(element.getBoundingClientRect().top),
          ),
        )
        .toBe(24);
    }
  });

  test('aligns clicked and direct TOC fragments at the top gutter', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const path = '/docs/capabilities/artifacts-and-dashboards';
    const fragment = 'if-an-artifact-or-widget-fails';
    await page.goto(path);

    const target = page.locator(`h2#${fragment}`);
    const targetTop = () =>
      target.evaluate((heading) =>
        Math.round(heading.getBoundingClientRect().top),
      );
    const expectTargetAtTopGutter = async () => {
      await expect.poll(targetTop).toBeGreaterThanOrEqual(20);
      await expect.poll(targetTop).toBeLessThanOrEqual(28);
    };

    await page
      .locator('nav[aria-label="On this page"]:visible')
      .getByRole('link', {
        name: 'If an artifact or widget fails',
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(new RegExp(`${path}#${fragment}$`));
    await expectTargetAtTopGutter();

    await page.goto(`${path}#${fragment}`);
    await expectTargetAtTopGutter();
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
