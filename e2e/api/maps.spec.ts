import { test, expect } from '../fixtures/api';
import type { APIRequestContext } from '../fixtures/api';
import { uid } from '../utils/helpers';
import { collectSseEvents, eventsOfType, joinResponseText } from '../utils/sse';
import {
  configureTestMapping,
  patchMappingSettings,
  readMappingSettings,
  restoreMappingSettings,
  seedAwaitingMappingLocation,
  type MappingSettingsSnapshot,
} from '../utils/mapping';

async function postMappingChat(
  request: APIRequestContext,
  model: string,
  overrides: Partial<{
    chatId: string;
    messageId: string;
    content: string;
    isPrivate: boolean;
    clientSessionId: string;
    focusMode: string;
    panel: { executors: Array<{ provider: string; name: string }> };
  }> = {},
) {
  const chatId = overrides.chatId ?? uid();
  const messageId = overrides.messageId ?? uid();
  const response = await request.post('/api/chat', {
    data: {
      message: {
        messageId,
        chatId,
        content: overrides.content ?? 'Mapping integration fixture',
      },
      focusMode: overrides.focusMode ?? 'webSearch',
      files: [],
      chatModel: { provider: 'test', name: model },
      systemModel: { provider: 'test', name: model },
      selectedSystemPromptIds: [],
      workspaceId: null,
      clientSessionId: overrides.clientSessionId ?? uid(),
      ...(overrides.isPrivate ? { isPrivate: true } : {}),
      ...(overrides.panel ? { panel: overrides.panel } : {}),
    },
  });
  expect(response.ok()).toBe(true);
  return {
    chatId,
    messageId,
    events: await collectSseEvents(response),
  };
}

function assistantFrom(body: {
  messages: Array<{
    role: string;
    content: string;
    metadata?: string | Record<string, unknown>;
  }>;
}) {
  const message = body.messages.find((item) => item.role === 'assistant');
  expect(message).toBeTruthy();
  const metadata =
    typeof message!.metadata === 'string'
      ? JSON.parse(message!.metadata)
      : (message!.metadata ?? {});
  return { message: message!, metadata } as {
    message: (typeof body.messages)[number];
    metadata: Record<string, unknown>;
  };
}

let settingsBeforeTest: MappingSettingsSnapshot;

test.describe('mapping API boundaries and chat stream contract', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ request }) => {
    settingsBeforeTest = await readMappingSettings(request);
    await configureTestMapping(request);
  });

  test.afterEach(async ({ request }) => {
    await restoreMappingSettings(request, settingsBeforeTest);
  });

  test('returns disabled configuration without server endpoints', async ({
    request,
  }) => {
    await patchMappingSettings(request, {
      mappingEnabled: 'false',
      mappingProvider: 'test',
    });

    const response = await request.get('/api/maps/config');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      enabled: false,
      available: false,
      unavailableReason: 'disabled',
      provider: 'test',
      tile: {
        url: 'https://tiles.test/{z}/{x}/{y}.png',
        attribution: 'Deterministic tile attribution',
      },
    });
    expect(body).not.toHaveProperty('endpoints');
    expect(body).not.toHaveProperty('userAgent');
  });

  test('fails closed for malformed provider settings while preserving safe defaults', async ({
    request,
  }) => {
    await patchMappingSettings(request, {
      mappingProvider: 'not-a-provider',
      mappingEnabled: 'true',
    });

    const response = await request.get('/api/maps/config');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      enabled: true,
      available: false,
      provider: 'openstreetmap',
      unavailableReason: 'invalid_configuration',
      tile: {
        url: 'https://tiles.test/{z}/{x}/{y}.png',
      },
    });
    expect(body).not.toHaveProperty('endpoints');
  });

  test('clears the map cache through its bounded API contract', async ({
    request,
  }) => {
    const response = await request.delete('/api/maps/cache');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ deleted: expect.any(Number) });
    expect(body.deleted).toBeGreaterThanOrEqual(0);
  });

  test('validates the dedicated browser-location boundary and generic resume isolation', async ({
    request,
  }) => {
    const malformed = await request.post('/api/maps/location', { data: {} });
    expect(malformed.status()).toBe(400);
    expect(await malformed.json()).toEqual({
      error: 'Invalid browser location request',
    });

    const unknownApproval = await request.post('/api/maps/location', {
      data: {
        approvalId: uid(),
        clientSessionId: uid(),
        coordinates: { lat: 40, lon: -75 },
        retention: 'once',
      },
    });
    expect(unknownApproval.status()).toBe(404);
    expect(JSON.stringify(await unknownApproval.json())).not.toContain('40');

    const genericResume = await request.post('/api/chat/runs/resume', {
      data: {
        approvalId: uid(),
        response: { coordinates: { lat: 40, lon: -75 } },
      },
    });
    expect(genericResume.status()).toBe(400);
    expect((await genericResume.json()).error).toMatch(
      /dedicated mapping endpoint/i,
    );
  });

  test('keeps mapping disabled out of an ordinary chat when the operator turns it off', async ({
    request,
  }) => {
    await patchMappingSettings(request, { mappingEnabled: 'false' });

    const { events } = await postMappingChat(request, 'test-map-nearby', {
      content: 'Find nearby cafes in Testville without a map.',
    });
    expect(eventsOfType(events, 'map_spec')).toEqual([]);
    expect(eventsOfType(events, 'map_placement')).toEqual([]);
    expect(joinResponseText(events)).not.toContain(
      'Deterministic Central Cafe',
    );
  });

  test('keeps mapping tools out of Chat, Local Research, and Agent Panel paths', async ({
    request,
  }) => {
    for (const focusMode of ['chat', 'localResearch']) {
      const { events } = await postMappingChat(request, 'test-map-nearby', {
        focusMode,
      });
      expect(eventsOfType(events, 'map_spec')).toEqual([]);
      expect(eventsOfType(events, 'map_placement')).toEqual([]);
    }

    const { events } = await postMappingChat(request, 'test-map-nearby', {
      panel: {
        executors: [
          { provider: 'test', name: 'test-direct' },
          { provider: 'test', name: 'test-direct' },
        ],
      },
    });
    expect(eventsOfType(events, 'map_spec')).toEqual([]);
    expect(eventsOfType(events, 'map_placement')).toEqual([]);
  });

  test('emits one grounded map and replays the same persisted map milestones', async ({
    request,
  }) => {
    const {
      chatId,
      messageId,
      events: liveEvents,
    } = await postMappingChat(request, 'test-map-nearby', {
      content: 'Find nearby cafes in Testville.',
    });

    const mapSpecs = eventsOfType(liveEvents, 'map_spec');
    const placements = eventsOfType(liveEvents, 'map_placement');
    expect(mapSpecs).toHaveLength(1);
    expect(placements).toHaveLength(1);
    expect((mapSpecs[0].data as Record<string, unknown>).mapId).toEqual(
      (placements[0].data as Record<string, unknown>).mapId,
    );
    expect((mapSpecs[0].data as Record<string, unknown>).spec).toMatchObject({
      title: 'Places near Deterministic Central Cafe',
      places: [expect.objectContaining({ name: 'Deterministic Central Cafe' })],
    });
    expect(joinResponseText(liveEvents)).toContain(
      'Deterministic Central Cafe',
    );

    const chatBody = await (await request.get(`/api/chats/${chatId}`)).json();
    const { message, metadata } = assistantFrom(chatBody);
    expect(message.content).toContain('```yaawc:map');
    expect(metadata.mapSpecs).toBeTruthy();
    expect(JSON.stringify(metadata.mapSpecs)).toContain(
      'Deterministic Central Cafe',
    );

    const replay = await request.get(
      `/api/chat/runs/${messageId}/stream?from=0`,
    );
    expect(replay.status()).toBe(200);
    const replayEvents = await collectSseEvents(replay);
    expect(eventsOfType(replayEvents, 'map_spec')).toEqual(mapSpecs);
    expect(eventsOfType(replayEvents, 'map_placement')).toEqual(placements);
    expect(eventsOfType(replayEvents, 'map_session_overlay')).toEqual([]);
    expect(joinResponseText(replayEvents)).toBe(joinResponseText(liveEvents));
  });

  test('runs the location approval resume through the opaque dedicated route and redacts a transient route', async ({
    request,
  }) => {
    const flow = await seedAwaitingMappingLocation({
      clientSessionId: `api-${uid()}`,
    });
    const pending = flow.pendingEvent.data as Record<string, unknown>;
    expect(pending).not.toHaveProperty('coordinates');
    expect(pending).not.toHaveProperty('locationToken');
    expect(pending.authorizedHosts).toEqual(['tiles.test']);

    const locationResponse = await request.post('/api/maps/location', {
      data: {
        approvalId: flow.approvalId,
        clientSessionId: flow.clientSessionId,
        coordinates: { lat: 40, lon: -75 },
        retention: 'once',
      },
    });
    expect(locationResponse.status()).toBe(200);
    expect(await locationResponse.json()).toEqual({ ok: true });
    expect(JSON.stringify(flow.pendingEvent)).not.toContain('40,-75');

    const replay = await request.get(
      `/api/chat/runs/${flow.messageId}/stream?from=0&chatId=${flow.chatId}`,
    );
    expect(replay.status()).toBe(200);
    const replayEvents = await collectSseEvents(replay);
    expect(eventsOfType(replayEvents, 'location_answered')).toHaveLength(1);
    expect(eventsOfType(replayEvents, 'map_spec')).toHaveLength(1);
    expect(eventsOfType(replayEvents, 'map_placement')).toHaveLength(1);
    expect(eventsOfType(replayEvents, 'map_session_overlay')).toEqual([]);

    const mapSpec = (
      eventsOfType(replayEvents, 'map_spec')[0].data as {
        spec: Record<string, unknown>;
      }
    ).spec;
    expect(mapSpec.route).toMatchObject({
      destination: { lat: 40.004, lon: -75.002 },
      routeNotRetained: true,
    });
    expect(mapSpec.route).not.toHaveProperty('origin');
    expect(mapSpec.route).not.toHaveProperty('geometry');
    expect(JSON.stringify(replayEvents)).not.toContain('40,-75');

    const chatBody = await (
      await request.get(`/api/chats/${flow.chatId}`)
    ).json();
    const { message, metadata } = assistantFrom(chatBody);
    expect(message.content).toContain('Route not retained');
    expect(JSON.stringify(metadata.mapSpecs)).not.toContain('40,-75');

    const pendingAfter = await request.get(
      `/api/approvals/pending?chatId=${flow.chatId}`,
    );
    expect((await pendingAfter.json()).pending).toEqual([]);
  });

  test('persists an approved saved route in the map snapshot but never as a session overlay', async ({
    request,
  }) => {
    const flow = await seedAwaitingMappingLocation({
      clientSessionId: `api-save-${uid()}`,
    });

    const locationResponse = await request.post('/api/maps/location', {
      data: {
        approvalId: flow.approvalId,
        clientSessionId: flow.clientSessionId,
        coordinates: { lat: 40, lon: -75 },
        retention: 'save',
      },
    });
    expect(locationResponse.status()).toBe(200);
    expect(await locationResponse.json()).toEqual({ ok: true });

    const replay = await request.get(
      `/api/chat/runs/${flow.messageId}/stream?from=0&chatId=${flow.chatId}`,
    );
    expect(replay.status()).toBe(200);
    const replayEvents = await collectSseEvents(replay);
    const mapSpecs = eventsOfType(replayEvents, 'map_spec');

    expect(eventsOfType(replayEvents, 'map_session_overlay')).toEqual([]);
    expect(mapSpecs).toHaveLength(1);
    expect(
      (mapSpecs[0].data as { spec: { route: Record<string, unknown> } }).spec
        .route,
    ).toMatchObject({
      origin: { lat: 40, lon: -75 },
      destination: { lat: 40.004, lon: -75.002 },
    });
    expect(
      (mapSpecs[0].data as { spec: { route: Record<string, unknown> } }).spec
        .route,
    ).toHaveProperty('geometry');
    expect(JSON.stringify(replayEvents)).not.toContain('locationToken');
  });

  test('keeps provider failures independent from the answer path', async ({
    request,
  }) => {
    const { events } = await postMappingChat(
      request,
      'test-map-provider-failure',
      { content: 'Find a place while the provider is unavailable.' },
    );
    expect(eventsOfType(events, 'map_spec')).toEqual([]);
    expect(eventsOfType(events, 'map_placement')).toEqual([]);
    expect(joinResponseText(events)).toBe(
      'The mapping provider was unavailable, so no map was shown. I did not infer a location.',
    );
  });
});
