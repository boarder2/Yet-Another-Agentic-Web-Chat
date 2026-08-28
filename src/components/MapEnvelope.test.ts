import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import MapEnvelope from './maps/MapEnvelope';
import MarkdownRenderer from './MarkdownRenderer';
import { MapSpecContext } from '@/lib/maps/MapSpecContext';
import { appendMapWidget, type MapPayload } from '@/lib/widgets/envelope';
import type { PersistableMapSpec } from '@/lib/maps/types';

const spec: PersistableMapSpec = {
  places: [
    {
      id: 'node/1',
      name: 'Central Cafe',
      coordinate: { lat: 40, lon: -75 },
      address: '1 Main Street',
      sourceUrl: 'https://www.openstreetmap.org/node/1',
      provider: 'openstreetmap',
      attribution: '© OpenStreetMap contributors',
    },
  ],
  attribution: '© OpenStreetMap contributors',
  retrievedAt: '2026-08-27T12:00:00.000Z',
  title: 'Nearby places',
};

const payload: MapPayload = {
  id: 'map_placement_1',
  mapId: 'private-map-1',
  title: 'Nearby places',
  fallback: 'Nearby places\n1. Central Cafe — 1 Main Street',
  links: [
    { label: '1. Central Cafe', url: 'https://www.openstreetmap.org/node/1' },
  ],
  attribution: '© OpenStreetMap contributors',
};

function providerValue(
  mapId = 'private-map-1',
): ComponentProps<typeof MapSpecContext.Provider>['value'] {
  return {
    getMapSpecById: (id) => (id === mapId ? spec : undefined),
  };
}

describe('MapEnvelope', () => {
  it('renders the exact registered map as a text-first accessible fallback', () => {
    const markup = renderToStaticMarkup(
      createElement(
        MapSpecContext.Provider,
        { value: providerValue() },
        createElement(MapEnvelope, { payload }),
      ),
    );

    expect(markup).toContain('data-map-envelope');
    expect(markup).toContain('Nearby places');
    expect(markup).toContain('1. Central Cafe');
    expect(markup).toContain('1 Main Street');
    expect(markup).toContain('https://www.openstreetmap.org/node/1');
    expect(markup).toContain('Map attribution: © OpenStreetMap contributors');
    expect(markup).not.toContain('40');
    expect(markup).not.toContain('-75');
  });

  it('does not render a guessed private map ID', () => {
    const markup = renderToStaticMarkup(
      createElement(
        MapSpecContext.Provider,
        { value: providerValue('different-map') },
        createElement(MapEnvelope, { payload }),
      ),
    );

    expect(markup).toBe('');
  });

  it('dispatches a valid yaawc:map fence through MarkdownRenderer', () => {
    const content = appendMapWidget('Answer\n\n', payload);
    const markup = renderToStaticMarkup(
      createElement(
        MapSpecContext.Provider,
        { value: providerValue() },
        createElement(MarkdownRenderer, { content }),
      ),
    );

    expect(markup).toContain('data-map-envelope');
    expect(markup).toContain('Central Cafe');
    expect(markup).not.toContain('yaawc:map');
  });
});
