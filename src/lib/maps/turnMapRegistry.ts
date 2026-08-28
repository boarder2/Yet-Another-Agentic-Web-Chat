import { generateId } from '@/lib/utils/id';
import {
  MapPlaceSchema,
  MapRouteSchema,
  MapSpecSchema,
  PersistableMapSpecSchema,
  type MapPlace,
  type MapRoute,
  type MapSpec,
  type PersistableMapSpec,
  type PersistableMapRoute,
} from './types';

/** A turn can register and place exactly one writer-owned map. */
export const TURN_MAP_MAX_REGISTRATIONS = 1;
export const TURN_MAP_MAX_PLACEMENTS = 1;
export const MAP_MAX_REGISTRATIONS = TURN_MAP_MAX_REGISTRATIONS;
export const MAP_MAX_PLACEMENTS = TURN_MAP_MAX_PLACEMENTS;

export interface TurnMapMilestone {
  type: string;
  data?: unknown;
}

export interface TurnMapRegistration {
  handle: string;
  mapId: string;
  title: string;
  spec: PersistableMapSpec;
}

export interface TurnMapPlacement extends TurnMapRegistration {
  placementId: string;
  placementNumber: number;
}

/** A short handle for a provider-grounded place in the current turn. */
export interface TurnMapPlaceRegistration {
  handle: string;
  mapId?: string;
  mapHandle?: string;
  place: MapPlace;
}

/** A short handle for a provider-grounded route in the current turn. */
export interface TurnMapRouteRegistration {
  handle: string;
  mapId?: string;
  mapHandle?: string;
  route: MapRoute;
}

export interface AvailableTurnMap {
  handle: string;
  title: string;
}

export interface TurnMapRegistrySnapshot {
  registrations: TurnMapRegistration[];
  nextHandle: number;
  placementCount: number;
  /** Handles shown at least once; absent in older snapshots. */
  placedHandles?: string[];
  /** Placement IDs make replay idempotent after a process restart. */
  placementIds?: string[];
}

export interface TurnMapRegistryOptions {
  idFactory?: () => string;
  snapshot?: TurnMapRegistrySnapshot;
}

export type TurnMapRegistryErrorCode =
  | 'unknown_handle'
  | 'unknown_map'
  | 'registration_limit'
  | 'placement_limit'
  | 'invalid_placement'
  | 'invalid_snapshot';

export class TurnMapRegistryError extends Error {
  readonly code: TurnMapRegistryErrorCode;
  readonly availableMaps: AvailableTurnMap[];
  readonly handle?: string;
  readonly mapId?: string;

  constructor(
    code: TurnMapRegistryErrorCode,
    message: string,
    availableMaps: AvailableTurnMap[] = [],
    handle?: string,
    mapId?: string,
  ) {
    super(message);
    this.name = 'TurnMapRegistryError';
    this.code = code;
    this.availableMaps = availableMaps;
    this.handle = handle;
    this.mapId = mapId;
  }
}

function cloneRoute(route: PersistableMapRoute): PersistableMapRoute {
  if ('routeNotRetained' in route) {
    return { ...route, destination: { ...route.destination } };
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
  return {
    ...spec,
    places: spec.places.map((place) => ({
      ...place,
      coordinate: { ...place.coordinate },
    })),
    ...(spec.origin ? { origin: { ...spec.origin } } : {}),
    ...(spec.route ? { route: cloneRoute(spec.route) } : {}),
  };
}

function clonePlace(place: MapPlace): MapPlace {
  return { ...place, coordinate: { ...place.coordinate } };
}

function cloneRouteReference(route: MapRoute): MapRoute {
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

function clonePlaceRegistration(
  registration: TurnMapPlaceRegistration,
): TurnMapPlaceRegistration {
  return { ...registration, place: clonePlace(registration.place) };
}

function cloneRouteRegistration(
  registration: TurnMapRouteRegistration,
): TurnMapRouteRegistration {
  return { ...registration, route: cloneRouteReference(registration.route) };
}

function cloneRegistration(
  registration: TurnMapRegistration,
): TurnMapRegistration {
  return { ...registration, spec: cloneSpec(registration.spec) };
}

function clonePlacement(placement: TurnMapPlacement): TurnMapPlacement {
  return { ...placement, spec: cloneSpec(placement.spec) };
}

function availableText(maps: readonly AvailableTurnMap[]): string {
  if (maps.length === 0) return 'No maps are available in this turn.';
  return maps.map(({ handle, title }) => `${handle} (${title})`).join(', ');
}

function routeKey(route: MapRoute): string {
  return [
    route.mode,
    route.origin.lat,
    route.origin.lon,
    route.destination.lat,
    route.destination.lon,
  ].join(':');
}

function isValidHandle(handle: string): boolean {
  return /^map_[1-9]\d*$/.test(handle);
}

function isValidOpaqueId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 160 &&
    !/[\u0000-\u001f\u007f<>]/.test(value) &&
    value !== '__proto__' &&
    value !== 'constructor' &&
    value !== 'prototype'
  );
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

/** A turn-local mapping from short model handles to private canonical map IDs. */
export class TurnMapRegistry {
  private readonly idFactory: () => string;
  private readonly registrations = new Map<string, TurnMapRegistration>();
  private readonly registrationsById = new Map<string, TurnMapRegistration>();
  private readonly places = new Map<string, TurnMapPlaceRegistration>();
  private readonly placesById = new Map<string, TurnMapPlaceRegistration>();
  private readonly routes = new Map<string, TurnMapRouteRegistration>();
  private readonly routesByKey = new Map<string, TurnMapRouteRegistration>();
  private nextHandleValue = 1;
  private nextPlaceHandleValue = 1;
  private nextRouteHandleValue = 1;
  private placementCountValue = 0;
  private readonly placedHandles = new Set<string>();
  private readonly placementIds = new Set<string>();

  constructor(options: TurnMapRegistryOptions = {}) {
    this.idFactory = options.idFactory ?? generateId;
    if (options.snapshot) this.restore(options.snapshot);
  }

  get registrationCount(): number {
    return this.registrations.size;
  }

  get placementCount(): number {
    return this.placementCountValue;
  }

  /** Register one validated provider-grounded map and allocate private IDs. */
  register(spec: MapSpec | PersistableMapSpec): TurnMapRegistration {
    if (this.registrations.size >= TURN_MAP_MAX_REGISTRATIONS) {
      throw new TurnMapRegistryError(
        'registration_limit',
        `A turn can register at most ${TURN_MAP_MAX_REGISTRATIONS} map. Available maps: ${availableText(this.availableMaps())}`,
        this.availableMaps(),
      );
    }

    const normalized = parseSpec(spec);
    const handle = this.allocateHandle();
    const mapId = this.allocateMapId();
    const registration = {
      handle,
      mapId,
      title: normalized.title?.trim() || 'Map',
      spec: cloneSpec(normalized),
    } satisfies TurnMapRegistration;
    this.setRegistration(registration);
    this.registerReferences(registration);
    return cloneRegistration(registration);
  }

  /**
   * Register provider-grounded places under short handles. Provider IDs remain
   * inside the turn registry so detail lookups cannot be redirected by model
   * text.
   */
  registerPlaces(
    places: readonly MapPlace[],
    options: { mapId?: string; mapHandle?: string } = {},
  ): TurnMapPlaceRegistration[] {
    return places.map((place) => {
      const parsed = MapPlaceSchema.safeParse(place);
      if (!parsed.success) {
        throw new TurnMapRegistryError(
          'invalid_snapshot',
          'Invalid provider place registration.',
        );
      }
      const existing = this.placesById.get(parsed.data.id);
      if (existing) return clonePlaceRegistration(existing);
      const registration: TurnMapPlaceRegistration = {
        handle: this.allocatePlaceHandle(),
        ...(options.mapId ? { mapId: options.mapId } : {}),
        ...(options.mapHandle ? { mapHandle: options.mapHandle } : {}),
        place: clonePlace(parsed.data),
      };
      this.places.set(registration.handle, registration);
      this.placesById.set(parsed.data.id, registration);
      return clonePlaceRegistration(registration);
    });
  }

  resolvePlace(handle: unknown): TurnMapPlaceRegistration | undefined {
    if (typeof handle !== 'string' || !/^place_[1-9]\d*$/.test(handle)) {
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

  /** Register a route and optionally associate it with a showable map. */
  registerRoute(
    route: MapRoute,
    options: { mapId?: string; mapHandle?: string } = {},
  ): TurnMapRouteRegistration {
    const parsed = MapRouteSchema.safeParse(route);
    if (!parsed.success) {
      throw new TurnMapRegistryError(
        'invalid_snapshot',
        'Invalid provider route registration.',
      );
    }
    const key = routeKey(parsed.data);
    const existing = this.routesByKey.get(key);
    if (existing) return cloneRouteRegistration(existing);
    const registration: TurnMapRouteRegistration = {
      handle: this.allocateRouteHandle(),
      ...(options.mapId ? { mapId: options.mapId } : {}),
      ...(options.mapHandle ? { mapHandle: options.mapHandle } : {}),
      route: cloneRouteReference(parsed.data),
    };
    this.routes.set(registration.handle, registration);
    this.routesByKey.set(key, registration);
    return cloneRouteRegistration(registration);
  }

  resolveRoute(handle: unknown): TurnMapRouteRegistration | undefined {
    if (typeof handle !== 'string' || !/^route_[1-9]\d*$/.test(handle)) {
      return undefined;
    }
    const registration = this.routes.get(handle);
    return registration ? cloneRouteRegistration(registration) : undefined;
  }

  /**
   * Admit an event-backed registration when rebuilding a run. This is also
   * useful to the trusted run host when a provider registered before it emitted
   * its map milestone. It never lets a second map bypass the turn cap.
   */
  registerKnown(input: {
    handle: string;
    mapId: string;
    spec: MapSpec | PersistableMapSpec;
    title?: string;
  }): TurnMapRegistration {
    const normalized = parseSpec(input.spec);
    if (!isValidHandle(input.handle) || !isValidOpaqueId(input.mapId)) {
      throw new TurnMapRegistryError(
        'invalid_snapshot',
        'Invalid turn map registration identity.',
      );
    }
    const existing = this.registrations.get(input.handle);
    if (existing) {
      if (existing.mapId !== input.mapId) {
        throw new TurnMapRegistryError(
          'invalid_snapshot',
          'Turn map handle is already assigned.',
          this.availableMaps(),
          input.handle,
          input.mapId,
        );
      }
      this.registerReferences(existing);
      return cloneRegistration(existing);
    }
    const existingById = this.registrationsById.get(input.mapId);
    if (existingById) {
      if (existingById.handle !== input.handle) {
        throw new TurnMapRegistryError(
          'invalid_snapshot',
          'Turn map ID is already assigned.',
          this.availableMaps(),
          input.handle,
          input.mapId,
        );
      }
      return cloneRegistration(existingById);
    }
    if (this.registrations.size >= TURN_MAP_MAX_REGISTRATIONS) {
      throw new TurnMapRegistryError(
        'registration_limit',
        `A turn can register at most ${TURN_MAP_MAX_REGISTRATIONS} map. Available maps: ${availableText(this.availableMaps())}`,
        this.availableMaps(),
        input.handle,
        input.mapId,
      );
    }
    const registration = {
      handle: input.handle,
      mapId: input.mapId,
      title: input.title?.trim() || normalized.title?.trim() || 'Map',
      spec: cloneSpec(normalized),
    } satisfies TurnMapRegistration;
    this.setRegistration(registration);
    this.registerReferences(registration);
    const suffix = Number(input.handle.slice('map_'.length));
    if (Number.isInteger(suffix)) {
      this.nextHandleValue = Math.max(this.nextHandleValue, suffix + 1);
    }
    return cloneRegistration(registration);
  }

  resolve(handle: unknown): TurnMapRegistration | undefined {
    if (typeof handle !== 'string') return undefined;
    const registration = this.registrations.get(handle);
    return registration ? cloneRegistration(registration) : undefined;
  }

  resolveById(mapId: unknown): TurnMapRegistration | undefined {
    if (typeof mapId !== 'string') return undefined;
    const registration = this.registrationsById.get(mapId);
    return registration ? cloneRegistration(registration) : undefined;
  }

  require(handle: unknown): TurnMapRegistration {
    const registration = this.resolve(handle);
    if (registration) return registration;
    const displayHandle = typeof handle === 'string' ? handle : String(handle);
    throw new TurnMapRegistryError(
      'unknown_handle',
      `Unknown map handle "${displayHandle}". Choose a map from this turn: ${availableText(this.availableMaps())}`,
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

  /** Allocate the one writer-owned placement for a registered map. */
  place(handle: unknown): TurnMapPlacement {
    const registration = this.require(handle);
    if (this.placementCountValue >= TURN_MAP_MAX_PLACEMENTS) {
      throw new TurnMapRegistryError(
        'placement_limit',
        `A turn can show a map at most ${TURN_MAP_MAX_PLACEMENTS} time. Available maps: ${availableText(this.availableMaps())}`,
        this.availableMaps(),
        typeof handle === 'string' ? handle : undefined,
      );
    }
    const placement: TurnMapPlacement = {
      ...registration,
      placementId: `map_placement_${this.placementCountValue + 1}`,
      placementNumber: this.placementCountValue + 1,
    };
    this.placementCountValue += 1;
    this.placementIds.add(placement.placementId);
    this.placedHandles.add(registration.handle);
    return clonePlacement(placement);
  }

  /**
   * Record a writer placement received from a stream event. Replaying the same
   * ID is a no-op; a different ID still obeys the one-placement cap.
   */
  acceptPlacement(input: {
    placementId: string;
    mapId: string;
    handle?: string;
    placementNumber?: number;
  }): TurnMapPlacement {
    if (
      !isValidOpaqueId(input.placementId) ||
      (input.placementNumber !== undefined &&
        (!Number.isInteger(input.placementNumber) ||
          input.placementNumber < 1 ||
          input.placementNumber > TURN_MAP_MAX_PLACEMENTS))
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
    if (input.handle !== undefined && input.handle !== registration.handle) {
      throw new TurnMapRegistryError(
        'unknown_handle',
        'Map placement handle does not match its registered map.',
        this.availableMaps(),
        input.handle,
        input.mapId,
      );
    }
    if (this.placementIds.has(input.placementId)) {
      return clonePlacement({
        ...registration,
        placementId: input.placementId,
        placementNumber: input.placementNumber ?? 1,
      });
    }
    if (this.placementCountValue >= TURN_MAP_MAX_PLACEMENTS) {
      throw new TurnMapRegistryError(
        'placement_limit',
        `A turn can show a map at most ${TURN_MAP_MAX_PLACEMENTS} time. Available maps: ${availableText(this.availableMaps())}`,
        this.availableMaps(),
        input.handle,
        input.mapId,
      );
    }
    this.placementCountValue += 1;
    this.placementIds.add(input.placementId);
    this.placedHandles.add(registration.handle);
    return clonePlacement({
      ...registration,
      placementId: input.placementId,
      placementNumber: input.placementNumber ?? this.placementCountValue,
    });
  }

  recordPlacement = this.acceptPlacement.bind(this);

  isPlaced(handle: unknown): boolean {
    return typeof handle === 'string' && this.placedHandles.has(handle);
  }

  isPlacementAccepted(placementId: unknown): boolean {
    return (
      typeof placementId === 'string' && this.placementIds.has(placementId)
    );
  }

  availableMaps(): AvailableTurnMap[] {
    return [...this.registrations.values()].map(({ handle, title }) => ({
      handle,
      title,
    }));
  }

  snapshot(): TurnMapRegistrySnapshot {
    return {
      registrations: [...this.registrations.values()].map(cloneRegistration),
      nextHandle: this.nextHandleValue,
      placementCount: this.placementCountValue,
      placedHandles: [...this.placedHandles],
      placementIds: [...this.placementIds],
    };
  }

  restore(snapshot: TurnMapRegistrySnapshot): void {
    if (
      !snapshot ||
      !Array.isArray(snapshot.registrations) ||
      !Number.isInteger(snapshot.nextHandle) ||
      snapshot.nextHandle < 1 ||
      !Number.isInteger(snapshot.placementCount) ||
      snapshot.placementCount < 0 ||
      snapshot.placementCount > TURN_MAP_MAX_PLACEMENTS ||
      snapshot.registrations.length > TURN_MAP_MAX_REGISTRATIONS ||
      (snapshot.placedHandles !== undefined &&
        !Array.isArray(snapshot.placedHandles)) ||
      (snapshot.placementIds !== undefined &&
        !Array.isArray(snapshot.placementIds))
    ) {
      throw new TurnMapRegistryError(
        'invalid_snapshot',
        'Invalid turn map registry snapshot.',
      );
    }

    const restored = new Map<string, TurnMapRegistration>();
    const restoredById = new Map<string, TurnMapRegistration>();
    for (const entry of snapshot.registrations) {
      if (
        !entry ||
        typeof entry.handle !== 'string' ||
        !isValidHandle(entry.handle) ||
        typeof entry.mapId !== 'string' ||
        !isValidOpaqueId(entry.mapId) ||
        typeof entry.title !== 'string' ||
        restored.has(entry.handle) ||
        restoredById.has(entry.mapId)
      ) {
        throw new TurnMapRegistryError(
          'invalid_snapshot',
          'Invalid turn map registry snapshot.',
        );
      }
      let spec: PersistableMapSpec;
      try {
        spec = parseSpec(entry.spec);
      } catch {
        throw new TurnMapRegistryError(
          'invalid_snapshot',
          'Invalid turn map registry snapshot.',
        );
      }
      const registration: TurnMapRegistration = {
        handle: entry.handle,
        mapId: entry.mapId,
        title: entry.title,
        spec: cloneSpec(spec),
      };
      restored.set(entry.handle, registration);
      restoredById.set(entry.mapId, registration);
    }

    const placedHandles = new Set<string>();
    const suppliedPlacedHandles = snapshot.placedHandles;
    for (const handle of suppliedPlacedHandles ?? []) {
      if (typeof handle !== 'string' || !restored.has(handle)) {
        throw new TurnMapRegistryError(
          'invalid_snapshot',
          'Invalid turn map registry placement handles.',
        );
      }
      placedHandles.add(handle);
    }
    if (
      suppliedPlacedHandles !== undefined &&
      placedHandles.size !== suppliedPlacedHandles.length
    ) {
      throw new TurnMapRegistryError(
        'invalid_snapshot',
        'Invalid turn map registry placement handles.',
      );
    }

    const placementIds = new Set<string>();
    const suppliedPlacementIds = snapshot.placementIds;
    for (const placementId of suppliedPlacementIds ?? []) {
      if (typeof placementId !== 'string' || !isValidOpaqueId(placementId)) {
        throw new TurnMapRegistryError(
          'invalid_snapshot',
          'Invalid turn map registry placement IDs.',
        );
      }
      placementIds.add(placementId);
    }
    if (
      suppliedPlacementIds !== undefined &&
      placementIds.size !== suppliedPlacementIds.length
    ) {
      throw new TurnMapRegistryError(
        'invalid_snapshot',
        'Invalid turn map registry placement IDs.',
      );
    }

    if (
      snapshot.placementCount === 0 &&
      (placedHandles.size > 0 || placementIds.size > 0)
    ) {
      throw new TurnMapRegistryError(
        'invalid_snapshot',
        'Invalid turn map registry placement count.',
      );
    }
    if (
      placedHandles.size > snapshot.placementCount ||
      placementIds.size > snapshot.placementCount ||
      (suppliedPlacedHandles !== undefined &&
        placedHandles.size !== snapshot.placementCount) ||
      (suppliedPlacementIds !== undefined &&
        placementIds.size !== snapshot.placementCount)
    ) {
      throw new TurnMapRegistryError(
        'invalid_snapshot',
        'Invalid turn map registry placement count.',
      );
    }

    this.registrations.clear();
    this.registrationsById.clear();
    this.places.clear();
    this.placesById.clear();
    this.routes.clear();
    this.routesByKey.clear();
    for (const [handle, registration] of restored) {
      this.registrations.set(handle, registration);
    }
    for (const [mapId, registration] of restoredById) {
      this.registrationsById.set(mapId, registration);
    }
    this.nextHandleValue = snapshot.nextHandle;
    this.nextPlaceHandleValue = 1;
    this.nextRouteHandleValue = 1;
    for (const registration of restored.values()) {
      this.registerReferences(registration);
    }
    this.placementCountValue = snapshot.placementCount;
    this.placedHandles.clear();
    for (const handle of placedHandles) this.placedHandles.add(handle);
    this.placementIds.clear();
    for (const placementId of placementIds) this.placementIds.add(placementId);
  }

  private registerReferences(registration: TurnMapRegistration): void {
    this.registerPlaces(registration.spec.places, {
      mapId: registration.mapId,
      mapHandle: registration.handle,
    });
    const route = registration.spec.route;
    if (route && !('routeNotRetained' in route)) {
      this.registerRoute(route, {
        mapId: registration.mapId,
        mapHandle: registration.handle,
      });
    }
  }

  private setRegistration(registration: TurnMapRegistration): void {
    this.registrations.set(registration.handle, registration);
    this.registrationsById.set(registration.mapId, registration);
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
    while (this.registrations.has(`map_${this.nextHandleValue}`)) {
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
        !this.registrationsById.has(mapId)
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
 * Rebuild a registry from persisted map registration/placement milestones.
 * Session overlays are intentionally ignored: they are never durable.
 */
export function restoreTurnMapRegistryFromMilestones(
  registry: TurnMapRegistry,
  milestones: Iterable<TurnMapMilestone>,
): void {
  const registrations: TurnMapRegistration[] = [];
  const byHandle = new Set<string>();
  const byMapId = new Set<string>();
  const placementIds = new Set<string>();
  const placedHandles = new Set<string>();
  let maxHandle = 0;

  for (const milestone of milestones) {
    if (milestone.type === 'map_spec') {
      const data = milestone.data;
      if (!data || typeof data !== 'object') continue;
      const value = data as {
        mapId?: unknown;
        handle?: unknown;
        turnHandle?: unknown;
        spec?: unknown;
      };
      const mapId = value.mapId;
      const handle = value.handle ?? value.turnHandle;
      if (
        typeof mapId !== 'string' ||
        !isValidOpaqueId(mapId) ||
        typeof handle !== 'string' ||
        !isValidHandle(handle) ||
        byHandle.has(handle) ||
        byMapId.has(mapId) ||
        registrations.length >= TURN_MAP_MAX_REGISTRATIONS
      ) {
        continue;
      }
      const parsed = PersistableMapSpecSchema.safeParse(value.spec);
      if (!parsed.success) continue;
      registrations.push({
        handle,
        mapId,
        title: parsed.data.title?.trim() || 'Map',
        spec: cloneSpec(parsed.data),
      });
      byHandle.add(handle);
      byMapId.add(mapId);
      maxHandle = Math.max(maxHandle, Number(handle.slice('map_'.length)));
      continue;
    }

    if (milestone.type !== 'map_placement') continue;
    const data = milestone.data;
    if (!data || typeof data !== 'object') continue;
    const value = data as {
      placementId?: unknown;
      mapId?: unknown;
      handle?: unknown;
      placementNumber?: unknown;
    };
    const placementId = value.placementId;
    const mapId = value.mapId;
    const handle = value.handle;
    if (
      typeof placementId !== 'string' ||
      !isValidOpaqueId(placementId) ||
      typeof mapId !== 'string' ||
      !byMapId.has(mapId) ||
      (handle !== undefined &&
        (typeof handle !== 'string' || !byHandle.has(handle))) ||
      (value.placementNumber !== undefined &&
        (typeof value.placementNumber !== 'number' ||
          !Number.isInteger(value.placementNumber) ||
          value.placementNumber < 1 ||
          value.placementNumber > TURN_MAP_MAX_PLACEMENTS))
    ) {
      continue;
    }
    if (placementIds.size >= TURN_MAP_MAX_PLACEMENTS) continue;
    const registration = registrations.find((entry) => entry.mapId === mapId);
    if (!registration) continue;
    if (handle !== undefined && registration.handle !== handle) continue;
    placementIds.add(placementId);
    placedHandles.add(registration.handle);
  }

  try {
    registry.restore({
      registrations,
      nextHandle: Math.max(1, maxHandle + 1),
      placementCount: placementIds.size,
      placedHandles: [...placedHandles],
      placementIds: [...placementIds],
    });
  } catch {
    // A malformed historical map milestone should not prevent other run data
    // from being reconstructed. The registry remains empty in this case.
    registry.restore({
      registrations: [],
      nextHandle: 1,
      placementCount: 0,
      placedHandles: [],
      placementIds: [],
    });
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
      handle: data.handle,
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
