import { describe, expect, it } from 'vitest';
import {
  MapError,
  MapValidationError,
  type MapRequestClientLike,
  type MapRequestOptions,
} from '../request';
import { MAP_LIMITS, type MapRouteRequest } from '../types';
import { OsrmClient, normalizeOsrmRoute, simplifyRouteGeometry } from './osrm';

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

const routeRequest: MapRouteRequest = {
  mode: 'driving',
  origin: { lat: 40, lon: -75 },
  destination: { lat: 40.01, lon: -75.02 },
};

const routePayload = (
  geometry: unknown = {
    type: 'LineString',
    coordinates: [
      [-75, 40],
      [-75.01, 40.005],
      [-75.02, 40.01],
    ],
  },
) => ({
  code: 'Ok',
  routes: [{ distance: 2_500, duration: 900, geometry }],
});

describe('OSRM mapping adapter', () => {
  it('simplifies oversized geometry while retaining valid GeoJSON order and endpoints', () => {
    const points = Array.from(
      { length: 1_001 },
      (_, index) =>
        [-75 + index / 100_000, 40 + Math.sin(index / 3) / 100_000] as [
          number,
          number,
        ],
    );
    const simplified = simplifyRouteGeometry(
      { type: 'LineString', coordinates: points },
      7,
    );

    expect(simplified.type).toBe('LineString');
    expect(simplified.coordinates.length).toBeLessThanOrEqual(7);
    expect(simplified.coordinates[0]).toEqual(points[0]);
    expect(simplified.coordinates.at(-1)).toEqual(points.at(-1));
    expect(() =>
      simplifyRouteGeometry(
        {
          type: 'LineString',
          coordinates: Array.from({ length: 20_001 }, () => [0, 0]),
        },
        7,
      ),
    ).toThrow(MapValidationError);
  });

  it('normalizes a route with bounded geometry and safe external links', () => {
    const geometry = {
      type: 'LineString',
      coordinates: Array.from({ length: 600 }, (_, index) => [
        -75 + index / 100_000,
        40 + index / 100_000,
      ]),
    };
    const route = normalizeOsrmRoute(routePayload(geometry), routeRequest, {
      endpoint: 'https://router.example/api/',
      profile: 'car',
      maxGeometryPoints: 5,
    });

    expect(route).toMatchObject({
      mode: 'driving',
      origin: routeRequest.origin,
      destination: routeRequest.destination,
      distanceMeters: 2_500,
      durationSeconds: 900,
      provider: 'openstreetmap',
      attribution: '© OpenStreetMap contributors',
    });
    expect(route.geometry.coordinates.length).toBeLessThanOrEqual(5);
    expect(route.sourceUrl).toContain(
      'https://router.example/api/route/v1/car/',
    );
    expect(route.sourceUrl).toContain('geometries=geojson');
    expect(route.navigationUrl).toContain('fossgis_osrm_car');
  });

  it('rejects a valid route geometry whose endpoints are unrelated to the request', () => {
    expect(() =>
      normalizeOsrmRoute(
        routePayload({
          type: 'LineString',
          coordinates: [
            [0, 0],
            [1, 1],
          ],
        }),
        routeRequest,
        { endpoint: 'https://router.example', profile: 'driving' },
      ),
    ).toThrow('different endpoints');
  });

  it('rejects malformed, unbounded, and no-route responses without inventing geometry', () => {
    const options = {
      endpoint: 'https://router.example',
      profile: 'driving',
    };
    expect(() =>
      normalizeOsrmRoute({ code: 'NoRoute' }, routeRequest, options),
    ).toThrow(MapError);
    try {
      normalizeOsrmRoute({ code: 'NoRoute' }, routeRequest, options);
    } catch (error) {
      expect(error).toMatchObject({
        code: 'not_found',
        mapErrorCode: 'not_found',
      });
    }

    for (const payload of [
      { code: 'Ok', routes: [] },
      routePayload({ type: 'Point', coordinates: [-75, 40] }),
      routePayload({
        type: 'LineString',
        coordinates: [
          [-75, 40],
          [-75, 40, 1],
        ],
      }),
      {
        code: 'Ok',
        routes: [
          {
            distance: MAP_LIMITS.maxRouteDistanceMeters + 1,
            duration: 1,
            geometry: routePayload().routes[0].geometry,
          },
        ],
      },
      {
        code: 'Ok',
        routes: [
          {
            distance: 1,
            duration: 7 * 24 * 60 * 60 + 1,
            geometry: routePayload().routes[0].geometry,
          },
        ],
      },
    ]) {
      expect(() => normalizeOsrmRoute(payload, routeRequest, options)).toThrow(
        /route|Routing provider/i,
      );
    }
  });

  it('requests only configured profiles and sends bounded route parameters', async () => {
    const calls: RequestCall[] = [];
    const client = new OsrmClient({
      endpoint: 'https://router.example/api/',
      profiles: { driving: 'car', walking: 'foot' },
      userAgent: 'Test mapping client',
      requestClient: requestClientFor(routePayload(), calls),
      maxGeometryPoints: 4,
    });

    const result = await client.route(routeRequest);
    expect(result.route.mode).toBe('driving');
    expect(calls).toHaveLength(1);
    const url = new URL(String(calls[0].input));
    expect(url.pathname).toContain('/route/v1/car/');
    expect(url.searchParams.get('overview')).toBe('full');
    expect(url.searchParams.get('geometries')).toBe('geojson');
    expect(calls[0].options).toMatchObject({
      maxBytes: 1_500_000,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Test mapping client',
      },
    });

    await expect(
      client.route({ ...routeRequest, mode: 'cycling' }),
    ).rejects.toBeInstanceOf(MapValidationError);
  });

  it('rejects invalid profiles and adapter inputs before making a request', () => {
    expect(
      () => new OsrmClient({ profiles: { driving: 'car profile' } }),
    ).toThrow(MapValidationError);
    expect(
      () => new OsrmClient({ endpoint: 'https://user:pass@router.example' }),
    ).toThrow(MapValidationError);
    expect(() => new OsrmClient({ attribution: '<unsafe>' })).toThrow(
      MapValidationError,
    );
  });
});
