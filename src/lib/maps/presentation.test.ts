import { describe, expect, it } from 'vitest';
import {
  formatMapAttributions,
  formatMapSpecFallback,
  mapSpecToPayload,
} from './presentation';
import type { PersistableMapSpec } from './types';

const mixedSpec = (withAttributions = true): PersistableMapSpec => ({
  places: [
    {
      id: 'node/1',
      name: 'First place',
      coordinate: { lat: 40, lon: -75 },
      sourceUrl: 'https://provider-a.example/places/1',
      provider: 'provider-a',
      attribution: 'Provider A',
    },
    {
      id: 'node/2',
      name: 'Second place',
      coordinate: { lat: 40.1, lon: -75.1 },
      sourceUrl: 'https://provider-b.example/places/2',
      provider: 'provider-b',
      attribution: 'Provider B',
    },
  ],
  route: {
    mode: 'driving',
    origin: { lat: 39, lon: -74 },
    destination: { lat: 39.1, lon: -74.1 },
    distanceMeters: 4_000,
    durationSeconds: 600,
    geometry: {
      type: 'LineString',
      coordinates: [
        [-74, 39],
        [-74.1, 39.1],
      ],
    },
    sourceUrl: 'https://provider-c.example/routes/1',
    navigationUrl: 'https://provider-c.example/navigate/1',
    provider: 'provider-c',
    attribution: 'Provider C',
  },
  attribution: 'Provider A',
  ...(withAttributions
    ? { attributions: ['Provider A', 'Provider B', 'Provider A'] }
    : {}),
  retrievedAt: '2026-01-01T00:00:00.000Z',
  title: 'Mixed providers',
});

describe('map presentation attribution compatibility', () => {
  it('retains every distinct attribution in deterministic first-seen order', () => {
    const spec = mixedSpec();

    expect(formatMapAttributions(spec)).toEqual([
      'Provider A',
      'Provider B',
      'Provider C',
    ]);
    expect(formatMapSpecFallback(spec)).toContain(
      'Attribution: Provider A · Provider B · Provider C',
    );

    const payload = mapSpecToPayload('private-map-1', 'map_placement_1', spec);
    expect(payload).toMatchObject({
      mapId: 'private-map-1',
      id: 'map_placement_1',
      attribution: 'Provider A',
      attributions: ['Provider A', 'Provider B', 'Provider C'],
    });
  });

  it('derives the complete set when rendering a legacy persisted single-attribution spec', () => {
    const legacy = mixedSpec(false);

    expect(legacy).not.toHaveProperty('attributions');
    expect(formatMapAttributions(legacy)).toEqual([
      'Provider A',
      'Provider B',
      'Provider C',
    ]);

    const payload = mapSpecToPayload('legacy-map', 'legacy-placement', legacy);
    expect(payload.attribution).toBe('Provider A');
    expect(payload.attributions).toEqual([
      'Provider A',
      'Provider B',
      'Provider C',
    ]);
  });
});
