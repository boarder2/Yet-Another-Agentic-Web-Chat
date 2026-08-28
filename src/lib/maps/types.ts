import { z } from 'zod';

/** Hard bounds shared by every mapping adapter and result normalizer. */
export const MAP_LIMITS = {
  maxPlaces: 12,
  maxQueryLength: 240,
  maxAddressLength: 500,
  maxPlaceIdLength: 160,
  maxCategoryLength: 40,
  maxRadiusMeters: 50_000,
  maxRouteDistanceMeters: 20_100_000,
  maxRouteGeometryPoints: 500,
  maxResponseBytes: 2_000_000,
  maxUrlLength: 2_048,
  maxAttributionLength: 500,
} as const;

export const MAX_MAP_PLACES = MAP_LIMITS.maxPlaces;
export const MAX_ROUTE_GEOMETRY_POINTS = MAP_LIMITS.maxRouteGeometryPoints;
export const MAP_MAX_PLACES = MAP_LIMITS.maxPlaces;
export const MAP_MAX_ROUTE_GEOMETRY_POINTS = MAP_LIMITS.maxRouteGeometryPoints;

export const MAP_ROUTE_MODES = ['driving', 'walking', 'cycling'] as const;
export const MapRouteModeSchema = z.enum(MAP_ROUTE_MODES);
export type MapRouteMode = (typeof MAP_ROUTE_MODES)[number];

export const MAP_PROVIDER_IDS = ['openstreetmap', 'test'] as const;
export const MapProviderIdSchema = z.enum(MAP_PROVIDER_IDS);
export type MapProviderId = (typeof MAP_PROVIDER_IDS)[number];

export const MapCoordinateSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
});
export const CoordinateSchema = MapCoordinateSchema;
export type MapCoordinate = z.infer<typeof MapCoordinateSchema>;

function sanitizeDomainErrorMessage(message: string): string {
  return String(message)
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[redacted URL]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

export class MapDomainValidationError extends Error {
  readonly code = 'invalid_request' as const;
  readonly mapErrorCode = this.code;

  constructor(message: string) {
    super(sanitizeDomainErrorMessage(message));
    this.name = 'MapDomainValidationError';
  }
}

const GeoJsonPositionSchema = z
  .tuple([
    z.number().finite().min(-180).max(180),
    z.number().finite().min(-90).max(90),
  ])
  .transform(([lon, lat]) => [lon, lat] as [number, number]);

export const GeoJsonLineStringSchema = z.object({
  type: z.literal('LineString'),
  coordinates: z
    .array(GeoJsonPositionSchema)
    .min(2)
    .max(MAP_LIMITS.maxRouteGeometryPoints),
});
export type GeoJsonLineString = z.infer<typeof GeoJsonLineStringSchema>;

export const MapSafeUrlSchema = z
  .string()
  .min(1)
  .max(MAP_LIMITS.maxUrlLength)
  .refine((value) => !/[\u0000-\u001f\u007f<>]/.test(value), {
    message: 'URL contains unsupported characters',
  })
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }, 'URL must use http or https and must not contain credentials');

export const MapAttributionSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAP_LIMITS.maxAttributionLength)
  .refine(
    (value) => !/[\u0000-\u001f\u007f<>]/.test(value),
    'attribution contains unsupported characters',
  );

export const MapPlaceSchema = z.object({
  id: z.string().min(1).max(MAP_LIMITS.maxPlaceIdLength),
  name: z.string().trim().min(1).max(240),
  coordinate: MapCoordinateSchema,
  address: z.string().max(MAP_LIMITS.maxAddressLength).optional(),
  category: z.string().max(MAP_LIMITS.maxCategoryLength).optional(),
  sourceUrl: MapSafeUrlSchema,
  websiteUrl: MapSafeUrlSchema.optional(),
  phone: z.string().max(100).optional(),
  openingHours: z.string().max(500).optional(),
  rating: z.number().finite().min(0).max(5).optional(),
  reviewCount: z.number().int().min(0).max(100_000_000).optional(),
  provider: z.string().min(1).max(64),
  attribution: MapAttributionSchema,
});
export type MapPlace = z.infer<typeof MapPlaceSchema>;

export const MapRouteSchema = z.object({
  mode: z.enum(MAP_ROUTE_MODES),
  origin: MapCoordinateSchema,
  destination: MapCoordinateSchema,
  distanceMeters: z
    .number()
    .finite()
    .nonnegative()
    .max(MAP_LIMITS.maxRouteDistanceMeters),
  durationSeconds: z
    .number()
    .finite()
    .nonnegative()
    .max(7 * 24 * 60 * 60),
  geometry: GeoJsonLineStringSchema,
  sourceUrl: MapSafeUrlSchema,
  navigationUrl: MapSafeUrlSchema,
  provider: z.string().min(1).max(64),
  attribution: MapAttributionSchema,
});
export type MapRoute = z.infer<typeof MapRouteSchema>;

/** A validated, provider-grounded payload consumed by later map stream chunks. */
export const GeometrySchema = GeoJsonLineStringSchema;

export const MapSpecSchema = z.object({
  places: z.array(MapPlaceSchema).max(MAP_LIMITS.maxPlaces),
  /** Exact browser origin is present only when explicitly saved in this answer. */
  origin: MapCoordinateSchema.optional(),
  route: MapRouteSchema.optional(),
  attribution: MapAttributionSchema,
  retrievedAt: z.string().datetime({ offset: true }),
  title: z.string().max(240).optional(),
  summary: z.string().max(2_000).optional(),
});
export type MapSpec = z.infer<typeof MapSpecSchema>;

/**
 * A route projection safe to retain when the origin came from a transient
 * browser location. It deliberately contains neither the origin, geometry, nor
 * URLs that could encode the exact origin. The destination remains useful for
 * the persisted numbered answer while the UI can explain that the route was
 * not retained.
 */
export const MapRouteRedactedSchema = z
  .object({
    mode: MapRouteModeSchema,
    destination: MapCoordinateSchema,
    distanceMeters: z
      .number()
      .finite()
      .nonnegative()
      .max(MAP_LIMITS.maxRouteDistanceMeters),
    durationSeconds: z
      .number()
      .finite()
      .nonnegative()
      .max(7 * 24 * 60 * 60),
    provider: z.string().min(1).max(64),
    attribution: MapAttributionSchema,
    routeNotRetained: z.literal(true),
  })
  .strict();
export type MapRouteRedacted = z.infer<typeof MapRouteRedactedSchema>;

export const PersistableMapRouteSchema = z.union([
  MapRouteSchema,
  MapRouteRedactedSchema,
]);
export type PersistableMapRoute = z.infer<typeof PersistableMapRouteSchema>;

/** The redacted map snapshot stored in assistant metadata and run milestones. */
export const PersistableMapSpecSchema = z
  .object({
    places: z.array(MapPlaceSchema).max(MAP_LIMITS.maxPlaces),
    /** Exact browser origin retained only in an explicit save-in-answer snapshot. */
    origin: MapCoordinateSchema.optional(),
    route: PersistableMapRouteSchema.optional(),
    /** Set when the exact origin/route was intentionally kept out of storage. */
    routeNotRetained: z.boolean().optional(),
    attribution: MapAttributionSchema,
    retrievedAt: z.string().datetime({ offset: true }),
    title: z.string().max(240).optional(),
    summary: z.string().max(2_000).optional(),
  })
  .superRefine((spec, ctx) => {
    const redactedRoute = spec.route && 'routeNotRetained' in spec.route;
    if (spec.routeNotRetained && !redactedRoute) {
      ctx.addIssue({
        code: 'custom',
        path: ['route'],
        message: 'routeNotRetained requires a redacted route',
      });
    }
  });
export type PersistableMapSpec = z.infer<typeof PersistableMapSpecSchema>;

// Descriptive aliases keep the persistence boundary explicit for callers that
// refer to the value as a persisted snapshot rather than a persistable one.
export const PersistedMapSpecSchema = PersistableMapSpecSchema;
export type PersistedMapSpec = PersistableMapSpec;
export const MapSpecPersistableSchema = PersistableMapSpecSchema;
export type MapSpecPersistable = PersistableMapSpec;

/**
 * Exact browser-origin data is carried only by the live stream overlay. This
 * shape is intentionally separate from PersistableMapSpec; callers cannot
 * accidentally pass an overlay to the durable snapshot helpers.
 */
export const MapSessionOverlaySchema = z
  .object({
    mapId: z.string().trim().min(1).max(MAP_LIMITS.maxPlaceIdLength),
    origin: MapCoordinateSchema.optional(),
    route: MapRouteSchema.optional(),
    /** Page-session binding for precise live-only data, when present. */
    clientSessionId: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), {
        message: 'overlay client session ID contains control characters',
      })
      .optional(),
    expiresAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .superRefine((overlay, ctx) => {
    if (overlay.origin === undefined && overlay.route === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'a map session overlay needs an origin or route',
      });
    }
    if (
      overlay.origin &&
      overlay.route &&
      (overlay.origin.lat !== overlay.route.origin.lat ||
        overlay.origin.lon !== overlay.route.origin.lon)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['origin'],
        message: 'overlay origin must match the route origin',
      });
    }
  });
export type MapSessionOverlay = z.infer<typeof MapSessionOverlaySchema>;
export const MapOverlaySchema = MapSessionOverlaySchema;
export type MapOverlay = MapSessionOverlay;

export function validatePersistableMapSpec(value: unknown): PersistableMapSpec {
  return PersistableMapSpecSchema.parse(value);
}

export function validateMapSessionOverlay(value: unknown): MapSessionOverlay {
  return MapSessionOverlaySchema.parse(value);
}

function cloneMapRoute(route: PersistableMapRoute): PersistableMapRoute {
  if ('routeNotRetained' in route) {
    return { ...route, destination: { ...route.destination } };
  }
  return {
    ...route,
    origin: { ...route.origin },
    destination: { ...route.destination },
    geometry: {
      ...route.geometry,
      coordinates: route.geometry.coordinates.map(([lon, lat]) => [lon, lat]),
    },
  };
}

function clonePersistableMapSpec(spec: PersistableMapSpec): PersistableMapSpec {
  return {
    ...spec,
    places: spec.places.map((place) => ({
      ...place,
      coordinate: { ...place.coordinate },
    })),
    ...(spec.origin ? { origin: { ...spec.origin } } : {}),
    ...(spec.route ? { route: cloneMapRoute(spec.route) } : {}),
  };
}

/**
 * Normalize a provider-grounded spec at the durable boundary. By default a
 * named-origin route and an explicitly saved browser origin are retained;
 * callers handling transient browser data pass the corresponding retain flags
 * as false and receive a redacted projection.
 */
export function toPersistableMapSpec(
  value: MapSpec | PersistableMapSpec,
  options: { retainRoute?: boolean; retainOrigin?: boolean } = {},
): PersistableMapSpec {
  const full = MapSpecSchema.safeParse(value);
  const parsed = full.success
    ? full.data
    : PersistableMapSpecSchema.parse(value);
  const retainRoute = options.retainRoute !== false;
  const retainOrigin = options.retainOrigin ?? retainRoute;
  const withoutOrigin = retainOrigin
    ? parsed
    : Object.fromEntries(
        Object.entries(parsed).filter(([key]) => key !== 'origin'),
      );
  if (!parsed.route || retainRoute || 'routeNotRetained' in parsed.route) {
    return clonePersistableMapSpec(
      PersistableMapSpecSchema.parse(withoutOrigin),
    );
  }

  const route = parsed.route;
  if ('routeNotRetained' in route) {
    return clonePersistableMapSpec(
      PersistableMapSpecSchema.parse(withoutOrigin),
    );
  }
  return clonePersistableMapSpec(
    PersistableMapSpecSchema.parse({
      ...withoutOrigin,
      route: {
        mode: route.mode,
        destination: { ...route.destination },
        distanceMeters: route.distanceMeters,
        durationSeconds: route.durationSeconds,
        provider: route.provider,
        attribution: route.attribution,
        routeNotRetained: true,
      },
      routeNotRetained: true,
    }),
  );
}

export const redactMapSpec = (
  value: MapSpec | PersistableMapSpec,
): PersistableMapSpec =>
  toPersistableMapSpec(value, { retainRoute: false, retainOrigin: false });

export const MapProviderCapabilitiesSchema = z.object({
  geocoding: z.boolean(),
  nearby: z.boolean(),
  placeDetails: z.boolean(),
  routing: z.boolean(),
  routeModes: z
    .array(MapRouteModeSchema)
    .max(MAP_ROUTE_MODES.length)
    .refine((modes) => new Set(modes).size === modes.length, {
      message: 'route modes must be unique',
    }),
  tiles: z.boolean(),
});
export type MapProviderCapabilities = z.infer<
  typeof MapProviderCapabilitiesSchema
>;

export const MapPlaceSearchRequestSchema = z
  .object({
    query: z.string().trim().min(1).max(MAP_LIMITS.maxQueryLength).optional(),
    center: MapCoordinateSchema.optional(),
    radiusMeters: z
      .number()
      .int()
      .positive()
      .max(MAP_LIMITS.maxRadiusMeters)
      .optional(),
    category: z
      .string()
      .trim()
      .min(1)
      .max(MAP_LIMITS.maxCategoryLength)
      .optional(),
    limit: z.number().int().positive().max(MAP_LIMITS.maxPlaces).optional(),
  })
  .superRefine((request, ctx) => {
    if (!request.query && !request.center) {
      ctx.addIssue({
        code: 'custom',
        path: ['query'],
        message: 'query or center is required',
      });
    }
    if (request.radiusMeters !== undefined && !request.center) {
      ctx.addIssue({
        code: 'custom',
        path: ['center'],
        message: 'center is required when radiusMeters is provided',
      });
    }
  });
export type MapPlaceSearchRequest = z.infer<typeof MapPlaceSearchRequestSchema>;

export const MapPlaceDetailsRequestSchema = z.object({
  placeId: z.string().trim().min(1).max(MAP_LIMITS.maxPlaceIdLength),
});
export type MapPlaceDetailsRequest = z.infer<
  typeof MapPlaceDetailsRequestSchema
>;

export const MapRouteRequestSchema = z.object({
  origin: MapCoordinateSchema,
  destination: MapCoordinateSchema,
  mode: MapRouteModeSchema,
});
export type MapRouteRequest = z.infer<typeof MapRouteRequestSchema>;

export const MapPlaceSearchResultSchema = z.object({
  places: z.array(MapPlaceSchema).max(MAP_LIMITS.maxPlaces),
  query: z.string().max(MAP_LIMITS.maxQueryLength).optional(),
  provider: z.string().min(1).max(64),
  attribution: MapAttributionSchema,
  retrievedAt: z.string().datetime({ offset: true }),
});
export type MapPlaceSearchResult = z.infer<typeof MapPlaceSearchResultSchema>;

export const MapPlaceDetailsResultSchema = z.object({
  place: MapPlaceSchema,
  provider: z.string().min(1).max(64),
  attribution: MapAttributionSchema,
  retrievedAt: z.string().datetime({ offset: true }),
});
export type MapPlaceDetailsResult = z.infer<typeof MapPlaceDetailsResultSchema>;

export const MapRouteResultSchema = z.object({
  route: MapRouteSchema,
  provider: z.string().min(1).max(64),
  attribution: MapAttributionSchema,
  retrievedAt: z.string().datetime({ offset: true }),
});
export type MapRouteResult = z.infer<typeof MapRouteResultSchema>;

function numericCoordinateValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (value.trim() === '') return undefined;
  return Number(value);
}

export function normalizeCoordinate(value: unknown): MapCoordinate | null {
  // Array coordinates follow GeoJSON order: [longitude, latitude]. Do not
  // silently accept a third value; accepting malformed tuples can turn an
  // unrelated payload field into a usable location.
  if (Array.isArray(value) && value.length === 2) {
    const lon = numericCoordinateValue(value[0]);
    const lat = numericCoordinateValue(value[1]);
    const parsed = MapCoordinateSchema.safeParse({ lat, lon });
    return parsed.success ? parsed.data : null;
  }

  if (value === null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if ('coordinates' in record) {
    const coordinate = normalizeCoordinate(record.coordinates);
    if (coordinate) return coordinate;
  }
  if ('center' in record) {
    const coordinate = normalizeCoordinate(record.center);
    if (coordinate) return coordinate;
  }
  const latValue = record.lat ?? record.latitude;
  const lonValue = record.lon ?? record.lng ?? record.longitude;
  const lat = numericCoordinateValue(latValue);
  const lon = numericCoordinateValue(lonValue);
  const parsed = MapCoordinateSchema.safeParse({ lat, lon });
  return parsed.success ? parsed.data : null;
}

export function assertCoordinate(
  value: unknown,
  label = 'coordinate',
): MapCoordinate {
  const coordinate = normalizeCoordinate(value);
  if (!coordinate) throw new MapDomainValidationError(`Invalid ${label}`);
  return coordinate;
}

export function isValidCoordinate(value: unknown): value is MapCoordinate {
  return normalizeCoordinate(value) !== null;
}

export function isValidGeoJsonLineString(
  value: unknown,
): value is GeoJsonLineString {
  return GeoJsonLineStringSchema.safeParse(value).success;
}

export function validateMapPlace(value: unknown): MapPlace {
  return MapPlaceSchema.parse(value);
}

export function validateMapRoute(value: unknown): MapRoute {
  return MapRouteSchema.parse(value);
}

export function validateMapSpec(value: unknown): MapSpec {
  return MapSpecSchema.parse(value);
}

export function clampPlaceLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return MAP_LIMITS.maxPlaces;
  return Math.max(
    1,
    Math.min(MAP_LIMITS.maxPlaces, Math.trunc(limit as number)),
  );
}

export function clampRadiusMeters(radius: number | undefined): number {
  if (!Number.isFinite(radius)) return 5_000;
  return Math.max(
    1,
    Math.min(MAP_LIMITS.maxRadiusMeters, Math.trunc(radius as number)),
  );
}

export function formatCoordinate(
  coordinate: MapCoordinate,
  precision = 6,
): string {
  const safePrecision = Number.isFinite(precision)
    ? Math.max(0, Math.min(12, Math.trunc(precision)))
    : 6;
  return `${coordinate.lat.toFixed(safePrecision)},${coordinate.lon.toFixed(safePrecision)}`;
}
