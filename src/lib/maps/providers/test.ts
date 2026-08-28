import {
  MAP_LIMITS,
  MapPlaceDetailsRequestSchema,
  MapPlaceSearchRequestSchema,
  MapRouteRequestSchema,
  clampRadiusMeters,
  type MapPlace,
  type MapPlaceDetailsRequest,
  type MapPlaceDetailsResult,
  type MapPlaceSearchRequest,
  type MapPlaceSearchResult,
  type MapProviderCapabilities,
  type MapRouteRequest,
  type MapRouteResult,
} from '../types';
import { MapError, MapValidationError } from '../request';
import type { MapProvider, MapProviderClientOptions } from './types';

export const TEST_MAPPING_PROVIDER_ID = 'test';
export const TEST_MAPPING_ATTRIBUTION = 'Deterministic mapping test data';
export const TEST_MAPPING_RETRIEVED_AT = '2026-01-01T00:00:00.000Z';

const TEST_PLACES: MapPlace[] = [
  {
    id: 'node/910001',
    name: 'Deterministic Central Cafe',
    coordinate: { lat: 40.0005, lon: -75.0005 },
    address: '1 Test Way, Testville',
    category: 'cafe',
    sourceUrl: 'https://www.openstreetmap.org/node/910001',
    websiteUrl: 'https://example.test/central-cafe',
    openingHours: 'Mo-Su 08:00-18:00',
    provider: TEST_MAPPING_PROVIDER_ID,
    attribution: TEST_MAPPING_ATTRIBUTION,
  },
  {
    id: 'node/910002',
    name: 'Deterministic North Market',
    coordinate: { lat: 40.004, lon: -75.002 },
    address: '2 Test Way, Testville',
    category: 'supermarket',
    sourceUrl: 'https://www.openstreetmap.org/node/910002',
    provider: TEST_MAPPING_PROVIDER_ID,
    attribution: TEST_MAPPING_ATTRIBUTION,
  },
  {
    id: 'node/910003',
    name: 'Deterministic South Museum',
    coordinate: { lat: 39.996, lon: -75.001 },
    address: '3 Test Way, Testville',
    category: 'museum',
    sourceUrl: 'https://www.openstreetmap.org/node/910003',
    provider: TEST_MAPPING_PROVIDER_ID,
    attribution: TEST_MAPPING_ATTRIBUTION,
  },
];

function clonePlace(place: MapPlace): MapPlace {
  return { ...place, coordinate: { ...place.coordinate } };
}

export const TEST_MAPPING_PLACES = TEST_PLACES.map(clonePlace);

const TEST_CAPABILITIES: MapProviderCapabilities = {
  geocoding: true,
  nearby: true,
  placeDetails: true,
  routing: true,
  routeModes: ['driving', 'walking', 'cycling'],
  tiles: true,
};

function resultTime(): string {
  return TEST_MAPPING_RETRIEVED_AT;
}

function distanceSquared(a: MapPlace, b: { lat: number; lon: number }): number {
  return (a.coordinate.lat - b.lat) ** 2 + (a.coordinate.lon - b.lon) ** 2;
}

function distanceMeters(a: MapPlace, b: { lat: number; lon: number }): number {
  const latitude = ((a.coordinate.lat + b.lat) / 2) * (Math.PI / 180);
  const deltaLat = (a.coordinate.lat - b.lat) * (Math.PI / 180);
  const deltaLon = (a.coordinate.lon - b.lon) * (Math.PI / 180);
  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);
  const haversine =
    sinLat * sinLat + Math.cos(latitude) * Math.cos(latitude) * sinLon * sinLon;
  return (
    6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

/** Deterministic, network-free provider enabled only in test environments. */
export class DeterministicMapProvider implements MapProvider {
  readonly id = TEST_MAPPING_PROVIDER_ID;
  readonly displayName = 'Deterministic mapping test provider';
  readonly attribution = TEST_MAPPING_ATTRIBUTION;
  readonly capabilities = TEST_CAPABILITIES;

  async searchPlaces(
    rawRequest: MapPlaceSearchRequest,
    _options: MapProviderClientOptions = {},
  ): Promise<MapPlaceSearchResult> {
    const parsed = MapPlaceSearchRequestSchema.safeParse(rawRequest);
    if (!parsed.success)
      throw new MapValidationError('Invalid mapping search request');
    const request = parsed.data;
    if (request.query === 'provider-failure') {
      throw new MapError(
        'provider_unavailable',
        'Deterministic mapping provider failure',
      );
    }
    let places = [...TEST_PLACES];
    if (request.query) {
      const query = request.query.toLowerCase();
      places = places.filter((place) =>
        `${place.name} ${place.address ?? ''} ${place.category ?? ''}`
          .toLowerCase()
          .includes(query),
      );
    }
    if (request.category) {
      const categoryAliases: Record<string, string> = {
        coffee: 'cafe',
        coffee_shop: 'cafe',
        grocery: 'supermarket',
        groceries: 'supermarket',
      };
      const category =
        categoryAliases[request.category.toLowerCase()] ??
        request.category.toLowerCase();
      if (category !== 'business' && category !== 'shop') {
        places = places.filter((place) => place.category === category);
      }
    }
    if (request.center) {
      const center = request.center;
      const radius = clampRadiusMeters(request.radiusMeters);
      places = places.filter(
        (place) => distanceMeters(place, center) <= radius,
      );
      places.sort(
        (a, b) => distanceSquared(a, center) - distanceSquared(b, center),
      );
    }
    return {
      places: places.slice(0, request.limit ?? 12).map(clonePlace),
      query: request.query,
      provider: this.id,
      attribution: this.attribution,
      retrievedAt: resultTime(),
    };
  }

  async getPlaceDetails(
    rawRequest: MapPlaceDetailsRequest,
    _options: MapProviderClientOptions = {},
  ): Promise<MapPlaceDetailsResult> {
    const parsed = MapPlaceDetailsRequestSchema.safeParse(rawRequest);
    if (!parsed.success)
      throw new MapValidationError('Invalid mapping place request');
    const place = TEST_PLACES.find(
      (candidate) => candidate.id === parsed.data.placeId,
    );
    if (!place) throw new MapError('not_found', 'Mapping place was not found');
    return {
      place: clonePlace(place),
      provider: this.id,
      attribution: this.attribution,
      retrievedAt: resultTime(),
    };
  }

  async getRoute(
    rawRequest: MapRouteRequest,
    _options: MapProviderClientOptions = {},
  ): Promise<MapRouteResult> {
    const parsed = MapRouteRequestSchema.safeParse(rawRequest);
    if (!parsed.success)
      throw new MapValidationError('Invalid mapping route request');
    const { origin, destination, mode } = parsed.data;
    const sourceUrl = new URL('https://example.test/deterministic-route');
    sourceUrl.searchParams.set('mode', mode);
    const navigationUrl = new URL('https://example.test/directions');
    navigationUrl.searchParams.set('from', `${origin.lat},${origin.lon}`);
    navigationUrl.searchParams.set(
      'to',
      `${destination.lat},${destination.lon}`,
    );
    const distanceMeters =
      Math.sqrt(
        (origin.lat - destination.lat) ** 2 +
          (origin.lon - destination.lon) ** 2,
      ) * 111_000;
    const durationSeconds =
      distanceMeters / (mode === 'walking' ? 1.4 : mode === 'cycling' ? 4 : 13);
    if (
      distanceMeters > MAP_LIMITS.maxRouteDistanceMeters ||
      durationSeconds > 7 * 24 * 60 * 60
    ) {
      throw new MapError('unsupported', 'Deterministic route exceeds bounds');
    }
    return {
      route: {
        mode,
        origin,
        destination,
        distanceMeters,
        durationSeconds,
        geometry: {
          type: 'LineString',
          coordinates: [
            [origin.lon, origin.lat],
            [destination.lon, destination.lat],
          ],
        },
        sourceUrl: sourceUrl.toString(),
        navigationUrl: navigationUrl.toString(),
        provider: this.id,
        attribution: this.attribution,
      },
      provider: this.id,
      attribution: this.attribution,
      retrievedAt: resultTime(),
    };
  }

  search = this.searchPlaces.bind(this);
  searchNearby = this.searchPlaces.bind(this);
  details = this.getPlaceDetails.bind(this);
  route = this.getRoute.bind(this);
}

export function isDeterministicMappingProviderEnabled(): boolean {
  return (
    process.env.YAAWC_TEST_MODE === 'true' ||
    process.env.YAAWC_TEST_MAPPING_PROVIDER === 'true'
  );
}

export interface DeterministicMapProviderOptions {
  /** Explicitly enabled only by test seams; production defaults stay gated. */
  enabled?: boolean;
}

export function createTestMappingProvider(
  options: DeterministicMapProviderOptions = {},
): DeterministicMapProvider | null {
  const enabled = options.enabled ?? isDeterministicMappingProviderEnabled();
  return enabled ? new DeterministicMapProvider() : null;
}

export function getTestMappingProvider(
  options: DeterministicMapProviderOptions = {},
): DeterministicMapProvider | null {
  return createTestMappingProvider(options);
}
