import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import {
  mappingLocationHosts,
  resolveMappingConfiguration,
} from '@/lib/maps/config';
import { mappingConfigurationFingerprint } from '@/lib/maps/runtime';
import {
  locationTokenStore,
  mintLocationToken,
} from '@/lib/maps/locationSessions';
import { createMappingService } from '@/lib/maps/service';
import { createTestMappingProvider } from '@/lib/maps/providers/test';
import { TurnMapRegistry } from '@/lib/maps/turnMapRegistry';
import {
  STREAM_EVENT_CHANNEL,
  type AgentEmitEvent,
} from '@/lib/streaming/events';
import { getRouteTool } from './getRouteTool';
import { searchPlacesTool } from './searchPlacesTool';
import { showMapTool } from './showMapTool';

type InvokableTool = {
  invoke(input: unknown, config: unknown): Promise<unknown>;
};

type Runtime = {
  context: Record<string, unknown>;
  toolCallId: string;
  state: Record<string, unknown>;
  config: Record<string, unknown>;
  store: null;
  writer: null;
};

const mappingConfig = resolveMappingConfiguration(
  { mappingEnabled: 'true', mappingProvider: 'test' },
  { testProviderEnabled: true },
);
const provider = createTestMappingProvider({ enabled: true });
if (!provider) throw new Error('deterministic mapping provider is required');
const mappingService = createMappingService(provider, { useCache: false });

function makeRuntime(
  retention: 'once' | 'save',
  options: {
    purpose?: 'nearby' | 'routing';
    coordinate?: { lat: number; lon: number };
  } = {},
): {
  runtime: Runtime;
  token: string;
  events: AgentEmitEvent[];
} {
  const emitter = new EventEmitter();
  const events: AgentEmitEvent[] = [];
  emitter.on(STREAM_EVENT_CHANNEL, (event: AgentEmitEvent) =>
    events.push(event),
  );
  const mapRegistry = new TurnMapRegistry({
    idFactory: (() => {
      let value = 0;
      return () => `private-map-${++value}`;
    })(),
  });
  const purpose = options.purpose ?? 'routing';
  const coordinate = options.coordinate ?? { lat: 40.1234, lon: -75.5678 };
  const tokenSession = mintLocationToken({
    coordinate,
    binding: {
      approvalId: 'approval-1',
      runId: 'thread-1',
      chatId: 'chat-1',
      messageId: 'message-1',
      aiMessageId: 'assistant-1',
      clientSessionId: 'page-1',
    },
    authorizedPurposes: [purpose],
    authorizedHosts: mappingLocationHosts(mappingConfig),
    configHash: mappingConfigurationFingerprint(mappingConfig),
    retention,
  });
  return {
    token: tokenSession.token,
    events,
    runtime: {
      context: {
        emitter,
        mapRegistry,
        mappingConfig,
        mappingService,
        locationToken: tokenSession.token,
        clientSessionId: 'page-1',
        assistantMessageId: 'assistant-1',
        threadId: 'thread-1',
        chatId: 'chat-1',
        messageId: 'message-1',
      },
      toolCallId: `mapping-${retention}`,
      state: {},
      config: {},
      store: null,
      writer: null,
    },
  };
}

async function invokeRoute(runtime: Runtime): Promise<unknown> {
  return (getRouteTool as unknown as InvokableTool).invoke(
    {
      type: 'tool_call',
      name: 'get_route',
      id: runtime.toolCallId,
      args: {
        origin: 'current location',
        destination: 'north',
        mode: 'driving',
      },
    },
    runtime,
  );
}

async function invokeNearby(runtime: Runtime): Promise<unknown> {
  return (searchPlacesTool as unknown as InvokableTool).invoke(
    {
      type: 'tool_call',
      name: 'search_places',
      id: runtime.toolCallId,
      args: {
        near: 'current location',
        category: 'cafe',
        radiusMeters: 500,
        limit: 12,
      },
    },
    runtime,
  );
}

async function invokeShowMap(
  runtime: Runtime,
  args: Record<string, unknown>,
): Promise<unknown> {
  return (showMapTool as unknown as InvokableTool).invoke(
    {
      type: 'tool_call',
      name: 'show_map',
      id: runtime.toolCallId,
      args,
    },
    runtime,
  );
}

function resultText(result: unknown): string {
  if (typeof result === 'string') return result;
  const directContent = (result as { content?: unknown }).content;
  if (typeof directContent === 'string') return directContent;
  const update = (
    result as { update?: { messages?: Array<{ content?: unknown }> } }
  ).update;
  const content = update?.messages?.[0]?.content;
  if (typeof content !== 'string') throw new Error('expected textual result');
  return content;
}

function resultJson(result: unknown): Record<string, unknown> {
  return JSON.parse(resultText(result)) as Record<string, unknown>;
}

afterEach(() => locationTokenStore.clear());

describe('current-location mapping privacy and explicit map composition', () => {
  it('keeps a transient route reusable in-memory, redacts its durable discovery, and emits the exact overlay only when shown', async () => {
    const { runtime, token, events } = makeRuntime('once');
    const result = await invokeRoute(runtime);
    const routeOutput = resultJson(result).route as Record<string, unknown>;
    const mapRegistry = runtime.context.mapRegistry as TurnMapRegistry;

    expect(routeOutput.routeHandle).toBe('route_1');
    expect(routeOutput).not.toHaveProperty('mapHandle');
    expect(resultText(result)).not.toContain(token);
    expect(resultText(result)).not.toContain('40.1234');
    expect(resultText(result)).not.toContain('-75.5678');
    expect(mapRegistry.resolveRoute('route_1')).toMatchObject({
      routeRetained: false,
      locationRetention: 'once',
      route: {
        origin: { lat: 40.1234, lon: -75.5678 },
      },
    });
    expect(events.map((event) => event.type)).toEqual([
      'map_places_discovered',
      'map_route_discovered',
    ]);
    expect(events[1]).toMatchObject({
      type: 'map_route_discovered',
      data: {
        handle: 'route_1',
        route: {
          routeNotRetained: true,
          destination: { lat: 40.004, lon: -75.002 },
        },
      },
    });
    expect(JSON.stringify(events[1])).not.toContain('40.1234');
    expect(JSON.stringify(events[1])).not.toContain('deterministic-route');

    const shown = await invokeShowMap(runtime, { routeHandle: 'route_1' });
    const registration = mapRegistry.resolveById('private-map-1');

    expect(resultJson(shown)).toEqual({
      title: 'Map',
      pinCount: 2,
      hasRoute: true,
    });
    expect(registration?.handle).toBeUndefined();
    expect(registration?.spec.route).toMatchObject({
      destination: { lat: 40.004, lon: -75.002 },
      routeNotRetained: true,
    });
    expect(JSON.stringify(registration?.spec)).not.toContain('40.1234');
    expect(JSON.stringify(registration?.spec)).not.toContain(
      'deterministic-route',
    );
    expect(events.map((event) => event.type)).toEqual([
      'map_places_discovered',
      'map_route_discovered',
      'map_spec',
      'map_placement',
      'map_session_overlay',
    ]);
    expect(events[2]).toMatchObject({
      type: 'map_spec',
      data: { mapId: 'private-map-1', spec: { routeNotRetained: true } },
    });
    expect(events[3]).toMatchObject({
      type: 'map_placement',
      data: {
        mapId: 'private-map-1',
        placementId: 'map_placement_1',
      },
    });
    expect(events[4]).toMatchObject({
      type: 'map_session_overlay',
      data: {
        mapId: 'private-map-1',
        clientSessionId: 'page-1',
        origin: { lat: 40.1234, lon: -75.5678 },
        route: { origin: { lat: 40.1234, lon: -75.5678 } },
      },
    });
  });

  it('attaches an approved transient route overlay independently to every composed map', async () => {
    const { runtime, events } = makeRuntime('once');
    await invokeRoute(runtime);
    events.length = 0;

    await invokeShowMap(runtime, {
      routeHandle: 'route_1',
      title: 'First view',
    });
    await invokeShowMap(runtime, {
      routeHandle: 'route_1',
      title: 'Second view',
    });

    expect(events.map((event) => event.type)).toEqual([
      'map_spec',
      'map_placement',
      'map_session_overlay',
      'map_spec',
      'map_placement',
      'map_session_overlay',
    ]);
    expect(
      events
        .filter((event) => event.type === 'map_session_overlay')
        .map((event) => event.data.mapId),
    ).toEqual(['private-map-1', 'private-map-2']);
    expect(
      events
        .filter((event) => event.type === 'map_session_overlay')
        .every((event) => JSON.stringify(event).includes('40.1234')),
    ).toBe(true);

    const mapRegistry = runtime.context.mapRegistry as TurnMapRegistry;
    expect(mapRegistry.registrationCount).toBe(2);
    expect(mapRegistry.placementCount).toBe(2);
  });

  it('retains a saved current-location route only after explicit composition and never emits a transient overlay', async () => {
    const { runtime, events } = makeRuntime('save');
    const result = await invokeRoute(runtime);
    const routeOutput = resultJson(result).route as Record<string, unknown>;

    expect(routeOutput.routeHandle).toBe('route_1');
    expect(resultText(result)).not.toContain('40.1234');
    expect(resultText(result)).not.toContain('mapHandle');
    expect(events.map((event) => event.type)).toEqual([
      'map_places_discovered',
      'map_route_discovered',
    ]);

    const shown = await invokeShowMap(runtime, {
      routeHandle: 'route_1',
      title: 'Saved route',
    });
    const mapRegistry = runtime.context.mapRegistry as TurnMapRegistry;
    const registration = mapRegistry.resolveById('private-map-1');

    expect(resultJson(shown)).toEqual({
      title: 'Saved route',
      pinCount: 2,
      hasRoute: true,
    });
    expect(registration?.spec).toMatchObject({
      title: 'Saved route',
      origin: { lat: 40.1234, lon: -75.5678 },
      route: {
        origin: { lat: 40.1234, lon: -75.5678 },
        navigationUrl: expect.stringContaining('directions'),
      },
    });
    expect(events.map((event) => event.type)).toEqual([
      'map_places_discovered',
      'map_route_discovered',
      'map_spec',
      'map_placement',
    ]);
    expect(events.some((event) => event.type === 'map_session_overlay')).toBe(
      false,
    );
  });

  it('retains an approved origin in a saved nearby map only after selecting its place handle', async () => {
    const { runtime, events } = makeRuntime('save', {
      purpose: 'nearby',
      coordinate: { lat: 40, lon: -75 },
    });
    const result = await invokeNearby(runtime);
    const places = resultJson(result).places as Array<Record<string, unknown>>;

    expect(places).toHaveLength(1);
    expect(places[0]?.placeHandle).toBe('place_1');
    expect(resultText(result)).not.toContain('40.000');
    expect(resultText(result)).not.toContain('-75.000');
    expect(events.map((event) => event.type)).toEqual([
      'map_places_discovered',
    ]);

    await invokeShowMap(runtime, { placeHandles: ['place_1'] });
    const mapRegistry = runtime.context.mapRegistry as TurnMapRegistry;
    const registration = mapRegistry.resolveById('private-map-1');

    expect(registration?.spec).toMatchObject({
      origin: { lat: 40, lon: -75 },
      places: [expect.objectContaining({ name: 'Deterministic Central Cafe' })],
    });
    expect(events.map((event) => event.type)).toEqual([
      'map_places_discovered',
      'map_spec',
      'map_placement',
    ]);
    expect(events.some((event) => event.type === 'map_session_overlay')).toBe(
      false,
    );
  });

  it('refuses a current-location route when the token lacks routing authorization', async () => {
    const { runtime } = makeRuntime('once');
    const replacement = mintLocationToken({
      coordinate: { lat: 40.1234, lon: -75.5678 },
      binding: {
        approvalId: 'approval-2',
        runId: 'thread-1',
        chatId: 'chat-1',
        messageId: 'message-1',
        aiMessageId: 'assistant-1',
        clientSessionId: 'page-1',
      },
      authorizedPurposes: ['nearby'],
      authorizedHosts: mappingLocationHosts(mappingConfig),
      configHash: mappingConfigurationFingerprint(mappingConfig),
      retention: 'once',
    });
    runtime.context.locationToken = replacement.token;

    const result = await invokeRoute(runtime);

    expect(resultText(result)).toContain('No approved current location');
    expect(
      (runtime.context.mapRegistry as TurnMapRegistry).registrationCount,
    ).toBe(0);
    expect((runtime.context.mapRegistry as TurnMapRegistry).routeCount).toBe(0);
  });
});
