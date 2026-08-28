import { describe, expect, it, vi } from 'vitest';
import { MapError } from '../request';
import type {
  MapPlaceDetailsResult,
  MapPlaceSearchResult,
  MapRouteResult,
} from '../types';
import { NominatimClient } from './nominatim';
import { OpenStreetMapProvider } from './openStreetMap';
import { OsrmClient } from './osrm';
import { OverpassClient } from './overpass';

const searchResult = {
  places: [],
  provider: 'openstreetmap',
  attribution: '© OpenStreetMap contributors',
  retrievedAt: '2026-01-01T00:00:00.000Z',
} satisfies MapPlaceSearchResult;
const detailsResult = {
  place: {
    id: 'node/1',
    name: 'Test place',
    coordinate: { lat: 40, lon: -75 },
    sourceUrl: 'https://www.openstreetmap.org/node/1',
    provider: 'openstreetmap',
    attribution: '© OpenStreetMap contributors',
  },
  provider: 'openstreetmap',
  attribution: '© OpenStreetMap contributors',
  retrievedAt: '2026-01-01T00:00:00.000Z',
} satisfies MapPlaceDetailsResult;
const routeResult = {
  route: {
    mode: 'driving',
    origin: { lat: 40, lon: -75 },
    destination: { lat: 40.01, lon: -75.01 },
    distanceMeters: 1_000,
    durationSeconds: 100,
    geometry: {
      type: 'LineString',
      coordinates: [
        [-75, 40],
        [-75.01, 40.01],
      ],
    },
    sourceUrl: 'https://router.example/route',
    navigationUrl: 'https://www.openstreetmap.org/directions',
    provider: 'openstreetmap',
    attribution: '© OpenStreetMap contributors',
  },
  provider: 'openstreetmap',
  attribution: '© OpenStreetMap contributors',
  retrievedAt: '2026-01-01T00:00:00.000Z',
} satisfies MapRouteResult;

const config = {
  geocoderUrl: 'https://nominatim.example',
  placesUrl: 'https://overpass.example',
  routingUrl: 'https://router.example',
  routeProfiles: { driving: 'car', walking: 'foot' },
  tileAttribution: '© Example map data',
  userAgent: 'Test mapping client',
};

describe('composed OpenStreetMap-compatible provider', () => {
  it('dispatches searches, details, and routes to the appropriate bounded adapter', async () => {
    const nominatim = {
      search: vi.fn(async () => searchResult),
      details: vi.fn(async () => detailsResult),
      attribution: '© Example map data',
    } as unknown as NominatimClient;
    const overpass = {
      searchNearby: vi.fn(async () => searchResult),
      attribution: '© Example map data',
    } as unknown as OverpassClient;
    const osrm = {
      route: vi.fn(async () => routeResult),
      attribution: '© Example map data',
    } as unknown as OsrmClient;
    const provider = new OpenStreetMapProvider(config, {
      nominatim,
      overpass,
      osrm,
    });

    await provider.searchPlaces({ query: 'Testville' });
    await provider.searchPlaces({
      center: { lat: 40, lon: -75 },
      radiusMeters: 500,
      category: 'cafe',
    });
    await provider.getPlaceDetails({ placeId: 'node/1' });
    await provider.getRoute({
      origin: { lat: 40, lon: -75 },
      destination: { lat: 40.01, lon: -75.01 },
      mode: 'driving',
    });

    expect(nominatim.search).toHaveBeenCalledOnce();
    expect(overpass.searchNearby).toHaveBeenCalledOnce();
    expect(nominatim.details).toHaveBeenCalledWith(
      { placeId: 'node/1' },
      expect.anything(),
    );
    expect(osrm.route).toHaveBeenCalledOnce();
  });

  it('exposes capabilities from configured route profiles and rejects unconfigured modes', async () => {
    const provider = new OpenStreetMapProvider(config, {
      nominatim: {} as NominatimClient,
      overpass: {} as OverpassClient,
      osrm: {} as OsrmClient,
    });

    expect(provider.capabilities).toMatchObject({
      geocoding: true,
      nearby: true,
      placeDetails: true,
      routing: true,
      routeModes: ['driving', 'walking'],
      tiles: true,
    });

    await expect(
      provider.getRoute({
        origin: { lat: 40, lon: -75 },
        destination: { lat: 40.01, lon: -75.01 },
        mode: 'cycling',
      }),
    ).rejects.toMatchObject({
      code: 'unsupported',
      mapErrorCode: 'unsupported',
    });
  });

  it('validates component endpoints and attribution at construction time', () => {
    expect(
      () =>
        new OpenStreetMapProvider({
          ...config,
          geocoderUrl: 'javascript:alert(1)',
        }),
    ).toThrow();
    expect(
      () =>
        new OpenStreetMapProvider({
          ...config,
          tileAttribution: '<unsafe>',
        }),
    ).toThrow();
    expect(new MapError('unsupported', 'not configured').code).toBe(
      'unsupported',
    );
  });
});
