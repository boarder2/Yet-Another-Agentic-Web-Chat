import { test, expect } from '../fixtures';
import type { APIRequestContext, Page } from '@playwright/test';
import { DashboardPage } from '../pages/DashboardPage';

const WIDGET_ALPHA = {
  id: 'widget-test-alpha',
  widgetType: 'llm',
  title: 'Test Widget Alpha',
  sources: [],
  refreshFrequency: 60,
  refreshUnit: 'minutes',
  prompt: 'test',
  provider: 'test',
  model: 'test-direct',
  lastUpdated: null,
  isLoading: false,
  content: '<p>Alpha content</p>',
  error: null,
  layout: { x: 0, y: 0, w: 2, h: 2 },
  showOnDashboard: true,
};

const WIDGET_BETA = {
  ...WIDGET_ALPHA,
  id: 'widget-test-beta',
  title: 'Test Widget Beta',
  content: '<p>Beta content</p>',
  layout: { x: 2, y: 0, w: 2, h: 2 },
};

async function openWidgetCreator(
  page: Page,
  request: APIRequestContext,
): Promise<void> {
  const response = await request.patch('/api/settings', {
    data: { yaawc_dashboard_widgets: '[]', yaawc_dashboard_cache: '{}' },
  });
  expect(response.status()).toBe(204);

  const dashboard = new DashboardPage(page);
  await dashboard.goto();
  await page.getByRole('button', { name: 'Create Your First Widget' }).click();
}

test.describe('dashboard', () => {
  // Both tests mutate the global, DB-backed dashboard settings keys (a real
  // cross-device-sync feature — see src/lib/settings/keys.ts). This spec's
  // `serial` project (one worker) keeps a concurrently-running spec from
  // hydrating a dirty value; reset after each test so nothing leaks between
  // tests.
  test.afterEach(async ({ page, request }) => {
    // Clear the page's cache first: an open board re-persists its widget state
    // on a debounce, and each flush sends whatever localStorage holds at that
    // moment — so a straggler write can't resurrect the widgets. Then re-patch
    // until the DB reads back empty.
    await page.evaluate(() => {
      localStorage.setItem('yaawc_dashboard_widgets', '[]');
      localStorage.setItem('yaawc_dashboard_cache', '{}');
    });
    await expect
      .poll(async () => {
        await request.patch('/api/settings', {
          data: { yaawc_dashboard_widgets: '[]', yaawc_dashboard_cache: '{}' },
        });
        const response = await request.get('/api/settings');
        const settings = (await response.json()) as Record<string, string>;
        return settings.yaawc_dashboard_widgets;
      })
      .toBe('[]');
  });

  test('renders the heading and the empty-state board when no widgets exist', async ({
    page,
  }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    await expect(dashboard.heading).toBeVisible();
    // The isolated test DB has no widgets, so the welcome/empty state shows.
    await expect(dashboard.emptyTitle).toBeVisible();

    const empty = page.locator(
      '[data-list-state="empty"][data-list-layout="page"]',
    );
    await expect(empty).toBeVisible();
    await expect(
      empty.getByRole('heading', {
        name: 'Welcome to your Dashboard',
        exact: true,
      }),
    ).toBeVisible();
    await expect(empty).toContainText(
      'Create your first widget to get started with personalized information',
    );
    await expect(empty).toContainText(
      'Widgets let you fetch content from any URL and process it with AI to show exactly what you need.',
    );
    await expect(
      empty.getByRole('button', { name: 'Create Your First Widget' }),
    ).toBeVisible();
  });

  test('code widget fields wire title and code validation captions', async ({
    page,
  }) => {
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

    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await page
      .getByRole('button', { name: 'Create Your First Widget' })
      .click();

    const chooser = page.getByRole('dialog');
    await chooser.getByRole('button', { name: /^Code Widget/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: 'Create Code Widget', exact: true }),
    ).toBeVisible();

    const code = dialog.getByLabel('Code', { exact: true });
    await expect(code).toBeVisible();

    const refreshGroup = dialog.getByRole('group', {
      name: 'Refresh Frequency',
      exact: true,
    });
    await expect(
      refreshGroup.getByRole('spinbutton', {
        name: 'Refresh frequency',
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      refreshGroup.getByRole('combobox', {
        name: 'Refresh unit',
        exact: true,
      }),
    ).toBeVisible();

    const sources = dialog.getByRole('group', {
      name: 'Widget sources',
      exact: true,
    });
    await dialog
      .getByRole('button', { name: 'Add Source', exact: true })
      .click();
    await expect(
      sources.getByRole('textbox', { name: 'Source URL 1', exact: true }),
    ).toBeVisible();
    await expect(
      sources.getByRole('combobox', {
        name: 'Source type 1',
        exact: true,
      }),
    ).toBeVisible();

    await code.fill('');
    await dialog
      .getByRole('button', { name: 'Create Widget', exact: true })
      .click();

    const title = dialog.getByLabel('Widget Title', { exact: true });
    await expect(title).toHaveAttribute('aria-invalid', 'true');
    const titleDescribedBy = await title.getAttribute('aria-describedby');
    expect(titleDescribedBy).not.toBeNull();
    await expect(dialog.locator(`[id="${titleDescribedBy}"]`)).toHaveText(
      'Title is required.',
    );

    const codeGroup = dialog.getByRole('group', {
      name: 'Code',
      exact: true,
    });
    await expect(codeGroup.locator('legend')).toHaveText('Code');
    await expect(codeGroup).toHaveAttribute('aria-invalid', 'true');
    const codeDescribedBy = await codeGroup.getAttribute('aria-describedby');
    expect(codeDescribedBy).not.toBeNull();
    await expect(dialog.locator(`[id="${codeDescribedBy}"]`)).toHaveText(
      'Code is required.',
    );
  });

  test('LLM widget composite fields name every source and refresh control', async ({
    page,
    request,
  }) => {
    await openWidgetCreator(page, request);

    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', {
        name: 'Create New Widget',
        exact: true,
      }),
    ).toBeVisible();

    const sourceField = dialog.getByRole('group', {
      name: 'Source URLs',
      exact: true,
    });
    const sources = sourceField.getByRole('group', {
      name: 'Widget sources',
      exact: true,
    });
    await expect(
      sources.getByRole('textbox', { name: 'Source URL 1', exact: true }),
    ).toBeVisible();
    await expect(
      sources.getByRole('combobox', {
        name: 'Source type 1',
        exact: true,
      }),
    ).toBeVisible();

    const refreshField = dialog.getByRole('group', {
      name: 'Refresh Frequency',
      exact: true,
    });
    await expect(
      refreshField.getByRole('spinbutton', {
        name: 'Refresh frequency',
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      refreshField.getByRole('combobox', {
        name: 'Refresh unit',
        exact: true,
      }),
    ).toBeVisible();

    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();
  });

  test('shows a compact widget loading state during refresh and restores content afterward', async ({
    page,
    request,
  }) => {
    const farFuture = new Date(Date.now() + 3_600_000).toISOString();
    const now = new Date().toISOString();
    const widgetsJson = JSON.stringify([WIDGET_ALPHA]);
    const cacheJson = JSON.stringify({
      [WIDGET_ALPHA.id]: {
        content: '<p>Alpha content</p>',
        lastFetched: now,
        expiresAt: farFuture,
      },
    });
    await request.patch('/api/settings', {
      data: {
        yaawc_dashboard_widgets: widgetsJson,
        yaawc_dashboard_cache: cacheJson,
      },
    });
    await page.addInitScript(
      ([widgets, cache]) => {
        localStorage.setItem('yaawc_dashboard_widgets', widgets);
        localStorage.setItem('yaawc_dashboard_cache', cache);
      },
      [widgetsJson, cacheJson],
    );

    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/dashboard/process-widget', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fallback();
        return;
      }
      await held;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          content: '<p>Refreshed alpha content</p>',
          charts: [],
        }),
      });
    });

    try {
      const dashboard = new DashboardPage(page);
      await dashboard.goto();
      await expect(page.getByText('Alpha content')).toBeVisible();

      await page
        .getByRole('button', { name: 'Refresh All Widgets', exact: true })
        .click();

      const loading = page.locator(
        '[data-list-state="loading"][data-list-layout="compact"]',
      );
      await expect(loading).toBeVisible();
      await expect(loading).toContainText('Loading content...');
      await expect(loading.locator('svg')).toHaveAttribute('width', '20');
      await expect(loading.locator('svg')).toHaveAttribute('height', '20');

      release();
      await expect(loading).toBeHidden();
      await expect(page.getByText('Refreshed alpha content')).toBeVisible();
    } finally {
      release();
    }
  });

  test('renders seeded widgets with content and hides empty state', async ({
    page,
    request,
  }) => {
    // Seed a fresh cache entry per widget so the on-mount auto-refresh serves
    // cached content instead of calling the (agent-backed) process-widget route
    // — keeping the assertions deterministic and independent of server load.
    const farFuture = new Date(Date.now() + 3_600_000).toISOString();
    const now = new Date().toISOString();
    const cacheJson = JSON.stringify({
      [WIDGET_ALPHA.id]: {
        content: '<p>Alpha content</p>',
        lastFetched: now,
        expiresAt: farFuture,
      },
      [WIDGET_BETA.id]: {
        content: '<p>Beta content</p>',
        lastFetched: now,
        expiresAt: farFuture,
      },
    });
    const widgetsJson = JSON.stringify([WIDGET_ALPHA, WIDGET_BETA]);

    // Seed both DB-backed keys (so settings hydration reconciles to these
    // values, not an empty default) and prime localStorage before any page
    // script runs (so useDashboard reads them on first mount).
    await request.patch('/api/settings', {
      data: {
        yaawc_dashboard_widgets: widgetsJson,
        yaawc_dashboard_cache: cacheJson,
      },
    });
    await page.addInitScript(
      ([widgets, cache]) => {
        localStorage.setItem('yaawc_dashboard_widgets', widgets);
        localStorage.setItem('yaawc_dashboard_cache', cache);
      },
      [widgetsJson, cacheJson],
    );

    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    await expect(dashboard.heading).toBeVisible();

    // Both seeded widgets render their (distinct, cached) content, and the
    // empty-state card is gone.
    await expect(page.getByText('Alpha content')).toBeVisible();
    await expect(page.getByText('Beta content')).toBeVisible();
    await expect(dashboard.emptyTitle).not.toBeVisible();

    // Per-widget title headers render only in edit mode (view mode shows
    // content alone). Switch modes and assert both seeded widgets render their
    // own header. The grid library lays cards out with a deferred width
    // measurement that leaves them zero-size in headless, so assert the headers
    // are attached (rendered) rather than fighting that visibility timing.
    await page.getByRole('button', { name: 'Switch to Edit Mode' }).click();
    await expect(
      page.getByRole('button', { name: 'Switch to View Mode' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Test Widget Alpha' }),
    ).toBeAttached();
    await expect(
      page.getByRole('heading', { name: 'Test Widget Beta' }),
    ).toBeAttached();
  });
});
