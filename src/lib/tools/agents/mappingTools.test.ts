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
import { showMapTool } from './showMapTool';

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

const makeRuntime = (
  toolCallId: string,
  mapRegistry: TurnMapRegistry,
  options: {
    service?: ReturnType<typeof makeService> | null;
    resolver?: () => ReturnType<typeof makeService> | null;
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

describe('named-location mapping tools', () => {
  it('searches validated places, registers private handles, emits a map spec, and returns source documents', async () => {
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
    expect(output.mapHandle).toBe('map_1');

    const registration = mapRegistry.resolve('map_1');
    expect(registration).toMatchObject({
      mapId: 'private-map-1',
      spec: { places: [TEST_MAPPING_PLACES[0]] },
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'map_spec',
        data: expect.objectContaining({
          mapId: 'private-map-1',
          handle: 'map_1',
          source: 'search_places',
        }),
      }),
    );

    const update = resultUpdate(result);
    expect(update.relevantDocuments).toHaveLength(1);
    expect(update.relevantDocuments?.[0]).toMatchObject({
      pageContent: expect.stringContaining('Deterministic Central Cafe'),
      metadata: {
        processingType: 'mapping-place',
        placeHandle: 'place_1',
        url: 'https://www.openstreetmap.org/node/910001',
        provider: 'test',
      },
    });
  });

  it('uses a named locality for nearby discovery and omits facts the provider did not supply', async () => {
    const mapRegistry = makeRegistry();
    const service = makeService();
    const runtime = makeRuntime('nearby-1', mapRegistry, { service });

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
      name: 'Deterministic Central Cafe',
      category: 'cafe',
    });
    expect(places[0]).not.toHaveProperty('rating');
    expect(places[0]).not.toHaveProperty('reviewCount');
    expect(output.mapHandle).toBe('map_1');
    expect(resultUpdate(result).relevantDocuments?.[0]?.metadata).toMatchObject(
      {
        searchQuery: 'cafe near Testville',
      },
    );
  });

  it('omits a map and factual claims when the provider has no validated place', async () => {
    const mapRegistry = makeRegistry();
    const service = makeService();
    const runtime = makeRuntime('search-empty', mapRegistry, { service });

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

  it('builds a named route with handles, structured route citations, and an external navigation link', async () => {
    const mapRegistry = makeRegistry();
    const service = makeService();
    const runtime = makeRuntime('route-1', mapRegistry, { service });

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
      mapHandle: 'map_1',
      sourceUrl: expect.stringContaining('deterministic-route'),
      navigationUrl: expect.stringContaining('https://example.test/directions'),
      provider: 'test',
      attribution: 'Deterministic mapping test data',
    });
    expect(route.distanceMeters).toEqual(expect.any(Number));
    expect(route.durationSeconds).toEqual(expect.any(Number));
    expect(output.origin).toMatchObject({ placeHandle: 'place_1' });
    expect(output.destination).toMatchObject({ placeHandle: 'place_2' });
    expect(mapRegistry.resolveRoute('route_1')).toMatchObject({
      mapHandle: 'map_1',
      mapId: 'private-map-1',
      route: { mode: 'driving' },
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
    expect(resultUpdate(result).relevantDocuments).toEqual([]);
  });

  it('shows only a registered map or route once and keeps guessed handles out of the stream', async () => {
    const mapRegistry = makeRegistry();
    const service = makeService();
    const runtime = makeRuntime('show-1', mapRegistry, { service });
    const events = eventsFor(runtime.context.emitter);

    await invoke(searchPlacesTool, { query: 'central' }, runtime);
    events.length = 0;

    const shown = await invoke(showMapTool, { handle: 'map_1' }, runtime);
    expect(resultJson(shown)).toMatchObject({
      handle: 'map_1',
      mapHandle: 'map_1',
      pinCount: 1,
      hasRoute: false,
    });
    expect(events).toEqual([
      {
        type: 'map_placement',
        data: {
          placementId: 'map_placement_1',
          mapId: 'private-map-1',
          handle: 'map_1',
          placementNumber: 1,
        },
      },
    ]);

    const repeated = await invoke(showMapTool, { handle: 'map_1' }, runtime);
    expect(resultText(repeated)).toContain('at most 1 time');
    expect(events).toHaveLength(1);

    const guessed = await invoke(showMapTool, { handle: 'map_99' }, runtime);
    expect(resultText(guessed)).toContain('No registered map matches');
    expect(events).toHaveLength(1);
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
