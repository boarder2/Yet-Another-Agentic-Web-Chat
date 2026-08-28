import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createMappingService } from '@/lib/maps/service';
import { TurnMapRegistry } from '@/lib/maps/turnMapRegistry';
import {
  TEST_MAPPING_PLACES,
  createTestMappingProvider,
} from '@/lib/maps/providers/test';
import {
  STREAM_EVENT_CHANNEL,
  type AgentEmitEvent,
} from '@/lib/streaming/events';
import {
  getPlaceDetailsTool,
  GetPlaceDetailsToolSchema,
} from './getPlaceDetailsTool';
import { getRouteTool } from './getRouteTool';
import { searchPlacesTool, SearchPlacesToolSchema } from './searchPlacesTool';
import { showMapTool, ShowMapToolSchema } from './showMapTool';

type InvokableTool = {
  invoke(input: unknown, config: unknown): Promise<unknown>;
};

type ToolUpdate = {
  relevantDocuments?: Array<{
    pageContent?: string;
    metadata?: Record<string, unknown>;
  }>;
  messages?: Array<{ content?: unknown }>;
};

const makeRegistry = () =>
  new TurnMapRegistry({
    idFactory: (() => {
      let value = 0;
      return () => `private-map-${++value}`;
    })(),
  });

const makeService = () => {
  const provider = createTestMappingProvider({ enabled: true });
  if (!provider) throw new Error('deterministic mapping provider is required');
  return createMappingService(provider, { useCache: false });
};

type MappingService = ReturnType<typeof makeService>;

const makeRuntime = (
  toolCallId: string,
  mapRegistry: TurnMapRegistry,
  options: {
    service?: MappingService | null;
    resolver?: () => MappingService | null;
    retrievalSignal?: AbortSignal;
  } = {},
) => ({
  context: {
    emitter: new EventEmitter(),
    mapRegistry,
    mappingService: options.service,
    mappingServiceResolver: options.resolver,
    retrievalSignal: options.retrievalSignal,
  },
  state: {},
  toolCallId,
  config: {},
  store: null,
  writer: null,
});

const invoke = async (
  tool: unknown,
  args: unknown,
  runtime: ReturnType<typeof makeRuntime>,
): Promise<unknown> =>
  (tool as InvokableTool).invoke(
    {
      type: 'tool_call',
      name: (tool as { name: string }).name,
      id: runtime.toolCallId,
      args,
    },
    runtime,
  );

const resultUpdate = (value: unknown): ToolUpdate => {
  if (!value || typeof value !== 'object') return {};
  const update = (value as { update?: unknown }).update;
  return update && typeof update === 'object' ? (update as ToolUpdate) : {};
};

const resultText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  const directContent = (value as { content?: unknown }).content;
  if (typeof directContent === 'string') return directContent;
  const update = resultUpdate(value);
  const content = update.messages?.[0]?.content;
  if (typeof content === 'string') return content;
  throw new Error('expected a textual tool result');
};

const resultJson = (value: unknown): Record<string, unknown> =>
  JSON.parse(resultText(value)) as Record<string, unknown>;

const eventsFor = (emitter: EventEmitter): AgentEmitEvent[] => {
  const events: AgentEmitEvent[] = [];
  emitter.on(STREAM_EVENT_CHANNEL, (event: AgentEmitEvent) =>
    events.push(event),
  );
  return events;
};

const eventTypes = (events: readonly AgentEmitEvent[]) =>
  events.map((event) => event.type);

describe('named-location mapping tools', () => {
  it('searches validated places into turn-local handles without constructing a map', async () => {
    const mapRegistry = makeRegistry();
    const service = makeService();
    const runtime = makeRuntime('search-1', mapRegistry, { service });
    const events = eventsFor(runtime.context.emitter);

    const result = await invoke(
      searchPlacesTool,
      { query: 'central' },
      runtime,
    );
    const output = resultJson(result);
    const places = output.places as Array<Record<string, unknown>>;

    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({
      placeHandle: 'place_1',
      name: 'Deterministic Central Cafe',
      sourceUrl: 'https://www.openstreetmap.org/node/910001',
      provider: 'test',
      address: '1 Test Way, Testville',
      category: 'cafe',
      openingHours: 'Mo-Su 08:00-18:00',
    });
    expect(places[0]).not.toHaveProperty('id');
    expect(places[0]).not.toHaveProperty('coordinate');
    expect(output).not.toHaveProperty('mapHandle');
    expect(output).not.toHaveProperty('mapNote');

    expect(mapRegistry.placeCount).toBe(1);
    expect(mapRegistry.registrationCount).toBe(0);
    expect(eventTypes(events)).toEqual(['map_places_discovered']);
    expect(events[0]).toMatchObject({
      type: 'map_places_discovered',
      data: {
        places: [
          {
            handle: 'place_1',
            place: TEST_MAPPING_PLACES[0],
            retrievedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    });

    const update = resultUpdate(result);
    expect(update.relevantDocuments).toHaveLength(1);
    expect(update.relevantDocuments?.[0]).toMatchObject({
      pageContent: expect.stringContaining('Deterministic Central Cafe'),
      metadata: {
        processingType: 'mapping-place',
        placeHandle: 'place_1',
        url: 'https://www.openstreetmap.org/node/910001',
        provider: 'test',
        searchQuery: 'central',
      },
    });
  });

  it('uses a named locality for nearby discovery and omits facts the provider did not supply', async () => {
    const mapRegistry = makeRegistry();
    const service = makeService();
    const runtime = makeRuntime('nearby-1', mapRegistry, { service });
    const events = eventsFor(runtime.context.emitter);

    const result = await invoke(
      searchPlacesTool,
      {
        near: 'Testville',
        category: 'coffee_shop',
        radiusMeters: 100,
        limit: 12,
      },
      runtime,
    );
    const output = resultJson(result);
    const places = output.places as Array<Record<string, unknown>>;

    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({
      placeHandle: 'place_1',
      name: 'Deterministic Central Cafe',
      category: 'cafe',
    });
    expect(places[0]).not.toHaveProperty('rating');
    expect(places[0]).not.toHaveProperty('reviewCount');
    expect(output).not.toHaveProperty('mapHandle');
    expect(output).not.toHaveProperty('mapNote');
    expect(mapRegistry.registrationCount).toBe(0);
    expect(eventTypes(events)).toEqual(['map_places_discovered']);
    expect(resultUpdate(result).relevantDocuments?.[0]?.metadata).toMatchObject(
      {
        searchQuery: 'cafe near Testville',
      },
    );
  });

  it('keeps concurrent discoveries independent and assigns handles to the provider result that completed', async () => {
    const mapRegistry = makeRegistry();
    const baseService = makeService();
    const delayedService = {
      searchPlaces: async (
        request: Parameters<MappingService['searchPlaces']>[0],
        signal?: AbortSignal,
      ) => {
        if (request.query === 'central') {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return baseService.searchPlaces(request, signal);
      },
      getPlaceDetails: baseService.getPlaceDetails.bind(baseService),
      getRoute: baseService.getRoute.bind(baseService),
    } as unknown as MappingService;
    const centralRuntime = makeRuntime('search-central', mapRegistry, {
      service: delayedService,
    });
    const northRuntime = makeRuntime('search-north', mapRegistry, {
      service: delayedService,
    });
    const centralEvents = eventsFor(centralRuntime.context.emitter);
    const northEvents = eventsFor(northRuntime.context.emitter);

    const [centralResult, northResult] = await Promise.all([
      invoke(searchPlacesTool, { query: 'central' }, centralRuntime),
      invoke(searchPlacesTool, { query: 'north' }, northRuntime),
    ]);
    const central = resultJson(centralResult).places as Array<
      Record<string, unknown>
    >;
    const north = resultJson(northResult).places as Array<
      Record<string, unknown>
    >;

    expect(central[0]?.placeHandle).toBe('place_2');
    expect(north[0]?.placeHandle).toBe('place_1');
    expect(mapRegistry.placeCount).toBe(2);
    expect(mapRegistry.registrationCount).toBe(0);
    expect(eventTypes(centralEvents)).toEqual(['map_places_discovered']);
    expect(eventTypes(northEvents)).toEqual(['map_places_discovered']);

    const shown = await invoke(
      showMapTool,
      {
        placeHandles: [central[0]?.placeHandle, north[0]?.placeHandle],
      },
      centralRuntime,
    );
    expect(resultJson(shown)).toMatchObject({
      pinCount: 2,
      hasRoute: false,
    });
  });

  it('omits a map and factual claims when the provider has no validated place', async () => {
    const mapRegistry = makeRegistry();
    const service = makeService();
    const runtime = makeRuntime('search-empty', mapRegistry, { service });
    const events = eventsFor(runtime.context.emitter);

    const result = await invoke(
      searchPlacesTool,
      { query: 'unlisted place' },
      runtime,
    );
    const output = resultJson(result);

    expect(output.places).toEqual([]);
    expect(output.note).toContain('No validated places found');
    expect(output).not.toHaveProperty('mapHandle');
    expect(mapRegistry.registrationCount).toBe(0);
    expect(mapRegistry.placeCount).toBe(0);
    expect(events).toEqual([]);
    expect(resultUpdate(result).relevantDocuments).toEqual([]);
  });

  it('retrieves identity-bound details through a place handle and adds a distinct cited document', async () => {
    const mapRegistry = makeRegistry();
    const service = makeService();
    const runtime = makeRuntime('details-1', mapRegistry, { service });

    await invoke(searchPlacesTool, { query: 'central' }, runtime);
    const result = await invoke(
      getPlaceDetailsTool,
      { placeHandle: 'place_1' },
      runtime,
    );
    const output = resultJson(result);

    expect(output.place).toMatchObject({
      placeHandle: 'place_1',
      name: 'Deterministic Central Cafe',
      openingHours: 'Mo-Su 08:00-18:00',
    });
    expect(output.place).not.toHaveProperty('id');
    expect(output.place).not.toHaveProperty('coordinate');
    expect(resultUpdate(result).relevantDocuments?.[0]).toMatchObject({
      metadata: {
        processingType: 'mapping-place-details',
        placeHandle: 'place_1',
      },
    });
  });

  it('rejects provider IDs and unknown handles instead of allowing model redirection', async () => {
    const mapRegistry = makeRegistry();
    const service = makeService();
    const runtime = makeRuntime('details-2', mapRegistry, { service });

    await expect(
      invoke(getPlaceDetailsTool, { placeHandle: 'node/910001' }, runtime),
    ).rejects.toThrow();

    const result = await invoke(
      getPlaceDetailsTool,
      { placeHandle: 'place_99' },
      runtime,
    );
    expect(resultText(result)).toContain('No registered place matches');
    expect(resultUpdate(result).relevantDocuments).toEqual([]);
  });

  it('fails closed when the provider returns a different identity for a details lookup', async () => {
    const baseProvider = createTestMappingProvider({ enabled: true });
    if (!baseProvider)
      throw new Error('deterministic mapping provider is required');
    const mismatchedProvider = {
      id: baseProvider.id,
      displayName: baseProvider.displayName,
      attribution: baseProvider.attribution,
      capabilities: baseProvider.capabilities,
      searchPlaces: baseProvider.searchPlaces.bind(baseProvider),
      getPlaceDetails: vi.fn(async () => ({
        place: { ...TEST_MAPPING_PLACES[1] },
        provider: baseProvider.id,
        attribution: baseProvider.attribution,
        retrievedAt: '2026-01-01T00:00:00.000Z',
      })),
      getRoute: baseProvider.getRoute.bind(baseProvider),
    };
    const service = createMappingService(mismatchedProvider, {
      useCache: false,
    });
    const mapRegistry = makeRegistry();
    const runtime = makeRuntime('details-3', mapRegistry, { service });

    await invoke(searchPlacesTool, { query: 'central' }, runtime);
    const result = await invoke(
      getPlaceDetailsTool,
      { placeHandle: 'place_1' },
      runtime,
    );

    expect(resultText(result)).toContain('different place identity');
    expect(resultUpdate(result).relevantDocuments).toEqual([]);
  });

  it('builds a named route with place and route handles but no map handle or map capacity note', async () => {
    const mapRegistry = makeRegistry();
    const service = makeService();
    const runtime = makeRuntime('route-1', mapRegistry, { service });
    const events = eventsFor(runtime.context.emitter);

    const result = await invoke(
      getRouteTool,
      { origin: 'central', destination: 'north', mode: 'driving' },
      runtime,
    );
    const output = resultJson(result);
    const route = output.route as Record<string, unknown>;

    expect(route).toMatchObject({
      origin: 'Deterministic Central Cafe',
      destination: 'Deterministic North Market',
      mode: 'driving',
      routeHandle: 'route_1',
      sourceUrl: expect.stringContaining('deterministic-route'),
      navigationUrl: expect.stringContaining('https://example.test/directions'),
      provider: 'test',
      attribution: 'Deterministic mapping test data',
    });
    expect(route).not.toHaveProperty('mapHandle');
    expect(output).not.toHaveProperty('mapNote');
    expect(route.distanceMeters).toEqual(expect.any(Number));
    expect(route.durationSeconds).toEqual(expect.any(Number));
    expect(output.origin).toMatchObject({ placeHandle: 'place_1' });
    expect(output.destination).toMatchObject({ placeHandle: 'place_2' });
    expect(mapRegistry.registrationCount).toBe(0);
    expect(mapRegistry.placeCount).toBe(2);
    expect(mapRegistry.routeCount).toBe(1);
    expect(mapRegistry.resolveRoute('route_1')).toMatchObject({
      placeHandles: ['place_1', 'place_2'],
      originPlaceHandle: 'place_1',
      destinationPlaceHandle: 'place_2',
      route: { mode: 'driving' },
    });
    expect(eventTypes(events)).toEqual([
      'map_places_discovered',
      'map_route_discovered',
    ]);
    expect(events[1]).toMatchObject({
      type: 'map_route_discovered',
      data: {
        handle: 'route_1',
        placeHandles: ['place_1', 'place_2'],
        originPlaceHandle: 'place_1',
        destinationPlaceHandle: 'place_2',
        retrievedAt: '2026-01-01T00:00:00.000Z',
      },
    });
    expect(resultUpdate(result).relevantDocuments?.[0]).toMatchObject({
      pageContent: expect.stringContaining('Driving route'),
      metadata: { processingType: 'mapping-route', provider: 'test' },
    });
  });

  it('omits routes for modes that are not enabled in the provider configuration', async () => {
    const mapRegistry = makeRegistry();
    const service = makeService();
    const runtime = makeRuntime('route-unsupported', mapRegistry, { service });

    const result = await invoke(
      getRouteTool,
      { origin: 'central', destination: 'north', mode: 'walking' },
      runtime,
    );

    expect(resultText(result)).toContain('does not support walking routes');
    expect(mapRegistry.registrationCount).toBe(0);
    expect(mapRegistry.placeCount).toBe(0);
    expect(mapRegistry.routeCount).toBe(0);
    expect(resultUpdate(result).relevantDocuments).toEqual([]);
  });

  it('composes an explicitly selected grouping, emits one canonical spec and placement, and allows repeated maps', async () => {
    const mapRegistry = makeRegistry();
    const service = makeService();
    const runtime = makeRuntime('show-1', mapRegistry, { service });
    const events = eventsFor(runtime.context.emitter);

    await invoke(searchPlacesTool, { query: 'central' }, runtime);
    await invoke(searchPlacesTool, { query: 'north' }, runtime);
    events.length = 0;

    const shown = await invoke(
      showMapTool,
      {
        placeHandles: ['place_2', 'place_1', 'place_2'],
        title: 'Selected places',
      },
      runtime,
    );
    expect(resultJson(shown)).toEqual({
      title: 'Selected places',
      pinCount: 2,
      hasRoute: false,
    });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: 'map_spec',
      data: {
        mapId: 'private-map-1',
        source: 'show_map',
        spec: {
          title: 'Selected places',
          places: [TEST_MAPPING_PLACES[1], TEST_MAPPING_PLACES[0]],
        },
      },
    });
    expect(events[0]).not.toHaveProperty('handle');
    expect(events[1]).toEqual({
      type: 'map_placement',
      data: {
        placementId: 'map_placement_1',
        mapId: 'private-map-1',
        placementNumber: 1,
      },
    });
    expect(events[1]).not.toHaveProperty('handle');

    const repeated = await invoke(
      showMapTool,
      { placeHandles: ['place_1', 'place_2'], title: 'Same grouping again' },
      runtime,
    );
    expect(resultJson(repeated)).toEqual({
      title: 'Same grouping again',
      pinCount: 2,
      hasRoute: false,
    });
    expect(mapRegistry.registrationCount).toBe(2);
    expect(mapRegistry.placementCount).toBe(2);
    expect(eventTypes(events)).toEqual([
      'map_spec',
      'map_placement',
      'map_spec',
      'map_placement',
    ]);
    expect(events[2]).toMatchObject({
      type: 'map_spec',
      data: { mapId: 'private-map-2' },
    });
    expect(events[3]).toMatchObject({
      type: 'map_placement',
      data: {
        mapId: 'private-map-2',
        placementId: 'map_placement_2',
        placementNumber: 2,
      },
    });
    expect(JSON.stringify(resultJson(shown))).not.toContain('mapId');
    expect(JSON.stringify(resultJson(shown))).not.toContain('placementId');
    expect(JSON.stringify(resultJson(shown))).not.toContain('mapHandle');
  });

  it('composes a route with a separately discovered place and includes endpoint pins in route order', async () => {
    const mapRegistry = makeRegistry();
    const service = makeService();
    const runtime = makeRuntime('route-map', mapRegistry, { service });
    const events = eventsFor(runtime.context.emitter);

    const routeResult = await invoke(
      getRouteTool,
      { origin: 'central', destination: 'north', mode: 'driving' },
      runtime,
    );
    await invoke(searchPlacesTool, { query: 'south' }, runtime);
    events.length = 0;

    const shown = await invoke(
      showMapTool,
      {
        placeHandles: ['place_3'],
        routeHandle: 'route_1',
        title: 'Route and museum',
      },
      runtime,
    );
    expect(resultJson(shown)).toEqual({
      title: 'Route and museum',
      pinCount: 3,
      hasRoute: true,
    });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: 'map_spec',
      data: {
        mapId: 'private-map-1',
        spec: {
          title: 'Route and museum',
          places: [
            TEST_MAPPING_PLACES[2],
            TEST_MAPPING_PLACES[0],
            TEST_MAPPING_PLACES[1],
          ],
          route: { mode: 'driving' },
        },
      },
    });
    expect(events[1]).toMatchObject({
      type: 'map_placement',
      data: {
        placementId: 'map_placement_1',
        mapId: 'private-map-1',
        placementNumber: 1,
      },
    });
    expect(resultText(routeResult)).not.toContain('mapHandle');
  });

  it('rejects an invalid selection atomically and leaves valid handles available', async () => {
    const mapRegistry = makeRegistry();
    const service = makeService();
    const runtime = makeRuntime('show-invalid', mapRegistry, { service });
    const events = eventsFor(runtime.context.emitter);

    await invoke(searchPlacesTool, { query: 'central' }, runtime);
    events.length = 0;

    const invalid = await invoke(
      showMapTool,
      { placeHandles: ['place_1', 'place_999'] },
      runtime,
    );
    expect(resultText(invalid)).toContain('Unknown place handle "place_999"');
    expect(mapRegistry.registrationCount).toBe(0);
    expect(mapRegistry.placementCount).toBe(0);
    expect(events).toEqual([]);

    const valid = await invoke(
      showMapTool,
      { placeHandles: ['place_1'] },
      runtime,
    );
    expect(resultJson(valid)).toMatchObject({ pinCount: 1, hasRoute: false });
    expect(mapRegistry.resolveById('private-map-1')).toBeDefined();
    expect(mapRegistry.placementCount).toBe(1);
    expect(events).toHaveLength(2);
  });

  it('describes discovery handles and explicit repeatable map composition without legacy map handles', () => {
    expect(searchPlacesTool.description).toContain(
      'discovery does not place a map',
    );
    expect(searchPlacesTool.description).toContain(
      'select the desired grouping later with show_map',
    );
    expect(searchPlacesTool.description).not.toContain('mapHandle');

    expect(getRouteTool.description).toContain(
      'routeHandle valid only in this turn',
    );
    expect(getRouteTool.description).toContain(
      'discovery does not place a map',
    );
    expect(getRouteTool.description).not.toContain('mapHandle');

    expect(showMapTool.description).toContain(
      'selected placeHandles and an optional routeHandle',
    );
    expect(showMapTool.description).toContain(
      'may be repeated for different groupings',
    );
    expect(showMapTool.description).toContain('no per-answer map-count limit');
    expect(showMapTool.description).toContain(
      'at most 12 unique pins including route endpoints',
    );
    expect(showMapTool.description).toContain(
      'Invalid handle selections fail atomically',
    );
    expect(showMapTool.description).not.toContain('mapHandle');
  });

  it('accepts only place and route handles in the show_map contract', async () => {
    expect(ShowMapToolSchema.safeParse({ handle: 'map_1' }).success).toBe(
      false,
    );
    expect(ShowMapToolSchema.safeParse({ mapHandle: 'map_1' }).success).toBe(
      false,
    );
    expect(ShowMapToolSchema.safeParse({}).success).toBe(false);
    expect(
      ShowMapToolSchema.safeParse({ routeHandle: 'route_1' }).success,
    ).toBe(true);
    expect(
      ShowMapToolSchema.safeParse({ placeHandles: ['place_1'] }).success,
    ).toBe(true);

    const runtime = makeRuntime('schema-1', makeRegistry(), {
      service: makeService(),
    });
    await expect(
      invoke(showMapTool, { handle: 'map_1' }, runtime),
    ).rejects.toThrow();
    await expect(
      invoke(showMapTool, { placeHandles: [] }, runtime),
    ).rejects.toThrow();
  });

  it('does not contact a provider when mapping is unavailable or cancelled', async () => {
    const mapRegistry = makeRegistry();
    const service = makeService();
    const unavailable = makeRuntime('unavailable-1', mapRegistry, {
      service: null,
    });
    const resolver = vi.fn(() => null);
    const stale = makeRuntime('stale-1', makeRegistry(), {
      service,
      resolver,
    });

    expect(
      resultText(
        await invoke(searchPlacesTool, { query: 'central' }, unavailable),
      ),
    ).toContain('Mapping is unavailable');
    expect(resolver).not.toHaveBeenCalled();

    const cancelled = new AbortController();
    cancelled.abort();
    const cancelledResult = await invoke(
      searchPlacesTool,
      { query: 'central' },
      makeRuntime('cancelled-1', makeRegistry(), {
        service,
        retrievalSignal: cancelled.signal,
      }),
    );
    expect(resultText(cancelledResult)).toContain('cancelled');

    const first = await invoke(
      getRouteTool,
      { origin: 'central', destination: 'north', mode: 'driving' },
      stale,
    );
    expect(resultText(first)).toContain('Mapping is unavailable');
    expect(resolver).toHaveBeenCalled();
  });

  it('revalidates settings between each geocode and route provider operation', async () => {
    const service = makeService();
    let calls = 0;
    const resolver = vi.fn(() => {
      calls += 1;
      return calls === 1 ? service : null;
    });
    const runtime = makeRuntime('stale-between-calls', makeRegistry(), {
      resolver,
    });

    const result = await invoke(
      getRouteTool,
      { origin: 'central', destination: 'north', mode: 'driving' },
      runtime,
    );

    expect(resultText(result)).toContain('Mapping is unavailable');
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(runtime.context.mapRegistry.registrationCount).toBe(0);
    expect(runtime.context.mapRegistry.placeCount).toBe(0);
    expect(runtime.context.mapRegistry.routeCount).toBe(0);
  });

  it('rejects model-authored coordinates and unsupported route modes', async () => {
    const mapRegistry = makeRegistry();
    const service = makeService();
    const runtime = makeRuntime('validation-1', mapRegistry, { service });

    expect(
      SearchPlacesToolSchema.safeParse({ query: '40.0,-75.0' }).success,
    ).toBe(false);
    expect(
      SearchPlacesToolSchema.safeParse({ near: '[40.0 -75.0]' }).success,
    ).toBe(false);
    expect(
      GetPlaceDetailsToolSchema.safeParse({ placeHandle: 'private-map-1' })
        .success,
    ).toBe(false);
    await expect(
      invoke(
        getRouteTool,
        { origin: '40.0,-75.0', destination: 'north', mode: 'driving' },
        runtime,
      ),
    ).rejects.toThrow();
    await expect(
      invoke(
        getRouteTool,
        { origin: 'central', destination: 'north', mode: 'transit' },
        runtime,
      ),
    ).rejects.toThrow();
  });
});
