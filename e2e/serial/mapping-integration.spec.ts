import { test, expect } from '../fixtures';
import type { APIRequestContext, Page } from '../fixtures/api';
import { ChatPage } from '../pages/ChatPage';
import {
  configureTestMapping,
  readMappingIntegrationSettings,
  restoreMappingIntegrationSettings,
  routeTestMapTiles,
  type MappingSettingsSnapshot,
} from '../utils/mapping';

let settingsBeforeTest: MappingSettingsSnapshot;
let activeRun: { chatId: string; messageId: string } | undefined;

async function openMappingChat(
  page: Page,
  model: string,
  path = '/',
  tileOptions: { fail?: boolean } = {},
): Promise<ChatPage> {
  await routeTestMapTiles(page, tileOptions);
  const chat = new ChatPage(page);
  await chat.goto(path);
  await chat.selectChatModel(model);
  return chat;
}

async function mapWidget(page: Page) {
  const widget = page.locator('[data-map-widget]').last();
  await expect(widget).toBeVisible({ timeout: 15_000 });
  return widget;
}

async function installGeolocationSpy(
  page: Page,
): Promise<() => Promise<number>> {
  await page.addInitScript(() => {
    const geolocation = navigator.geolocation;
    const original = geolocation.getCurrentPosition.bind(geolocation);
    let calls = 0;
    Object.defineProperty(geolocation, 'getCurrentPosition', {
      configurable: true,
      value: (
        success: PositionCallback,
        error?: PositionErrorCallback | null,
        options?: PositionOptions,
      ) => {
        calls += 1;
        return original(success, error, options);
      },
    });
    (window as Window & { __yaawcGeoCalls?: () => number }).__yaawcGeoCalls =
      () => calls;
  });
  return () =>
    page.evaluate(
      () =>
        (
          window as Window & { __yaawcGeoCalls?: () => number }
        ).__yaawcGeoCalls?.() ?? 0,
    );
}

function trackActiveRun(page: Page): void {
  page.on('request', (outgoing) => {
    if (outgoing.method() !== 'POST' || !outgoing.url().endsWith('/api/chat'))
      return;
    try {
      const payload = JSON.parse(outgoing.postData() ?? '{}') as {
        message?: { chatId?: string; messageId?: string };
      };
      const chatId = payload.message?.chatId;
      const messageId = payload.message?.messageId;
      if (chatId && messageId) activeRun = { chatId, messageId };
    } catch {
      // The application request is authoritative; a malformed observer copy
      // must not affect the browser flow.
    }
  });
}

async function restoreActiveRun(request: APIRequestContext) {
  if (!activeRun) return;
  await request
    .post('/api/chat/cancel', { data: { messageId: activeRun.messageId } })
    .catch(() => {});
  activeRun = undefined;
}

test.describe('mapping interactive integration', () => {
  test.beforeEach(async ({ request }) => {
    settingsBeforeTest = await readMappingIntegrationSettings(request);
    await configureTestMapping(request);
  });

  test.afterEach(async ({ request }) => {
    await restoreActiveRun(request);
    await restoreMappingIntegrationSettings(request, settingsBeforeTest);
  });

  test('renders nearby and business results as one numbered, cited map', async ({
    page,
  }) => {
    const chat = await openMappingChat(page, 'Test (mapping nearby)');
    await chat.sendMessage('Find nearby cafes in Testville.');
    await chat.waitForStreamComplete();

    const widget = await mapWidget(page);
    await expect(
      widget.locator('ol[aria-label="Mapped places"]'),
    ).toContainText('Deterministic Central Cafe');
    await expect(widget).toContainText('1 Test Way, Testville');
    await expect(widget).toContainText(
      'Map attribution: Deterministic mapping test data',
    );
    await expect(widget.locator('.yaawc-map-numbered-marker')).toHaveCount(1);
    await expect(widget.locator('[data-map-links] a')).toHaveCount(2);

    // Business enrichment is a separate identity-bound tool call and retains
    // the provider-supplied field in the ordinary answer, not attribution.
    const businessChat = await openMappingChat(page, 'Test (mapping business)');
    await businessChat.sendMessage('Look up the central cafe in Testville.');
    await businessChat.waitForStreamComplete();
    const businessWidget = await mapWidget(page);
    await expect(page.getByText('Mo-Su 08:00-18:00')).toBeVisible();
    await expect(
      businessWidget.locator('ol[aria-label="Mapped places"]'),
    ).toContainText('Deterministic Central Cafe');
  });

  test('composes several searches into independently rendered map groupings', async ({
    page,
  }) => {
    const chat = await openMappingChat(page, 'Test (mapping multiple maps)');
    await chat.sendMessage(
      'Search for the central cafe, north market, and south museum, then show the selected groups on separate maps.',
    );
    await chat.waitForStreamComplete();

    const widgets = page.locator('[data-map-widget]');
    await expect(widgets).toHaveCount(3);
    await expect(page.locator('body')).toContainText(
      'Each inline map is an independent grouping.',
    );
    await expect(widgets.nth(0)).toContainText('Central and North');
    await expect(widgets.nth(0)).toContainText('Deterministic Central Cafe');
    await expect(widgets.nth(0)).toContainText('Deterministic North Market');
    await expect(widgets.nth(0)).not.toContainText(
      'Deterministic South Museum',
    );

    await expect(widgets.nth(1)).toContainText('South and Central');
    await expect(widgets.nth(1)).toContainText('Deterministic South Museum');
    await expect(widgets.nth(1)).toContainText('Deterministic Central Cafe');
    await expect(widgets.nth(1)).not.toContainText(
      'Deterministic North Market',
    );

    await expect(widgets.nth(2)).toContainText('North only');
    await expect(widgets.nth(2)).toContainText('Deterministic North Market');
    await expect(widgets.nth(2)).not.toContainText(
      'Deterministic Central Cafe',
    );
    await expect(widgets.nth(2)).not.toContainText(
      'Deterministic South Museum',
    );
  });

  test('renders a named route with a single polyline and external navigation link', async ({
    page,
  }) => {
    const chat = await openMappingChat(page, 'Test (mapping route)');
    await chat.sendMessage('Give me driving directions from central to north.');
    await chat.waitForStreamComplete();

    const widget = await mapWidget(page);
    await expect(widget.locator('[data-map-route-summary]')).toContainText(
      'Driving route',
    );
    await expect(widget.locator('.yaawc-map-route')).toHaveCount(1);
    await expect(
      widget.getByRole('link', { name: 'Open route', exact: true }),
    ).toBeVisible();
    await expect(
      widget.locator('ol[aria-label="Mapped places"]'),
    ).toContainText('Deterministic North Market');
  });

  test('requests browser permission only after approval and keeps Use once exact data session-scoped', async ({
    page,
    context,
  }) => {
    trackActiveRun(page);
    const geoCalls = await installGeolocationSpy(page);
    await context.setGeolocation({ latitude: 40, longitude: -75 });
    const chat = await openMappingChat(page, 'Test (mapping location)');
    await context.grantPermissions(['geolocation'], {
      origin: new URL(page.url()).origin,
    });

    await chat.sendMessage(
      'Route from my current location to the north market.',
    );
    await expect(
      page.getByText('Use your current location?', { exact: true }),
    ).toBeVisible();
    expect(await geoCalls()).toBe(0);
    await expect(
      page.getByRole('button', { name: 'Use and save', exact: true }),
    ).toBeVisible();

    // The approval UI is the only action that may start the browser call.
    await page.getByRole('button', { name: 'Use once', exact: true }).click();
    await expect.poll(geoCalls).toBe(1);
    await chat.waitForStreamComplete();

    const widget = await mapWidget(page);
    await expect(widget.locator('.yaawc-map-current-location')).toHaveCount(1);

    await page.reload({ waitUntil: 'networkidle' });
    await chat.input.waitFor({ state: 'visible' });
    const reloaded = await mapWidget(page);
    await expect(reloaded).toContainText('Route not retained in this answer.');
    await expect(reloaded.locator('.yaawc-map-current-location')).toHaveCount(
      0,
    );
    await expect(reloaded.locator('.yaawc-map-route')).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toContain('40,-75');

    // The active run is complete; no cancellation is needed. The generated
    // message remains useful after the exact session overlay disappears.
    activeRun = undefined;
  });

  test('Use and save retains the exact route only in the current answer', async ({
    page,
    context,
    request,
  }) => {
    trackActiveRun(page);
    await context.setGeolocation({ latitude: 40, longitude: -75 });
    const chat = await openMappingChat(page, 'Test (mapping location)');
    await context.grantPermissions(['geolocation'], {
      origin: new URL(page.url()).origin,
    });
    await chat.sendMessage(
      'Route from my current location to the north market.',
    );
    await expect(
      page.getByRole('button', { name: 'Use and save', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Use and save', exact: true })
      .click();
    await chat.waitForStreamComplete();

    const chatId = new URL(page.url()).pathname.split('/').pop()!;
    const body = await (await request.get(`/api/chats/${chatId}`)).json();
    const assistant = body.messages.find(
      (message: { role: string }) => message.role === 'assistant',
    ) as { metadata: string };
    const metadata = JSON.parse(assistant.metadata) as {
      mapSpecs: Record<string, { route?: Record<string, unknown> }>;
    };
    const spec = Object.values(metadata.mapSpecs)[0];
    expect(spec.route).toMatchObject({
      origin: { lat: 40, lon: -75 },
      destination: { lat: 40.004, lon: -75.002 },
    });
    expect(spec.route).toHaveProperty('geometry');

    await page.reload({ waitUntil: 'networkidle' });
    await chat.input.waitFor({ state: 'visible' });
    const widget = await mapWidget(page);
    await expect(widget).not.toContainText(
      'Route not retained in this answer.',
    );
    await expect(widget.locator('.yaawc-map-route')).toHaveCount(1);
    activeRun = undefined;
  });

  test('private sessions never offer saving the precise route', async ({
    page,
    context,
  }) => {
    trackActiveRun(page);
    await context.setGeolocation({ latitude: 40, longitude: -75 });
    const chat = await openMappingChat(
      page,
      'Test (mapping location)',
      '/?private=1',
    );
    await context.grantPermissions(['geolocation'], {
      origin: new URL(page.url()).origin,
    });
    await chat.sendMessage(
      'Route from my current location to the north market.',
    );
    await expect(
      page.getByText('Use your current location?', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Use and save', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText('Saving the exact route is unavailable in private chats.'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Use once', exact: true }).click();
    await chat.waitForStreamComplete();
    await mapWidget(page);
    activeRun = undefined;
  });

  test('preserves semantic map text when the provider or tile surface fails', async ({
    page,
  }) => {
    const failingProviderChat = await openMappingChat(
      page,
      'Test (mapping provider failure)',
    );
    await failingProviderChat.sendMessage(
      'Find a place while the provider is unavailable.',
    );
    await failingProviderChat.waitForStreamComplete();
    await expect(
      page.getByText(
        'The mapping provider was unavailable, so no map was shown. I did not infer a location.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.locator('[data-map-widget]')).toHaveCount(0);

    const tileFailureChat = await openMappingChat(
      page,
      'Test (mapping nearby)',
      '/',
      { fail: true },
    );
    await tileFailureChat.sendMessage('Find nearby cafes in Testville.');
    await tileFailureChat.waitForStreamComplete();
    const widget = await mapWidget(page);
    await expect(widget).toContainText('1. Deterministic Central Cafe');
    await expect(
      widget.locator('[data-map-status-kind="tile-error"]'),
    ).toContainText('Map tiles could not be loaded');
  });

  test('keeps map rendering responsive, keyboard reachable, themed, and text-equivalent on mobile', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    const originalTheme = await page.evaluate(() =>
      localStorage.getItem('appTheme'),
    );
    try {
      await page.evaluate(() => localStorage.setItem('appTheme', 'nord'));
      const chat = await openMappingChat(page, 'Test (mapping nearby)');
      await chat.sendMessage('Find nearby cafes in Testville.');
      await chat.waitForStreamComplete();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

      const widget = await mapWidget(page);
      const width = await widget
        .locator('[data-map-canvas]')
        .evaluate((element) => element.getBoundingClientRect().width);
      expect(width).toBeGreaterThan(0);
      expect(width).toBeLessThanOrEqual(375);
      const semanticName = await widget
        .locator('ol[aria-label="Mapped places"] li')
        .first()
        .innerText();
      const marker = widget.locator('.yaawc-map-numbered-marker').first();
      await expect(marker).toHaveAttribute(
        'aria-label',
        `1. ${semanticName.split(' — ')[0]}`,
      );
      await marker.focus();
      await expect(marker).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(widget.locator('.leaflet-popup')).toContainText(
        'Deterministic Central Cafe',
      );

      const link = widget.locator('[data-map-links] a').first();
      await link.focus();
      await expect(link).toBeFocused();
    } finally {
      await page.evaluate((theme) => {
        if (theme) localStorage.setItem('appTheme', theme);
        else localStorage.removeItem('appTheme');
      }, originalTheme);
    }
  });
});
