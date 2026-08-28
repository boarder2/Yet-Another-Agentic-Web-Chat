import { z } from 'zod';
import {
  MAP_LIMITS,
  MAP_ROUTE_MODES,
  MapAttributionSchema,
  MapRouteRequestSchema,
  MapRouteSchema,
  assertCoordinate,
  type GeoJsonLineString,
  type MapCoordinate,
  type MapRoute,
  type MapRouteMode,
  type MapRouteRequest,
  type MapRouteResult,
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

export const OSRM_ATTRIBUTION = '© OpenStreetMap contributors';
export const OSRM_MAX_WAYPOINTS = 2;

interface OsrmRouteRecord {
  distance?: unknown;
  duration?: unknown;
  geometry?: unknown;
}

interface OsrmResponse {
  code?: unknown;
  message?: unknown;
  routes?: unknown;
}

// Provider responses can contain more points than the persistable/renderable
// route cap. Bound the raw parse separately, then simplify before validation.
const RawGeoJsonLineStringSchema = z.object({
  type: z.literal('LineString'),
  coordinates: z
    .array(
      z.tuple([
        z.number().finite().min(-180).max(180),
        z.number().finite().min(-90).max(90),
      ]),
    )
    .min(2)
    .max(20_000),
});

export interface OsrmClientOptions {
  endpoint?: string;
  profile?: string;
  profiles?: Partial<Record<MapRouteMode, string>>;
  requestClient?: MapRequestClientLike;
  attribution?: string;
  userAgent?: string;
  maxGeometryPoints?: number;
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

function numericValue(value: unknown): number | undefined {
  if (typeof value !== 'number') return undefined;
  return Number.isFinite(value) ? value : undefined;
}

function routeProfile(value: string | undefined, mode: MapRouteMode): string {
  const profile = typeof value === 'string' ? value.trim() : '';
  if (!profile || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(profile)) {
    throw new MapValidationError(
      `No valid routing profile is configured for ${mode}`,
    );
  }
  return profile;
}

function coordinatePair(coordinate: MapCoordinate): string {
  return `${coordinate.lon.toFixed(6)},${coordinate.lat.toFixed(6)}`;
}

function pointDistanceSquared(
  a: [number, number],
  b: [number, number],
): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

// Routing services may snap an input to a nearby road, but a route whose
// geometry starts or ends far away is a malformed response, not a valid snap.
export const MAX_ROUTE_ENDPOINT_OFFSET_METERS = 5_000;

function endpointDistanceMeters(
  position: [number, number],
  coordinate: MapCoordinate,
): number {
  const earthRadiusMeters = 6_371_000;
  const toRadians = (value: number) => value * (Math.PI / 180);
  const latitude = toRadians(position[1]);
  const requestedLatitude = toRadians(coordinate.lat);
  const deltaLatitude = requestedLatitude - latitude;
  const deltaLongitude = toRadians(coordinate.lon - position[0]);
  const sineLatitude = Math.sin(deltaLatitude / 2);
  const sineLongitude = Math.sin(deltaLongitude / 2);
  const haversine =
    sineLatitude * sineLatitude +
    Math.cos(latitude) *
      Math.cos(requestedLatitude) *
      sineLongitude *
      sineLongitude;
  return (
    earthRadiusMeters *
    2 *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(Math.max(0, 1 - haversine)))
  );
}

function geometryMatchesRequest(
  geometry: GeoJsonLineString,
  request: MapRouteRequest,
): boolean {
  const first = geometry.coordinates[0];
  const last = geometry.coordinates[geometry.coordinates.length - 1];
  return (
    endpointDistanceMeters(first, request.origin) <=
      MAX_ROUTE_ENDPOINT_OFFSET_METERS &&
    endpointDistanceMeters(last, request.destination) <=
      MAX_ROUTE_ENDPOINT_OFFSET_METERS
  );
}

function perpendicularDistanceSquared(
  point: [number, number],
  start: [number, number],
  end: [number, number],
): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) return pointDistanceSquared(point, start);
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) /
        (dx * dx + dy * dy),
    ),
  );
  return pointDistanceSquared(point, [start[0] + t * dx, start[1] + t * dy]);
}

function simplifyPositions(
  positions: [number, number][],
  toleranceSquared: number,
): [number, number][] {
  if (positions.length <= 2) return positions;

  // Keep Douglas–Peucker iterative: the raw provider response is bounded, but
  // a deliberately zig-zagged 20,000-point line must not consume the call
  // stack before the route cap can be applied.
  const keep = new Uint8Array(positions.length);
  keep[0] = 1;
  keep[positions.length - 1] = 1;
  const ranges: Array<[number, number]> = [[0, positions.length - 1]];
  while (ranges.length > 0) {
    const [startIndex, endIndex] = ranges.pop() as [number, number];
    const start = positions[startIndex];
    const end = positions[endIndex];
    let maxDistance = toleranceSquared;
    let splitIndex = -1;
    for (let i = startIndex + 1; i < endIndex; i++) {
      const distance = perpendicularDistanceSquared(positions[i], start, end);
      if (distance > maxDistance) {
        maxDistance = distance;
        splitIndex = i;
      }
    }
    if (splitIndex >= 0) {
      keep[splitIndex] = 1;
      ranges.push([startIndex, splitIndex], [splitIndex, endIndex]);
    }
  }
  return positions.filter((_, index) => keep[index] === 1);
}

/** Simplify a route while preserving valid GeoJSON order and both endpoints. */
export function simplifyRouteGeometry(
  geometry: unknown,
  maxPoints: number = MAP_LIMITS.maxRouteGeometryPoints,
): GeoJsonLineString {
  const parsed = RawGeoJsonLineStringSchema.safeParse(geometry);
  if (!parsed.success) {
    throw new MapValidationError('Route geometry is invalid');
  }
  const points = parsed.data.coordinates;
  const requestedCap = Number.isFinite(maxPoints)
    ? Math.trunc(maxPoints)
    : MAP_LIMITS.maxRouteGeometryPoints;
  const cap = Math.max(
    2,
    Math.min(MAP_LIMITS.maxRouteGeometryPoints, requestedCap),
  );
  if (points.length <= cap) return parsed.data;

  let simplified = simplifyPositions(points, 0);
  let tolerance = 1e-12;
  while (simplified.length > cap && tolerance < 1) {
    simplified = simplifyPositions(points, tolerance);
    tolerance *= 4;
  }
  if (simplified.length > cap) {
    const sampled: [number, number][] = [];
    for (let i = 0; i < cap; i++) {
      const index = Math.round((i * (points.length - 1)) / (cap - 1));
      sampled.push(points[index]);
    }
    simplified = sampled;
  }

  return {
    type: 'LineString',
    coordinates: simplified,
  };
}

function routeSourceUrl(
  endpoint: string,
  profile: string,
  origin: MapCoordinate,
  destination: MapCoordinate,
): string {
  const url = new URL(
    `${endpoint}/route/v1/${profile}/${coordinatePair(origin)};${coordinatePair(destination)}`,
  );
  url.searchParams.set('overview', 'full');
  url.searchParams.set('geometries', 'geojson');
  url.searchParams.set('steps', 'false');
  url.searchParams.set('alternatives', 'false');
  return url.toString();
}

function navigationUrl(
  profile: string,
  origin: MapCoordinate,
  destination: MapCoordinate,
): string {
  const url = new URL('https://www.openstreetmap.org/directions');
  url.searchParams.set('engine', `fossgis_osrm_${profile}`);
  url.searchParams.set(
    'route',
    `${origin.lat.toFixed(6)},${origin.lon.toFixed(6)};${destination.lat.toFixed(6)},${destination.lon.toFixed(6)}`,
  );
  return url.toString();
}

export function normalizeOsrmRoute(
  payload: unknown,
  request: MapRouteRequest,
  options: {
    endpoint: string;
    profile: string;
    provider?: string;
    attribution?: string;
    maxGeometryPoints?: number;
  },
): MapRoute {
  const parsedRequest = MapRouteRequestSchema.safeParse(request);
  if (!parsedRequest.success)
    throw new MapValidationError('Invalid mapping route request');
  const validatedRequest = parsedRequest.data;
  const normalizedEndpoint = normalizeMappingEndpoint(
    options.endpoint,
    'mapping routing URL',
  );
  if (normalizedEndpoint.error)
    throw new MapValidationError(normalizedEndpoint.error);
  const normalizedProfile = routeProfile(
    options.profile,
    validatedRequest.mode,
  );
  const attribution = validateAttribution(
    options.attribution ?? OSRM_ATTRIBUTION,
  );

  if (
    payload === null ||
    typeof payload !== 'object' ||
    Array.isArray(payload)
  ) {
    throw new MapError(
      'malformed_response',
      'Routing provider returned malformed data',
    );
  }
  const response = payload as OsrmResponse;
  if (response.code !== 'Ok' || !Array.isArray(response.routes)) {
    if (response.code === 'NoRoute') {
      throw new MapError('not_found', 'No route was found for those locations');
    }
    throw new MapError(
      'malformed_response',
      'Routing provider returned no usable route',
    );
  }
  const first = response.routes[0] as OsrmRouteRecord | undefined;
  if (!first || typeof first !== 'object') {
    throw new MapError('not_found', 'No route was found for those locations');
  }
  const distanceMeters = numericValue(first.distance);
  const durationSeconds = numericValue(first.duration);
  const geometry = RawGeoJsonLineStringSchema.safeParse(first.geometry);
  if (
    distanceMeters === undefined ||
    durationSeconds === undefined ||
    distanceMeters < 0 ||
    durationSeconds < 0 ||
    distanceMeters > MAP_LIMITS.maxRouteDistanceMeters ||
    durationSeconds > 7 * 24 * 60 * 60 ||
    !geometry.success
  ) {
    throw new MapError(
      'malformed_response',
      'Routing provider returned an invalid route',
    );
  }
  if (!geometryMatchesRequest(geometry.data, validatedRequest)) {
    throw new MapError(
      'malformed_response',
      'Routing provider returned a route for different endpoints',
    );
  }

  const simplified = simplifyRouteGeometry(
    geometry.data,
    options.maxGeometryPoints ?? MAP_LIMITS.maxRouteGeometryPoints,
  );
  const route = {
    mode: validatedRequest.mode,
    origin: assertCoordinate(validatedRequest.origin, 'route origin'),
    destination: assertCoordinate(
      validatedRequest.destination,
      'route destination',
    ),
    distanceMeters,
    durationSeconds,
    geometry: simplified,
    sourceUrl: routeSourceUrl(
      normalizedEndpoint.value,
      normalizedProfile,
      validatedRequest.origin,
      validatedRequest.destination,
    ),
    navigationUrl: navigationUrl(
      normalizedProfile,
      validatedRequest.origin,
      validatedRequest.destination,
    ),
    provider: options.provider ?? 'openstreetmap',
    attribution,
  } satisfies MapRoute;
  const parsed = MapRouteSchema.safeParse(route);
  if (!parsed.success) {
    throw new MapError(
      'malformed_response',
      'Routing provider returned an invalid route',
    );
  }
  return parsed.data;
}

export class OsrmClient {
  readonly endpoint: string;
  readonly profiles: Partial<Record<MapRouteMode, string>>;
  readonly attribution: string;
  readonly userAgent: string;
  private readonly requestClient: MapRequestClientLike;
  private readonly maxGeometryPoints: number;

  constructor(options: OsrmClientOptions = {}) {
    const endpoint = options.endpoint ?? PUBLIC_MAP_DEFAULTS.routingUrl;
    const normalized = normalizeMappingEndpoint(
      endpoint,
      'mapping routing URL',
    );
    if (normalized.error) throw new MapValidationError(normalized.error);
    this.endpoint = normalized.value;
    this.profiles = {
      driving:
        options.profiles?.driving ??
        options.profile ??
        PUBLIC_MAP_DEFAULTS.routingProfile,
      ...(options.profiles?.walking
        ? { walking: options.profiles.walking }
        : {}),
      ...(options.profiles?.cycling
        ? { cycling: options.profiles.cycling }
        : {}),
    };
    for (const mode of MAP_ROUTE_MODES) {
      const profile = this.profiles[mode];
      if (profile !== undefined) routeProfile(profile, mode);
    }
    this.attribution = validateAttribution(
      options.attribution ?? OSRM_ATTRIBUTION,
    );
    this.userAgent = validateUserAgent(
      options.userAgent ?? DEFAULT_MAP_USER_AGENT,
    );
    this.requestClient = options.requestClient ?? defaultMapRequestClient;
    const requestedGeometryPoints =
      options.maxGeometryPoints ?? MAP_LIMITS.maxRouteGeometryPoints;
    this.maxGeometryPoints = Number.isFinite(requestedGeometryPoints)
      ? Math.max(
          2,
          Math.min(
            MAP_LIMITS.maxRouteGeometryPoints,
            Math.trunc(requestedGeometryPoints),
          ),
        )
      : MAP_LIMITS.maxRouteGeometryPoints;
  }

  async route(
    rawRequest: MapRouteRequest,
    options: MapProviderClientOptions = {},
  ): Promise<MapRouteResult> {
    const parsed = MapRouteRequestSchema.safeParse(rawRequest);
    if (!parsed.success)
      throw new MapValidationError('Invalid mapping route request');
    const request = parsed.data;
    const origin = assertCoordinate(request.origin, 'route origin');
    const destination = assertCoordinate(
      request.destination,
      'route destination',
    );
    const profile = routeProfile(this.profiles[request.mode], request.mode);
    const url = routeSourceUrl(this.endpoint, profile, origin, destination);
    if (url.length > MAP_LIMITS.maxUrlLength) {
      throw new MapValidationError('Routing request is too long');
    }

    const payload = await this.requestClient.json<unknown>(url, {
      signal: options.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': this.userAgent,
      },
      maxBytes: 1_500_000,
    });
    const route = normalizeOsrmRoute(
      payload,
      { origin, destination, mode: request.mode },
      {
        endpoint: this.endpoint,
        profile,
        provider: 'openstreetmap',
        attribution: this.attribution,
        maxGeometryPoints: this.maxGeometryPoints,
      },
    );
    return {
      route,
      provider: 'openstreetmap',
      attribution: this.attribution,
      retrievedAt: new Date().toISOString(),
    };
  }

  getRoute = this.route.bind(this);
}
