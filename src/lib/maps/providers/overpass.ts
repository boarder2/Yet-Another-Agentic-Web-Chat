import {
  MAP_LIMITS,
  MapAttributionSchema,
  MapPlaceSchema,
  MapPlaceSearchRequestSchema,
  assertCoordinate,
  clampPlaceLimit,
  clampRadiusMeters,
  normalizeCoordinate,
  type MapCoordinate,
  type MapPlace,
  type MapPlaceSearchRequest,
  type MapPlaceSearchResult,
} from '../types';
import {
  MapError,
  MapValidationError,
  defaultMapRequestClient,
} from '../request';
import type { MapRequestClientLike } from '../request';
import {
  DEFAULT_MAP_USER_AGENT,
  normalizeMappingEndpoint,
  PUBLIC_MAP_DEFAULTS,
} from '../config';
import type { MapProviderClientOptions } from './types';

export const OVERPASS_ATTRIBUTION = '© OpenStreetMap contributors';

export type OverpassCategory =
  | 'restaurant'
  | 'cafe'
  | 'bar'
  | 'hotel'
  | 'bank'
  | 'pharmacy'
  | 'hospital'
  | 'supermarket'
  | 'shop'
  | 'fuel'
  | 'parking'
  | 'school'
  | 'park'
  | 'museum'
  | 'attraction'
  | 'business';

type OverpassFilter = { key: string; value?: string };

/** Only these fixed filters may reach the Overpass query language. */
export const OVERPASS_CATEGORY_TAXONOMY: Readonly<
  Record<OverpassCategory, readonly OverpassFilter[]>
> = {
  restaurant: [{ key: 'amenity', value: 'restaurant' }],
  cafe: [{ key: 'amenity', value: 'cafe' }],
  bar: [{ key: 'amenity', value: 'bar' }],
  hotel: [{ key: 'tourism', value: 'hotel' }],
  bank: [{ key: 'amenity', value: 'bank' }],
  pharmacy: [{ key: 'amenity', value: 'pharmacy' }],
  hospital: [{ key: 'amenity', value: 'hospital' }],
  supermarket: [{ key: 'shop', value: 'supermarket' }],
  shop: [{ key: 'shop' }],
  fuel: [{ key: 'amenity', value: 'fuel' }],
  parking: [{ key: 'amenity', value: 'parking' }],
  school: [{ key: 'amenity', value: 'school' }],
  park: [{ key: 'leisure', value: 'park' }],
  museum: [{ key: 'tourism', value: 'museum' }],
  attraction: [
    { key: 'tourism', value: 'attraction' },
    { key: 'tourism', value: 'viewpoint' },
  ],
  business: [{ key: 'amenity' }, { key: 'shop' }, { key: 'tourism' }],
};

interface OverpassElement {
  type?: unknown;
  id?: unknown;
  lat?: unknown;
  lon?: unknown;
  center?: unknown;
  tags?: unknown;
}

export interface OverpassClientOptions {
  endpoint?: string;
  requestClient?: MapRequestClientLike;
  attribution?: string;
  userAgent?: string;
  timeoutSeconds?: number;
}

function validateUserAgent(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (
    normalized.length === 0 ||
    normalized.length > 300 ||
    /[\r\n\u0000]/.test(normalized)
  ) {
    throw new MapValidationError('Mapping user agent is invalid');
  }
  return normalized;
}

function validateAttribution(value: unknown): string {
  const parsed = MapAttributionSchema.safeParse(value);
  if (!parsed.success)
    throw new MapValidationError('Mapping attribution is invalid');
  return parsed.data;
}

function categoryKey(value: string): value is OverpassCategory {
  return Object.prototype.hasOwnProperty.call(
    OVERPASS_CATEGORY_TAXONOMY,
    value,
  );
}

const CATEGORY_ALIASES: Record<string, OverpassCategory> = {
  coffee: 'cafe',
  coffee_shop: 'cafe',
  gas_station: 'fuel',
  grocery: 'supermarket',
  groceries: 'supermarket',
  landmark: 'attraction',
};

export function normalizeOverpassCategory(value: unknown): OverpassCategory {
  if (typeof value !== 'string') {
    throw new MapValidationError('Unsupported nearby-place category');
  }
  const normalized = value.trim().toLowerCase();
  const category = CATEGORY_ALIASES[normalized] ?? normalized;
  if (!categoryKey(category)) {
    throw new MapValidationError('Unsupported nearby-place category');
  }
  return category;
}

function fixedCoordinate(value: number): string {
  return value.toFixed(6);
}

/** Build a bounded query from the fixed category taxonomy, never raw model text. */
export function buildOverpassQuery(input: {
  center?: MapCoordinate;
  lat?: number;
  lon?: number;
  radiusMeters?: number;
  category: OverpassCategory | string;
  timeoutSeconds?: number;
}): string {
  const center = assertCoordinate(
    input.center ?? { lat: input.lat, lon: input.lon },
    'nearby center',
  );
  const category = normalizeOverpassCategory(input.category);
  const radius = clampRadiusMeters(input.radiusMeters);
  const requestedTimeout = input.timeoutSeconds ?? 10;
  const timeout = Number.isFinite(requestedTimeout)
    ? Math.max(1, Math.min(25, Math.trunc(requestedTimeout)))
    : 10;
  const filters = OVERPASS_CATEGORY_TAXONOMY[category];
  const clauses = filters.map(({ key, value }) => {
    const filter = value ? `["${key}"="${value}"]` : `["${key}"]`;
    return `nwr(around:${radius},${fixedCoordinate(center.lat)},${fixedCoordinate(center.lon)})${filter};`;
  });
  return `[out:json][timeout:${timeout}];\n(\n${clauses.join('\n')}\n);\nout center;`;
}

function stringValue(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const result = value.replace(/\s+/g, ' ').trim();
  return result && result.length <= maxLength ? result : undefined;
}

function numericValue(value: unknown): number | undefined {
  if (typeof value === 'number')
    return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const result = Number(value);
  return Number.isFinite(result) ? result : undefined;
}

function elementCoordinate(element: OverpassElement): MapCoordinate | null {
  const direct = normalizeCoordinate({ lat: element.lat, lon: element.lon });
  if (direct) return direct;
  return normalizeCoordinate(element.center);
}

function elementId(element: OverpassElement): string | undefined {
  const type = element.type;
  if (type !== 'node' && type !== 'way' && type !== 'relation')
    return undefined;
  const id =
    typeof element.id === 'number'
      ? Number.isSafeInteger(element.id) && element.id > 0
        ? String(element.id)
        : undefined
      : typeof element.id === 'string' && /^[1-9]\d{0,18}$/.test(element.id)
        ? element.id
        : undefined;
  return id ? `${type}/${id}` : undefined;
}

function addressFromTags(tags: Record<string, unknown>): string | undefined {
  const parts = [
    [tags['addr:housenumber'], tags['addr:street']].filter(
      (part): part is string =>
        typeof part === 'string' && Boolean(part.trim()),
    ),
    [
      tags['addr:postcode'],
      tags['addr:city'] ?? tags['addr:town'] ?? tags['addr:village'],
    ].filter(
      (part): part is string =>
        typeof part === 'string' && Boolean(part.trim()),
    ),
  ].flat();
  return stringValue(parts.join(', '), MAP_LIMITS.maxAddressLength);
}

function safeUrl(value: unknown): string | undefined {
  const candidate = stringValue(value, MAP_LIMITS.maxUrlLength);
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username ||
      url.password
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function categoryFromTags(tags: Record<string, unknown>): string | undefined {
  for (const key of ['amenity', 'shop', 'tourism', 'leisure']) {
    const value = stringValue(tags[key], MAP_LIMITS.maxCategoryLength);
    if (value) return value;
  }
  return undefined;
}

function nameFromTags(tags: Record<string, unknown>): string | undefined {
  return (
    stringValue(tags.name, 240) ??
    stringValue(tags['name:en'], 240) ??
    stringValue(tags.brand, 240)
  );
}

export function normalizeOverpassElement(
  element: unknown,
  attribution = OVERPASS_ATTRIBUTION,
): MapPlace | null {
  if (
    element === null ||
    typeof element !== 'object' ||
    Array.isArray(element)
  ) {
    return null;
  }
  const record = element as OverpassElement;
  const id = elementId(record);
  const coordinate = elementCoordinate(record);
  const tags =
    record.tags !== null &&
    typeof record.tags === 'object' &&
    !Array.isArray(record.tags)
      ? (record.tags as Record<string, unknown>)
      : null;
  if (!id || !coordinate || !tags) return null;
  const name = nameFromTags(tags);
  if (!name) return null;

  const rating = numericValue(tags.rating ?? tags['stars']);
  const reviewCount = numericValue(tags.review_count);
  const place = {
    id,
    name,
    coordinate,
    ...(addressFromTags(tags) ? { address: addressFromTags(tags) } : {}),
    ...(categoryFromTags(tags) ? { category: categoryFromTags(tags) } : {}),
    sourceUrl: `https://www.openstreetmap.org/${id}`,
    ...(safeUrl(tags.website ?? tags['contact:website'])
      ? { websiteUrl: safeUrl(tags.website ?? tags['contact:website']) }
      : {}),
    ...(stringValue(tags.phone ?? tags['contact:phone'], 100)
      ? { phone: stringValue(tags.phone ?? tags['contact:phone'], 100) }
      : {}),
    ...(stringValue(tags.opening_hours, 500)
      ? { openingHours: stringValue(tags.opening_hours, 500) }
      : {}),
    ...(rating !== undefined && rating >= 0 && rating <= 5 ? { rating } : {}),
    ...(reviewCount !== undefined &&
    Number.isInteger(reviewCount) &&
    reviewCount >= 0 &&
    reviewCount <= 100_000_000
      ? { reviewCount }
      : {}),
    provider: 'openstreetmap',
    attribution,
  } satisfies MapPlace;
  const parsed = MapPlaceSchema.safeParse(place);
  return parsed.success ? parsed.data : null;
}

export class OverpassClient {
  readonly endpoint: string;
  readonly attribution: string;
  readonly userAgent: string;
  private readonly requestClient: MapRequestClientLike;
  private readonly timeoutSeconds: number;

  constructor(options: OverpassClientOptions = {}) {
    const endpoint = options.endpoint ?? PUBLIC_MAP_DEFAULTS.placesUrl;
    const normalized = normalizeMappingEndpoint(endpoint, 'mapping places URL');
    if (normalized.error) throw new MapValidationError(normalized.error);
    this.endpoint = normalized.value;
    this.attribution = validateAttribution(
      options.attribution ?? OVERPASS_ATTRIBUTION,
    );
    this.userAgent = validateUserAgent(
      options.userAgent ?? DEFAULT_MAP_USER_AGENT,
    );
    this.requestClient = options.requestClient ?? defaultMapRequestClient;
    const timeoutSeconds = options.timeoutSeconds ?? 10;
    this.timeoutSeconds = Number.isFinite(timeoutSeconds)
      ? Math.max(1, Math.min(25, Math.trunc(timeoutSeconds)))
      : 10;
  }

  async searchNearby(
    rawRequest: MapPlaceSearchRequest,
    options: MapProviderClientOptions = {},
  ): Promise<MapPlaceSearchResult> {
    const parsed = MapPlaceSearchRequestSchema.safeParse(rawRequest);
    if (!parsed.success)
      throw new MapValidationError('Invalid mapping place search request');
    const request = parsed.data;
    if (!request.center)
      throw new MapValidationError('A nearby search center is required');
    const category = normalizeOverpassCategory(request.category ?? 'business');
    const query = buildOverpassQuery({
      center: request.center,
      radiusMeters: request.radiusMeters,
      category,
      timeoutSeconds: this.timeoutSeconds,
    });
    if (query.length > 20_000) {
      throw new MapValidationError('Nearby mapping request is too long');
    }

    const payload = await this.requestClient.json<unknown>(this.endpoint, {
      method: 'POST',
      body: new URLSearchParams({ data: query }).toString(),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': this.userAgent,
      },
      signal: options.signal,
      maxBytes: 1_500_000,
    });
    if (
      payload === null ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      !Array.isArray((payload as { elements?: unknown }).elements)
    ) {
      throw new MapError(
        'malformed_response',
        'Overpass returned malformed data',
      );
    }

    const places: MapPlace[] = [];
    const elements = (payload as { elements: unknown[] }).elements;
    for (const element of elements.slice(0, MAP_LIMITS.maxPlaces * 3)) {
      const place = normalizeOverpassElement(element, this.attribution);
      if (place) places.push(place);
      if (places.length >= clampPlaceLimit(request.limit)) break;
    }
    return {
      places,
      query: request.query,
      provider: 'openstreetmap',
      attribution: this.attribution,
      retrievedAt: new Date().toISOString(),
    };
  }

  searchPlaces = this.searchNearby.bind(this);
  nearby = this.searchNearby.bind(this);
}
