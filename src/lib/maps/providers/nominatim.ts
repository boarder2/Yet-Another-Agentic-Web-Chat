import {
  MAP_LIMITS,
  MapAttributionSchema,
  MapPlaceSchema,
  MapPlaceDetailsRequestSchema,
  MapPlaceSearchRequestSchema,
  clampPlaceLimit,
  type MapPlace,
  type MapPlaceDetailsRequest,
  type MapPlaceDetailsResult,
  type MapPlaceSearchRequest,
  type MapPlaceSearchResult,
  type MapCoordinate,
  normalizeCoordinate,
} from '../types';
import {
  MapError,
  MapValidationError,
  defaultMapRequestClient,
} from '../request';
import type { MapRequestClientLike } from '../request';
import {
  DEFAULT_MAP_USER_AGENT,
  PUBLIC_MAP_DEFAULTS,
  normalizeMappingEndpoint,
} from '../config';
import type { MapProviderClientOptions } from './types';

export const NOMINATIM_ATTRIBUTION = '© OpenStreetMap contributors';

interface NominatimSearchRecord {
  place_id?: unknown;
  osm_type?: unknown;
  osm_id?: unknown;
  display_name?: unknown;
  name?: unknown;
  localname?: unknown;
  lat?: unknown;
  lon?: unknown;
  centroid?: unknown;
  type?: unknown;
  category?: unknown;
  address?: unknown;
  extratags?: unknown;
  namedetails?: unknown;
  boundingbox?: unknown;
}

interface NominatimDetailsRecord extends NominatimSearchRecord {
  addresstype?: unknown;
  importance?: unknown;
}

export interface NominatimClientOptions {
  endpoint?: string;
  userAgent?: string;
  requestClient?: MapRequestClientLike;
  attribution?: string;
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

function stringValue(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const result = value.replace(/\s+/g, ' ').trim();
  if (!result || result.length > maxLength) return undefined;
  return result;
}

function numericString(value: unknown): number | undefined {
  if (typeof value === 'number')
    return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const result = Number(value);
  return Number.isFinite(result) ? result : undefined;
}

function osmType(value: unknown): 'node' | 'way' | 'relation' | undefined {
  if (value === 'node' || value === 'way' || value === 'relation') return value;
  if (value === 'N' || value === 'n') return 'node';
  if (value === 'W' || value === 'w') return 'way';
  if (value === 'R' || value === 'r') return 'relation';
  return undefined;
}

function osmId(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  if (typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value)) return value;
  return undefined;
}

export function nominatimPlaceId(
  type: unknown,
  id: unknown,
): string | undefined {
  const normalizedType = osmType(type);
  const normalizedId = osmId(id);
  return normalizedType && normalizedId
    ? `${normalizedType}/${normalizedId}`
    : undefined;
}

function sourceUrlFor(type: string, id: string): string {
  return `https://www.openstreetmap.org/${type}/${id}`;
}

function normalizeAddress(value: unknown): string | undefined {
  if (typeof value === 'string')
    return stringValue(value, MAP_LIMITS.maxAddressLength);
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const address = value as Record<string, unknown>;
  const orderedKeys = [
    'house_number',
    'road',
    'neighbourhood',
    'suburb',
    'city',
    'town',
    'village',
    'municipality',
    'state',
    'postcode',
    'country',
  ];
  const parts: string[] = [];
  for (const key of orderedKeys) {
    const part = stringValue(address[key], 120);
    if (part && !parts.includes(part)) parts.push(part);
  }
  return stringValue(parts.join(', '), MAP_LIMITS.maxAddressLength);
}

function normalizeWebsite(value: unknown): string | undefined {
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

function categoryFor(record: NominatimSearchRecord): string | undefined {
  return (
    stringValue(record.category, MAP_LIMITS.maxCategoryLength) ??
    stringValue(record.type, MAP_LIMITS.maxCategoryLength)
  );
}

function parseCoordinate(record: NominatimSearchRecord): MapCoordinate | null {
  return (
    normalizeCoordinate({ lat: record.lat, lon: record.lon }) ??
    normalizeCoordinate(record.centroid)
  );
}

function nameFromRecord(record: NominatimSearchRecord): string | undefined {
  const namedetails =
    record.namedetails !== null &&
    typeof record.namedetails === 'object' &&
    !Array.isArray(record.namedetails)
      ? (record.namedetails as Record<string, unknown>)
      : undefined;
  return (
    stringValue(record.localname, 240) ??
    stringValue(namedetails?.name, 240) ??
    stringValue(record.name, 240) ??
    stringValue(record.display_name, 240)
  );
}

function normalizeRecord(
  record: NominatimSearchRecord,
  attribution: string,
): MapPlace | null {
  if (record === null || typeof record !== 'object') return null;
  const id = nominatimPlaceId(record.osm_type, record.osm_id);
  const coordinate = parseCoordinate(record);
  const name = nameFromRecord(record);
  if (!id || !coordinate || !name) return null;

  const extra =
    record.extratags !== null &&
    typeof record.extratags === 'object' &&
    !Array.isArray(record.extratags)
      ? (record.extratags as Record<string, unknown>)
      : {};
  const rating = numericString(extra.rating);
  const reviewCount = numericString(extra.review_count ?? extra.reviews);
  const place = {
    id,
    name,
    coordinate,
    ...(normalizeAddress(record.address)
      ? { address: normalizeAddress(record.address) }
      : {}),
    ...(categoryFor(record) ? { category: categoryFor(record) } : {}),
    sourceUrl: sourceUrlFor(id.split('/')[0], id.split('/')[1]),
    ...(normalizeWebsite(extra.website ?? extra.contact_website)
      ? { websiteUrl: normalizeWebsite(extra.website ?? extra.contact_website) }
      : {}),
    ...(stringValue(extra.phone ?? extra['contact:phone'], 100)
      ? { phone: stringValue(extra.phone ?? extra['contact:phone'], 100) }
      : {}),
    ...(stringValue(extra.opening_hours, 500)
      ? { openingHours: stringValue(extra.opening_hours, 500) }
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

function normalizeRecords(payload: unknown, attribution: string): MapPlace[] {
  if (!Array.isArray(payload)) {
    throw new MapError(
      'malformed_response',
      'Nominatim returned malformed data',
    );
  }
  const places: MapPlace[] = [];
  for (const record of payload.slice(0, MAP_LIMITS.maxPlaces * 2)) {
    const place = normalizeRecord(record as NominatimSearchRecord, attribution);
    if (place) places.push(place);
    if (places.length >= MAP_LIMITS.maxPlaces) break;
  }
  return places;
}

function detailsParameters(placeId: string): {
  osmtype: string;
  osmid: string;
} {
  const match = /^(node|way|relation)\/([1-9]\d{0,18})$/.exec(placeId);
  if (!match) throw new MapValidationError('Invalid mapping place id');
  return {
    osmtype: match[1] === 'node' ? 'N' : match[1] === 'way' ? 'W' : 'R',
    osmid: match[2],
  };
}

export class NominatimClient {
  readonly endpoint: string;
  readonly userAgent: string;
  readonly attribution: string;
  private readonly requestClient: MapRequestClientLike;

  constructor(options: NominatimClientOptions = {}) {
    const endpoint = options.endpoint ?? PUBLIC_MAP_DEFAULTS.geocoderUrl;
    const normalized = normalizeMappingEndpoint(
      endpoint,
      'mapping geocoder URL',
    );
    if (normalized.error) throw new MapValidationError(normalized.error);
    this.endpoint = normalized.value;
    this.userAgent = validateUserAgent(
      options.userAgent ?? DEFAULT_MAP_USER_AGENT,
    );
    this.attribution = validateAttribution(
      options.attribution ?? NOMINATIM_ATTRIBUTION,
    );
    this.requestClient = options.requestClient ?? defaultMapRequestClient;
  }

  async search(
    rawRequest: MapPlaceSearchRequest,
    options: MapProviderClientOptions = {},
  ): Promise<MapPlaceSearchResult> {
    const parsed = MapPlaceSearchRequestSchema.safeParse(rawRequest);
    if (!parsed.success)
      throw new MapValidationError('Invalid mapping place search request');
    const request = parsed.data;
    const query = request.query?.trim();
    if (!query)
      throw new MapValidationError('A place search query is required');
    const url = new URL(`${this.endpoint}/search`);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('extratags', '1');
    url.searchParams.set('namedetails', '1');
    url.searchParams.set('limit', String(clampPlaceLimit(request.limit)));
    url.searchParams.set('q', query);
    if (url.toString().length > MAP_LIMITS.maxUrlLength) {
      throw new MapValidationError('Mapping search request is too long');
    }

    const payload = await this.requestClient.json<unknown>(url, {
      signal: options.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': this.userAgent,
      },
      maxBytes: 512_000,
    });
    const places = normalizeRecords(payload, this.attribution).slice(
      0,
      clampPlaceLimit(request.limit),
    );
    return {
      places,
      query,
      provider: 'openstreetmap',
      attribution: this.attribution,
      retrievedAt: new Date().toISOString(),
    };
  }

  async details(
    rawRequest: MapPlaceDetailsRequest,
    options: MapProviderClientOptions = {},
  ): Promise<MapPlaceDetailsResult> {
    const parsed = MapPlaceDetailsRequestSchema.safeParse(rawRequest);
    if (!parsed.success)
      throw new MapValidationError('Invalid mapping place request');
    const { osmtype, osmid } = detailsParameters(parsed.data.placeId.trim());
    const url = new URL(`${this.endpoint}/details`);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('extratags', '1');
    url.searchParams.set('namedetails', '1');
    url.searchParams.set('osmtype', osmtype);
    url.searchParams.set('osmid', osmid);
    if (url.toString().length > MAP_LIMITS.maxUrlLength) {
      throw new MapValidationError('Mapping place request is too long');
    }

    const payload = await this.requestClient.json<NominatimDetailsRecord>(url, {
      signal: options.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': this.userAgent,
      },
      maxBytes: 512_000,
    });
    const place = normalizeRecord(payload, this.attribution);
    if (!place)
      throw new MapError(
        'malformed_response',
        'Nominatim returned an invalid place',
      );
    return {
      place,
      provider: 'openstreetmap',
      attribution: this.attribution,
      retrievedAt: new Date().toISOString(),
    };
  }

  searchPlaces = this.search.bind(this);
  getPlaceDetails = this.details.bind(this);
  searchNearby = this.search.bind(this);
}

export function normalizeNominatimPlace(
  record: unknown,
  attribution = NOMINATIM_ATTRIBUTION,
): MapPlace | null {
  return normalizeRecord(record as NominatimSearchRecord, attribution);
}
