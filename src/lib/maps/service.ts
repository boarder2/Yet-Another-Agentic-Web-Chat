import 'server-only';

import {
  MapPlaceDetailsRequestSchema,
  MapPlaceDetailsResultSchema,
  MapPlaceSearchRequestSchema,
  MapPlaceSearchResultSchema,
  MapRouteRequestSchema,
  MapRouteResultSchema,
  type MapPlace,
  type MapPlaceDetailsRequest,
  type MapPlaceDetailsResult,
  type MapPlaceSearchRequest,
  type MapPlaceSearchResult,
  type MapProviderCapabilities,
  type MapRouteRequest,
  type MapRouteResult,
} from './types';
import {
  resolveMappingConfiguration,
  type MappingConfiguration,
} from './config';
import { getMappingConfiguration } from '@/lib/settings/server';
import { MapError, MapValidationError, sanitizeMapError } from './request';
import {
  classifyMapCache,
  hashMapCacheKey,
  isLikelyExactAddress,
  mapCacheStore,
  sensitiveMapCache,
  type BoundedMapMemoryCache,
  type MapCacheStorage,
  type MapCacheStore,
} from './cache';
import {
  createOpenStreetMapProvider,
  OpenStreetMapProvider,
} from './providers/openStreetMap';
import {
  createTestMappingProvider,
  type DeterministicMapProvider,
} from './providers/test';
import type { MapProvider } from './providers/types';

export interface MappingServiceOptions {
  provider?: MapProvider;
  durableCache?: MapCacheStore;
  memoryCache?: BoundedMapMemoryCache;
  useCache?: boolean;
}

function isMappingConfiguration(
  value: MappingConfiguration | MapProvider,
): value is MappingConfiguration {
  return (
    value !== null &&
    typeof value === 'object' &&
    'available' in value &&
    'endpoints' in value
  );
}

function providerForConfiguration(config: MappingConfiguration): MapProvider {
  if (config.provider === 'test') {
    // Availability was resolved (and environment-gated) before this factory
    // is reached. Passing the explicit gate avoids checking process.env twice
    // and keeps resolver test overrides deterministic.
    const provider = createTestMappingProvider({ enabled: true });
    if (!provider) {
      throw new MapError(
        'provider_unavailable',
        'The deterministic mapping provider is unavailable',
      );
    }
    return provider;
  }
  return createOpenStreetMapProvider({
    geocoderUrl: config.endpoints.geocoderUrl,
    placesUrl: config.endpoints.placesUrl,
    routingUrl: config.endpoints.routingUrl,
    routingProfile: config.routingProfile,
    routeProfiles: config.routeProfiles,
    tileAttribution: config.tileAttribution,
    userAgent: config.userAgent,
  });
}

function mappingConfigurationError(config: MappingConfiguration): MapError {
  if (!config.enabled || config.unavailableReason === 'disabled') {
    return new MapError('unsupported', 'Mapping is disabled');
  }
  if (config.unavailableReason === 'public_acknowledgement_required') {
    return new MapError(
      'invalid_configuration',
      'Public mapping services require acknowledgement',
    );
  }
  if (config.unavailableReason === 'invalid_configuration') {
    return new MapError(
      'invalid_configuration',
      'Mapping configuration is invalid',
    );
  }
  return new MapError(
    'provider_unavailable',
    'Mapping provider is unavailable',
  );
}

export function createMappingProvider(
  config: MappingConfiguration,
): MapProvider {
  if (!config.enabled || !config.available) {
    throw mappingConfigurationError(config);
  }
  return providerForConfiguration(config);
}

function validateSearchResult(
  value: MapPlaceSearchResult,
): MapPlaceSearchResult {
  const parsed = MapPlaceSearchResultSchema.safeParse(value);
  if (!parsed.success) {
    throw new MapError(
      'malformed_response',
      'Mapping provider returned malformed place data',
    );
  }
  return parsed.data;
}

function validateDetailsResult(
  value: MapPlaceDetailsResult,
): MapPlaceDetailsResult {
  const parsed = MapPlaceDetailsResultSchema.safeParse(value);
  if (!parsed.success) {
    throw new MapError(
      'malformed_response',
      'Mapping provider returned malformed place data',
    );
  }
  return parsed.data;
}

function validateRouteResult(value: MapRouteResult): MapRouteResult {
  const parsed = MapRouteResultSchema.safeParse(value);
  if (!parsed.success) {
    throw new MapError(
      'malformed_response',
      'Mapping provider returned malformed route data',
    );
  }
  return parsed.data;
}

function unsupportedMappingOperation(message: string): MapError {
  return new MapError('unsupported', message);
}

function cacheStorageForSearch(
  request: MapPlaceSearchRequest,
  result?: MapPlaceSearchResult,
): MapCacheStorage {
  const storage = classifyMapCache({
    operation: request.center
      ? 'nearby'
      : request.category
        ? 'business'
        : 'geocode',
    query: request.query,
    center: request.center,
    publicRecord: Boolean(request.category),
  });
  if (
    result &&
    storage === 'coarse_locality' &&
    result.places.some((place) => isExactAddressPlace(place))
  ) {
    return 'memory';
  }
  return storage;
}

// Details requests carry only a provider ID, so their cache class can only be
// established from the validated provider result. Unknown or non-business
// address records stay process-local; only explicit business/locality
// categories may enter the durable cache.
const PUBLIC_BUSINESS_CATEGORIES = new Set([
  'amenity',
  'attraction',
  'bar',
  'bank',
  'business',
  'cafe',
  'commercial',
  'craft',
  'education',
  'entertainment',
  'fuel',
  'healthcare',
  'hospital',
  'hotel',
  'leisure',
  'museum',
  'office',
  'parking',
  'pharmacy',
  'restaurant',
  'school',
  'service',
  'shop',
  'supermarket',
  'tourism',
]);

const COARSE_LOCALITY_CATEGORIES = new Set([
  'administrative',
  'borough',
  'city',
  'continent',
  'county',
  'country',
  'district',
  'hamlet',
  'island',
  'locality',
  'municipality',
  'neighbourhood',
  'place',
  'postcode',
  'quarter',
  'region',
  'state',
  'suburb',
  'town',
  'village',
]);

const EXACT_ADDRESS_CATEGORIES = new Set([
  'address',
  'building',
  'house',
  'residential',
]);

function isExactAddressPlace(place: MapPlace): boolean {
  const category = place.category?.trim().toLowerCase();
  if (category && PUBLIC_BUSINESS_CATEGORIES.has(category)) return false;
  // Nominatim can describe a named house as category "place" while the raw
  // type is "house". The normalized place intentionally does not expose that
  // raw field, so an addressed place must remain process-local.
  return Boolean(
    isLikelyExactAddress(place.address) ||
    (category && EXACT_ADDRESS_CATEGORIES.has(category)) ||
    (category === 'place' && place.address),
  );
}

function cacheStorageForDetails(
  result: MapPlaceDetailsResult,
): MapCacheStorage {
  const category = result.place.category?.trim().toLowerCase();
  if (category && PUBLIC_BUSINESS_CATEGORIES.has(category)) {
    return 'public_business';
  }
  if (isExactAddressPlace(result.place)) return 'memory';
  if (category && COARSE_LOCALITY_CATEGORIES.has(category)) {
    return 'coarse_locality';
  }
  return 'memory';
}

/** Provider access plus privacy-aware durable/memory cache policy. */
export class MappingService {
  readonly configuration: MappingConfiguration;
  readonly provider: MapProvider;
  private readonly durableCache: MapCacheStore;
  private readonly memoryCache: BoundedMapMemoryCache;
  private readonly useCache: boolean;

  constructor(
    configuration: MappingConfiguration,
    provider: MapProvider,
    options: MappingServiceOptions = {},
  ) {
    if (!configuration.enabled || !configuration.available) {
      throw mappingConfigurationError(configuration);
    }
    this.configuration = configuration;
    this.provider = provider;
    this.durableCache = options.durableCache ?? mapCacheStore;
    this.memoryCache = options.memoryCache ?? sensitiveMapCache;
    this.useCache = options.useCache !== false;
  }

  get capabilities(): MapProviderCapabilities {
    const configured = this.configuration.capabilities;
    const provider = this.provider.capabilities;
    const routeModes = provider.routeModes.filter((mode) =>
      configured.routeModes.includes(mode),
    );
    return {
      geocoding: configured.geocoding && provider.geocoding,
      nearby: configured.nearby && provider.nearby,
      placeDetails: configured.placeDetails && provider.placeDetails,
      routing: configured.routing && provider.routing && routeModes.length > 0,
      routeModes,
      tiles: configured.tiles && provider.tiles,
    };
  }

  async searchPlaces(
    rawRequest: MapPlaceSearchRequest,
    signal?: AbortSignal,
  ): Promise<MapPlaceSearchResult> {
    const parsed = MapPlaceSearchRequestSchema.safeParse(rawRequest);
    if (!parsed.success)
      throw new MapValidationError('Invalid mapping place search request');
    const request = parsed.data;
    if (request.center && !this.capabilities.nearby) {
      throw unsupportedMappingOperation(
        'This mapping provider does not support nearby search',
      );
    }
    if (!request.center && !this.capabilities.geocoding) {
      throw unsupportedMappingOperation(
        'This mapping provider does not support place search',
      );
    }
    const requestedStorage = cacheStorageForSearch(request);
    const cacheKey = hashMapCacheKey('places', request);
    if (this.useCache) {
      try {
        const cachedMemory =
          this.memoryCache.get<MapPlaceSearchResult>(cacheKey);
        const parsedMemory = cachedMemory
          ? MapPlaceSearchResultSchema.safeParse(cachedMemory)
          : null;
        if (parsedMemory?.success) return parsedMemory.data;

        if (requestedStorage === 'coarse_locality') {
          const cachedDurable = this.durableCache.get<MapPlaceSearchResult>(
            cacheKey,
            requestedStorage,
          );
          const parsedDurable = cachedDurable
            ? MapPlaceSearchResultSchema.safeParse(cachedDurable)
            : null;
          if (
            parsedDurable?.success &&
            cacheStorageForSearch(request, parsedDurable.data) ===
              'coarse_locality'
          ) {
            return parsedDurable.data;
          }
        }
      } catch {
        // A stale/corrupt cache must never make the provider unavailable.
      }
    }

    try {
      const result = validateSearchResult(
        await this.provider.searchPlaces(request, { signal }),
      );
      const storage = cacheStorageForSearch(request, result);
      if (this.useCache) {
        try {
          if (storage === 'coarse_locality') {
            this.durableCache.set(cacheKey, storage, result);
          } else {
            this.memoryCache.set(cacheKey, result);
          }
        } catch {
          // Caching is best-effort and independent from a successful lookup.
        }
      }
      return result;
    } catch (error) {
      throw sanitizeMapError(error);
    }
  }

  async getPlaceDetails(
    rawRequest: MapPlaceDetailsRequest,
    signal?: AbortSignal,
  ): Promise<MapPlaceDetailsResult> {
    const parsed = MapPlaceDetailsRequestSchema.safeParse(rawRequest);
    if (!parsed.success)
      throw new MapValidationError('Invalid mapping place request');
    const request = parsed.data;
    if (!this.capabilities.placeDetails) {
      throw unsupportedMappingOperation(
        'This mapping provider does not support place details',
      );
    }
    const cacheKey = hashMapCacheKey('place-details', request);
    if (this.useCache) {
      try {
        const cachedMemory =
          this.memoryCache.get<MapPlaceDetailsResult>(cacheKey);
        const parsedMemory = cachedMemory
          ? MapPlaceDetailsResultSchema.safeParse(cachedMemory)
          : null;
        if (parsedMemory?.success) return parsedMemory.data;

        // Durable details rows predate result-based classification, so verify
        // the cached record before returning it. This also refuses a legacy
        // exact-address row that was incorrectly stored as public_business.
        for (const kind of ['public_business', 'coarse_locality'] as const) {
          const cached = this.durableCache.get<MapPlaceDetailsResult>(
            cacheKey,
            kind,
          );
          const parsedCached = cached
            ? MapPlaceDetailsResultSchema.safeParse(cached)
            : null;
          if (
            parsedCached?.success &&
            cacheStorageForDetails(parsedCached.data) === kind
          ) {
            return parsedCached.data;
          }
        }
      } catch {
        // A stale/corrupt cache must never make the provider unavailable.
      }
    }

    try {
      const result = validateDetailsResult(
        await this.provider.getPlaceDetails(request, { signal }),
      );
      if (this.useCache) {
        try {
          const storage = cacheStorageForDetails(result);
          if (storage === 'memory') {
            this.memoryCache.set(cacheKey, result);
          } else {
            this.durableCache.set(cacheKey, storage, result);
          }
        } catch {
          // Caching is best-effort and independent from a successful lookup.
        }
      }
      return result;
    } catch (error) {
      throw sanitizeMapError(error);
    }
  }

  async getRoute(
    rawRequest: MapRouteRequest,
    signal?: AbortSignal,
  ): Promise<MapRouteResult> {
    const parsed = MapRouteRequestSchema.safeParse(rawRequest);
    if (!parsed.success)
      throw new MapValidationError('Invalid mapping route request');
    const request = parsed.data;
    if (!this.capabilities.routing) {
      throw unsupportedMappingOperation(
        'This mapping provider does not support routing',
      );
    }
    if (!this.capabilities.routeModes.includes(request.mode)) {
      throw unsupportedMappingOperation(
        `This mapping provider does not support ${request.mode} routes`,
      );
    }
    const cacheKey = hashMapCacheKey('route', request);
    if (this.useCache) {
      try {
        const cached = this.memoryCache.get<MapRouteResult>(cacheKey);
        const parsedCached = cached
          ? MapRouteResultSchema.safeParse(cached)
          : null;
        if (parsedCached?.success) return parsedCached.data;
      } catch {
        // A stale/corrupt cache must never make the provider unavailable.
      }
    }

    try {
      const result = validateRouteResult(
        await this.provider.getRoute(request, { signal }),
      );
      if (this.useCache) {
        try {
          this.memoryCache.set(cacheKey, result);
        } catch {
          // Caching is best-effort and independent from a successful lookup.
        }
      }
      return result;
    } catch (error) {
      throw sanitizeMapError(error);
    }
  }
}

export function createMappingService(
  configOrProvider: MappingConfiguration | MapProvider,
  options: MappingServiceOptions = {},
): MappingService {
  if (isMappingConfiguration(configOrProvider)) {
    const provider =
      options.provider ?? createMappingProvider(configOrProvider);
    return new MappingService(configOrProvider, provider, options);
  }
  const provider = options.provider ?? configOrProvider;
  const configuration = resolveMappingConfiguration(
    {
      mappingEnabled: 'true',
      mappingPublicServicesAcknowledged: 'true',
      mappingProvider: provider.id === 'test' ? 'test' : 'openstreetmap',
    },
    // An explicitly injected provider is already a test seam. The normal
    // factory path remains environment-gated when it has to construct one.
    { testProviderEnabled: provider.id === 'test' },
  );
  return new MappingService(configuration, provider, options);
}

export function createMappingServiceFromSettings(
  settings: Record<string, string>,
  options: MappingServiceOptions = {},
): MappingService {
  const configuration = resolveMappingConfiguration(settings);
  return createMappingService(configuration, options);
}

export function getMappingService(
  settings?: Record<string, string>,
  options: MappingServiceOptions = {},
): MappingService | null {
  const configuration =
    settings === undefined
      ? getMappingConfiguration()
      : resolveMappingConfiguration(settings);
  if (!configuration.available) return null;
  return createMappingService(configuration, options);
}

export type MappingProvider =
  OpenStreetMapProvider | DeterministicMapProvider | MapProvider;
