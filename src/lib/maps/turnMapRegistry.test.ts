import { describe, expect, it } from 'vitest';
import {
  MAP_LIMITS,
  redactMapSpec,
  type MapCoordinate,
  type MapPlace,
  type MapRoute,
  type MapSpec,
  type PersistableMapSpec,
} from './types';
import {
  restoreTurnMapRegistryFromMilestones,
  TURN_MAP_MAX_PLACEMENTS,
  TURN_MAP_MAX_REGISTRATIONS,
  TurnMapRegistry,
  TurnMapRegistryError,
  type TurnMapRegistryErrorCode,
} from './turnMapRegistry';

const RETRIEVED_AT = '2026-08-27T12:00:00.000Z';
const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

type PlaceOverrides = {
  id?: string;
  name?: string;
  coordinate?: MapCoordinate;
  sourceUrl?: string;
  provider?: string;
  attribution?: string;
};

const place = (number: number, overrides: PlaceOverrides = {}): MapPlace => ({
  id: overrides.id ?? `node/${number}`,
  name: overrides.name ?? `Place ${number}`,
  coordinate: overrides.coordinate ?? {
    lat: 40 + number / 100,
    lon: -75 - number / 100,
  },
  sourceUrl:
    overrides.sourceUrl ?? `https://www.openstreetmap.org/node/${number}`,
  provider: overrides.provider ?? 'openstreetmap',
  attribution: overrides.attribution ?? OSM_ATTRIBUTION,
});

type RouteOverrides = {
  mode?: MapRoute['mode'];
  distanceMeters?: number;
  durationSeconds?: number;
  geometry?: MapRoute['geometry'];
  sourceUrl?: string;
  navigationUrl?: string;
  provider?: string;
  attribution?: string;
};

const route = (
  origin: MapCoordinate = { lat: 39, lon: -74 },
  destination: MapCoordinate = { lat: 39.1, lon: -74.1 },
  overrides: RouteOverrides = {},
): MapRoute => ({
  mode: overrides.mode ?? 'driving',
  origin,
  destination,
  distanceMeters: overrides.distanceMeters ?? 12_000,
  durationSeconds: overrides.durationSeconds ?? 900,
  geometry: overrides.geometry ?? {
    type: 'LineString',
    coordinates: [
      [origin.lon, origin.lat],
      [destination.lon, destination.lat],
    ],
  },
  sourceUrl: overrides.sourceUrl ?? 'https://router.example/route',
  navigationUrl: overrides.navigationUrl ?? 'https://router.example/nav',
  provider: overrides.provider ?? 'router',
  attribution: overrides.attribution ?? 'Routing provider',
});

const mapSpec = (
  places: readonly MapPlace[] = [place(1)],
  overrides: {
    attribution?: string;
    route?: MapRoute;
    title?: string;
    summary?: string;
  } = {},
): MapSpec => ({
  places: [...places],
  ...(overrides.route ? { route: overrides.route } : {}),
  attribution:
    overrides.attribution ?? places[0]?.attribution ?? OSM_ATTRIBUTION,
  retrievedAt: RETRIEVED_AT,
  title: overrides.title ?? 'Places nearby',
  ...(overrides.summary ? { summary: overrides.summary } : {}),
});

function deterministicIds(): () => string {
  let next = 1;
  return () => `private-map-${next++}`;
}

function expectRegistryError(
  action: () => unknown,
  code: TurnMapRegistryErrorCode,
): void {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(TurnMapRegistryError);
  expect((caught as TurnMapRegistryError).code).toBe(code);
}

describe('TurnMapRegistry', () => {
  it('keeps legacy map handles private while explicit composition returns placement-only identities', () => {
    const registry = new TurnMapRegistry({ idFactory: deterministicIds() });
    const legacy = registry.register(mapSpec());
    const [discovered] = registry.registerPlaces([place(2)]);

    expect(legacy).toMatchObject({
      handle: 'map_1',
      mapId: 'private-map-1',
      title: 'Places nearby',
    });
    expect(registry.availableMaps()).toEqual([
      { handle: 'map_1', title: 'Places nearby' },
    ]);
    expect(registry.resolve('map_1')?.mapId).toBe('private-map-1');
    expect(registry.resolve('private-map-1')).toBeUndefined();

    const placement = registry.composeMap({
      placeHandles: [discovered.handle],
      title: 'Explicit map',
    });
    expect(placement.handle).toBeUndefined();
    expect(placement.mapId).toBe('private-map-2');
    expect(placement.placementId).toBe('map_placement_1');
    expect(registry.resolveById(placement.mapId)?.spec).toEqual(placement.spec);
  });

  it('allows repeated groupings and unlimited immutable map placements', () => {
    const registry = new TurnMapRegistry({ idFactory: deterministicIds() });
    const [firstPlace, secondPlace] = registry.registerPlaces([
      place(1),
      place(2),
    ]);

    const first = registry.composeMap({
      placeHandles: [firstPlace.handle, secondPlace.handle],
      title: 'First grouping',
    });
    const repeated = registry.composeMap({
      placeHandles: [firstPlace.handle, secondPlace.handle],
      title: 'Repeated grouping',
    });
    const reordered = registry.composeMap({
      placeHandles: [secondPlace.handle, firstPlace.handle],
      title: 'Reordered grouping',
    });

    expect(TURN_MAP_MAX_REGISTRATIONS).toBe(Number.POSITIVE_INFINITY);
    expect(TURN_MAP_MAX_PLACEMENTS).toBe(Number.POSITIVE_INFINITY);
    expect(registry.registrationCount).toBe(3);
    expect(registry.mapCount).toBe(3);
    expect(registry.placementCount).toBe(3);
    expect(new Set([first.mapId, repeated.mapId, reordered.mapId]).size).toBe(
      3,
    );
    expect([
      first.placementId,
      repeated.placementId,
      reordered.placementId,
    ]).toEqual(['map_placement_1', 'map_placement_2', 'map_placement_3']);
    expect(first.spec.places.map(({ id }) => id)).toEqual(['node/1', 'node/2']);
    expect(repeated.spec.places.map(({ id }) => id)).toEqual([
      'node/1',
      'node/2',
    ]);
    expect(reordered.spec.places.map(({ id }) => id)).toEqual([
      'node/2',
      'node/1',
    ]);

    first.spec.places[0].name = 'mutated outside the registry';
    expect(registry.resolveById(first.mapId)?.spec.places[0].name).toBe(
      'Place 1',
    );
  });

  it('deduplicates places by provider identity and preserves first occurrence order', () => {
    const registry = new TurnMapRegistry({ idFactory: deterministicIds() });
    const [providerA, providerB] = registry.registerPlaces([
      place(1, {
        id: 'shared-id',
        name: 'Provider A place',
        provider: 'provider-a',
        attribution: 'Provider A',
      }),
      place(2, {
        id: 'shared-id',
        name: 'Provider B place',
        provider: 'provider-b',
        attribution: 'Provider B',
      }),
    ]);
    const duplicateA = registry.registerPlaces([
      place(3, {
        id: 'shared-id',
        name: 'Later result with same identity',
        provider: 'provider-a',
        attribution: 'Different attribution that must not replace A',
      }),
    ])[0];

    expect(duplicateA.handle).toBe(providerA.handle);
    expect(duplicateA).not.toHaveProperty('mapId');
    expect(duplicateA).not.toHaveProperty('mapHandle');
    expect(registry.placeCount).toBe(2);

    const placement = registry.composeMap({
      placeHandles: [
        providerB.handle,
        duplicateA.handle,
        providerB.handle,
        providerA.handle,
      ],
    });

    expect(
      placement.spec.places.map(({ provider, id }) => [provider, id]),
    ).toEqual([
      ['provider-b', 'shared-id'],
      ['provider-a', 'shared-id'],
    ]);
    expect(placement.spec.places.map(({ name }) => name)).toEqual([
      'Provider B place',
      'Provider A place',
    ]);
  });

  it('composes selected places with route endpoints and a complete ordered attribution set', () => {
    const registry = new TurnMapRegistry({ idFactory: deterministicIds() });
    const origin = place(1, {
      coordinate: { lat: 41, lon: -76 },
      attribution: 'Origin provider',
    });
    const destination = place(2, {
      coordinate: { lat: 41.1, lon: -76.1 },
      attribution: 'Destination provider',
    });
    const middle = place(3, {
      coordinate: { lat: 41.05, lon: -76.05 },
      attribution: 'Middle provider',
    });
    const [originHandle, destinationHandle, middleHandle] =
      registry.registerPlaces([origin, destination, middle]);
    const routeRegistration = registry.registerRoute(
      route(origin.coordinate, destination.coordinate, {
        attribution: 'Route provider',
      }),
      {
        originPlaceHandle: originHandle.handle,
        destinationPlaceHandle: destinationHandle.handle,
        retrievedAt: RETRIEVED_AT,
      },
    );
    expect(routeRegistration).not.toHaveProperty('mapId');
    expect(routeRegistration).not.toHaveProperty('mapHandle');

    const placement = registry.composeMap({
      placeHandles: [
        middleHandle.handle,
        originHandle.handle,
        middleHandle.handle,
      ],
      routeHandle: routeRegistration.handle,
      title: 'Walking group',
      retrievedAt: RETRIEVED_AT,
      summary: 'Selected places and route',
    });

    expect(placement.spec.places.map(({ id }) => id)).toEqual([
      'node/3',
      'node/1',
      'node/2',
    ]);
    expect(placement.spec.route).toEqual(routeRegistration.route);
    expect(placement.pinCount).toBe(3);
    expect(placement.spec.attribution).toBe('Middle provider');
    expect(placement.spec.attributions).toEqual([
      'Middle provider',
      'Origin provider',
      'Destination provider',
      'Route provider',
    ]);
    expect(placement.spec.title).toBe('Walking group');
    expect(placement.spec.summary).toBe('Selected places and route');
  });

  it('requires a selected discovery and permits a route-only map', () => {
    const registry = new TurnMapRegistry({ idFactory: deterministicIds() });
    const routeRegistration = registry.registerRoute(route());

    expectRegistryError(() => registry.composeMap({}), 'invalid_composition');
    expect(registry.registrationCount).toBe(0);
    expect(registry.placementCount).toBe(0);

    const routeOnly = registry.composeMap({
      routeHandle: routeRegistration.handle,
    });
    expect(routeOnly.spec.places).toEqual([]);
    expect(routeOnly.pinCount).toBe(2);
    expect(routeOnly.spec.route).toEqual(routeRegistration.route);
  });

  it('retains a browser origin only when explicitly requested and counts transient origin pins once', () => {
    const registry = new TurnMapRegistry({ idFactory: deterministicIds() });
    const origin = { lat: 38, lon: -73 };
    const destination = { lat: 38.1, lon: -73.1 };
    const routeRegistration = registry.registerRoute(
      route(origin, destination),
    );

    const transient = registry.composeMap({
      routeHandle: routeRegistration.handle,
      origin,
    });
    expect(transient.spec).not.toHaveProperty('origin');
    expect(transient.spec.route).toMatchObject({
      routeNotRetained: true,
      destination,
    });
    expect(transient.pinCount).toBe(2);

    const saved = registry.composeMap({
      routeHandle: routeRegistration.handle,
      origin,
      retainOrigin: true,
    });
    expect(saved.spec.origin).toEqual(origin);
    expect(saved.spec.route).toEqual(routeRegistration.route);
    expect(saved.pinCount).toBe(2);
  });

  it('counts route endpoints toward the twelve-pin limit without capping discovery', () => {
    const registry = new TurnMapRegistry({ idFactory: deterministicIds() });
    const discovered = registry.registerPlaces(
      Array.from({ length: MAP_LIMITS.maxPlaces + 1 }, (_, index) =>
        place(index + 1),
      ),
    );
    expect(registry.placeCount).toBe(MAP_LIMITS.maxPlaces + 1);

    const twelvePlaces = registry.composeMap({
      placeHandles: discovered
        .slice(0, MAP_LIMITS.maxPlaces)
        .map(({ handle }) => handle),
    });
    expect(twelvePlaces.pinCount).toBe(MAP_LIMITS.maxPlaces);

    expectRegistryError(
      () =>
        registry.composeMap({
          placeHandles: discovered.map(({ handle }) => handle),
        }),
      'pin_limit',
    );
    expect(registry.registrationCount).toBe(1);
    expect(registry.placementCount).toBe(1);

    const routeRegistration = registry.registerRoute(
      route({ lat: 0, lon: 0 }, { lat: 0.1, lon: 0.1 }),
    );
    const tenPlacesAndRoute = registry.composeMap({
      placeHandles: discovered.slice(0, 10).map(({ handle }) => handle),
      routeHandle: routeRegistration.handle,
    });
    expect(tenPlacesAndRoute.pinCount).toBe(MAP_LIMITS.maxPlaces);

    expectRegistryError(
      () =>
        registry.composeMap({
          placeHandles: discovered.slice(0, 11).map(({ handle }) => handle),
          routeHandle: routeRegistration.handle,
        }),
      'pin_limit',
    );
    expect(registry.registrationCount).toBe(2);
    expect(registry.placementCount).toBe(2);
  });

  it('rejects any invalid selection atomically and keeps valid discoveries usable', () => {
    const registry = new TurnMapRegistry({ idFactory: deterministicIds() });
    const [first, second] = registry.registerPlaces([place(1), place(2)]);
    const routeRegistration = registry.registerRoute(
      route({ lat: 39, lon: -74 }, { lat: 39.1, lon: -74.1 }),
    );
    const before = registry.snapshot();

    expectRegistryError(
      () =>
        registry.composeMap({
          placeHandles: [first.handle, 'place_999'],
          routeHandle: routeRegistration.handle,
        }),
      'unknown_place_handle',
    );
    expect(registry.snapshot()).toEqual(before);
    expect(registry.resolvePlace(first.handle)?.place).toEqual(first.place);
    expect(registry.resolvePlace(second.handle)?.place).toEqual(second.place);
    expect(registry.resolveRoute(routeRegistration.handle)?.route).toEqual(
      routeRegistration.route,
    );

    expectRegistryError(
      () =>
        registry.composeMap({
          placeHandles: [first.handle],
          routeHandle: 'route_999',
        }),
      'unknown_route_handle',
    );
    expect(registry.registrationCount).toBe(0);
    expect(registry.placementCount).toBe(0);

    const valid = registry.composeMap({ placeHandles: [second.handle] });
    expect(valid.mapId).toBe('private-map-1');
    expect(valid.placementId).toBe('map_placement_1');
  });

  it('validates place batches before allocating handles', () => {
    const registry = new TurnMapRegistry();

    expectRegistryError(
      () => registry.registerPlaces([place(1), {} as MapPlace]),
      'invalid_snapshot',
    );
    expect(registry.placeCount).toBe(0);

    const [registered] = registry.registerPlaces([place(1)]);
    expect(registered.handle).toBe('place_1');
  });

  it('reserves generated placement IDs from map identities', () => {
    const registry = new TurnMapRegistry({
      idFactory: () => 'map_placement_1',
    });
    const [discovered] = registry.registerPlaces([place(1)]);

    expectRegistryError(
      () => registry.composeMap({ placeHandles: [discovered.handle] }),
      'invalid_snapshot',
    );
    expect(registry.registrationCount).toBe(0);
    expect(registry.placementCount).toBe(0);
    expect(registry.resolvePlace(discovered.handle)?.place).toEqual(
      discovered.place,
    );
  });

  it('restores the complete state after a failed map allocation without losing discoveries', () => {
    let allocationCalls = 0;
    const registry = new TurnMapRegistry({
      idFactory: () => {
        allocationCalls += 1;
        return allocationCalls === 1 || allocationCalls < 102
          ? 'first-map-id'
          : 'recovered-map-id';
      },
    });
    const [firstPlace] = registry.registerPlaces([place(1)]);
    const first = registry.composeMap({ placeHandles: [firstPlace.handle] });
    const [standalonePlace] = registry.registerPlaces([place(2)]);
    const before = registry.snapshot();

    expectRegistryError(
      () => registry.composeMap({ placeHandles: [standalonePlace.handle] }),
      'invalid_snapshot',
    );

    expect(registry.snapshot()).toEqual(before);
    expect(registry.registrationCount).toBe(1);
    expect(registry.placementCount).toBe(1);
    expect(registry.resolveById(first.mapId)?.spec).toEqual(first.spec);
    expect(registry.resolvePlace(standalonePlace.handle)?.place).toEqual(
      standalonePlace.place,
    );

    const restoredSelection = registry.composeMap({
      placeHandles: [firstPlace.handle],
    });
    expect(restoredSelection.mapId).toBe('recovered-map-id');
  });

  it('snapshots and restores discoveries, redacts transient routes, and resets all state on cleanup', () => {
    const original = new TurnMapRegistry({ idFactory: deterministicIds() });
    const origin = place(1, { coordinate: { lat: 42, lon: -77 } });
    const destination = place(2, { coordinate: { lat: 42.1, lon: -77.1 } });
    const [originHandle, destinationHandle] = original.registerPlaces([
      origin,
      destination,
    ]);
    const routeRegistration = original.registerRoute(
      route(origin.coordinate, destination.coordinate),
      {
        originPlaceHandle: originHandle.handle,
        destinationPlaceHandle: destinationHandle.handle,
        retainRoute: false,
      },
    );
    const first = original.composeMap({
      placeHandles: [originHandle.handle],
      routeHandle: routeRegistration.handle,
    });
    const second = original.composeMap({
      placeHandles: [destinationHandle.handle],
      routeHandle: routeRegistration.handle,
    });
    const snapshot = original.snapshot();

    expect(snapshot.routes?.[0].route).toMatchObject({
      routeNotRetained: true,
      destination: destination.coordinate,
    });
    expect(snapshot.routes?.[0].route).not.toHaveProperty('origin');
    expect(snapshot.routes?.[0].route).not.toHaveProperty('geometry');
    expect(snapshot.routes?.[0].route).not.toHaveProperty('navigationUrl');

    const restored = new TurnMapRegistry({
      snapshot,
      idFactory: deterministicIds(),
    });
    snapshot.places![0].place.name = 'mutated snapshot';
    snapshot.placements![0].spec.places[0].name = 'mutated placement';

    expect(restored.placeCount).toBe(2);
    expect(restored.routeCount).toBe(1);
    expect(restored.registrationCount).toBe(2);
    expect(restored.placementCount).toBe(2);
    expect(restored.resolvePlace(originHandle.handle)?.place.name).toBe(
      'Place 1',
    );
    expect(restored.resolveById(first.mapId)?.spec.places[0].name).toBe(
      'Place 1',
    );
    expect(restored.resolveById(second.mapId)).toBeDefined();
    expect(restored.isPlacementAccepted(first.placementId)).toBe(true);
    expect(restored.isPlacementAccepted(second.placementId)).toBe(true);
    expect(
      restored.resolveRoute(routeRegistration.handle)?.route,
    ).not.toHaveProperty('origin');

    const third = restored.composeMap({
      placeHandles: [destinationHandle.handle],
      routeHandle: routeRegistration.handle,
    });
    expect(third.mapId).toBe('private-map-3');
    expect(third.placementId).toBe('map_placement_3');

    restored.cleanup();
    expect(restored.registrationCount).toBe(0);
    expect(restored.placeCount).toBe(0);
    expect(restored.routeCount).toBe(0);
    expect(restored.placementCount).toBe(0);
    expect(restored.resolvePlace(originHandle.handle)).toBeUndefined();
    expect(restored.resolveRoute(routeRegistration.handle)).toBeUndefined();
    expect(restored.isPlacementAccepted(first.placementId)).toBe(false);
  });

  it('reconstructs all safe discovery and placement milestones while ignoring session overlays', () => {
    const source = new TurnMapRegistry({ idFactory: deterministicIds() });
    const origin = place(1, { coordinate: { lat: 43, lon: -78 } });
    const destination = place(2, { coordinate: { lat: 43.1, lon: -78.1 } });
    const [originHandle, destinationHandle] = source.registerPlaces([
      origin,
      destination,
    ]);
    const routeRegistration = source.registerRoute(
      route(origin.coordinate, destination.coordinate),
      {
        originPlaceHandle: originHandle.handle,
        destinationPlaceHandle: destinationHandle.handle,
      },
    );
    const first = source.composeMap({
      placeHandles: [originHandle.handle],
      routeHandle: routeRegistration.handle,
    });
    const second = source.composeMap({
      placeHandles: [destinationHandle.handle],
    });

    const restored = new TurnMapRegistry({ idFactory: deterministicIds() });
    restoreTurnMapRegistryFromMilestones(restored, [
      {
        type: 'map_places_discovered',
        data: {
          places: [
            { ...originHandle, retrievedAt: RETRIEVED_AT },
            { ...destinationHandle, retrievedAt: RETRIEVED_AT },
          ],
        },
      },
      {
        type: 'map_route_discovered',
        data: {
          ...routeRegistration,
          routeRetained: false,
        },
      },
      {
        type: 'map_session_overlay',
        data: {
          mapId: first.mapId,
          origin: { lat: 10, lon: 20 },
        },
      },
      {
        type: 'map_spec',
        data: {
          mapId: first.mapId,
          spec: redactMapSpec(first.spec),
        },
      },
      {
        type: 'map_spec',
        data: {
          mapId: second.mapId,
          spec: redactMapSpec(second.spec),
        },
      },
      {
        type: 'map_placement',
        data: {
          placementId: first.placementId,
          mapId: first.mapId,
          placementNumber: first.placementNumber,
        },
      },
      {
        type: 'map_placement',
        data: {
          placementId: second.placementId,
          mapId: second.mapId,
          placementNumber: second.placementNumber,
        },
      },
      {
        type: 'map_place_discovered',
        data: { handle: 'place_999', place: {} },
      },
    ]);

    expect(restored.placeCount).toBe(2);
    expect(restored.routeCount).toBe(1);
    expect(restored.registrationCount).toBe(2);
    expect(restored.placementCount).toBe(2);
    expect(restored.resolvePlace(originHandle.handle)?.place).toEqual(origin);
    expect(restored.resolvePlace(destinationHandle.handle)?.place).toEqual(
      destination,
    );
    expect(
      restored.resolveRoute(routeRegistration.handle)?.route,
    ).not.toHaveProperty('origin');
    expect(restored.resolveById(first.mapId)?.spec).toEqual(
      redactMapSpec(first.spec),
    );
    expect(restored.isPlaced(first.mapId)).toBe(true);
    expect(restored.isPlaced(second.mapId)).toBe(true);
    expect(restored.isPlacementAccepted(first.placementId)).toBe(true);
    expect(restored.isPlacementAccepted(second.placementId)).toBe(true);

    const followup = restored.composeMap({
      placeHandles: [destinationHandle.handle],
      routeHandle: routeRegistration.handle,
    });
    expect(followup.mapId).toBe('private-map-3');
    expect(followup.placementId).toBe('map_placement_3');
    expect(followup.spec.route).toMatchObject({ routeNotRetained: true });
  });

  it('rejects guessed handles, mismatched placement handles, and unsafe identities', () => {
    const registry = new TurnMapRegistry({ idFactory: deterministicIds() });
    const registration = registry.register(mapSpec());

    expect(() => registry.place('map_99')).toThrow(TurnMapRegistryError);
    expect(() =>
      registry.acceptPlacement({
        placementId: 'placement-1',
        mapId: registration.mapId,
        handle: 'map_99',
      }),
    ).toThrow(TurnMapRegistryError);
    expect(() =>
      registry.registerKnown({
        handle: 'map_2',
        mapId: '__proto__',
        spec: mapSpec(),
      }),
    ).toThrow(TurnMapRegistryError);
  });

  it('does not expose mutable specs through registrations or snapshots', () => {
    const registry = new TurnMapRegistry({ idFactory: deterministicIds() });
    const registration = registry.register(mapSpec());

    registration.spec.places[0].coordinate.lat = 1;
    const snapshot = registry.snapshot();
    snapshot.registrations[0].spec.places[0].name = 'changed';

    expect(registry.resolve('map_1')?.spec.places[0]).toMatchObject({
      name: 'Place 1',
      coordinate: { lat: 40.01 },
    });
  });

  it('restores legacy persisted registrations and accepted placement IDs', () => {
    const original = new TurnMapRegistry({ idFactory: deterministicIds() });
    const registration = original.register(mapSpec());
    const placement = original.place(registration.handle);

    const restored = new TurnMapRegistry({
      snapshot: original.snapshot(),
      idFactory: deterministicIds(),
    });

    expect(restored.resolve('map_1')).toMatchObject({
      mapId: 'private-map-1',
      title: 'Places nearby',
    });
    expect(restored.isPlaced('map_1')).toBe(true);
    expect(restored.isPlacementAccepted(placement.placementId)).toBe(true);
    expect(restored.placementCount).toBe(1);

    const replayed = restored.acceptPlacement({
      placementId: placement.placementId,
      mapId: placement.mapId,
      handle: placement.handle,
    });
    expect(replayed).toMatchObject(placement);
    expect(restored.placementCount).toBe(1);
  });

  it('rejects malformed snapshots instead of restoring unsafe registry state', () => {
    const registry = new TurnMapRegistry();
    const valid: PersistableMapSpec = mapSpec();

    expect(() =>
      registry.restore({
        registrations: [
          {
            handle: 'map_1',
            mapId: 'private-map-1',
            title: 'Map',
            spec: valid,
          },
          {
            handle: 'map_1',
            mapId: 'private-map-2',
            title: 'Duplicate',
            spec: valid,
          },
        ],
        nextHandle: 2,
        placementCount: 0,
      }),
    ).toThrow(TurnMapRegistryError);

    expect(() =>
      registry.restore({
        registrations: [],
        nextHandle: 1,
        placementCount: 1,
        placementIds: ['same', 'same'],
        placedHandles: [],
      }),
    ).toThrow(TurnMapRegistryError);
  });
});
