import { test, expect } from '../fixtures';
import type { APIRequestContext, Page } from '../fixtures/api';
import { SettingsPage } from '../pages/SettingsPage';
import { MAPPING_SETTING_KEYS } from '../../src/lib/maps/settingKeys';
import { PUBLIC_MAP_DEFAULTS } from '../../src/lib/maps/config';

type Locator = ReturnType<Page['locator']>;

const selfHostedSettings = {
  mappingEnabled: 'false',
  mappingPublicServicesAcknowledged: 'false',
  mappingProvider: 'openstreetmap',
  mappingGeocoderUrl: 'http://localhost:18080/nominatim',
  mappingPlacesUrl: 'http://localhost:18081/overpass',
  mappingRoutingUrl: 'http://localhost:18082/osrm',
  mappingRoutingProfile: 'car',
  mappingWalkingProfile: 'foot',
  mappingCyclingProfile: 'bike',
  mappingTileUrl: 'http://localhost:18083/tiles/{z}/{x}/{y}.png',
  mappingTileAttribution: 'Local tile service',
  mappingSavedLocationEnabled: 'false',
};

async function patchSettings(
  request: APIRequestContext,
  values: Record<string, string | null>,
) {
  const response = await request.patch('/api/settings', { data: values });
  expect(response.status()).toBe(204);
}

async function readSettings(
  request: APIRequestContext,
): Promise<Record<string, string>> {
  const response = await request.get('/api/settings');
  expect(response.status()).toBe(200);
  return response.json();
}

async function resetMappingSettings(request: APIRequestContext) {
  await patchSettings(
    request,
    Object.fromEntries(MAPPING_SETTING_KEYS.map((key) => [key, null])),
  );
}

async function openMapping(page: Page) {
  const settings = new SettingsPage(page);
  await settings.goto();
  await settings.openSection('Mapping');
  const section = page.locator('#mapping');
  await expect(
    section.getByRole('heading', { name: 'Mapping', exact: true }),
  ).toBeVisible();
  return section;
}

function toggle(section: Locator, name: string): Locator {
  return section.locator(`button[role="switch"][aria-label="${name}"]`);
}

test.beforeEach(async ({ request }) => {
  await resetMappingSettings(request);
});

test.afterEach(async ({ request }) => {
  await resetMappingSettings(request);
});

test.describe('mapping settings', () => {
  test('is alphabetized and starts disabled with public defaults and accessible controls', async ({
    page,
    request,
  }) => {
    const settings = new SettingsPage(page);
    await settings.goto();

    const general = page.locator('nav.hidden.lg\\:block div.mb-2').first();
    await expect(general.locator('p').first()).toHaveText('General');
    await expect(general.getByRole('button')).toHaveText([
      'Appearance',
      'Automation',
      'Mapping',
      'MCP Servers',
      'Memory',
      'Persona Prompts',
      'Personalization',
      'Research Methodologies',
      'Retention',
      'Skills',
      'Voice',
    ]);

    await settings.openSection('Mapping');
    const dialog = page.locator('#mapping');
    await expect(dialog).toBeVisible();
    const geocoder = dialog.getByLabel('Geocoder URL', { exact: true });
    const places = dialog.getByLabel('Places URL', { exact: true });
    const routing = dialog.getByLabel('Routing URL', { exact: true });
    const driving = dialog.getByLabel('Driving profile', { exact: true });
    const walking = dialog.getByLabel('Walking profile (optional)', {
      exact: true,
    });
    const cycling = dialog.getByLabel('Cycling profile (optional)', {
      exact: true,
    });
    const tile = dialog.getByLabel('Tile URL template', { exact: true });
    const attribution = dialog.getByLabel('Tile attribution', { exact: true });

    await expect(geocoder).toHaveValue(PUBLIC_MAP_DEFAULTS.geocoderUrl);
    await expect(places).toHaveValue(PUBLIC_MAP_DEFAULTS.placesUrl);
    await expect(routing).toHaveValue(PUBLIC_MAP_DEFAULTS.routingUrl);
    await expect(driving).toHaveValue(PUBLIC_MAP_DEFAULTS.routingProfile);
    await expect(walking).toHaveValue('');
    await expect(cycling).toHaveValue('');
    await expect(tile).toHaveValue(PUBLIC_MAP_DEFAULTS.tileUrl);
    await expect(attribution).toHaveValue(PUBLIC_MAP_DEFAULTS.tileAttribution);

    for (const control of [
      geocoder,
      places,
      routing,
      driving,
      walking,
      cycling,
      tile,
      attribution,
    ]) {
      expect(await control.getAttribute('aria-label')).toBeNull();
      await expect(control).toBeVisible();
    }

    const enabled = toggle(dialog, 'Enable mapping');
    const acknowledged = toggle(dialog, 'Acknowledge public mapping services');
    const saved = toggle(dialog, 'Allow saved location for mapping');
    await expect(enabled).not.toHaveAttribute('data-checked');
    await expect(acknowledged).not.toHaveAttribute('data-checked');
    await expect(saved).toBeDisabled();
    await expect(
      dialog.getByText(
        'Mapping is disabled. No mapping provider or tile requests are made.',
        { exact: true },
      ),
    ).toBeVisible();

    const configResponse = await request.get('/api/maps/config');
    expect(configResponse.status()).toBe(200);
    const config = await configResponse.json();
    expect(config).toMatchObject({
      enabled: false,
      available: false,
      unavailableReason: 'disabled',
      usesPublicServices: true,
      publicServicesAcknowledged: false,
      tile: {
        url: PUBLIC_MAP_DEFAULTS.tileUrl,
        attribution: PUBLIC_MAP_DEFAULTS.tileAttribution,
      },
    });
  });

  test('requires public-host acknowledgement before enablement and persists both choices', async ({
    page,
    request,
  }) => {
    const dialog = await openMapping(page);
    const enabled = toggle(dialog, 'Enable mapping');
    const acknowledged = toggle(dialog, 'Acknowledge public mapping services');

    await enabled.click();
    const acknowledgement = page.getByRole('dialog').filter({
      hasText: 'The configured public OpenStreetMap-compatible services',
    });
    await expect(acknowledgement).toBeVisible();
    for (const host of [
      'nominatim.openstreetmap.org',
      'overpass-api.de',
      'router.project-osrm.org',
      'tile.openstreetmap.org',
    ]) {
      await expect(acknowledgement).toContainText(host);
    }
    await expect(enabled).not.toHaveAttribute('data-checked');
    await expect(acknowledged).not.toHaveAttribute('data-checked');

    await acknowledgement
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();
    await expect(acknowledgement).toBeHidden();
    await expect(enabled).not.toHaveAttribute('data-checked');

    await enabled.click();
    const secondAcknowledgement = page.getByRole('dialog').filter({
      hasText: 'The configured public OpenStreetMap-compatible services',
    });
    await secondAcknowledgement
      .getByRole('button', { name: 'Acknowledge and continue', exact: true })
      .click();

    await expect(enabled).toHaveAttribute('data-checked', '');
    await expect(acknowledged).toHaveAttribute('data-checked', '');
    await expect(
      dialog.getByText('Mapping is enabled for eligible Web Search turns.', {
        exact: true,
      }),
    ).toBeVisible();

    await expect
      .poll(async () => {
        const values = await readSettings(request);
        return [
          values.mappingEnabled,
          values.mappingPublicServicesAcknowledged,
        ];
      })
      .toEqual(['true', 'true']);

    const configResponse = await request.get('/api/maps/config');
    expect(configResponse.status()).toBe(200);
    const config = await configResponse.json();
    expect(config).toMatchObject({
      enabled: true,
      available: true,
      publicServicesAcknowledged: true,
      usesPublicServices: true,
    });
  });

  test('supports self-hosted endpoints without acknowledgement and validates edits inline', async ({
    page,
    request,
  }) => {
    await patchSettings(request, selfHostedSettings);
    const dialog = await openMapping(page);

    await expect(
      dialog.getByLabel('Geocoder URL', { exact: true }),
    ).toHaveValue(selfHostedSettings.mappingGeocoderUrl);
    const enabled = toggle(dialog, 'Enable mapping');
    const acknowledged = toggle(dialog, 'Acknowledge public mapping services');
    await expect(acknowledged).toBeDisabled();

    await enabled.click();
    await expect(
      page.getByRole('dialog').filter({
        hasText: 'The configured public OpenStreetMap-compatible services',
      }),
    ).toHaveCount(0);
    await expect(enabled).toHaveAttribute('data-checked', '');
    await expect(
      dialog.getByText('Mapping is enabled for eligible Web Search turns.', {
        exact: true,
      }),
    ).toBeVisible();
    await expect
      .poll(async () => (await readSettings(request)).mappingEnabled)
      .toBe('true');

    const geocoder = dialog.getByLabel('Geocoder URL', { exact: true });
    await geocoder.fill(' http://localhost:19090/nominatim/// ');
    await geocoder.blur();
    await expect(geocoder).toHaveValue('http://localhost:19090/nominatim');
    await expect
      .poll(async () => (await readSettings(request)).mappingGeocoderUrl)
      .toBe('http://localhost:19090/nominatim');

    const places = dialog.getByLabel('Places URL', { exact: true });
    await places.fill('http://localhost:19181/overpass///');
    await places.blur();
    await expect(places).toHaveValue('http://localhost:19181/overpass');
    await expect
      .poll(async () => (await readSettings(request)).mappingPlacesUrl)
      .toBe('http://localhost:19181/overpass');

    const routing = dialog.getByLabel('Routing URL', { exact: true });
    await routing.fill('http://localhost:19182/osrm///');
    await routing.blur();
    await expect(routing).toHaveValue('http://localhost:19182/osrm');
    await expect
      .poll(async () => (await readSettings(request)).mappingRoutingUrl)
      .toBe('http://localhost:19182/osrm');

    const driving = dialog.getByLabel('Driving profile', { exact: true });
    await driving.fill(' car-fast ');
    await driving.blur();
    await expect(driving).toHaveValue('car-fast');
    await expect
      .poll(async () => (await readSettings(request)).mappingRoutingProfile)
      .toBe('car-fast');

    const walking = dialog.getByLabel('Walking profile (optional)', {
      exact: true,
    });
    await walking.fill(' foot-hike ');
    await walking.blur();
    await expect(walking).toHaveValue('foot-hike');
    await expect
      .poll(async () => (await readSettings(request)).mappingWalkingProfile)
      .toBe('foot-hike');

    const cycling = dialog.getByLabel('Cycling profile (optional)', {
      exact: true,
    });
    await cycling.fill(' bike-fast ');
    await cycling.blur();
    await expect(cycling).toHaveValue('bike-fast');
    await expect
      .poll(async () => (await readSettings(request)).mappingCyclingProfile)
      .toBe('bike-fast');

    const attribution = dialog.getByLabel('Tile attribution', { exact: true });
    await attribution.fill(' Updated local attribution ');
    await attribution.blur();
    await expect(attribution).toHaveValue('Updated local attribution');
    await expect
      .poll(async () => (await readSettings(request)).mappingTileAttribution)
      .toBe('Updated local attribution');

    const tile = dialog.getByLabel('Tile URL template', { exact: true });
    await tile.fill('https://tiles.example/{z}/{x}.png');
    await tile.blur();
    const tileError =
      'mapping tile URL must contain {z}, {x}, and {y} placeholders';
    await expect(dialog.getByText(tileError, { exact: true })).toBeVisible();
    await expect(tile).toHaveAttribute('aria-invalid', 'true');
    const describedBy = await tile.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    await expect(page.locator(`[id="${describedBy}"]`)).toHaveText(tileError);

    await tile.fill(selfHostedSettings.mappingTileUrl);
    await tile.blur();
    await expect(tile).toHaveValue(selfHostedSettings.mappingTileUrl);
    await expect
      .poll(async () => (await readSettings(request)).mappingTileUrl)
      .toBe(selfHostedSettings.mappingTileUrl);
  });

  test('keeps saved-location consent separate and discloses its provider scope', async ({
    page,
    request,
  }) => {
    await patchSettings(request, {
      ...selfHostedSettings,
      mappingEnabled: 'true',
      mappingSavedLocationEnabled: 'false',
    });
    const before = await readSettings(request);
    const dialog = await openMapping(page);
    const saved = toggle(dialog, 'Allow saved location for mapping');

    await expect(saved).toBeEnabled();
    await expect(dialog).toContainText(
      'Hosts that may receive mapping requests: localhost:18080, localhost:18081, localhost:18082, localhost:18083',
    );
    await expect(dialog).toContainText('Private chats never send it');

    await saved.click();
    await expect(saved).toHaveAttribute('data-checked', '');
    await expect
      .poll(
        async () => (await readSettings(request)).mappingSavedLocationEnabled,
      )
      .toBe('true');

    const after = await readSettings(request);
    expect(after['personalization.sendLocationEnabled']).toBe(
      before['personalization.sendLocationEnabled'],
    );
  });

  test('reports cache clear success and failure, then refreshes client-safe config', async ({
    page,
  }) => {
    let deleteAttempts = 0;
    let configGets = 0;
    await page.route('**/api/maps/config', async (route) => {
      if (route.request().method() === 'GET') configGets++;
      await route.continue();
    });
    await page.route('**/api/maps/cache', async (route) => {
      if (route.request().method() !== 'DELETE') {
        await route.continue();
        return;
      }
      deleteAttempts++;
      await route.fulfill({
        status: deleteAttempts === 1 ? 200 : 503,
        contentType: 'application/json',
        body: JSON.stringify(
          deleteAttempts === 1
            ? { deleted: 3 }
            : { error: 'simulated cache failure' },
        ),
      });
    });

    const dialog = await openMapping(page);
    const clear = dialog.getByRole('button', { name: 'Clear map cache' });
    const configGetsBeforeClear = configGets;

    await clear.click();
    await expect(
      dialog.getByText('Cleared 3 cached map entries.', { exact: true }),
    ).toBeVisible();
    await expect.poll(() => configGets).toBeGreaterThan(configGetsBeforeClear);

    await clear.click();
    await expect(
      dialog
        .getByRole('alert')
        .filter({ hasText: 'Could not clear the map cache. Try again.' }),
    ).toHaveText('Could not clear the map cache. Try again.');
    expect(deleteAttempts).toBe(2);
  });
});
