import { describe, expect, it } from 'vitest';
import {
  MapValidationError,
  type MapRequestClientLike,
  type MapRequestOptions,
} from '../request';
import { MAP_LIMITS } from '../types';
import {
  OVERPASS_CATEGORY_TAXONOMY,
  OverpassClient,
  buildOverpassQuery,
  normalizeOverpassCategory,
  normalizeOverpassElement,
} from './overpass';

type RequestCall = {
  input: RequestInfo | URL;
  options?: MapRequestOptions;
};

function requestClientFor(
  payload: unknown,
  calls: RequestCall[] = [],
): MapRequestClientLike {
  const json = async <T>(
    input: RequestInfo | URL,
    options?: MapRequestOptions,
  ): Promise<T> => {
    calls.push({ input, options });
    return payload as T;
  };
  return { json };
}

const overpassElement = (
  index = 1,
  overrides: Record<string, unknown> = {},
) => ({
  type: 'way',
  id: index,
  center: { lat: 40 + index / 10_000, lon: -75 - index / 10_000 },
  tags: {
    name: `Business ${index}`,
    amenity: 'restaurant',
    'addr:housenumber': String(index),
    'addr:street': 'Main Street',
    'addr:postcode': '12345',
    'addr:city': 'Testville',
    website: 'javascript:alert(1)',
    phone: '+1 555 0100',
    opening_hours: 'Mo-Fr 09:00-17:00',
    rating: '4.2',
    review_count: '24',
  },
  ...overrides,
});

describe('Overpass mapping adapter', () => {
  it('uses only the fixed category taxonomy and escapes no model-supplied filter text', () => {
    expect(normalizeOverpassCategory(' coffee_shop ')).toBe('cafe');
    expect(normalizeOverpassCategory('landmark')).toBe('attraction');
    expect(Object.keys(OVERPASS_CATEGORY_TAXONOMY)).toContain('business');

    const query = buildOverpassQuery({
      center: { lat: 40.1234567, lon: -75.7654321 },
      radiusMeters: 999_999,
      category: 'restaurant',
      timeoutSeconds: 999,
    });
    expect(query).toContain('around:50000,40.123457,-75.765432');
    expect(query).toContain('[timeout:25]');
    expect(query).toContain('["amenity"="restaurant"]');
    expect(query).not.toContain('999999');

    expect(() =>
      normalizeOverpassCategory('restaurant"];way(around:1);('),
    ).toThrow(MapValidationError);
    expect(() =>
      buildOverpassQuery({
        center: { lat: 0, lon: 0 },
        category: 'restaurant\n[out:json]',
      }),
    ).toThrow(MapValidationError);
  });

  it('normalizes node and centered way records, retaining only bounded safe fields', () => {
    const place = normalizeOverpassElement(overpassElement(3));
    expect(place).toMatchObject({
      id: 'way/3',
      name: 'Business 3',
      coordinate: { lat: 40.0003, lon: -75.0003 },
      address: '3, Main Street, 12345, Testville',
      category: 'restaurant',
      phone: '+1 555 0100',
      openingHours: 'Mo-Fr 09:00-17:00',
      rating: 4.2,
      reviewCount: 24,
      sourceUrl: 'https://www.openstreetmap.org/way/3',
      provider: 'openstreetmap',
    });
    expect(place).not.toHaveProperty('websiteUrl');

    expect(
      normalizeOverpassElement({
        type: 'node',
        id: 4,
        lat: 40,
        lon: -75,
        tags: { name: 'Direct node', brand: 'Brand' },
      }),
    ).toMatchObject({ id: 'node/4', name: 'Direct node' });
    expect(
      normalizeOverpassElement({ ...overpassElement(), tags: {} }),
    ).toBeNull();
    expect(
      normalizeOverpassElement({
        ...overpassElement(),
        center: { lat: 91, lon: 0 },
      }),
    ).toBeNull();
  });

  it('posts bounded queries and caps normalized nearby results', async () => {
    const calls: RequestCall[] = [];
    const payload = {
      elements: Array.from({ length: MAP_LIMITS.maxPlaces + 10 }, (_, index) =>
        overpassElement(index + 1),
      ),
    };
    const client = new OverpassClient({
      endpoint: 'https://overpass.example/interpreter/',
      userAgent: 'Test mapping client',
      requestClient: requestClientFor(payload, calls),
    });

    const result = await client.searchNearby({
      center: { lat: 40, lon: -75 },
      radiusMeters: 2_000,
      category: 'restaurant',
      limit: MAP_LIMITS.maxPlaces,
    });

    expect(result.places).toHaveLength(MAP_LIMITS.maxPlaces);
    expect(calls).toHaveLength(1);
    expect(String(calls[0].input)).toBe('https://overpass.example/interpreter');
    expect(calls[0].options).toMatchObject({
      method: 'POST',
      maxBytes: 1_500_000,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Test mapping client',
      },
    });
    const body = new URLSearchParams(String(calls[0].options?.body));
    expect(body.get('data')).toContain('nwr(around:2000,40.000000,-75.000000)');
    expect(body.get('data')).toContain('["amenity"="restaurant"]');
  });

  it('rejects missing centers and malformed provider envelopes', async () => {
    const malformed = new OverpassClient({
      requestClient: requestClientFor({ elements: 'not-an-array' }),
    });
    await expect(
      malformed.searchNearby({ category: 'restaurant' }),
    ).rejects.toBeInstanceOf(MapValidationError);
    await expect(
      malformed.searchNearby({
        center: { lat: 40, lon: -75 },
        category: 'restaurant',
      }),
    ).rejects.toMatchObject({ mapErrorCode: 'malformed_response' });
    await expect(
      malformed.searchNearby({
        center: { lat: 40, lon: -75 },
        category: 'unknown',
      }),
    ).rejects.toBeInstanceOf(MapValidationError);
  });

  it('validates adapter construction and keeps request category values out of query text', () => {
    expect(
      () => new OverpassClient({ endpoint: 'ftp://overpass.example' }),
    ).toThrow(MapValidationError);
    expect(() => new OverpassClient({ userAgent: 'bad\ragent' })).toThrow(
      MapValidationError,
    );
    expect(() => new OverpassClient({ attribution: '<unsafe>' })).toThrow(
      MapValidationError,
    );
  });
});
