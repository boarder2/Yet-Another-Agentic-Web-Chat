import { describe, expect, it } from 'vitest';
import {
  GeoJsonLineStringSchema,
  MAP_LIMITS,
  MapAttributionSchema,
  MapPlaceSchema,
  MapSafeUrlSchema,
  MapDomainValidationError,
  formatCoordinate,
  normalizeCoordinate,
  redactMapSpec,
  toPersistableMapSpec,
  validateMapSessionOverlay,
  validateMapSpec,
} from './types';

describe('mapping domain contracts', () => {
  it('normalizes GeoJSON and object coordinates without accepting malformed tuples', () => {
    expect(normalizeCoordinate(['-73.9857', '40.7484'])).toEqual({
      lat: 40.7484,
      lon: -73.9857,
    });
    expect(
      normalizeCoordinate({ latitude: '40.7484', longitude: '-73.9857' }),
    ).toEqual({
      lat: 40.7484,
      lon: -73.9857,
    });
    expect(normalizeCoordinate({ coordinates: [-73.9857, 40.7484] })).toEqual({
      lat: 40.7484,
      lon: -73.9857,
    });
    expect(normalizeCoordinate([-73.9857, 40.7484, 12])).toBeNull();
    expect(normalizeCoordinate({ lat: 91, lon: -73.9857 })).toBeNull();
    expect(normalizeCoordinate({ lat: 40.7484, lon: Number.NaN })).toBeNull();
  });

  it('enforces safe URLs, attribution, and the persistable geometry cap', () => {
    expect(
      MapSafeUrlSchema.safeParse('https://example.test/place').success,
    ).toBe(true);
    expect(MapSafeUrlSchema.safeParse('javascript:alert(1)').success).toBe(
      false,
    );
    expect(
      MapSafeUrlSchema.safeParse('https://user:pass@example.test').success,
    ).toBe(false);
    expect(
      MapSafeUrlSchema.safeParse('https://example.test/\nsecret').success,
    ).toBe(false);
    expect(
      MapAttributionSchema.safeParse('<script>alert(1)</script>').success,
    ).toBe(false);

    const tooManyPoints = Array.from(
      { length: MAP_LIMITS.maxRouteGeometryPoints + 1 },
      (_, index) => [index / 1_000, index / 1_000] as [number, number],
    );
    expect(
      GeoJsonLineStringSchema.safeParse({
        type: 'LineString',
        coordinates: tooManyPoints,
      }).success,
    ).toBe(false);
  });

  it('validates a map spec as provider-grounded data rather than arbitrary coordinates', () => {
    const parsed = validateMapSpec({
      places: [
        {
          id: 'node/1',
          name: 'Test Place',
          coordinate: { lat: 40, lon: -75 },
          sourceUrl: 'https://www.openstreetmap.org/node/1',
          provider: 'openstreetmap',
          attribution: '© OpenStreetMap contributors',
        },
      ],
      attribution: '© OpenStreetMap contributors',
      retrievedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(parsed.places[0]).toMatchObject({
      id: 'node/1',
      name: 'Test Place',
    });
    expect(() =>
      validateMapSpec({
        places: [
          {
            id: 'node/1',
            name: 'Untrusted',
            coordinate: { lat: 40, lon: -75 },
            sourceUrl: 'https://example.test',
            provider: 'model',
            attribution: 'source',
          },
        ],
        attribution: 'source',
        retrievedAt: 'not-a-date',
      }),
    ).toThrow();
    expect(MapPlaceSchema.safeParse({}).success).toBe(false);
  });

  it('redacts an exact route into a destination-only durable snapshot', () => {
    const spec = validateMapSpec({
      places: [],
      route: {
        mode: 'driving',
        origin: { lat: 40, lon: -75 },
        destination: { lat: 40.1, lon: -75.1 },
        distanceMeters: 12_000,
        durationSeconds: 900,
        geometry: {
          type: 'LineString',
          coordinates: [
            [-75, 40],
            [-75.1, 40.1],
          ],
        },
        sourceUrl: 'https://router.example/route/secret-origin',
        navigationUrl: 'https://maps.example/nav?origin=secret',
        provider: 'test',
        attribution: 'Test routing provider',
      },
      attribution: 'Test routing provider',
      retrievedAt: '2026-01-01T00:00:00.000Z',
    });

    const retained = toPersistableMapSpec(spec);
    expect(retained.route).toMatchObject({
      origin: { lat: 40, lon: -75 },
      navigationUrl: 'https://maps.example/nav?origin=secret',
    });

    const redacted = redactMapSpec(spec);
    expect(redacted).toMatchObject({
      routeNotRetained: true,
      route: {
        mode: 'driving',
        destination: { lat: 40.1, lon: -75.1 },
        distanceMeters: 12_000,
        durationSeconds: 900,
        provider: 'test',
        attribution: 'Test routing provider',
        routeNotRetained: true,
      },
    });
    expect(redacted.route).not.toHaveProperty('origin');
    expect(redacted.route).not.toHaveProperty('geometry');
    expect(redacted.route).not.toHaveProperty('sourceUrl');
    expect(redacted.route).not.toHaveProperty('navigationUrl');
  });

  it('keeps session overlays separate from persistable map snapshots', () => {
    const overlay = validateMapSessionOverlay({
      mapId: 'private-map-1',
      origin: { lat: 40, lon: -75 },
      clientSessionId: 'page-session-1',
      expiresAt: '2026-01-01T00:10:00.000Z',
    });
    expect(overlay).toEqual({
      mapId: 'private-map-1',
      origin: { lat: 40, lon: -75 },
      clientSessionId: 'page-session-1',
      expiresAt: '2026-01-01T00:10:00.000Z',
    });

    expect(() =>
      validateMapSessionOverlay({ mapId: 'private-map-1' }),
    ).toThrow();
    expect(() =>
      validateMapSessionOverlay({
        mapId: 'private-map-1',
        origin: { lat: 40, lon: -75 },
        route: {
          mode: 'driving',
          origin: { lat: 41, lon: -75 },
          destination: { lat: 40.1, lon: -75.1 },
          distanceMeters: 1,
          durationSeconds: 1,
          geometry: {
            type: 'LineString',
            coordinates: [
              [-75, 41],
              [-75.1, 40.1],
            ],
          },
          sourceUrl: 'https://router.example/route',
          navigationUrl: 'https://maps.example/nav',
          provider: 'test',
          attribution: 'Test routing provider',
        },
      }),
    ).toThrow(/match the route origin/);
    expect(() =>
      validateMapSessionOverlay({
        mapId: 'private-map-1',
        origin: { lat: 40, lon: -75 },
        rawCoordinates: { lat: 1, lon: 2 },
      }),
    ).toThrow();
  });

  it('enforces the twelve-place map cap', () => {
    const places = Array.from({ length: MAP_LIMITS.maxPlaces + 1 }, (_, i) => ({
      id: `node/${i}`,
      name: `Place ${i}`,
      coordinate: { lat: 40, lon: -75 },
      sourceUrl: `https://www.openstreetmap.org/node/${i}`,
      provider: 'openstreetmap',
      attribution: '© OpenStreetMap contributors',
    }));

    expect(() =>
      validateMapSpec({
        places,
        attribution: '© OpenStreetMap contributors',
        retrievedAt: '2026-01-01T00:00:00.000Z',
      }),
    ).toThrow();
  });

  it('clamps formatted coordinates to a bounded precision', () => {
    expect(formatCoordinate({ lat: 1.23456789, lon: -2.3456789 })).toBe(
      '1.234568,-2.345679',
    );
    expect(formatCoordinate({ lat: 1.2, lon: 3.4 }, 99)).toBe(
      '1.200000000000,3.400000000000',
    );
  });

  it('sanitizes domain validation messages before exposing them', () => {
    const error = new MapDomainValidationError(
      'bad https://secret.example/path\nwith\u0000control',
    );

    expect(error.message).not.toContain('secret.example');
    expect(error.message).not.toMatch(/[\u0000-\u001f]/);
    expect(error.mapErrorCode).toBe('invalid_request');
  });
});
