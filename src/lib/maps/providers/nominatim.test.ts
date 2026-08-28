import { describe, expect, it } from 'vitest';
import {
  MapError,
  MapValidationError,
  type MapRequestClientLike,
  type MapRequestOptions,
} from '../request';
import { MAP_LIMITS } from '../types';
import {
  NominatimClient,
  normalizeNominatimPlace,
  nominatimPlaceId,
} from './nominatim';

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

const nominatimRecord = (
  index = 1,
  overrides: Record<string, unknown> = {},
) => ({
  osm_type: 'node',
  osm_id: index,
  display_name: `Place ${index}, Testville`,
  lat: String(40 + index / 1000),
  lon: String(-75 - index / 1000),
  type: 'cafe',
  address: {
    house_number: String(index),
    road: 'Test Way',
    city: 'Testville',
    country: 'Testland',
  },
  extratags: {
    website: 'https://example.test/place',
    phone: '+1 555 0100',
    opening_hours: 'Mo-Fr 09:00-17:00',
    rating: '4.5',
    review_count: '12',
  },
  ...overrides,
});

describe('Nominatim mapping adapter', () => {
  it('normalizes provider records into validated places and drops unsafe optional fields', () => {
    const place = normalizeNominatimPlace(
      nominatimRecord(1, {
        namedetails: { name: 'Named Details Name' },
        name: 'Fallback Name',
        extratags: {
          website: 'javascript:alert(1)',
          phone: ' +1 555 0100 ',
          opening_hours: ' Mo-Su 09:00-17:00 ',
          rating: 'not-a-rating',
          review_count: '3.5',
        },
      }),
    );

    expect(place).toMatchObject({
      id: 'node/1',
      name: 'Named Details Name',
      coordinate: { lat: 40.001, lon: -75.001 },
      address: '1, Test Way, Testville, Testland',
      category: 'cafe',
      sourceUrl: 'https://www.openstreetmap.org/node/1',
      provider: 'openstreetmap',
      attribution: '© OpenStreetMap contributors',
      phone: '+1 555 0100',
      openingHours: 'Mo-Su 09:00-17:00',
    });
    expect(place).not.toHaveProperty('websiteUrl');
    expect(place).not.toHaveProperty('rating');
    expect(place).not.toHaveProperty('reviewCount');
  });

  it('requires a canonical OSM identity and a valid coordinate', () => {
    expect(nominatimPlaceId('N', '42')).toBe('node/42');
    expect(nominatimPlaceId('way', 42)).toBe('way/42');
    expect(nominatimPlaceId('node', '0')).toBeUndefined();
    expect(nominatimPlaceId('point', '42')).toBeUndefined();
    expect(
      normalizeNominatimPlace({ place_id: 42, display_name: 'No OSM id' }),
    ).toBeNull();
    expect(
      normalizeNominatimPlace(nominatimRecord(2, { lat: '91', lon: '-75' })),
    ).toBeNull();
  });

  it('bounds search results and emits a bounded, encoded Nominatim request', async () => {
    const calls: RequestCall[] = [];
    const payload = [
      { unrelated: true },
      ...Array.from({ length: MAP_LIMITS.maxPlaces + 8 }, (_, index) =>
        nominatimRecord(index + 1),
      ),
    ];
    const client = new NominatimClient({
      endpoint: 'https://nominatim.example/api/',
      userAgent: 'Test mapping client',
      requestClient: requestClientFor(payload, calls),
    });

    const result = await client.search({
      query: '  coffee & tea  ',
      limit: MAP_LIMITS.maxPlaces,
    });

    expect(result.places).toHaveLength(MAP_LIMITS.maxPlaces);
    expect(result.query).toBe('coffee & tea');
    expect(calls).toHaveLength(1);
    const url = new URL(String(calls[0].input));
    expect(url.pathname).toBe('/api/search');
    expect(url.searchParams.get('q')).toBe('coffee & tea');
    expect(url.searchParams.get('limit')).toBe(String(MAP_LIMITS.maxPlaces));
    expect(url.searchParams.get('format')).toBe('jsonv2');
    expect(calls[0].options).toMatchObject({
      maxBytes: 512_000,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Test mapping client',
      },
    });
  });

  it('rejects malformed provider payloads and invalid search requests', async () => {
    const client = new NominatimClient({
      requestClient: requestClientFor({ elements: [] }),
    });

    await expect(client.search({ query: 'coffee' })).rejects.toMatchObject({
      code: 'malformed_response',
      mapErrorCode: 'malformed_response',
    });
    await expect(
      client.search({ query: 'x'.repeat(241) }),
    ).rejects.toBeInstanceOf(MapValidationError);
    await expect(client.search({ query: '' })).rejects.toBeInstanceOf(
      MapValidationError,
    );
  });

  it('validates detail IDs and normalizes a detail response through the same boundary', async () => {
    const calls: RequestCall[] = [];
    const client = new NominatimClient({
      endpoint: 'https://nominatim.example',
      requestClient: requestClientFor(
        nominatimRecord(7, { osm_type: 'way', osm_id: '99' }),
        calls,
      ),
    });

    const result = await client.details({ placeId: 'way/99' });
    expect(result.place.id).toBe('way/99');
    expect(new URL(String(calls[0].input)).searchParams.get('osmtype')).toBe(
      'W',
    );
    expect(new URL(String(calls[0].input)).searchParams.get('osmid')).toBe(
      '99',
    );

    await expect(
      client.details({ placeId: 'node/1/../../secret' }),
    ).rejects.toBeInstanceOf(MapValidationError);
  });

  it('rejects invalid adapter construction inputs before any provider call', () => {
    expect(
      () => new NominatimClient({ endpoint: 'https://user:pass@example.test' }),
    ).toThrow(MapValidationError);
    expect(() => new NominatimClient({ userAgent: 'line\nbreak' })).toThrow(
      MapValidationError,
    );
    expect(() => new NominatimClient({ attribution: '<unsafe>' })).toThrow(
      MapValidationError,
    );
    expect(new MapError('malformed_response', 'safe').mapErrorCode).toBe(
      'malformed_response',
    );
  });
});
