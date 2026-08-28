import { afterEach, describe, expect, it, vi } from 'vitest';
import { MapError } from '../request';
import {
  TEST_MAPPING_PLACES,
  TEST_MAPPING_RETRIEVED_AT,
  createTestMappingProvider,
  getTestMappingProvider,
  isDeterministicMappingProviderEnabled,
} from './test';

afterEach(() => vi.unstubAllEnvs());

describe('deterministic mapping provider', () => {
  it('is unavailable unless a test-only environment gate is enabled', () => {
    vi.stubEnv('YAAWC_TEST_MODE', 'false');
    vi.stubEnv('YAAWC_TEST_MAPPING_PROVIDER', 'false');
    expect(isDeterministicMappingProviderEnabled()).toBe(false);
    expect(createTestMappingProvider()).toBeNull();
    expect(getTestMappingProvider()).toBeNull();

    vi.stubEnv('YAAWC_TEST_MAPPING_PROVIDER', 'true');
    expect(isDeterministicMappingProviderEnabled()).toBe(true);
    expect(createTestMappingProvider()).not.toBeNull();
  });

  it('provides stable, network-free search, category, radius, and detail results', async () => {
    const provider = createTestMappingProvider({ enabled: true });
    expect(provider).not.toBeNull();
    if (!provider) return;

    const search = await provider.searchPlaces({ query: 'deterministic' });
    expect(search.places.map((place) => place.id)).toEqual(
      TEST_MAPPING_PLACES.map((place) => place.id),
    );
    expect(search.retrievedAt).toBe(TEST_MAPPING_RETRIEVED_AT);

    const nearby = await provider.searchPlaces({
      center: { lat: 40.0005, lon: -75.0005 },
      radiusMeters: 100,
      category: 'coffee_shop',
    });
    expect(nearby.places.map((place) => place.name)).toEqual([
      'Deterministic Central Cafe',
    ]);

    const details = await provider.getPlaceDetails({ placeId: 'node/910001' });
    expect(details.place.name).toBe('Deterministic Central Cafe');
    const returned = await provider.searchPlaces({ query: 'central' });
    returned.places[0].coordinate.lat = 0;
    expect(
      (await provider.searchPlaces({ query: 'central' })).places[0].coordinate
        .lat,
    ).toBe(40.0005);

    await expect(
      provider.getPlaceDetails({ placeId: 'node/does-not-exist' }),
    ).rejects.toMatchObject({ code: 'not_found', mapErrorCode: 'not_found' });
  });

  it('returns bounded deterministic routes for each supported mode', async () => {
    const provider = createTestMappingProvider({ enabled: true });
    expect(provider).not.toBeNull();
    if (!provider) return;

    for (const mode of provider.capabilities.routeModes) {
      const result = await provider.getRoute({
        mode,
        origin: { lat: 40, lon: -75 },
        destination: { lat: 40.01, lon: -75.01 },
      });
      expect(result.route).toMatchObject({
        mode,
        origin: { lat: 40, lon: -75 },
        destination: { lat: 40.01, lon: -75.01 },
        provider: 'test',
        attribution: 'Deterministic mapping test data',
      });
      expect(result.route.geometry.coordinates).toHaveLength(2);
      expect(result.route.sourceUrl).toContain(`mode=${mode}`);
    }

    await expect(
      provider.getRoute({
        mode: 'driving',
        origin: { lat: 90, lon: 180 },
        destination: { lat: -90, lon: -180 },
      }),
    ).rejects.toMatchObject({ code: 'unsupported' });
    expect(new MapError('unsupported', 'test').mapErrorCode).toBe(
      'unsupported',
    );
  });
});
