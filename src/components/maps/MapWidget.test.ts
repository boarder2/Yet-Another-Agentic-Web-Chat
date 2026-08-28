import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PersistableMapSpec } from '@/lib/maps/types';
import MapWidget from './MapWidget';

const spec: PersistableMapSpec = {
  places: [
    {
      id: 'node/1',
      name: 'Central Cafe',
      coordinate: { lat: 40, lon: -75 },
      address: '1 Main Street',
      category: 'cafe',
      sourceUrl: 'https://source.example/place/1',
      websiteUrl: 'https://central-cafe.example',
      provider: 'test',
      attribution: 'Test map provider',
    },
    {
      id: 'node/2',
      name: 'North Library',
      coordinate: { lat: 40.1, lon: -75.1 },
      address: '2 Main Street',
      sourceUrl: 'https://source.example/place/2',
      provider: 'test',
      attribution: 'Test map provider',
    },
  ],
  route: {
    mode: 'driving',
    origin: { lat: 40, lon: -75 },
    destination: { lat: 40.2, lon: -75.2 },
    distanceMeters: 12_000,
    durationSeconds: 900,
    geometry: {
      type: 'LineString',
      coordinates: [
        [-75, 40],
        [-75.1, 40.1],
        [-75.2, 40.2],
      ],
    },
    sourceUrl: 'https://source.example/route/1',
    navigationUrl: 'https://navigation.example/route/1',
    provider: 'test',
    attribution: 'Test map provider',
  },
  attribution: 'Test map provider',
  retrievedAt: '2026-08-27T12:00:00.000Z',
  title: 'Nearby places',
  summary: 'Validated places near the requested area.',
};

function render(specification: PersistableMapSpec): string {
  return renderToStaticMarkup(
    createElement(MapWidget, { spec: specification }),
  );
}

describe('MapWidget semantic fallback', () => {
  it('renders numbered places, route details, retrieval time, attribution, and external links without a canvas on the server', () => {
    const markup = render(spec);

    expect(markup).toContain('data-map-widget');
    expect(markup).toContain('aria-label="Mapped places"');
    expect(markup).toContain('1. Central Cafe');
    expect(markup).toContain('2. North Library');
    expect(markup).toContain('Driving route: 12 km, about 15 min.');
    expect(markup).toContain('Retrieved:');
    expect(markup).toContain('Map attribution: Test map provider');
    expect(markup).toContain('https://navigation.example/route/1');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).not.toContain('data-map-canvas');
    expect(markup).not.toContain('40,-75');
    expect(markup).not.toContain('-75.2,40.2');
  });

  it('keeps a redacted route useful while omitting exact-route links', () => {
    const redactedSpec: PersistableMapSpec = {
      ...spec,
      route: {
        mode: 'driving',
        destination: { lat: 40.2, lon: -75.2 },
        distanceMeters: 12_000,
        durationSeconds: 900,
        provider: 'test',
        attribution: 'Test map provider',
        routeNotRetained: true,
      },
      routeNotRetained: true,
    };

    const markup = render(redactedSpec);

    expect(markup).toContain('Driving route: 12 km, about 15 min.');
    expect(markup).toContain('Route not retained in this answer.');
    expect(markup).not.toContain('navigation.example');
    expect(markup).not.toContain('source.example/route/1');
  });

  it('renders an explicit error state for invalid map data', () => {
    const invalidSpec = {
      ...spec,
      places: [
        {
          ...spec.places[0],
          coordinate: { lat: 91, lon: -75 },
        },
      ],
    } as unknown as PersistableMapSpec;

    const markup = render(invalidSpec);

    expect(markup).toContain('data-map-render-state="error"');
    expect(markup).toContain('Map data is unavailable.');
    expect(markup).not.toContain('data-map-canvas');
  });
});
