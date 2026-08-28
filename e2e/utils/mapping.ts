import type { APIRequestContext, Page } from '@playwright/test';
import { MAPPING_SETTING_KEYS } from '../../src/lib/maps/settingKeys';
import { baseURL, uid } from './helpers';
import { streamChatUntil, type ChatEvent } from './sse';

/** A network-free provider/tile configuration for integration coverage. */
export const TEST_MAPPING_SETTINGS = {
  mappingEnabled: 'true',
  mappingPublicServicesAcknowledged: 'false',
  mappingProvider: 'test',
  mappingGeocoderUrl: 'https://geocoder.test',
  mappingPlacesUrl: 'https://places.test',
  mappingRoutingUrl: 'https://routing.test',
  mappingRoutingProfile: 'driving',
  mappingWalkingProfile: 'foot',
  mappingCyclingProfile: 'bike',
  mappingTileUrl: 'https://tiles.test/{z}/{x}/{y}.png',
  mappingTileAttribution: 'Deterministic tile attribution',
  mappingSavedLocationEnabled: 'false',
} as const;

const TEST_TILE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

export type MappingSettingsSnapshot = Record<string, string | null>;

const MAPPING_INTEGRATION_SETTING_KEYS = [
  ...MAPPING_SETTING_KEYS,
  'chatModelProvider',
  'chatModel',
  'systemModelProvider',
  'systemModel',
] as const;

async function readSettingsSnapshot(
  request: APIRequestContext,
  keys: readonly string[],
): Promise<MappingSettingsSnapshot> {
  const response = await request.get('/api/settings');
  if (!response.ok()) {
    throw new Error(`GET /api/settings returned ${response.status()}`);
  }
  const values = (await response.json()) as Record<string, unknown>;
  return Object.fromEntries(
    keys.map((key) => [
      key,
      typeof values[key] === 'string' ? values[key] : null,
    ]),
  );
}

export async function readMappingSettings(
  request: APIRequestContext,
): Promise<MappingSettingsSnapshot> {
  return readSettingsSnapshot(request, MAPPING_SETTING_KEYS);
}

/** Includes composer model keys changed by the browser mapping flows. */
export async function readMappingIntegrationSettings(
  request: APIRequestContext,
): Promise<MappingSettingsSnapshot> {
  return readSettingsSnapshot(request, MAPPING_INTEGRATION_SETTING_KEYS);
}

export async function patchMappingSettings(
  request: APIRequestContext,
  values: Record<string, string | null>,
): Promise<void> {
  const response = await request.patch('/api/settings', { data: values });
  if (!response.ok()) {
    throw new Error(
      `PATCH /api/settings returned ${response.status()}: ${await response.text()}`,
    );
  }
}

export async function configureTestMapping(
  request: APIRequestContext,
  overrides: Record<string, string | null> = {},
): Promise<void> {
  await patchMappingSettings(request, {
    ...TEST_MAPPING_SETTINGS,
    ...overrides,
  });
}

export async function restoreMappingSettings(
  request: APIRequestContext,
  snapshot: MappingSettingsSnapshot,
): Promise<void> {
  await patchMappingSettings(request, snapshot);
}

export const restoreMappingIntegrationSettings = restoreMappingSettings;

/** Intercept the test tile host; no browser test reaches a real tile service. */
export async function routeTestMapTiles(
  page: Page,
  options: { fail?: boolean } = {},
): Promise<void> {
  await page.route('**://tiles.test/**', async (route) => {
    if (options.fail) {
      await route.abort();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: TEST_TILE_PNG,
    });
  });
}

export interface AwaitingMappingLocation {
  chatId: string;
  messageId: string;
  clientSessionId: string;
  approvalId: string;
  pendingEvent: ChatEvent;
  events: ChatEvent[];
}

/** Start the deterministic location flow and stop at its real approval. */
export async function seedAwaitingMappingLocation(overrides?: {
  chatId?: string;
  messageId?: string;
  clientSessionId?: string;
  isPrivate?: boolean;
}): Promise<AwaitingMappingLocation> {
  const chatId = overrides?.chatId ?? uid();
  const messageId = overrides?.messageId ?? uid();
  const clientSessionId = overrides?.clientSessionId ?? uid();
  const events = await streamChatUntil(
    baseURL(),
    {
      message: {
        messageId,
        chatId,
        content: 'Route from my current location to the north market.',
      },
      focusMode: 'webSearch',
      files: [],
      chatModel: { provider: 'test', name: 'test-map-location' },
      systemModel: { provider: 'test', name: 'test-map-location' },
      selectedSystemPromptIds: [],
      workspaceId: null,
      clientSessionId,
      ...(overrides?.isPrivate ? { isPrivate: true } : {}),
    },
    (received) => received.some((event) => event.type === 'location_pending'),
  );
  const pendingEvent = events.find(
    (event) => event.type === 'location_pending',
  );
  if (!pendingEvent) {
    throw new Error('location_pending event never arrived');
  }
  const data = pendingEvent.data as Record<string, unknown>;
  if (typeof data.approvalId !== 'string') {
    throw new Error('location approval did not include an approvalId');
  }
  return {
    chatId,
    messageId,
    clientSessionId,
    approvalId: data.approvalId,
    pendingEvent,
    events,
  };
}
