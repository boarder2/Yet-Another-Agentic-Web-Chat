import { test, expect } from '../fixtures';
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

test.describe('dashboard', () => {
  // Both tests mutate the global, DB-backed dashboard settings keys (a real
  // cross-device-sync feature — see src/lib/settings/keys.ts). This spec's
  // `serial` project (one worker) keeps a concurrently-running spec from
  // hydrating a dirty value; reset after each test so nothing leaks between
  // tests.
  test.afterEach(async ({ request }) => {
    await request.patch('/api/settings', {
      data: { yaawc_dashboard_widgets: '[]', yaawc_dashboard_cache: '{}' },
    });
  });

  test('renders the heading and the empty-state board when no widgets exist', async ({
    page,
  }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    await expect(dashboard.heading).toBeVisible();
    // The isolated test DB has no widgets, so the welcome/empty state shows.
    await expect(dashboard.emptyTitle).toBeVisible();
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
