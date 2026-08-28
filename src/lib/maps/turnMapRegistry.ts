import { generateId } from '@/lib/utils/id';
import {
  MAP_LIMITS,
  MapCoordinateSchema,
  MapPlaceSchema,
  MapSpecSchema,
  PersistableMapRouteSchema,
  PersistableMapSpecSchema,
  mapSpecAttributions,
  type MapCoordinate,
  type MapPlace,
  type MapRoute,
  type MapRouteRedacted,
  type MapSpec,
  type PersistableMapRoute,
  type PersistableMapSpec,
} from './types';

/** Map discovery and explicit composition are intentionally not capped per turn. */
export const TURN_MAP_MAX_REGISTRATIONS = Number.POSITIVE_INFINITY;
export const TURN_MAP_MAX_PLACEMENTS = Number.POSITIVE_INFINITY;
export const MAP_MAX_REGISTRATIONS = TURN_MAP_MAX_REGISTRATIONS;
export const MAP_MAX_PLACEMENTS = TURN_MAP_MAX_PLACEMENTS;

const MAP_HANDLE_RE = /^map_([1-9]\d*)$/;
const PLACE_HANDLE_RE = /^place_([1-9]\d*)$/;
const ROUTE_HANDLE_RE = /^route_([1-9]\d*)$/;
const MAX_OPAQUE_ID_LENGTH = 160;

function isSequenceHandle(value: unknown, pattern: RegExp): value is string {
  if (typeof value !== 'string' || value.length > MAX_OPAQUE_ID_LENGTH) {
    return false;
  }
  const match = pattern.exec(value);
  if (!match) return false;
  const suffix = Number(match[1]);
  return (
    Number.isSafeInteger(suffix) &&
    suffix >= 1 &&
    suffix < Number.MAX_SAFE_INTEGER
  );
}

function isMapHandle(value: unknown): value is string {
  return isSequenceHandle(value, MAP_HANDLE_RE);
}

function isPlaceHandle(value: unknown): value is string {
  return isSequenceHandle(value, PLACE_HANDLE_RE);
}

function isRouteHandle(value: unknown): value is string {
  return isSequenceHandle(value, ROUTE_HANDLE_RE);
}

export interface TurnMapMilestone {
  type: string;
  data?: unknown;
}

/** A private map registration. `handle` is retained only for old trusted events. */
export interface TurnMapRegistration {
  handle?: string;
  mapId: string;
  title: string;
  spec: PersistableMapSpec;
  /** Total pins, including route endpoints that have no place record. */
  pinCount?: number;
}

export interface TurnMapPlacement extends TurnMapRegistration {
  placementId: string;
  placementNumber: number;
}

/** Precise data retained only while the current turn's page session is live. */
export interface TurnMapSessionOverlay {
  origin?: MapCoordinate;
  route?: MapRoute;
  retention: 'once';
}

/** A short handle for a provider-grounded place in the current turn. */
export interface TurnMapPlaceRegistration {
  handle: string;
  place: MapPlace;
  retrievedAt?: string;
  /** Live-only origin provenance for a current-location nearby search. */
  locationOrigin?: MapCoordinate;
  locationRetention?: 'once' | 'save';
}

/** A short handle for a provider-grounded route in the current turn. */
export interface TurnMapRouteRegistration {
  handle: string;
  route: PersistableMapRoute;
  /** Endpoint place handles are ordered origin, destination when both exist. */
  placeHandles?: string[];
  originPlaceHandle?: string;
  destinationPlaceHandle?: string;
  retrievedAt?: string;
  /** False means the live route must be redacted in a durable snapshot. */
  routeRetained?: boolean;
  /** Live-only origin provenance for a current-location route. */
  locationOrigin?: MapCoordinate;
  locationRetention?: 'once' | 'save';
}

export interface AvailableTurnMap {
  handle: string;
  title: string;
}

export interface TurnMapCompositionInput {
  placeHandles?: readonly string[];
  routeHandle?: string;
  title?: string;
  /** Internal retrieval metadata supplied by the trusted tool runtime. */
  retrievedAt?: string;
  /** Internal summary supplied by the trusted tool runtime. */
  summary?: string;
  /** A live or saved origin supplied by the trusted mapping runtime. */
  origin?: MapCoordinate;
  /** Exact origin data is retained only when explicitly allowed. */
  retainOrigin?: boolean;
  /** Alias used by trusted replay/runtime callers. */
  originRetained?: boolean;
  /** Internal privacy decision for a route with a transient browser origin. */
  retainRoute?: boolean;
  /** Alias used by trusted replay/runtime callers. */
  routeRetained?: boolean;
}

export interface TurnMapRegistrySnapshot {
  /** Map registrations; old snapshots may include a short `handle`. */
  registrations: TurnMapRegistration[];
  /** Legacy map-handle counter. */
  nextHandle: number;
  placementCount: number;
  /** Handles shown at least once; absent in older snapshots. */
  placedHandles?: string[];
  /** Placement IDs make replay idempotent after a process restart. */
  placementIds?: string[];
  /** Independent turn-local place discoveries. */
  places?: TurnMapPlaceRegistration[];
  /** Independent turn-local route discoveries. */
  routes?: TurnMapRouteRegistration[];
  /** Complete immutable placements, when available in a new snapshot. */
  placements?: TurnMapPlacement[];
  nextPlaceHandle?: number;
  nextRouteHandle?: number;
  /** Accepted aliases for snapshots written by an intermediate runtime. */
  mapRegistrations?: TurnMapRegistration[];
  maps?: TurnMapRegistration[];
  placeRegistrations?: TurnMapPlaceRegistration[];
  routeRegistrations?: TurnMapRouteRegistration[];
}

export interface TurnMapRegistryOptions {
  idFactory?: () => string;
  snapshot?: TurnMapRegistrySnapshot;
}

interface TurnMapRegistryInternalSnapshot {
  registrations: TurnMapRegistration[];
  places: TurnMapPlaceRegistration[];
  routes: TurnMapRouteRegistration[];
  placements: TurnMapPlacement[];
  sessionOverlays: Array<[string, TurnMapSessionOverlay]>;
  placementIds: string[];
  placedHandles: string[];
  nextHandle: number;
  nextPlaceHandle: number;
  nextRouteHandle: number;
  placementCount: number;
}

export type TurnMapRegistryErrorCode =
  | 'unknown_handle'
  | 'unknown_map'
  | 'unknown_place_handle'
  | 'unknown_route_handle'
  | 'registration_limit'
  | 'placement_limit'
  | 'pin_limit'
  | 'invalid_composition'
  | 'invalid_placement'
  | 'invalid_snapshot';

export class TurnMapRegistryError extends Error {
  readonly code: TurnMapRegistryErrorCode;
  readonly availableMaps: AvailableTurnMap[];
  readonly availablePlaces: Array<{ handle: string; name: string }>;
  readonly availableRoutes: Array<{ handle: string }>;
  readonly handle?: string;
  readonly mapId?: string;

  constructor(
    code: TurnMapRegistryErrorCode,
    message: string,
    availableMaps: AvailableTurnMap[] = [],
    handle?: string,
    mapId?: string,
    availablePlaces: Array<{ handle: string; name: string }> = [],
    availableRoutes: Array<{ handle: string }> = [],
  ) {
    super(message);
    this.name = 'TurnMapRegistryError';
    this.code = code;
    this.availableMaps = availableMaps;
    this.availablePlaces = availablePlaces;
    this.availableRoutes = availableRoutes;
    this.handle = handle;
    this.mapId = mapId;
  }
}

function cloneRoute(route: PersistableMapRoute): PersistableMapRoute {
  if ('routeNotRetained' in route) {
    return {
      ...route,
      destination: { ...route.destination },
    };
  }
  return {
    ...route,
    origin: { ...route.origin },
    destination: { ...route.destination },
    geometry: {
      ...route.geometry,
      coordinates: route.geometry.coordinates.map(
        ([lon, lat]) => [lon, lat] as [number, number],
      ),
    },
  };
}

function cloneSpec(spec: PersistableMapSpec): PersistableMapSpec {
  const attributions = mapSpecAttributions(spec);
  return {
    ...spec,
    places: spec.places.map((place) => ({
      ...place,
      coordinate: { ...place.coordinate },
    })),
    ...(spec.origin ? { origin: { ...spec.origin } } : {}),
    ...(spec.route ? { route: cloneRoute(spec.route) } : {}),
    ...(attributions.length > 1
      ? { attributions }
      : spec.attributions
        ? { attributions: [...spec.attributions] }
        : {}),
  };
}

function clonePlace(place: MapPlace): MapPlace {
  return { ...place, coordinate: { ...place.coordinate } };
}

function clonePlaceRegistration(
  registration: TurnMapPlaceRegistration,
): TurnMapPlaceRegistration {
  return {
    ...registration,
    place: clonePlace(registration.place),
    ...(registration.locationOrigin
      ? { locationOrigin: { ...registration.locationOrigin } }
      : {}),
  };
}

function cloneSafePlaceRegistration(
  registration: TurnMapPlaceRegistration,
): TurnMapPlaceRegistration {
  const {
    locationOrigin: _locationOrigin,
    locationRetention: _locationRetention,
    ...safe
  } = registration;
  return clonePlaceRegistration(safe);
}

function cloneRouteRegistration(
  registration: TurnMapRouteRegistration,
): TurnMapRouteRegistration {
  return {
    ...registration,
    route: cloneRoute(registration.route),
    ...(registration.placeHandles
      ? { placeHandles: [...registration.placeHandles] }
      : {}),
    ...(registration.locationOrigin
      ? { locationOrigin: { ...registration.locationOrigin } }
      : {}),
  };
}

function cloneSafeRouteRegistration(
  registration: TurnMapRouteRegistration,
): TurnMapRouteRegistration {
  const route =
    registration.routeRetained === false
      ? redactedRoute(registration.route)
      : registration.route;
  const {
    locationOrigin: _locationOrigin,
    locationRetention: _locationRetention,
    ...withoutLocation
  } = registration;
  if (!('routeNotRetained' in route)) {
    return cloneRouteRegistration({ ...withoutLocation, route });
  }
  const {
    originPlaceHandle: _originPlaceHandle,
    placeHandles: _placeHandles,
    ...withoutOrigin
  } = withoutLocation;
  const destinationPlaceHandle =
    registration.destinationPlaceHandle ??
    (registration.placeHandles?.length === 1
      ? registration.placeHandles[0]
      : registration.placeHandles?.[1]);
  return cloneRouteRegistration({
    ...withoutOrigin,
    route,
    ...(destinationPlaceHandle
      ? {
          placeHandles: [destinationPlaceHandle],
          destinationPlaceHandle,
        }
      : {}),
  });
}

function cloneRegistration(
  registration: TurnMapRegistration,
): TurnMapRegistration {
  return { ...registration, spec: cloneSpec(registration.spec) };
}

function clonePlacement(placement: TurnMapPlacement): TurnMapPlacement {
  return { ...placement, spec: cloneSpec(placement.spec) };
}

function cloneSessionOverlay(
  overlay: TurnMapSessionOverlay,
): TurnMapSessionOverlay {
  return {
    ...overlay,
    ...(overlay.origin ? { origin: { ...overlay.origin } } : {}),
    ...(overlay.route ? { route: cloneRoute(overlay.route) as MapRoute } : {}),
  };
}

function availableMapText(maps: readonly AvailableTurnMap[]): string {
  if (maps.length === 0) return 'No maps are available in this turn.';
  return maps.map(({ handle, title }) => `${handle} (${title})`).join(', ');
}

function availablePlaceText(
  places: readonly { handle: string; name: string }[],
): string {
  if (places.length === 0) return 'No places are available in this turn.';
  return places.map(({ handle, name }) => `${handle} (${name})`).join(', ');
}

function availableRouteText(routes: readonly { handle: string }[]): string {
  if (routes.length === 0) return 'No routes are available in this turn.';
  return routes.map(({ handle }) => handle).join(', ');
}

function placeIdentity(place: Pick<MapPlace, 'provider' | 'id'>): string {
  return JSON.stringify([place.provider, place.id]);
}

function coordinateIdentity(coordinate: { lat: number; lon: number }): string {
  return `${coordinate.lat}:${coordinate.lon}`;
}

function sameCoordinate(
  left: { lat: number; lon: number },
  right: { lat: number; lon: number },
): boolean {
  return left.lat === right.lat && left.lon === right.lon;
}

function mapPinKeys(
  places: readonly TurnMapPlaceRegistration[],
  route: PersistableMapRoute | undefined,
  endpointHandles: readonly (string | undefined)[] = [],
  origin?: { lat: number; lon: number },
): Set<string> {
  const pins = new Set(
    places.map(({ place }) => `place:${placeIdentity(place)}`),
  );
  const addCoordinatePin = (coordinate: { lat: number; lon: number }) => {
    if (
      places.some(({ place }) => sameCoordinate(place.coordinate, coordinate))
    ) {
      return;
    }
    pins.add(`coordinate:${coordinateIdentity(coordinate)}`);
  };
  if (origin) addCoordinatePin(origin);
  if (!route) return pins;

  const endpointCoordinates: Array<{ lat: number; lon: number } | undefined> =
    'routeNotRetained' in route
      ? [undefined, route.destination]
      : [route.origin, route.destination];
  for (let index = 0; index < endpointCoordinates.length; index += 1) {
    const handle = endpointHandles[index];
    if (handle !== undefined) {
      const endpoint = places.find(({ handle: value }) => value === handle);
      if (endpoint) pins.add(`place:${placeIdentity(endpoint.place)}`);
      continue;
    }
    const coordinate = endpointCoordinates[index];
    if (coordinate === undefined) {
      // A transient route's exact origin is supplied separately by the live
      // location overlay. Count that origin once when the caller provided it.
      if (!origin) pins.add(`route-origin:${route.provider}:${route.mode}`);
      continue;
    }
    addCoordinatePin(coordinate);
  }
  return pins;
}

function mapSpecPinCount(spec: PersistableMapSpec): number {
  const places = spec.places.map((place) => ({
    handle: '',
    place,
  }));
  return mapPinKeys(places, spec.route, [], spec.origin).size;
}

function routeKey(route: PersistableMapRoute): string {
  const endpoint =
    'routeNotRetained' in route
      ? ['redacted', route.destination.lat, route.destination.lon]
      : [
          'full',
          route.origin.lat,
          route.origin.lon,
          route.destination.lat,
          route.destination.lon,
        ];
  return JSON.stringify([route.provider, route.mode, endpoint]);
}

function isValidOpaqueId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_OPAQUE_ID_LENGTH &&
    !/[\u0000-\u001f\u007f<>]/.test(value) &&
    value !== '__proto__' &&
    value !== 'constructor' &&
    value !== 'prototype'
  );
}

function placementIdNumber(value: string): number | undefined {
  const match = /^map_placement_([1-9]\d*)$/.exec(value);
  if (!match) return undefined;
  const number = Number(match[1]);
  return Number.isSafeInteger(number) ? number : undefined;
}

function isGeneratedPlacementId(value: string): boolean {
  return placementIdNumber(value) !== undefined;
}

function isValidCounter(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

function isValidNonnegativeCounter(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function parseSpec(value: unknown): PersistableMapSpec {
  const parsed = PersistableMapSpecSchema.safeParse(value);
  if (!parsed.success) {
    throw new TurnMapRegistryError(
      'invalid_snapshot',
      'Invalid turn map specification.',
    );
  }
  return parsed.data;
}

function parseRoute(value: unknown): PersistableMapRoute {
  const parsed = PersistableMapRouteSchema.safeParse(value);
  if (!parsed.success) {
    throw new TurnMapRegistryError(
      'invalid_snapshot',
      'Invalid provider route registration.',
    );
  }
  return parsed.data;
}

function parseRetrievedAt(
  value: unknown,
  errorCode: 'invalid_snapshot' | 'invalid_composition' = 'invalid_snapshot',
): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string' ||
    !Number.isFinite(Date.parse(value)) ||
    value.length > 64
  ) {
    throw new TurnMapRegistryError(
      errorCode,
      'Invalid map retrieval timestamp.',
    );
  }
  return value;
}

function parseTitle(value: unknown): string {
  if (value === undefined) return 'Map';
  if (typeof value !== 'string' || value.length > 240) {
    throw new TurnMapRegistryError(
      'invalid_composition',
      'Map title must be at most 240 characters.',
    );
  }
  return value.trim() || 'Map';
}

function parseSummary(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > 2_000) {
    throw new TurnMapRegistryError(
      'invalid_composition',
      'Map summary is invalid.',
    );
  }
  const summary = value.trim();
  return summary || undefined;
}

function shouldRetainRoute(options: {
  retainRoute?: boolean;
  routeRetained?: boolean;
}): boolean {
  return options.routeRetained ?? options.retainRoute !== false;
}

function shouldRetainOrigin(options: {
  retainOrigin?: boolean;
  originRetained?: boolean;
}): boolean {
  return options.originRetained ?? options.retainOrigin === true;
}

function redactedRoute(route: PersistableMapRoute): MapRouteRedacted {
  if ('routeNotRetained' in route) {
    return {
      ...route,
      destination: { ...route.destination },
    };
  }
  return {
    mode: route.mode,
    destination: { ...route.destination },
    distanceMeters: route.distanceMeters,
    durationSeconds: route.durationSeconds,
    provider: route.provider,
    attribution: route.attribution,
    routeNotRetained: true,
  };
}

function routeEndpointHandles(
  registration: TurnMapRouteRegistration,
): Array<string | undefined> {
  if ('routeNotRetained' in registration.route) {
    // A redacted route has no retained origin. Never let stale endpoint
    // metadata reintroduce that origin into a composed map.
    const destination =
      registration.destinationPlaceHandle ??
      (registration.placeHandles?.length === 1
        ? registration.placeHandles[0]
        : registration.placeHandles?.[1]);
    return [undefined, destination];
  }
  const origin = registration.originPlaceHandle;
  const destination = registration.destinationPlaceHandle;
  if (origin !== undefined || destination !== undefined) {
    return [origin, destination];
  }
  if (!registration.placeHandles) return [];
  return [...registration.placeHandles];
}

function normalizeRoutePlaceHandles(
  options: {
    placeHandles?: readonly string[];
    endpointPlaceHandles?: readonly string[];
    originPlaceHandle?: string;
    destinationPlaceHandle?: string;
    originHandle?: string;
    destinationHandle?: string;
  },
  route?: PersistableMapRoute,
): {
  placeHandles: string[];
  originPlaceHandle?: string;
  destinationPlaceHandle?: string;
} {
  let originPlaceHandle = options.originPlaceHandle ?? options.originHandle;
  let destinationPlaceHandle =
    options.destinationPlaceHandle ?? options.destinationHandle;
  const supplied = options.placeHandles ?? options.endpointPlaceHandles;
  if (supplied !== undefined) {
    if (
      !Array.isArray(supplied) ||
      supplied.length > 2 ||
      supplied.some((handle) => typeof handle !== 'string')
    ) {
      throw new TurnMapRegistryError(
        'invalid_composition',
        'A route can reference at most two endpoint places.',
      );
    }
    const redacted = route !== undefined && 'routeNotRetained' in route;
    if (
      redacted &&
      supplied.length === 1 &&
      originPlaceHandle === undefined &&
      destinationPlaceHandle === undefined
    ) {
      // A redacted route exposes only its destination endpoint.
      destinationPlaceHandle = supplied[0];
    } else {
      originPlaceHandle ??= supplied[0];
      destinationPlaceHandle ??= supplied[1];
    }
  }
  const placeHandles = [originPlaceHandle, destinationPlaceHandle].filter(
    (handle): handle is string => handle !== undefined,
  );
  return {
    placeHandles,
    ...(originPlaceHandle !== undefined ? { originPlaceHandle } : {}),
    ...(destinationPlaceHandle !== undefined ? { destinationPlaceHandle } : {}),
  };
}

function validateHandleList(
  handles: readonly string[],
  kind: 'place' | 'route',
): void {
  if (
    !Array.isArray(handles) ||
    handles.some((handle) => typeof handle !== 'string')
  ) {
    throw new TurnMapRegistryError(
      'invalid_composition',
      `Map ${kind} handles must be strings.`,
    );
  }
}

/** Turn-local provider discovery plus immutable map composition. */
export class TurnMapRegistry {
  private readonly idFactory: () => string;
  private readonly registrationsById = new Map<string, TurnMapRegistration>();
  private readonly registrationsByHandle = new Map<
    string,
    TurnMapRegistration
  >();
  private readonly places = new Map<string, TurnMapPlaceRegistration>();
  private readonly placesByIdentity = new Map<
    string,
    TurnMapPlaceRegistration
  >();
  private readonly routes = new Map<string, TurnMapRouteRegistration>();
  private readonly routesByKey = new Map<string, TurnMapRouteRegistration>();
  private readonly placements = new Map<string, TurnMapPlacement>();
  /** Exact overlays are keyed by composed map ID and never enter snapshots. */
  private readonly sessionOverlays = new Map<string, TurnMapSessionOverlay>();
  private readonly placementIds = new Set<string>();
  private readonly placedHandles = new Set<string>();
  private nextHandleValue = 1;
  private nextPlaceHandleValue = 1;
  private nextRouteHandleValue = 1;
  private placementCountValue = 0;

  constructor(options: TurnMapRegistryOptions = {}) {
    this.idFactory = options.idFactory ?? generateId;
    if (options.snapshot) this.restore(options.snapshot);
  }

  get registrationCount(): number {
    return this.registrationsById.size;
  }

  get mapCount(): number {
    return this.registrationCount;
  }

  get placeCount(): number {
    return this.places.size;
  }

  get routeCount(): number {
    return this.routes.size;
  }

  get placementCount(): number {
    return this.placementCountValue;
  }

  /**
   * Legacy trusted registration entry point. New map writers should call
   * {@link composeMap}; a map registration is not created by discovery.
   */
  register(input: TurnMapCompositionInput): TurnMapPlacement;
  register(spec: MapSpec | PersistableMapSpec): TurnMapRegistration;
  register(
    input: MapSpec | PersistableMapSpec | TurnMapCompositionInput,
  ): TurnMapRegistration | TurnMapPlacement {
    if (
      input &&
      typeof input === 'object' &&
      !Array.isArray(input) &&
      !('places' in input) &&
      ('placeHandles' in input || 'routeHandle' in input || 'title' in input)
    ) {
      return this.composeMap(input as TurnMapCompositionInput);
    }
    const normalized = parseSpec(input);
    const pinCount = mapSpecPinCount(normalized);
    if (pinCount > MAP_LIMITS.maxPlaces) {
      throw new TurnMapRegistryError(
        'pin_limit',
        `A map can contain at most ${MAP_LIMITS.maxPlaces} unique pins.`,
        this.availableMaps(),
      );
    }
    const snapshot = this.captureState();
    const handle = this.allocateHandle();
    try {
      const registration: TurnMapRegistration = {
        handle,
        mapId: this.allocateMapId(),
        title: normalized.title?.trim() || 'Map',
        spec: cloneSpec(normalized),
        pinCount,
      };
      this.setRegistration(registration);
      this.registerReferences(registration);
      return cloneRegistration(registration);
    } catch (error) {
      this.restoreState(snapshot);
      throw error;
    }
  }

  /**
   * Register provider-grounded places independently of any map. The whole
   * batch is validated before the first handle is allocated.
   */
  registerPlaces(
    places: readonly MapPlace[],
    options: {
      retrievedAt?: string;
      /** Live-only provenance for a nearby search around current location. */
      locationOrigin?: MapCoordinate;
      locationRetention?: 'once' | 'save';
    } = {},
  ): TurnMapPlaceRegistration[] {
    if (!Array.isArray(places)) {
      throw new TurnMapRegistryError(
        'invalid_snapshot',
        'Invalid provider place registration.',
      );
    }
    const parsedPlaces = places.map((place) => {
      const parsed = MapPlaceSchema.safeParse(place);
      if (!parsed.success) {
        throw new TurnMapRegistryError(
          'invalid_snapshot',
          'Invalid provider place registration.',
        );
      }
      return parsed.data;
    });
    const retrievedAt = parseRetrievedAt(options.retrievedAt);
    const locationOrigin =
      options.locationOrigin === undefined
        ? undefined
        : MapCoordinateSchema.safeParse(options.locationOrigin);
    if (options.locationOrigin !== undefined && !locationOrigin?.success) {
      throw new TurnMapRegistryError(
        'invalid_composition',
        'Invalid current-location origin.',
      );
    }
    if (
      options.locationRetention !== undefined &&
      options.locationRetention !== 'once' &&
      options.locationRetention !== 'save'
    ) {
      throw new TurnMapRegistryError(
        'invalid_composition',
        'Invalid current-location retention.',
      );
    }
    if (
      options.locationOrigin !== undefined &&
      options.locationRetention === undefined
    ) {
      throw new TurnMapRegistryError(
        'invalid_composition',
        'Current-location retention is required with an origin.',
      );
    }

    return parsedPlaces.map((place) => {
      const identity = placeIdentity(place);
      const existing = this.placesByIdentity.get(identity);
      if (existing) {
        if (existing.retrievedAt === undefined && retrievedAt !== undefined) {
          existing.retrievedAt = retrievedAt;
        }
        if (locationOrigin?.success && options.locationRetention) {
          if (!existing.locationOrigin) {
            existing.locationOrigin = { ...locationOrigin.data };
            existing.locationRetention = options.locationRetention;
          } else if (
            existing.locationRetention === 'once' &&
            options.locationRetention === 'save' &&
            sameCoordinate(existing.locationOrigin, locationOrigin.data)
          ) {
            existing.locationRetention = 'save';
          }
        }
        return clonePlaceRegistration(existing);
      }
      const registration: TurnMapPlaceRegistration = {
        handle: this.allocatePlaceHandle(),
        place: clonePlace(place),
        ...(retrievedAt ? { retrievedAt } : {}),
        ...(locationOrigin?.success && options.locationRetention
          ? {
              locationOrigin: { ...locationOrigin.data },
              locationRetention: options.locationRetention,
            }
          : {}),
      };
      this.places.set(registration.handle, registration);
      this.placesByIdentity.set(identity, registration);
      return clonePlaceRegistration(registration);
    });
  }

  /** Admit a place discovery with its original short handle during replay. */
  registerKnownPlace(input: {
    handle: string;
    place: MapPlace;
    retrievedAt?: string;
  }): TurnMapPlaceRegistration {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new TurnMapRegistryError(
        'invalid_snapshot',
        'Invalid turn map place registration.',
      );
    }
    if (!isPlaceHandle(input.handle)) {
      throw new TurnMapRegistryError(
        'invalid_snapshot',
        'Invalid turn map place handle.',
      );
    }
    const parsed = MapPlaceSchema.safeParse(input.place);
    if (!parsed.success) {
      throw new TurnMapRegistryError(
        'invalid_snapshot',
        'Invalid provider place registration.',
      );
    }
    const retrievedAt = parseRetrievedAt(input.retrievedAt);
    const byHandle = this.places.get(input.handle);
    const identity = placeIdentity(parsed.data);
    const byIdentity = this.placesByIdentity.get(identity);
    if (byHandle && placeIdentity(byHandle.place) !== identity) {
      throw new TurnMapRegistryError(
        'invalid_snapshot',
        'Turn map place handle is already assigned.',
      );
    }
    if (byIdentity && byIdentity.handle !== input.handle) {
      throw new TurnMapRegistryError(
        'invalid_snapshot',
        'Provider place identity is already assigned.',
      );
    }
    const registration = byHandle ?? byIdentity;
    if (registration) return clonePlaceRegistration(registration);
    const created: TurnMapPlaceRegistration = {
      handle: input.handle,
      place: clonePlace(parsed.data),
      ...(retrievedAt ? { retrievedAt } : {}),
    };
    this.places.set(created.handle, created);
    this.placesByIdentity.set(identity, created);
    this.nextPlaceHandleValue = Math.max(
      this.nextPlaceHandleValue,
      Number(input.handle.slice('place_'.length)) + 1,
    );
    return clonePlaceRegistration(created);
  }

  resolvePlace(handle: unknown): TurnMapPlaceRegistration | undefined {
    if (!isPlaceHandle(handle)) {
      return undefined;
    }
    const registration = this.places.get(handle);
    return registration ? clonePlaceRegistration(registration) : undefined;
  }

  availablePlaces(): Array<{ handle: string; name: string }> {
    return [...this.places.values()].map(({ handle, place }) => ({
      handle,
      name: place.name,
    }));
  }

  /** Register a route independently and optionally retain endpoint handles. */
  registerRoute(
    route: MapRoute | PersistableMapRoute,
    options: {
      placeHandles?: readonly string[];
      endpointPlaceHandles?: readonly string[];
      originPlaceHandle?: string;
      destinationPlaceHandle?: string;
      originHandle?: string;
      destinationHandle?: string;
      retrievedAt?: string;
      retainRoute?: boolean;
      routeRetained?: boolean;
      /** Live-only provenance for a current-location route. */
      locationOrigin?: MapCoordinate;
      locationRetention?: 'once' | 'save';
    } = {},
  ): TurnMapRouteRegistration {
    if (
      (options.retainRoute !== undefined &&
        typeof options.retainRoute !== 'boolean') ||
      (options.routeRetained !== undefined &&
        typeof options.routeRetained !== 'boolean')
    ) {
      throw new TurnMapRegistryError(
        'invalid_snapshot',
        'Invalid provider route retention flag.',
      );
    }
    const parsed = parseRoute(route);
    const suppliedEndpoints = normalizeRoutePlaceHandles(options, parsed);
    const inferredEndpoints = this.inferEndpointHandles(parsed, [
      ...this.places.values(),
    ]);
    const originPlaceHandle =
      suppliedEndpoints.originPlaceHandle ??
      inferredEndpoints.originPlaceHandle;
    const destinationPlaceHandle =
      suppliedEndpoints.destinationPlaceHandle ??
      inferredEndpoints.destinationPlaceHandle;
    const endpoints = {
      placeHandles: [originPlaceHandle, destinationPlaceHandle].filter(
        (handle): handle is string => handle !== undefined,
      ),
      ...(originPlaceHandle !== undefined ? { originPlaceHandle } : {}),
      ...(destinationPlaceHandle !== undefined
        ? { destinationPlaceHandle }
        : {}),
    };
    const placeHandles = endpoints.placeHandles;
    validateHandleList(placeHandles, 'place');
    for (const handle of placeHandles) {
      if (!isPlaceHandle(handle) || !this.places.has(handle)) {
        throw new TurnMapRegistryError(
          'unknown_place_handle',
          `Unknown place handle "${handle}". Choose a validated place from this turn: ${availablePlaceText(this.availablePlaces())}`,
          [],
          handle,
          undefined,
          this.availablePlaces(),
          this.availableRoutes(),
        );
      }
    }
    this.validateRouteEndpoints(parsed, endpoints, 'invalid_composition');
    const retrievedAt = parseRetrievedAt(options.retrievedAt);
    const locationOrigin =
      options.locationOrigin === undefined
        ? undefined
        : MapCoordinateSchema.safeParse(options.locationOrigin);
    if (options.locationOrigin !== undefined && !locationOrigin?.success) {
      throw new TurnMapRegistryError(
        'invalid_composition',
        'Invalid current-location origin.',
      );
    }
    if (
      options.locationRetention !== undefined &&
      options.locationRetention !== 'once' &&
      options.locationRetention !== 'save'
    ) {
      throw new TurnMapRegistryError(
        'invalid_composition',
        'Invalid current-location retention.',
      );
    }
    if (
      options.locationOrigin !== undefined &&
      options.locationRetention === undefined
    ) {
      throw new TurnMapRegistryError(
        'invalid_composition',
        'Current-location retention is required with an origin.',
      );
    }
    const key = routeKey(parsed);
    const existing = this.routesByKey.get(key);
    if (existing) {
      this.mergeRouteMetadata(existing, endpoints, retrievedAt);
      // A route discovered with transient location data stays redacted for
      // the lifetime of the turn. A later duplicate lookup must not upgrade
      // that record into durable exact-origin data.
      if (!shouldRetainRoute(options)) existing.routeRetained = false;
      if (locationOrigin?.success && options.locationRetention) {
        existing.locationOrigin ??= { ...locationOrigin.data };
        existing.locationRetention ??= options.locationRetention;
      }
      return cloneRouteRegistration(existing);
    }

    const registration: TurnMapRouteRegistration = {
      handle: this.allocateRouteHandle(),
      route: cloneRoute(parsed),
      ...(placeHandles.length > 0 ? { placeHandles: [...placeHandles] } : {}),
      ...(endpoints.originPlaceHandle
        ? { originPlaceHandle: endpoints.originPlaceHandle }
        : {}),
      ...(endpoints.destinationPlaceHandle
        ? { destinationPlaceHandle: endpoints.destinationPlaceHandle }
        : {}),
      ...(retrievedAt ? { retrievedAt } : {}),
      ...(!shouldRetainRoute(options) || 'routeNotRetained' in parsed
        ? { routeRetained: false }
        : {}),
      ...(locationOrigin?.success && options.locationRetention
        ? {
            locationOrigin: { ...locationOrigin.data },
            locationRetention: options.locationRetention,
          }
        : {}),
    };
    this.routes.set(registration.handle, registration);
    this.routesByKey.set(key, registration);
    return cloneRouteRegistration(registration);
  }

  /** Admit a safe route discovery with its original short handle during replay. */
  registerKnownRoute(input: {
    handle: string;
    route: PersistableMapRoute;
    placeHandles?: readonly string[];
    endpointPlaceHandles?: readonly string[];
    originPlaceHandle?: string;
    destinationPlaceHandle?: string;
    originHandle?: string;
    destinationHandle?: string;
    retrievedAt?: string;
    retainRoute?: boolean;
    routeRetained?: boolean;
  }): TurnMapRouteRegistration {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new TurnMapRegistryError(
        'invalid_snapshot',
        'Invalid turn map route registration.',
      );
    }
    if (!isRouteHandle(input.handle)) {
      throw new TurnMapRegistryError(
        'invalid_snapshot',
        'Invalid turn map route handle.',
      );
    }
    if (
      (input.routeRetained !== undefined &&
        typeof input.routeRetained !== 'boolean') ||
      (input.retainRoute !== undefined &&
        typeof input.retainRoute !== 'boolean')
    ) {
      throw new TurnMapRegistryError(
        'invalid_snapshot',
        'Invalid turn map route retention flag.',
      );
    }
    const parsed = parseRoute(input.route);
    const retainRoute = shouldRetainRoute(input);
    const endpoints = normalizeRoutePlaceHandles(input, parsed);
    const placeHandles = endpoints.placeHandles;
    validateHandleList(placeHandles, 'place');
    for (const handle of placeHandles) {
      if (!isPlaceHandle(handle) || !this.places.has(handle)) {
        throw new TurnMapRegistryError(
          'invalid_snapshot',
          'Invalid turn map route endpoint reference.',
        );
      }
    }
    this.validateRouteEndpoints(parsed, endpoints, 'invalid_snapshot');
    const retrievedAt = parseRetrievedAt(input.retrievedAt);
    const storedRoute = !retainRoute ? redactedRoute(parsed) : parsed;
    const storedEndpoints =
      'routeNotRetained' in storedRoute
        ? {
            placeHandles: endpoints.destinationPlaceHandle
              ? [endpoints.destinationPlaceHandle]
              : [],
            ...(endpoints.destinationPlaceHandle
              ? { destinationPlaceHandle: endpoints.destinationPlaceHandle }
              : {}),
          }
        : endpoints;
    const key = routeKey(storedRoute);
    const requestedKey = routeKey(parsed);
    const byHandle = this.routes.get(input.handle);
    const byKey = this.routesByKey.get(key);
    if (byHandle && routeKey(byHandle.route) !== key) {
      // A trusted replay may repeat a full route milestone with a redaction
      // decision. Keep the already assigned handle, but never restore its
      // exact route as durable data.
      if (
        !retainRoute &&
        !('routeNotRetained' in parsed) &&
        routeKey(byHandle.route) === requestedKey
      ) {
        byHandle.routeRetained = false;
        return cloneRouteRegistration(byHandle);
      }
      throw new TurnMapRegistryError(
        'invalid_snapshot',
        'Turn map route handle is already assigned.',
      );
    }
    if (byKey && byKey.handle !== input.handle) {
      throw new TurnMapRegistryError(
        'invalid_snapshot',
        'Provider route identity is already assigned.',
      );
    }
    const existing = byHandle ?? byKey;
    if (existing) {
      if (!retainRoute || 'routeNotRetained' in parsed) {
        existing.routeRetained = false;
      }
      return cloneRouteRegistration(existing);
    }
    const created: TurnMapRouteRegistration = {
      handle: input.handle,
      route: cloneRoute(storedRoute),
      ...(storedEndpoints.placeHandles.length > 0
        ? { placeHandles: [...storedEndpoints.placeHandles] }
        : {}),
      ...(storedEndpoints.originPlaceHandle
        ? { originPlaceHandle: storedEndpoints.originPlaceHandle }
        : {}),
      ...(storedEndpoints.destinationPlaceHandle
        ? { destinationPlaceHandle: storedEndpoints.destinationPlaceHandle }
        : {}),
      ...(retrievedAt ? { retrievedAt } : {}),
      ...(!retainRoute || 'routeNotRetained' in parsed
        ? { routeRetained: false }
        : {}),
    };
    this.routes.set(created.handle, created);
    this.routesByKey.set(key, created);
    this.nextRouteHandleValue = Math.max(
      this.nextRouteHandleValue,
      Number(input.handle.slice('route_'.length)) + 1,
    );
    return cloneRouteRegistration(created);
  }

  resolveRoute(handle: unknown): TurnMapRouteRegistration | undefined {
    if (!isRouteHandle(handle)) {
      return undefined;
    }
    const registration = this.routes.get(handle);
    return registration ? cloneRouteRegistration(registration) : undefined;
  }

  availableRoutes(): Array<{ handle: string }> {
    return [...this.routes.values()].map(({ handle }) => ({ handle }));
  }

  /**
   * Admit a map spec received from a trusted stream event. Unlike discovery,
   * this compatibility boundary may carry a legacy short map handle.
   */
  registerKnown(input: {
    handle?: string;
    mapId: string;
    spec: MapSpec | PersistableMapSpec;
    title?: string;
    pinCount?: number;
  }): TurnMapRegistration {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new TurnMapRegistryError(
        'invalid_snapshot',
        'Invalid turn map registration.',
      );
    }
    const normalized = parseSpec(input.spec);
    if (
      !isValidOpaqueId(input.mapId) ||
      isGeneratedPlacementId(input.mapId) ||
      this.placementIds.has(input.mapId)
    ) {
      throw new TurnMapRegistryError(
        'invalid_snapshot',
        'Invalid turn map registration identity.',
      );
    }
    if (input.handle !== undefined && !isMapHandle(input.handle)) {
      throw new TurnMapRegistryError(
        'invalid_snapshot',
        'Invalid turn map registration identity.',
      );
    }
    if (
      input.title !== undefined &&
      (typeof input.title !== 'string' || input.title.length > 240)
    ) {
      throw new TurnMapRegistryError(
        'invalid_snapshot',
        'Invalid turn map registration title.',
      );
    }
    if (
      input.pinCount !== undefined &&
      (!Number.isSafeInteger(input.pinCount) ||
        input.pinCount < 0 ||
        input.pinCount > MAP_LIMITS.maxPlaces)
    ) {
      throw new TurnMapRegistryError(
        'invalid_snapshot',
        'Invalid turn map registration pin count.',
      );
    }
    const pinCount = mapSpecPinCount(normalized);
    if (
      pinCount > MAP_LIMITS.maxPlaces ||
      (input.pinCount !== undefined && input.pinCount !== pinCount)
    ) {
      throw new TurnMapRegistryError(
        'invalid_snapshot',
        'Invalid turn map registration pin count.',
      );
    }
    const byHandle = input.handle
      ? this.registrationsByHandle.get(input.handle)
      : undefined;
    if (byHandle && byHandle.mapId !== input.mapId) {
      throw new TurnMapRegistryError(
        'invalid_snapshot',
        'Turn map handle is already assigned.',
        this.availableMaps(),
        input.handle,
        input.mapId,
      );
    }
    const byId = this.registrationsById.get(input.mapId);
    if (byId && input.handle !== undefined && byId.handle !== input.handle) {
      throw new TurnMapRegistryError(
        'invalid_snapshot',
        'Turn map ID is already assigned.',
        this.availableMaps(),
        input.handle,
        input.mapId,
      );
    }
    const existing = byHandle ?? byId;
    if (existing) {
      this.registerReferences(existing);
      return cloneRegistration(existing);
    }
    const snapshot = this.captureState();
    try {
      const registration: TurnMapRegistration = {
        ...(input.handle ? { handle: input.handle } : {}),
        mapId: input.mapId,
        title: input.title?.trim() || normalized.title?.trim() || 'Map',
        spec: cloneSpec(normalized),
        pinCount,
      };
      this.setRegistration(registration);
      this.registerReferences(registration);
      if (input.handle) {
        this.nextHandleValue = Math.max(
          this.nextHandleValue,
          Number(input.handle.slice('map_'.length)) + 1,
        );
      }
      return cloneRegistration(registration);
    } catch (error) {
      this.restoreState(snapshot);
      throw error;
    }
  }

  resolve(handle: unknown): TurnMapRegistration | undefined {
    if (typeof handle !== 'string') return undefined;
    const registration = this.registrationsByHandle.get(handle);
    return registration ? cloneRegistration(registration) : undefined;
  }

  resolveById(mapId: unknown): TurnMapRegistration | undefined {
    if (typeof mapId !== 'string') return undefined;
    const registration = this.registrationsById.get(mapId);
    return registration ? cloneRegistration(registration) : undefined;
  }

  resolveMap(mapId: unknown): TurnMapRegistration | undefined {
    return this.resolveById(mapId);
  }

  /** Return a precise overlay for a composed map while the turn is live. */
  resolveSessionOverlay(mapId: unknown): TurnMapSessionOverlay | undefined {
    if (typeof mapId !== 'string') return undefined;
    const overlay = this.sessionOverlays.get(mapId);
    return overlay ? cloneSessionOverlay(overlay) : undefined;
  }

  getSessionOverlay = this.resolveSessionOverlay.bind(this);

  require(handle: unknown): TurnMapRegistration {
    const registration = this.resolve(handle);
    if (registration) return registration;
    const displayHandle = typeof handle === 'string' ? handle : String(handle);
    throw new TurnMapRegistryError(
      'unknown_handle',
      `Unknown map handle "${displayHandle}". Choose a map from this turn: ${availableMapText(this.availableMaps())}`,
      this.availableMaps(),
      typeof handle === 'string' ? handle : undefined,
    );
  }

  requireById(mapId: unknown): TurnMapRegistration {
    const registration = this.resolveById(mapId);
    if (registration) return registration;
    const displayId = typeof mapId === 'string' ? mapId : String(mapId);
    throw new TurnMapRegistryError(
      'unknown_map',
      `Unknown map ID "${displayId}".`,
      this.availableMaps(),
      undefined,
      typeof mapId === 'string' ? mapId : undefined,
    );
  }

  /** Compose a new immutable map and allocate its writer placement atomically. */
  composeMap(input: TurnMapCompositionInput): TurnMapPlacement {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new TurnMapRegistryError(
        'invalid_composition',
        'A map composition object is required.',
      );
    }
    if (
      (input.retainOrigin !== undefined &&
        typeof input.retainOrigin !== 'boolean') ||
      (input.originRetained !== undefined &&
        typeof input.originRetained !== 'boolean') ||
      (input.retainRoute !== undefined &&
        typeof input.retainRoute !== 'boolean') ||
      (input.routeRetained !== undefined &&
        typeof input.routeRetained !== 'boolean')
    ) {
      throw new TurnMapRegistryError(
        'invalid_composition',
        'Map retention options must be booleans.',
      );
    }
    const parsedOrigin =
      input.origin === undefined
        ? undefined
        : MapCoordinateSchema.safeParse(input.origin);
    if (input.origin !== undefined && !parsedOrigin?.success) {
      throw new TurnMapRegistryError(
        'invalid_composition',
        'Map origin is invalid.',
      );
    }
    const origin = parsedOrigin?.success ? parsedOrigin.data : undefined;
    if (
      input.placeHandles !== undefined &&
      !Array.isArray(input.placeHandles)
    ) {
      throw new TurnMapRegistryError(
        'invalid_composition',
        'placeHandles must be an array.',
      );
    }
    const placeHandles = input.placeHandles ?? [];
    validateHandleList(placeHandles, 'place');

    const selectedPlaces: TurnMapPlaceRegistration[] = [];
    const selectedIdentities = new Set<string>();
    for (const handle of placeHandles) {
      if (!isPlaceHandle(handle)) {
        throw this.unknownPlace(handle);
      }
      const registration = this.places.get(handle);
      if (!registration) throw this.unknownPlace(handle);
      const identity = placeIdentity(registration.place);
      if (!selectedIdentities.has(identity)) {
        selectedIdentities.add(identity);
        selectedPlaces.push(registration);
      }
    }

    let routeRegistration: TurnMapRouteRegistration | undefined;
    if (input.routeHandle !== undefined) {
      if (
        typeof input.routeHandle !== 'string' ||
        !isRouteHandle(input.routeHandle)
      ) {
        throw this.unknownRoute(input.routeHandle);
      }
      routeRegistration = this.routes.get(input.routeHandle);
      if (!routeRegistration) throw this.unknownRoute(input.routeHandle);
    }
    if (
      origin &&
      routeRegistration &&
      !('routeNotRetained' in routeRegistration.route) &&
      !sameCoordinate(origin, routeRegistration.route.origin)
    ) {
      throw new TurnMapRegistryError(
        'invalid_composition',
        'Map origin must match the selected route origin.',
        this.availableMaps(),
        undefined,
        undefined,
        this.availablePlaces(),
        this.availableRoutes(),
      );
    }
    if (selectedPlaces.length === 0 && routeRegistration === undefined) {
      throw new TurnMapRegistryError(
        'invalid_composition',
        'A map needs at least one selected place or route.',
        this.availableMaps(),
        undefined,
        undefined,
        this.availablePlaces(),
        this.availableRoutes(),
      );
    }

    const endpointHandles = routeRegistration
      ? (() => {
          const explicit = routeEndpointHandles(routeRegistration);
          const inferred = this.inferEndpointHandles(routeRegistration.route, [
            ...this.places.values(),
          ]);
          const endpoints: Array<string | undefined> = [
            explicit[0] ?? inferred.originPlaceHandle,
            explicit[1] ?? inferred.destinationPlaceHandle,
          ];
          return 'routeNotRetained' in routeRegistration.route
            ? [undefined, endpoints[1]]
            : endpoints;
        })()
      : [];
    if (routeRegistration) {
      for (const handle of endpointHandles) {
        if (handle === undefined) continue;
        const endpoint = this.places.get(handle);
        if (!endpoint) {
          // A route can never point at a place that was not validated in the
          // same turn, even when the route itself came from a replay.
          throw this.unknownPlace(handle);
        }
        const identity = placeIdentity(endpoint.place);
        if (!selectedIdentities.has(identity)) {
          selectedIdentities.add(identity);
          selectedPlaces.push(endpoint);
        }
      }
    }

    const locationPlace = selectedPlaces.find(
      ({ locationOrigin }) => locationOrigin !== undefined,
    );
    const locationRoute =
      routeRegistration?.locationOrigin && routeRegistration.locationRetention
        ? routeRegistration
        : undefined;
    const compositionOrigin =
      origin ?? locationRoute?.locationOrigin ?? locationPlace?.locationOrigin;
    const inferredOriginRetention =
      locationRoute?.locationRetention ?? locationPlace?.locationRetention;
    const retainOrigin =
      origin !== undefined
        ? shouldRetainOrigin(input)
        : inferredOriginRetention === 'save';
    const title = parseTitle(input.title);
    const summary = parseSummary(input.summary);
    const retrievedAt =
      parseRetrievedAt(input.retrievedAt, 'invalid_composition') ??
      routeRegistration?.retrievedAt ??
      selectedPlaces.find((place) => place.retrievedAt)?.retrievedAt ??
      new Date().toISOString();
    const retainRoute = input.routeRetained ?? input.retainRoute !== false;
    const keepRoute =
      retainRoute &&
      routeRegistration?.routeRetained !== false &&
      (!compositionOrigin ||
        retainOrigin ||
        inferredOriginRetention === 'save');
    const route = routeRegistration
      ? keepRoute
        ? cloneRoute(routeRegistration.route)
        : redactedRoute(routeRegistration.route)
      : undefined;
    // Count the projection that is actually stored with the map. A route
    // redacted for a transient origin has an unknown origin pin, so its
    // accounting must not depend on live-only endpoint metadata.
    const pinEndpointHandles =
      route && 'routeNotRetained' in route
        ? [undefined, endpointHandles[1]]
        : endpointHandles;
    const pinKeys = mapPinKeys(
      selectedPlaces,
      route,
      pinEndpointHandles,
      compositionOrigin,
    );
    const sessionOverlay: TurnMapSessionOverlay | undefined =
      locationRoute?.locationRetention === 'once' &&
      !('routeNotRetained' in locationRoute.route)
        ? {
            origin: { ...locationRoute.route.origin },
            route: cloneRoute(locationRoute.route) as MapRoute,
            retention: 'once',
          }
        : locationPlace?.locationRetention === 'once' &&
            locationPlace.locationOrigin
          ? {
              origin: { ...locationPlace.locationOrigin },
              retention: 'once',
            }
          : undefined;
    if (pinKeys.size > MAP_LIMITS.maxPlaces) {
      throw new TurnMapRegistryError(
        'pin_limit',
        `A map can contain at most ${MAP_LIMITS.maxPlaces} unique pins.`,
        this.availableMaps(),
        undefined,
        undefined,
        this.availablePlaces(),
        this.availableRoutes(),
      );
    }
    const attributions = mapSpecAttributions({
      attributions: [
        ...selectedPlaces.map(({ place }) => place.attribution),
        ...(route ? [route.attribution] : []),
      ],
    });
    if (attributions.length === 0) {
      throw new TurnMapRegistryError(
        'invalid_composition',
        'A map needs provider attribution.',
      );
    }
    const candidate = {
      places: selectedPlaces.map(({ place }) => clonePlace(place)),
      ...(retainOrigin && compositionOrigin
        ? { origin: { ...compositionOrigin } }
        : {}),
      ...(route ? { route } : {}),
      ...(route && 'routeNotRetained' in route
        ? { routeNotRetained: true }
        : {}),
      attribution: attributions[0],
      attributions,
      retrievedAt,
      title,
      ...(summary ? { summary } : {}),
    };
    const spec = parseSpec(candidate);
    const snapshot = this.captureState();
    try {
      const registration: TurnMapRegistration = {
        mapId: this.allocateMapId(),
        title,
        spec: cloneSpec(spec),
        pinCount: pinKeys.size,
      };
      this.setRegistration(registration);
      const placement = this.createPlacement(registration);
      if (sessionOverlay) {
        this.sessionOverlays.set(
          registration.mapId,
          cloneSessionOverlay(sessionOverlay),
        );
      }
      return placement;
    } catch (error) {
      this.restoreState(snapshot);
      throw error;
    }
  }

  /** Short aliases used by trusted map writers. */
  compose(input: TurnMapCompositionInput): TurnMapPlacement {
    return this.composeMap(input);
  }

  registerMap(input: TurnMapCompositionInput): TurnMapPlacement {
    return this.composeMap(input);
  }

  placeMap(input: TurnMapCompositionInput): TurnMapPlacement {
    return this.composeMap(input);
  }

  showMap(input: TurnMapCompositionInput): TurnMapPlacement {
    return this.composeMap(input);
  }

  /**
   * Legacy map placement by a short map handle, or explicit composition when
   * the caller supplies the new object form.
   */
  place(handle: unknown): TurnMapPlacement {
    if (
      handle !== null &&
      typeof handle === 'object' &&
      !Array.isArray(handle) &&
      ('placeHandles' in handle || 'routeHandle' in handle || 'title' in handle)
    ) {
      return this.composeMap(handle as TurnMapCompositionInput);
    }
    const registration = this.require(handle);
    return this.createPlacement(registration);
  }

  /** Record a writer placement received from a stream event. */
  acceptPlacement(input: {
    placementId: string;
    mapId: string;
    handle?: string;
    placementNumber?: number;
  }): TurnMapPlacement {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new TurnMapRegistryError(
        'invalid_placement',
        'Invalid map placement ID.',
        this.availableMaps(),
      );
    }
    if (
      !isValidOpaqueId(input.placementId) ||
      this.registrationsById.has(input.placementId) ||
      typeof input.mapId !== 'string' ||
      !isValidOpaqueId(input.mapId) ||
      (input.handle !== undefined && !isMapHandle(input.handle)) ||
      (input.placementNumber !== undefined &&
        (!Number.isSafeInteger(input.placementNumber) ||
          input.placementNumber < 1))
    ) {
      throw new TurnMapRegistryError(
        'invalid_placement',
        'Invalid map placement ID.',
        this.availableMaps(),
        input.handle,
        input.mapId,
      );
    }
    const registration = this.requireById(input.mapId);
    if (
      input.handle !== undefined &&
      (registration.handle === undefined ||
        input.handle !== registration.handle)
    ) {
      throw new TurnMapRegistryError(
        'unknown_handle',
        'Map placement handle does not match its registered map.',
        this.availableMaps(),
        input.handle,
        input.mapId,
      );
    }

    const existing = this.placements.get(input.placementId);
    if (existing) {
      if (
        existing.mapId !== input.mapId ||
        (input.placementNumber !== undefined &&
          existing.placementNumber !== input.placementNumber)
      ) {
        throw new TurnMapRegistryError(
          'invalid_placement',
          'Map placement ID is already assigned to another placement.',
          this.availableMaps(),
          input.handle,
          input.mapId,
        );
      }
      return clonePlacement(existing);
    }
    // Older snapshots stored only the accepted ID. Replaying that event must
    // remain a no-op rather than incrementing the placement count a second time.
    if (this.placementIds.has(input.placementId)) {
      let placementNumber =
        input.placementNumber ??
        placementIdNumber(input.placementId) ??
        this.acceptedPlacementNumber(input.placementId) ??
        this.nextPlacementNumber();
      if (
        [...this.placements.values()].some(
          (placement) => placement.placementNumber === placementNumber,
        ) ||
        [...this.placementIds].some(
          (placementId) =>
            placementId !== input.placementId &&
            placementIdNumber(placementId) === placementNumber,
        )
      ) {
        placementNumber = this.nextPlacementNumber();
      }
      const placement: TurnMapPlacement = {
        ...registration,
        placementId: input.placementId,
        placementNumber,
      };
      this.placements.set(input.placementId, clonePlacement(placement));
      if (registration.handle) this.placedHandles.add(registration.handle);
      return clonePlacement(placement);
    }

    const placementNumber = input.placementNumber ?? this.nextPlacementNumber();
    if (
      [...this.placements.values()].some(
        (placement) => placement.placementNumber === placementNumber,
      ) ||
      [...this.placementIds].some(
        (placementId) => placementIdNumber(placementId) === placementNumber,
      )
    ) {
      throw new TurnMapRegistryError(
        'invalid_placement',
        'Map placement number is already assigned.',
        this.availableMaps(),
        input.handle,
        input.mapId,
      );
    }
    const placement: TurnMapPlacement = {
      ...registration,
      placementId: input.placementId,
      placementNumber,
    };
    this.placementIds.add(input.placementId);
    this.placementCountValue += 1;
    this.placements.set(input.placementId, clonePlacement(placement));
    if (registration.handle) this.placedHandles.add(registration.handle);
    return clonePlacement(placement);
  }

  recordPlacement = this.acceptPlacement.bind(this);

  isPlaced(handle: unknown): boolean {
    if (typeof handle !== 'string') return false;
    if (this.placedHandles.has(handle)) return true;
    return [...this.placements.values()].some(
      (placement) => placement.mapId === handle || placement.handle === handle,
    );
  }

  isPlacementAccepted(placementId: unknown): boolean {
    return (
      typeof placementId === 'string' && this.placementIds.has(placementId)
    );
  }

  availableMaps(): AvailableTurnMap[] {
    return [...this.registrationsById.values()]
      .filter(
        (
          registration,
        ): registration is TurnMapRegistration & { handle: string } =>
          registration.handle !== undefined,
      )
      .map(({ handle, title }) => ({ handle, title }));
  }

  snapshot(): TurnMapRegistrySnapshot {
    return {
      registrations: [...this.registrationsById.values()].map(
        cloneRegistration,
      ),
      nextHandle: this.nextHandleValue,
      placementCount: this.placementCountValue,
      placedHandles: [...this.placedHandles],
      placementIds: [...this.placementIds],
      places: [...this.places.values()].map(cloneSafePlaceRegistration),
      routes: [...this.routes.values()].map(cloneSafeRouteRegistration),
      placements: [...this.placements.values()].map(clonePlacement),
      nextPlaceHandle: this.nextPlaceHandleValue,
      nextRouteHandle: this.nextRouteHandleValue,
    };
  }

  restore(snapshot: TurnMapRegistrySnapshot): void {
    const parsed = this.parseSnapshot(snapshot);

    this.clear();
    for (const registration of parsed.registrations) {
      this.setRegistration(registration);
    }
    for (const registration of parsed.places) {
      this.places.set(registration.handle, registration);
      this.placesByIdentity.set(
        placeIdentity(registration.place),
        registration,
      );
    }
    for (const registration of parsed.routes) {
      this.routes.set(registration.handle, registration);
      this.routesByKey.set(routeKey(registration.route), registration);
    }
    for (const placement of parsed.placements) {
      this.placements.set(placement.placementId, placement);
    }
    this.nextHandleValue = parsed.nextHandle;
    this.nextPlaceHandleValue = parsed.nextPlaceHandle;
    this.nextRouteHandleValue = parsed.nextRouteHandle;
    this.placementCountValue = parsed.placementCount;
    for (const handle of parsed.placedHandles) this.placedHandles.add(handle);
    for (const placementId of parsed.placementIds) {
      this.placementIds.add(placementId);
    }
  }

  /** Clear all turn-local discoveries, maps, placements, and counters. */
  clear(): void {
    this.registrationsById.clear();
    this.registrationsByHandle.clear();
    this.places.clear();
    this.placesByIdentity.clear();
    this.routes.clear();
    this.routesByKey.clear();
    this.placements.clear();
    this.sessionOverlays.clear();
    this.placementIds.clear();
    this.placedHandles.clear();
    this.nextHandleValue = 1;
    this.nextPlaceHandleValue = 1;
    this.nextRouteHandleValue = 1;
    this.placementCountValue = 0;
  }

  cleanup = this.clear.bind(this);

  private parseSnapshot(snapshot: TurnMapRegistrySnapshot): {
    registrations: TurnMapRegistration[];
    places: TurnMapPlaceRegistration[];
    routes: TurnMapRouteRegistration[];
    placements: TurnMapPlacement[];
    placementIds: Set<string>;
    placedHandles: Set<string>;
    nextHandle: number;
    nextPlaceHandle: number;
    nextRouteHandle: number;
    placementCount: number;
  } {
    if (!snapshot || typeof snapshot !== 'object') {
      throw new TurnMapRegistryError(
        'invalid_snapshot',
        'Invalid turn map registry snapshot.',
      );
    }
    const value = snapshot as TurnMapRegistrySnapshot;
    const registrationEntries =
      value.registrations ?? value.mapRegistrations ?? value.maps;
    if (!Array.isArray(registrationEntries)) {
      throw new TurnMapRegistryError(
        'invalid_snapshot',
        'Invalid turn map registry snapshot.',
      );
    }
    const placeEntries = value.places ?? value.placeRegistrations ?? [];
    const routeEntries = value.routes ?? value.routeRegistrations ?? [];
    if (!Array.isArray(placeEntries) || !Array.isArray(routeEntries)) {
      throw new TurnMapRegistryError(
        'invalid_snapshot',
        'Invalid turn map registry snapshot.',
      );
    }
    const placementEntries = value.placements;
    if (placementEntries !== undefined && !Array.isArray(placementEntries)) {
      throw new TurnMapRegistryError(
        'invalid_snapshot',
        'Invalid turn map registry placements.',
      );
    }
    if (
      !isValidCounter(value.nextHandle) ||
      (value.nextPlaceHandle !== undefined &&
        !isValidCounter(value.nextPlaceHandle)) ||
      (value.nextRouteHandle !== undefined &&
        !isValidCounter(value.nextRouteHandle)) ||
      !isValidNonnegativeCounter(value.placementCount)
    ) {
      throw new TurnMapRegistryError(
        'invalid_snapshot',
        'Invalid turn map registry counters.',
      );
    }

    const registrations: TurnMapRegistration[] = [];
    const registrationsByHandle = new Map<string, TurnMapRegistration>();
    const registrationsById = new Map<string, TurnMapRegistration>();
    for (const entry of registrationEntries) {
      if (!entry || typeof entry !== 'object') {
        throw new TurnMapRegistryError(
          'invalid_snapshot',
          'Invalid turn map registry snapshot.',
        );
      }
      const handle = entry.handle;
      if (
        (handle !== undefined &&
          (typeof handle !== 'string' || !isMapHandle(handle))) ||
        typeof entry.mapId !== 'string' ||
        !isValidOpaqueId(entry.mapId) ||
        typeof entry.title !== 'string' ||
        entry.title.length > 240 ||
        registrationsById.has(entry.mapId) ||
        (handle !== undefined && registrationsByHandle.has(handle))
      ) {
        throw new TurnMapRegistryError(
          'invalid_snapshot',
          'Invalid turn map registry snapshot.',
        );
      }
      const spec = parseSpec(entry.spec);
      const pinCount = mapSpecPinCount(spec);
      if (
        pinCount > MAP_LIMITS.maxPlaces ||
        (entry.pinCount !== undefined &&
          (!Number.isSafeInteger(entry.pinCount) ||
            entry.pinCount < 0 ||
            entry.pinCount > MAP_LIMITS.maxPlaces ||
            entry.pinCount !== pinCount))
      ) {
        throw new TurnMapRegistryError(
          'invalid_snapshot',
          'Invalid turn map registry pin count.',
        );
      }
      const registration: TurnMapRegistration = {
        ...(handle ? { handle } : {}),
        mapId: entry.mapId,
        title: entry.title,
        spec: cloneSpec(spec),
        pinCount,
      };
      registrations.push(registration);
      registrationsById.set(registration.mapId, registration);
      if (registration.handle) {
        registrationsByHandle.set(registration.handle, registration);
      }
    }

    const places: TurnMapPlaceRegistration[] = [];
    const placesByHandle = new Map<string, TurnMapPlaceRegistration>();
    const placesByIdentity = new Map<string, TurnMapPlaceRegistration>();
    for (const entry of placeEntries) {
      if (!entry || typeof entry !== 'object') {
        throw new TurnMapRegistryError(
          'invalid_snapshot',
          'Invalid turn map place registrations.',
        );
      }
      if (
        typeof entry.handle !== 'string' ||
        !isPlaceHandle(entry.handle) ||
        placesByHandle.has(entry.handle)
      ) {
        throw new TurnMapRegistryError(
          'invalid_snapshot',
          'Invalid turn map place registrations.',
        );
      }
      const parsedPlace = MapPlaceSchema.safeParse(entry.place);
      if (!parsedPlace.success) {
        throw new TurnMapRegistryError(
          'invalid_snapshot',
          'Invalid turn map place registrations.',
        );
      }
      const identity = placeIdentity(parsedPlace.data);
      if (placesByIdentity.has(identity)) {
        throw new TurnMapRegistryError(
          'invalid_snapshot',
          'Duplicate provider place identity.',
        );
      }
      const retrievedAt = parseRetrievedAt(entry.retrievedAt);
      const registration: TurnMapPlaceRegistration = {
        handle: entry.handle,
        place: clonePlace(parsedPlace.data),
        ...(retrievedAt ? { retrievedAt } : {}),
      };
      places.push(registration);
      placesByHandle.set(registration.handle, registration);
      placesByIdentity.set(identity, registration);
    }

    // Older snapshots only stored complete map specs. Reconstruct their
    // independent place handles without retaining any map-specific ownership.
    let nextPlaceHandle = value.nextPlaceHandle ?? 1;
    const placeFor = (place: MapPlace): TurnMapPlaceRegistration => {
      const identity = placeIdentity(place);
      const existing = placesByIdentity.get(identity);
      if (existing) return existing;
      while (placesByHandle.has(`place_${nextPlaceHandle}`)) {
        nextPlaceHandle += 1;
      }
      const created: TurnMapPlaceRegistration = {
        handle: `place_${nextPlaceHandle}`,
        place: clonePlace(place),
      };
      nextPlaceHandle += 1;
      places.push(created);
      placesByHandle.set(created.handle, created);
      placesByIdentity.set(identity, created);
      return created;
    };
    for (const registration of registrations) {
      for (const place of registration.spec.places) placeFor(place);
    }

    const routes: TurnMapRouteRegistration[] = [];
    const routesByHandle = new Map<string, TurnMapRouteRegistration>();
    const routesByKey = new Map<string, TurnMapRouteRegistration>();
    const addRoute = (entry: TurnMapRouteRegistration) => {
      if (
        routesByHandle.has(entry.handle) ||
        routesByKey.has(routeKey(entry.route))
      ) {
        return;
      }
      routes.push(entry);
      routesByHandle.set(entry.handle, entry);
      routesByKey.set(routeKey(entry.route), entry);
    };
    for (const entry of routeEntries) {
      if (
        !entry ||
        typeof entry !== 'object' ||
        typeof entry.handle !== 'string' ||
        !isRouteHandle(entry.handle) ||
        routesByHandle.has(entry.handle)
      ) {
        throw new TurnMapRegistryError(
          'invalid_snapshot',
          'Invalid turn map route registrations.',
        );
      }
      const route = parseRoute(entry.route);
      let endpoints: ReturnType<typeof normalizeRoutePlaceHandles>;
      try {
        endpoints = normalizeRoutePlaceHandles(entry, route);
      } catch {
        throw new TurnMapRegistryError(
          'invalid_snapshot',
          'Invalid turn map route endpoint references.',
        );
      }
      const placeHandles = endpoints.placeHandles;
      if (
        placeHandles.some(
          (handle) => typeof handle !== 'string' || !placesByHandle.has(handle),
        ) ||
        (entry.routeRetained !== undefined &&
          typeof entry.routeRetained !== 'boolean')
      ) {
        throw new TurnMapRegistryError(
          'invalid_snapshot',
          'Invalid turn map route endpoint references.',
        );
      }
      const endpointChecks: Array<
        [string | undefined, { lat: number; lon: number } | undefined]
      > = [
        [
          endpoints.originPlaceHandle,
          'routeNotRetained' in route ? undefined : route.origin,
        ],
        [endpoints.destinationPlaceHandle, route.destination],
      ];
      for (const [handle, coordinate] of endpointChecks) {
        if (!handle || !coordinate) continue;
        const place = placesByHandle.get(handle);
        if (!place || !sameCoordinate(place.place.coordinate, coordinate)) {
          throw new TurnMapRegistryError(
            'invalid_snapshot',
            'Invalid turn map route endpoint references.',
          );
        }
      }
      const retrievedAt = parseRetrievedAt(entry.retrievedAt);
      const storedRoute =
        entry.routeRetained === false ? redactedRoute(route) : route;
      const storedEndpoints =
        'routeNotRetained' in storedRoute
          ? {
              placeHandles: endpoints.destinationPlaceHandle
                ? [endpoints.destinationPlaceHandle]
                : [],
              ...(endpoints.destinationPlaceHandle
                ? {
                    destinationPlaceHandle: endpoints.destinationPlaceHandle,
                  }
                : {}),
            }
          : endpoints;
      const routeKeyValue = routeKey(storedRoute);
      if (routesByKey.has(routeKeyValue)) {
        throw new TurnMapRegistryError(
          'invalid_snapshot',
          'Duplicate provider route identity.',
        );
      }
      addRoute({
        handle: entry.handle,
        route: cloneRoute(storedRoute),
        ...(storedEndpoints.placeHandles.length > 0
          ? { placeHandles: [...storedEndpoints.placeHandles] }
          : {}),
        ...(storedEndpoints.originPlaceHandle
          ? { originPlaceHandle: storedEndpoints.originPlaceHandle }
          : {}),
        ...(storedEndpoints.destinationPlaceHandle
          ? { destinationPlaceHandle: storedEndpoints.destinationPlaceHandle }
          : {}),
        ...(retrievedAt ? { retrievedAt } : {}),
        ...(entry.routeRetained === false || 'routeNotRetained' in route
          ? { routeRetained: false }
          : {}),
      });
    }

    // Derive route discoveries from old map registrations when no route
    // milestone was available. The full route remains available only when its
    // persisted spec retained it; a redacted route stays redacted.
    let nextRouteHandle = value.nextRouteHandle ?? 1;
    const routeFor = (
      route: PersistableMapRoute,
      placesInMap: readonly MapPlace[],
    ): TurnMapRouteRegistration => {
      const existing = routesByKey.get(routeKey(route));
      if (existing) return existing;
      while (routesByHandle.has(`route_${nextRouteHandle}`)) {
        nextRouteHandle += 1;
      }
      const findEndpoint = (coordinate: { lat: number; lon: number }) => {
        const match = placesInMap.find(
          (place) =>
            place.coordinate.lat === coordinate.lat &&
            place.coordinate.lon === coordinate.lon,
        );
        return match ? placeFor(match).handle : undefined;
      };
      const originPlaceHandle =
        'routeNotRetained' in route ? undefined : findEndpoint(route.origin);
      const destinationPlaceHandle = findEndpoint(route.destination);
      const created: TurnMapRouteRegistration = {
        handle: `route_${nextRouteHandle}`,
        route: cloneRoute(route),
        ...([originPlaceHandle, destinationPlaceHandle].some(
          (handle) => handle !== undefined,
        )
          ? {
              placeHandles: [originPlaceHandle, destinationPlaceHandle].filter(
                (handle): handle is string => handle !== undefined,
              ),
            }
          : {}),
        ...(originPlaceHandle ? { originPlaceHandle } : {}),
        ...(destinationPlaceHandle ? { destinationPlaceHandle } : {}),
        ...('routeNotRetained' in route ? { routeRetained: false } : {}),
      };
      nextRouteHandle += 1;
      addRoute(created);
      return created;
    };
    for (const registration of registrations) {
      if (registration.spec.route) {
        routeFor(registration.spec.route, registration.spec.places);
      }
    }

    const placements: TurnMapPlacement[] = [];
    const placementsById = new Map<string, TurnMapPlacement>();
    const placementNumbers = new Set<number>();
    for (const [index, entry] of (placementEntries ?? []).entries()) {
      if (
        !entry ||
        typeof entry !== 'object' ||
        typeof entry.placementId !== 'string' ||
        !isValidOpaqueId(entry.placementId) ||
        placementsById.has(entry.placementId) ||
        typeof entry.mapId !== 'string' ||
        !registrationsById.has(entry.mapId)
      ) {
        throw new TurnMapRegistryError(
          'invalid_snapshot',
          'Invalid turn map registry placements.',
        );
      }
      const registration = registrationsById.get(
        entry.mapId,
      ) as TurnMapRegistration;
      if (
        entry.handle !== undefined &&
        (typeof entry.handle !== 'string' ||
          entry.handle !== registration.handle)
      ) {
        throw new TurnMapRegistryError(
          'invalid_snapshot',
          'Invalid turn map registry placement handle.',
        );
      }
      const placementNumber = entry.placementNumber ?? index + 1;
      if (
        !Number.isSafeInteger(placementNumber) ||
        placementNumber < 1 ||
        placementNumbers.has(placementNumber)
      ) {
        throw new TurnMapRegistryError(
          'invalid_snapshot',
          'Invalid turn map registry placement number.',
        );
      }
      placementNumbers.add(placementNumber);
      const placement: TurnMapPlacement = {
        ...registration,
        placementId: entry.placementId,
        placementNumber,
      };
      placements.push(clonePlacement(placement));
      placementsById.set(placement.placementId, placement);
    }

    const placementIds = new Set<string>();
    if (value.placementIds !== undefined) {
      if (!Array.isArray(value.placementIds)) {
        throw new TurnMapRegistryError(
          'invalid_snapshot',
          'Invalid turn map registry placement IDs.',
        );
      }
      for (const placementId of value.placementIds) {
        if (
          typeof placementId !== 'string' ||
          !isValidOpaqueId(placementId) ||
          placementIds.has(placementId)
        ) {
          throw new TurnMapRegistryError(
            'invalid_snapshot',
            'Invalid turn map registry placement IDs.',
          );
        }
        placementIds.add(placementId);
      }
    }
    for (const placement of placements) placementIds.add(placement.placementId);
    if (
      registrations.some((registration) => placementIds.has(registration.mapId))
    ) {
      throw new TurnMapRegistryError(
        'invalid_snapshot',
        'Map ID collides with a placement ID.',
      );
    }
    if (placementIds.size > value.placementCount) {
      throw new TurnMapRegistryError(
        'invalid_snapshot',
        'Invalid turn map registry placement count.',
      );
    }

    const placedHandles = new Set<string>();
    if (value.placedHandles !== undefined) {
      if (!Array.isArray(value.placedHandles)) {
        throw new TurnMapRegistryError(
          'invalid_snapshot',
          'Invalid turn map registry placement handles.',
        );
      }
      for (const handle of value.placedHandles) {
        if (
          typeof handle !== 'string' ||
          !registrationsByHandle.has(handle) ||
          placedHandles.has(handle)
        ) {
          throw new TurnMapRegistryError(
            'invalid_snapshot',
            'Invalid turn map registry placement handles.',
          );
        }
        placedHandles.add(handle);
      }
    }
    for (const placement of placements) {
      if (placement.handle) placedHandles.add(placement.handle);
    }
    if (
      value.placementCount === 0 &&
      (placementIds.size > 0 || placedHandles.size > 0)
    ) {
      throw new TurnMapRegistryError(
        'invalid_snapshot',
        'Invalid turn map registry placement count.',
      );
    }
    if (placedHandles.size > value.placementCount) {
      throw new TurnMapRegistryError(
        'invalid_snapshot',
        'Invalid turn map registry placement count.',
      );
    }

    const maxMapHandle = registrations
      .map((registration) =>
        registration.handle
          ? Number(registration.handle.slice('map_'.length))
          : 0,
      )
      .reduce((max, value) => Math.max(max, value), 0);
    const maxPlaceHandle = places
      .map((registration) => Number(registration.handle.slice('place_'.length)))
      .reduce((max, value) => Math.max(max, value), 0);
    const maxRouteHandle = routes
      .map((registration) => Number(registration.handle.slice('route_'.length)))
      .reduce((max, value) => Math.max(max, value), 0);

    return {
      registrations,
      places,
      routes,
      placements,
      placementIds,
      placedHandles,
      nextHandle: Math.max(value.nextHandle, maxMapHandle + 1),
      nextPlaceHandle: Math.max(
        value.nextPlaceHandle ?? 1,
        nextPlaceHandle,
        maxPlaceHandle + 1,
      ),
      nextRouteHandle: Math.max(
        value.nextRouteHandle ?? 1,
        nextRouteHandle,
        maxRouteHandle + 1,
      ),
      placementCount: value.placementCount,
    };
  }

  private validateRouteEndpoints(
    route: PersistableMapRoute,
    endpoints: {
      originPlaceHandle?: string;
      destinationPlaceHandle?: string;
    },
    errorCode: 'invalid_snapshot' | 'invalid_composition',
  ): void {
    const checks: Array<
      [string | undefined, { lat: number; lon: number } | undefined]
    > = [
      [
        endpoints.originPlaceHandle,
        'routeNotRetained' in route ? undefined : route.origin,
      ],
      [endpoints.destinationPlaceHandle, route.destination],
    ];
    for (const [handle, coordinate] of checks) {
      if (!handle || !coordinate) continue;
      const place = this.places.get(handle);
      if (
        !place ||
        place.place.coordinate.lat !== coordinate.lat ||
        place.place.coordinate.lon !== coordinate.lon
      ) {
        throw new TurnMapRegistryError(
          errorCode,
          'A route endpoint handle does not match the provider route endpoint.',
        );
      }
    }
  }

  private unknownPlace(handle: unknown): TurnMapRegistryError {
    const display = typeof handle === 'string' ? handle : String(handle);
    return new TurnMapRegistryError(
      'unknown_place_handle',
      `Unknown place handle "${display}". Choose a validated place from this turn: ${availablePlaceText(this.availablePlaces())}`,
      this.availableMaps(),
      typeof handle === 'string' ? handle : undefined,
      undefined,
      this.availablePlaces(),
      this.availableRoutes(),
    );
  }

  private unknownRoute(handle: unknown): TurnMapRegistryError {
    const display = typeof handle === 'string' ? handle : String(handle);
    return new TurnMapRegistryError(
      'unknown_route_handle',
      `Unknown route handle "${display}". Choose a validated route from this turn: ${availableRouteText(this.availableRoutes())}`,
      this.availableMaps(),
      typeof handle === 'string' ? handle : undefined,
      undefined,
      this.availablePlaces(),
      this.availableRoutes(),
    );
  }

  private registerReferences(registration: TurnMapRegistration): void {
    const placeRegistrations = this.registerPlaces(registration.spec.places);
    const route = registration.spec.route;
    // A transient route is carried by the page-session overlay, not as a
    // reusable turn-local discovery. Its redacted map spec remains safe to
    // restore, but must not create a model-facing route handle.
    if (!route || 'routeNotRetained' in route) return;
    const endpointHandles = this.inferEndpointHandles(
      route,
      placeRegistrations,
    );
    try {
      this.registerRoute(route, {
        ...(endpointHandles.originPlaceHandle
          ? { originPlaceHandle: endpointHandles.originPlaceHandle }
          : {}),
        ...(endpointHandles.destinationPlaceHandle
          ? { destinationPlaceHandle: endpointHandles.destinationPlaceHandle }
          : {}),
        ...(route && 'routeNotRetained' in route ? { retainRoute: false } : {}),
      });
    } catch {
      // A legacy map spec remains usable even if its independent route record
      // cannot be reconstructed; the canonical map registration is intact.
    }
  }

  private inferEndpointHandles(
    route: PersistableMapRoute,
    places: readonly TurnMapPlaceRegistration[],
  ): {
    originPlaceHandle?: string;
    destinationPlaceHandle?: string;
  } {
    const find = (coordinate: { lat: number; lon: number }) =>
      places.find(
        ({ place }) =>
          place.coordinate.lat === coordinate.lat &&
          place.coordinate.lon === coordinate.lon,
      )?.handle;
    return 'routeNotRetained' in route
      ? { destinationPlaceHandle: find(route.destination) }
      : {
          originPlaceHandle: find(route.origin),
          destinationPlaceHandle: find(route.destination),
        };
  }

  private mergeRouteMetadata(
    registration: TurnMapRouteRegistration,
    endpoints: {
      placeHandles: string[];
      originPlaceHandle?: string;
      destinationPlaceHandle?: string;
    },
    retrievedAt: string | undefined,
  ): void {
    const originPlaceHandle =
      registration.originPlaceHandle ?? endpoints.originPlaceHandle;
    const destinationPlaceHandle =
      registration.destinationPlaceHandle ?? endpoints.destinationPlaceHandle;
    if (originPlaceHandle !== undefined) {
      registration.originPlaceHandle = originPlaceHandle;
    }
    if (destinationPlaceHandle !== undefined) {
      registration.destinationPlaceHandle = destinationPlaceHandle;
    }
    const placeHandles = [originPlaceHandle, destinationPlaceHandle].filter(
      (handle): handle is string => handle !== undefined,
    );
    if (placeHandles.length > 0) registration.placeHandles = placeHandles;
    if (registration.retrievedAt === undefined && retrievedAt !== undefined) {
      registration.retrievedAt = retrievedAt;
    }
  }

  private captureState(): TurnMapRegistryInternalSnapshot {
    return {
      registrations: [...this.registrationsById.values()].map(
        cloneRegistration,
      ),
      places: [...this.places.values()].map(clonePlaceRegistration),
      routes: [...this.routes.values()].map(cloneRouteRegistration),
      placements: [...this.placements.values()].map(clonePlacement),
      sessionOverlays: [...this.sessionOverlays.entries()].map(
        ([mapId, overlay]) =>
          [mapId, cloneSessionOverlay(overlay)] as [
            string,
            TurnMapSessionOverlay,
          ],
      ),
      placementIds: [...this.placementIds],
      placedHandles: [...this.placedHandles],
      nextHandle: this.nextHandleValue,
      nextPlaceHandle: this.nextPlaceHandleValue,
      nextRouteHandle: this.nextRouteHandleValue,
      placementCount: this.placementCountValue,
    };
  }

  private restoreState(snapshot: TurnMapRegistryInternalSnapshot): void {
    this.clear();
    for (const registration of snapshot.registrations) {
      this.setRegistration(registration);
    }
    for (const registration of snapshot.places) {
      this.places.set(registration.handle, registration);
      this.placesByIdentity.set(
        placeIdentity(registration.place),
        registration,
      );
    }
    for (const registration of snapshot.routes) {
      this.routes.set(registration.handle, registration);
      this.routesByKey.set(routeKey(registration.route), registration);
    }
    for (const placement of snapshot.placements) {
      this.placements.set(placement.placementId, placement);
    }
    for (const [mapId, overlay] of snapshot.sessionOverlays) {
      this.sessionOverlays.set(mapId, cloneSessionOverlay(overlay));
    }
    this.nextHandleValue = snapshot.nextHandle;
    this.nextPlaceHandleValue = snapshot.nextPlaceHandle;
    this.nextRouteHandleValue = snapshot.nextRouteHandle;
    this.placementCountValue = snapshot.placementCount;
    for (const handle of snapshot.placedHandles) {
      this.placedHandles.add(handle);
    }
    for (const placementId of snapshot.placementIds) {
      this.placementIds.add(placementId);
    }
  }

  private setRegistration(registration: TurnMapRegistration): void {
    this.registrationsById.set(registration.mapId, registration);
    if (registration.handle) {
      this.registrationsByHandle.set(registration.handle, registration);
    }
  }

  private createPlacement(registration: TurnMapRegistration): TurnMapPlacement {
    const placementNumber = this.nextPlacementNumber();
    const placement: TurnMapPlacement = {
      ...registration,
      placementId: `map_placement_${placementNumber}`,
      placementNumber,
    };
    this.placementCountValue += 1;
    this.placementIds.add(placement.placementId);
    this.placements.set(placement.placementId, clonePlacement(placement));
    if (registration.handle) this.placedHandles.add(registration.handle);
    return clonePlacement(placement);
  }

  private acceptedPlacementNumber(placementId: string): number | undefined {
    const index = [...this.placementIds].indexOf(placementId);
    if (index < 0) return undefined;
    const number = index + 1;
    return Number.isSafeInteger(number) ? number : undefined;
  }

  private nextPlacementNumber(): number {
    let placementNumber = this.placementCountValue;
    for (const placement of this.placements.values()) {
      placementNumber = Math.max(placementNumber, placement.placementNumber);
    }
    for (const placementId of this.placementIds) {
      const suffix = placementIdNumber(placementId);
      if (suffix !== undefined) {
        placementNumber = Math.max(placementNumber, suffix);
      }
    }
    placementNumber += 1;
    while (
      this.placementIds.has(`map_placement_${placementNumber}`) ||
      this.registrationsById.has(`map_placement_${placementNumber}`)
    ) {
      placementNumber += 1;
    }
    return placementNumber;
  }

  private allocatePlaceHandle(): string {
    while (this.places.has(`place_${this.nextPlaceHandleValue}`)) {
      this.nextPlaceHandleValue += 1;
    }
    const handle = `place_${this.nextPlaceHandleValue}`;
    this.nextPlaceHandleValue += 1;
    return handle;
  }

  private allocateRouteHandle(): string {
    while (this.routes.has(`route_${this.nextRouteHandleValue}`)) {
      this.nextRouteHandleValue += 1;
    }
    const handle = `route_${this.nextRouteHandleValue}`;
    this.nextRouteHandleValue += 1;
    return handle;
  }

  private allocateHandle(): string {
    while (this.registrationsByHandle.has(`map_${this.nextHandleValue}`)) {
      this.nextHandleValue += 1;
    }
    const handle = `map_${this.nextHandleValue}`;
    this.nextHandleValue += 1;
    return handle;
  }

  private allocateMapId(): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const mapId = this.idFactory();
      if (
        typeof mapId === 'string' &&
        isValidOpaqueId(mapId) &&
        !this.registrationsById.has(mapId) &&
        !this.placementIds.has(mapId) &&
        !isGeneratedPlacementId(mapId)
      ) {
        return mapId;
      }
    }
    throw new TurnMapRegistryError(
      'invalid_snapshot',
      'Could not allocate a unique internal map ID.',
      this.availableMaps(),
    );
  }
}

/**
 * Rebuild a registry from safe map/discovery milestones. Session overlays are
 * intentionally ignored: they are never durable and cannot recreate a route.
 */
export function restoreTurnMapRegistryFromMilestones(
  registry: TurnMapRegistry,
  milestones: Iterable<TurnMapMilestone>,
): void {
  registry.clear();
  const allMilestones = [...milestones];
  const placements: Array<{
    placementId?: unknown;
    mapId?: unknown;
    handle?: unknown;
    placementNumber?: unknown;
  }> = [];
  const discoveryMilestone = (
    type: string,
    kind: 'place' | 'route',
  ): boolean =>
    kind === 'place'
      ? type === 'map_place' ||
        type === 'map_places' ||
        type === 'map_place_discovery' ||
        type === 'map_places_discovery' ||
        type === 'map_place_discovered' ||
        type === 'map_places_discovered' ||
        type === 'map_place_registration' ||
        type === 'map_places_registration' ||
        type === 'place_discovery' ||
        type === 'places_discovery' ||
        type === 'place_discovered' ||
        type === 'places_discovered' ||
        type === 'place_registration' ||
        type === 'places_registration'
      : type === 'map_route' ||
        type === 'map_routes' ||
        type === 'map_route_discovery' ||
        type === 'map_routes_discovery' ||
        type === 'map_route_discovered' ||
        type === 'map_routes_discovered' ||
        type === 'map_route_registration' ||
        type === 'map_routes_registration' ||
        type === 'route_discovery' ||
        type === 'routes_discovery' ||
        type === 'route_discovered' ||
        type === 'routes_discovered' ||
        type === 'route_registration' ||
        type === 'routes_registration';
  const discoveryRegistrations = (
    value: Record<string, unknown>,
    collection: 'places' | 'routes',
  ): Record<string, unknown>[] => {
    const base =
      value.registration &&
      typeof value.registration === 'object' &&
      !Array.isArray(value.registration)
        ? (value.registration as Record<string, unknown>)
        : value;
    const entries = base[collection] ?? value[collection];
    if (!Array.isArray(entries)) return [base];
    return entries
      .filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
      )
      .map((entry) => ({ ...base, ...entry }));
  };

  // Explicit discovery milestones take precedence over handles derived from
  // an older map_spec, regardless of the order in which the events arrived.
  for (const milestone of allMilestones) {
    if (!milestone || !discoveryMilestone(milestone.type, 'place')) continue;
    const data = milestone.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
    const value = data as Record<string, unknown>;
    for (const registration of discoveryRegistrations(value, 'places')) {
      const handle = registration.handle ?? registration.placeHandle;
      const place = registration.place;
      if (typeof handle !== 'string' || !place) continue;
      try {
        registry.registerKnownPlace({
          handle,
          place: place as MapPlace,
          ...(registration.retrievedAt !== undefined
            ? { retrievedAt: registration.retrievedAt as string }
            : {}),
        });
      } catch {
        // Ignore one malformed discovery without losing other milestones.
      }
    }
  }

  for (const milestone of allMilestones) {
    if (!milestone || !discoveryMilestone(milestone.type, 'route')) continue;
    const data = milestone.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
    const value = data as Record<string, unknown>;
    for (const registration of discoveryRegistrations(value, 'routes')) {
      const handle = registration.handle ?? registration.routeHandle;
      const route = registration.route;
      if (typeof handle !== 'string' || !route) continue;
      try {
        registry.registerKnownRoute({
          handle,
          route: route as PersistableMapRoute,
          ...(Array.isArray(registration.placeHandles)
            ? { placeHandles: registration.placeHandles as string[] }
            : {}),
          ...(Array.isArray(registration.endpointPlaceHandles)
            ? {
                endpointPlaceHandles:
                  registration.endpointPlaceHandles as string[],
              }
            : {}),
          ...(typeof registration.originPlaceHandle === 'string'
            ? { originPlaceHandle: registration.originPlaceHandle }
            : {}),
          ...(typeof registration.destinationPlaceHandle === 'string'
            ? { destinationPlaceHandle: registration.destinationPlaceHandle }
            : {}),
          ...(registration.retrievedAt !== undefined
            ? { retrievedAt: registration.retrievedAt as string }
            : {}),
          ...(registration.retainRoute === false ||
          registration.routeRetained === false ||
          registration.routeNotRetained === true
            ? { retainRoute: false }
            : {}),
          ...(registration.routeRetained === false
            ? { routeRetained: false }
            : {}),
        });
      } catch {
        // Ignore one malformed discovery without losing other milestones.
      }
    }
  }

  for (const milestone of allMilestones) {
    if (!milestone || typeof milestone.type !== 'string') continue;
    const data = milestone.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
    const value = data as Record<string, unknown>;

    if (milestone.type === 'map_spec') {
      const mapId = value.mapId;
      const handle = value.handle ?? value.turnHandle;
      if (
        typeof mapId !== 'string' ||
        (handle !== undefined && typeof handle !== 'string')
      ) {
        continue;
      }
      try {
        registry.registerKnown({
          mapId,
          ...(handle !== undefined ? { handle } : {}),
          spec: value.spec as MapSpec | PersistableMapSpec,
        });
      } catch {
        // Ignore malformed or conflicting historical map specs.
      }
      continue;
    }

    if (milestone.type === 'map_placement') {
      placements.push({
        placementId: value.placementId,
        mapId: value.mapId,
        handle: value.handle,
        placementNumber: value.placementNumber,
      });
    }
  }

  for (const placement of placements) {
    if (
      typeof placement.placementId !== 'string' ||
      typeof placement.mapId !== 'string' ||
      (placement.handle !== undefined && typeof placement.handle !== 'string')
    ) {
      continue;
    }
    try {
      registry.acceptPlacement({
        placementId: placement.placementId,
        mapId: placement.mapId,
        ...(placement.handle !== undefined ? { handle: placement.handle } : {}),
        ...(typeof placement.placementNumber === 'number'
          ? { placementNumber: placement.placementNumber }
          : {}),
      });
    } catch {
      // An invalid placement cannot suppress other valid map placements.
    }
  }
}

/** Resolve a placement against the registry's canonical private map ID. */
export function resolveTurnMapPlacement(
  registry: TurnMapRegistry,
  data: {
    placementId?: unknown;
    mapId?: unknown;
    handle?: unknown;
    placementNumber?: unknown;
  },
): TurnMapPlacement | null {
  if (
    typeof data.placementId !== 'string' ||
    typeof data.mapId !== 'string' ||
    (data.handle !== undefined && typeof data.handle !== 'string')
  ) {
    return null;
  }
  try {
    return registry.acceptPlacement({
      placementId: data.placementId,
      mapId: data.mapId,
      ...(data.handle !== undefined ? { handle: data.handle } : {}),
      placementNumber:
        typeof data.placementNumber === 'number'
          ? data.placementNumber
          : undefined,
    });
  } catch {
    return null;
  }
}

// Keep the schema import part of this module's public validation contract for
// callers that want to validate before constructing a registry.
export { MapSpecSchema };
