import { describe, expect, it, vi } from 'vitest';
import { resolveMappingConfiguration } from './config';
import { BoundedMapMemoryCache, type MapCacheStore } from './cache';
import { MapError } from './request';
import {
  MappingService,
  createMappingProvider,
  createMappingService,
  createMappingServiceFromSettings,
  getMappingService,
} from './service';
import {
  TEST_MAPPING_PLACES,
  createTestMappingProvider,
  type DeterministicMapProvider,
} from './providers/test';
import type { MapProvider } from './providers/types';

const enabledTestConfig = () =>
  resolveMappingConfiguration(
    { mappingEnabled: 'true', mappingProvider: 'test' },
    { testProviderEnabled: true },
  );

function spyProvider(): {
  provider: MapProvider;
  searchPlaces: ReturnType<typeof vi.fn>;
  getPlaceDetails: ReturnType<typeof vi.fn>;
  getRoute: ReturnType<typeof vi.fn>;
} {
  const base = createTestMappingProvider({
    enabled: true,
  }) as DeterministicMapProvider;
  const searchPlaces = vi.fn(base.searchPlaces.bind(base));
  const getPlaceDetails = vi.fn(base.getPlaceDetails.bind(base));
  const getRoute = vi.fn(base.getRoute.bind(base));
  return {
    searchPlaces,
    getPlaceDetails,
    getRoute,
    provider: {
      id: base.id,
      displayName: base.displayName,
      attribution: base.attribution,
      capabilities: base.capabilities,
      searchPlaces,
      getPlaceDetails,
      getRoute,
    },
  };
}

function emptyDurableCache(): {
  cache: MapCacheStore;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
} {
  const values = new Map<string, unknown>();
  const get = vi.fn((key: string) => values.get(key) ?? null);
  const set = vi.fn((_key: string, _kind: string, value: unknown) => {
    values.set(_key, value);
  });
  return {
    get,
    set,
    cache: { get, set } as unknown as MapCacheStore,
  };
}

describe('mapping service boundary', () => {
  it('fails closed for disabled or unavailable configurations', () => {
    const disabled = resolveMappingConfiguration();
    expect(() => createMappingProvider(disabled)).toThrow(
      /Mapping is disabled/,
    );
    expect(getMappingService({})).toBeNull();

    const publicPending = resolveMappingConfiguration({
      mappingEnabled: 'true',
    });
    expect(() => createMappingProvider(publicPending)).toThrow(
      /acknowledgement/,
    );
  });

  it('intersects configured capabilities with provider capabilities', () => {
    const { provider } = spyProvider();
    const service = new MappingService(enabledTestConfig(), provider, {
      useCache: false,
    });

    expect(service.capabilities).toMatchObject({
      geocoding: true,
      nearby: true,
      placeDetails: true,
      routing: true,
      routeModes: ['driving'],
      tiles: true,
    });
  });

  it('uses durable cache for locality/details and memory cache for nearby/routes', async () => {
    const { provider, searchPlaces, getPlaceDetails, getRoute } = spyProvider();
    const durable = emptyDurableCache();
    const memory = new BoundedMapMemoryCache(8, 60_000, () => 1_000);
    const service = new MappingService(enabledTestConfig(), provider, {
      durableCache: durable.cache,
      memoryCache: memory,
    });

    await service.searchPlaces({ query: 'central' });
    await service.searchPlaces({ query: 'central' });
    expect(searchPlaces).toHaveBeenCalledTimes(1);
    expect(durable.set).toHaveBeenCalledOnce();

    await service.searchPlaces({
      center: { lat: 40, lon: -75 },
      radiusMeters: 1_000,
      category: 'cafe',
    });
    await service.searchPlaces({
      center: { lat: 40, lon: -75 },
      radiusMeters: 1_000,
      category: 'cafe',
    });
    expect(searchPlaces).toHaveBeenCalledTimes(2);

    await service.getPlaceDetails({ placeId: 'node/910001' });
    await service.getPlaceDetails({ placeId: 'node/910001' });
    expect(getPlaceDetails).toHaveBeenCalledOnce();

    await service.getRoute({
      mode: 'driving',
      origin: { lat: 40, lon: -75 },
      destination: { lat: 40.01, lon: -75.01 },
    });
    await service.getRoute({
      mode: 'driving',
      origin: { lat: 40, lon: -75 },
      destination: { lat: 40.01, lon: -75.01 },
    });
    expect(getRoute).toHaveBeenCalledOnce();
    expect(durable.get).toHaveBeenCalled();
    expect(memory.size).toBe(2);
  });

  it.each([
    ['numbered', '123 Main Street, Testville'],
    ['named', 'The Old Rectory, Church Lane, Testville'],
  ])(
    'keeps %s exact-address place details in bounded memory instead of the durable cache',
    async (_kind, address) => {
      const { provider, getPlaceDetails } = spyProvider();
      getPlaceDetails.mockResolvedValue({
        place: {
          ...TEST_MAPPING_PLACES[0],
          id: 'node/residential-1',
          name: 'Registered residence',
          address,
          category: 'place',
        },
        provider: 'test',
        attribution: 'Deterministic mapping test data',
        retrievedAt: '2026-01-01T00:00:00.000Z',
      });
      const durable = emptyDurableCache();
      const memory = new BoundedMapMemoryCache(8, 60_000, () => 1_000);
      const service = new MappingService(enabledTestConfig(), provider, {
        durableCache: durable.cache,
        memoryCache: memory,
      });

      await service.getPlaceDetails({ placeId: 'node/residential-1' });
      await service.getPlaceDetails({ placeId: 'node/residential-1' });

      expect(getPlaceDetails).toHaveBeenCalledOnce();
      expect(durable.set).not.toHaveBeenCalled();
      expect(memory.size).toBe(1);
    },
  );

  it('keeps named exact-address place searches in bounded memory', async () => {
    const { provider, searchPlaces } = spyProvider();
    const address = 'The Old Rectory, Church Lane, Testville';
    searchPlaces.mockResolvedValue({
      places: [
        {
          ...TEST_MAPPING_PLACES[0],
          id: 'node/residential-search-1',
          name: 'Registered residence',
          address,
          category: 'place',
        },
      ],
      query: address,
      provider: 'test',
      attribution: 'Deterministic mapping test data',
      retrievedAt: '2026-01-01T00:00:00.000Z',
    });
    const durable = emptyDurableCache();
    const memory = new BoundedMapMemoryCache(8, 60_000, () => 1_000);
    const service = new MappingService(enabledTestConfig(), provider, {
      durableCache: durable.cache,
      memoryCache: memory,
    });

    await service.searchPlaces({ query: address });
    await service.searchPlaces({ query: address });

    expect(searchPlaces).toHaveBeenCalledOnce();
    expect(durable.set).not.toHaveBeenCalled();
    expect(memory.size).toBe(1);
  });

  it('validates requests and provider results while keeping provider failures sanitized', async () => {
    const { provider } = spyProvider();
    const service = new MappingService(enabledTestConfig(), provider, {
      useCache: false,
    });
    await expect(service.searchPlaces({ query: '' })).rejects.toMatchObject({
      code: 'invalid_request',
      mapErrorCode: 'invalid_request',
    });

    const invalidProvider: MapProvider = {
      ...provider,
      searchPlaces: async () => ({
        places: [],
        provider: 'test',
        attribution: '',
        retrievedAt: 'not-a-date',
      }),
    };
    const invalidService = new MappingService(
      enabledTestConfig(),
      invalidProvider,
      { useCache: false },
    );
    await expect(
      invalidService.searchPlaces({ query: 'central' }),
    ).rejects.toMatchObject({
      code: 'malformed_response',
      mapErrorCode: 'malformed_response',
    });

    const failingProvider: MapProvider = {
      ...provider,
      searchPlaces: async () => {
        throw new Error('provider https://secret.example/with-token failed');
      },
    };
    const failingService = new MappingService(
      enabledTestConfig(),
      failingProvider,
      { useCache: false },
    );
    try {
      await failingService.searchPlaces({ query: 'central' });
      throw new Error('expected provider failure');
    } catch (error) {
      expect(error).toBeInstanceOf(MapError);
      expect(error).toMatchObject({
        code: 'provider_unavailable',
        mapErrorCode: 'provider_unavailable',
      });
      expect((error as MapError).message).not.toContain('secret.example');
    }
  });

  it('supports explicit provider injection without enabling network access', async () => {
    const { provider } = spyProvider();
    const service = createMappingService(provider, { useCache: false });
    expect(service.configuration.provider).toBe('test');
    expect(service.configuration.available).toBe(true);
    await expect(
      service.searchPlaces({ query: 'central' }),
    ).resolves.toMatchObject({
      provider: 'test',
    });

    expect(() =>
      createMappingServiceFromSettings(
        { mappingEnabled: 'true', mappingProvider: 'test' },
        { provider, useCache: false },
      ),
    ).toThrow(/provider is unavailable|Mapping provider is unavailable/i);
  });
});
