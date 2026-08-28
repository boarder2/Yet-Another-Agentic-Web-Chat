import { describe, expect, it } from 'vitest';
import {
  MAP_LIMITS,
  redactMapSpec,
  type MapSpec,
  type PersistableMapSpec,
} from './types';
import {
  restoreTurnMapRegistryFromMilestones,
  TURN_MAP_MAX_PLACEMENTS,
  TURN_MAP_MAX_REGISTRATIONS,
  TurnMapRegistry,
  TurnMapRegistryError,
} from './turnMapRegistry';

const place = (number: number) => ({
  id: `node/${number}`,
  name: `Place ${number}`,
  coordinate: { lat: 40 + number / 100, lon: -75 - number / 100 },
  sourceUrl: `https://www.openstreetmap.org/node/${number}`,
  provider: 'openstreetmap',
  attribution: '© OpenStreetMap contributors',
});

const mapSpec = (placeCount = 1): MapSpec => ({
  places: Array.from({ length: placeCount }, (_, index) => place(index + 1)),
  attribution: '© OpenStreetMap contributors',
  retrievedAt: '2026-08-27T12:00:00.000Z',
  title: 'Places nearby',
  summary: 'Provider-grounded places',
});

function deterministicIds(): () => string {
  let next = 1;
  return () => `private-map-${next++}`;
}

describe('TurnMapRegistry', () => {
  it('keeps model handles short and canonical IDs private', () => {
    const registry = new TurnMapRegistry({ idFactory: deterministicIds() });
    const registration = registry.register(mapSpec());

    expect(registration).toMatchObject({
      handle: 'map_1',
      mapId: 'private-map-1',
      title: 'Places nearby',
    });
    expect(registry.availableMaps()).toEqual([
      { handle: 'map_1', title: 'Places nearby' },
    ]);
    expect(registry.resolve('map_1')?.mapId).toBe('private-map-1');
    expect(registry.resolve('private-map-1')).toBeUndefined();
    expect(() => registry.require('private-map-1')).toThrow(
      'Choose a map from this turn',
    );
  });

  it('enforces one map registration and the schema pin cap', () => {
    const registry = new TurnMapRegistry({ idFactory: deterministicIds() });
    registry.register(mapSpec(MAP_LIMITS.maxPlaces));

    expect(() => registry.register(mapSpec())).toThrow(TurnMapRegistryError);
    expect(registry.registrationCount).toBe(TURN_MAP_MAX_REGISTRATIONS);

    const tooManyPlaces = new TurnMapRegistry({
      idFactory: deterministicIds(),
    });
    expect(() =>
      tooManyPlaces.register(mapSpec(MAP_LIMITS.maxPlaces + 1)),
    ).toThrow(TurnMapRegistryError);
  });

  it('allows one writer placement and makes replay of that placement idempotent', () => {
    const registry = new TurnMapRegistry({ idFactory: deterministicIds() });
    const registration = registry.register(mapSpec());
    const placement = registry.place(registration.handle);

    expect(placement).toMatchObject({
      handle: 'map_1',
      mapId: 'private-map-1',
      placementId: 'map_placement_1',
      placementNumber: 1,
    });
    expect(registry.placementCount).toBe(TURN_MAP_MAX_PLACEMENTS);
    expect(registry.isPlaced('map_1')).toBe(true);
    expect(registry.isPlacementAccepted('map_placement_1')).toBe(true);

    expect(
      registry.acceptPlacement({
        placementId: placement.placementId,
        mapId: placement.mapId,
        handle: placement.handle,
      }),
    ).toMatchObject(placement);
    expect(() => registry.place(registration.handle)).toThrow(
      TurnMapRegistryError,
    );
    expect(registry.placementCount).toBe(1);
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

  it('snapshots and restores registrations and accepted placement IDs', () => {
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
    expect(() => restored.place('map_1')).toThrow(/at most 1 time/);
  });

  it('restores only valid current-turn map milestones and ignores session overlays', () => {
    const registry = new TurnMapRegistry({ idFactory: deterministicIds() });
    const spec = redactMapSpec(mapSpec());

    restoreTurnMapRegistryFromMilestones(registry, [
      {
        type: 'map_session_overlay',
        data: {
          mapId: 'private-map-1',
          origin: { lat: 1, lon: 2 },
        },
      },
      {
        type: 'map_spec',
        data: {
          mapId: 'private-map-1',
          handle: 'map_1',
          spec,
        },
      },
      {
        type: 'map_placement',
        data: {
          placementId: 'bad-placement',
          mapId: 'private-map-1',
          handle: 'map_2',
        },
      },
      {
        type: 'map_placement',
        data: {
          placementId: 'map_placement_1',
          mapId: 'private-map-1',
          handle: 'map_1',
          placementNumber: 1,
        },
      },
      {
        type: 'map_placement',
        data: {
          placementId: 'map_placement_1',
          mapId: 'private-map-1',
          handle: 'map_1',
        },
      },
    ]);

    expect(registry.availableMaps()).toEqual([
      { handle: 'map_1', title: 'Places nearby' },
    ]);
    expect(registry.placementCount).toBe(1);
    expect(registry.isPlaced('map_1')).toBe(true);
    expect(registry.isPlacementAccepted('bad-placement')).toBe(false);
    expect(registry.resolve('map_1')?.spec).toEqual(spec);
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
