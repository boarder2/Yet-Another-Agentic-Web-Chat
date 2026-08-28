// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PersistableMapSpec } from '@/lib/maps/types';

const mocks = vi.hoisted(() => {
  const map = {
    attributionControl: { addAttribution: vi.fn() },
    fitBounds: vi.fn(),
    invalidateSize: vi.fn(),
    remove: vi.fn(),
    setView: vi.fn(),
  };
  const tileLayers: Array<{
    on: ReturnType<typeof vi.fn>;
    addTo: ReturnType<typeof vi.fn>;
  }> = [];
  const leafletMap = vi.fn(() => map);
  const tileLayer = vi.fn(() => {
    const layer = {
      on: vi.fn(),
      addTo: vi.fn(),
    };
    tileLayers.push(layer);
    return layer;
  });
  const marker = vi.fn(() => ({
    addTo: vi.fn(),
    bindPopup: vi.fn().mockReturnThis(),
    getElement: vi.fn(() => null),
    on: vi.fn(),
  }));
  const polyline = vi.fn(() => ({ addTo: vi.fn() }));
  const circleMarker = vi.fn(() => ({
    addTo: vi.fn(),
    bindPopup: vi.fn().mockReturnThis(),
  }));
  const divIcon = vi.fn(() => ({}));
  const latLngBounds = vi.fn(() => ({
    getCenter: vi.fn(() => ({ lat: 40, lng: -75 })),
  }));
  const leaflet = {
    circleMarker,
    divIcon,
    latLngBounds,
    map: leafletMap,
    marker,
    polyline,
    tileLayer,
  };

  return {
    configHook: vi.fn(),
    leafletMap,
    leaflet,
    tileLayers,
  };
});

vi.mock('@/lib/hooks/api/useMapping', () => ({
  useMappingConfig: mocks.configHook,
}));

vi.mock('leaflet', () => ({
  ...mocks.leaflet,
  default: mocks.leaflet,
}));

import MapWidget from './MapWidget';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const config = {
  enabled: true,
  available: true,
  provider: 'test' as const,
  publicServicesAcknowledged: true,
  usesPublicServices: false,
  serviceHosts: ['tiles.example'],
  publicServiceHosts: [],
  tile: {
    url: 'https://tiles.example/{z}/{x}/{y}.png',
    attribution: 'Tile provider',
  },
  routeProfiles: { driving: 'driving' },
  capabilities: {
    geocoding: true,
    nearby: true,
    placeDetails: true,
    routing: true,
    routeModes: ['driving' as const],
    tiles: true,
  },
  savedLocationEnabled: false,
};

const firstSpec: PersistableMapSpec = {
  places: [
    {
      id: 'place-1',
      name: 'First place',
      coordinate: { lat: 40, lon: -75 },
      sourceUrl: 'https://provider-a.example/place-1',
      provider: 'provider-a',
      attribution: 'Provider A',
    },
  ],
  attribution: 'Provider A',
  retrievedAt: '2026-08-27T12:00:00.000Z',
  title: 'First map',
};

const secondSpec: PersistableMapSpec = {
  ...firstSpec,
  places: [
    {
      ...firstSpec.places[0],
      id: 'place-2',
      name: 'Second place',
      coordinate: { lat: 41, lon: -76 },
      sourceUrl: 'https://provider-b.example/place-2',
      provider: 'provider-b',
      attribution: 'Provider B',
    },
  ],
  attribution: 'Provider B',
  title: 'Second map',
};

type ObserverEntry = {
  isIntersecting: boolean;
  intersectionRatio: number;
  target: Element;
};

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly callback: IntersectionObserverCallback;
  readonly options: IntersectionObserverInit | undefined;
  observed: Element | undefined;
  disconnect = vi.fn();
  observe = vi.fn((element: Element) => {
    this.observed = element;
  });

  constructor(
    callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) {
    this.callback = callback;
    this.options = options;
    FakeIntersectionObserver.instances.push(this);
  }

  trigger(isIntersecting = true): void {
    const entry: ObserverEntry = {
      isIntersecting,
      intersectionRatio: isIntersecting ? 1 : 0,
      target: this.observed as Element,
    };
    this.callback(
      [entry as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

let container: HTMLDivElement;
let root: Root;

function renderWidgets(specs: PersistableMapSpec[]): void {
  root.render(
    createElement(
      'div',
      null,
      ...specs.map((spec, index) =>
        createElement(MapWidget, { key: index, spec }),
      ),
    ),
  );
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  FakeIntersectionObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  mocks.configHook.mockReturnValue({
    data: config,
    isPending: false,
    isError: false,
  });
  mocks.leafletMap.mockClear();
  mocks.leaflet.tileLayer.mockClear();
  mocks.leaflet.marker.mockClear();
  mocks.leaflet.polyline.mockClear();
  mocks.leaflet.circleMarker.mockClear();
  mocks.leaflet.divIcon.mockClear();
  mocks.leaflet.latLngBounds.mockClear();
  mocks.tileLayers.length = 0;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('MapWidget lazy rendering', () => {
  it('keeps semantic map content expanded and defers Leaflet until near the viewport', async () => {
    await act(async () => renderWidgets([firstSpec, secondSpec]));

    expect(container.querySelectorAll('[data-map-widget]')).toHaveLength(2);
    expect(container.textContent).toContain('First place');
    expect(container.textContent).toContain('Second place');
    expect(container.querySelectorAll('[data-map-links]')).toHaveLength(2);
    expect(container.textContent).toContain('Provider A');
    expect(container.textContent).toContain('Provider B');
    const canvases = container.querySelectorAll('[data-map-canvas]');
    const initialCanvases = Array.from(canvases);
    expect(initialCanvases).toHaveLength(2);
    for (const canvas of initialCanvases) {
      expect(canvas.getAttribute('role')).toBe('region');
      expect(canvas.getAttribute('aria-label')).toBe('Interactive map');
      expect(canvas.hasAttribute('hidden')).toBe(false);
      expect(canvas.className).toContain('min-h-64');
      expect(canvas.className).toContain('sm:h-80');
    }
    expect(mocks.leafletMap).not.toHaveBeenCalled();
    expect(FakeIntersectionObserver.instances).toHaveLength(2);
    expect(FakeIntersectionObserver.instances[0].options).toMatchObject({
      rootMargin: '300px 0px',
    });

    await act(async () => {
      for (const observer of FakeIntersectionObserver.instances) {
        observer.trigger(false);
      }
    });
    expect(mocks.leafletMap).not.toHaveBeenCalled();
    const canvasesWhileOffscreen = Array.from(
      container.querySelectorAll('[data-map-canvas]'),
    );
    expect(canvasesWhileOffscreen).toHaveLength(2);
    initialCanvases.forEach((canvas, index) => {
      expect(canvasesWhileOffscreen[index]).toBe(canvas);
    });

    await act(async () => FakeIntersectionObserver.instances[0]?.trigger());
    await act(settle);
    expect(mocks.leafletMap).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll('[data-map-canvas]')).toHaveLength(2);
    expect(
      container.querySelectorAll('[data-map-render-state="idle"]'),
    ).toHaveLength(1);

    await act(async () => FakeIntersectionObserver.instances[1]?.trigger());
    await act(settle);

    expect(container.querySelectorAll('[data-map-canvas]')).toHaveLength(2);
    expect(mocks.leafletMap).toHaveBeenCalledTimes(2);
    const canvasesAfterInitialization = Array.from(
      container.querySelectorAll('[data-map-canvas]'),
    );
    initialCanvases.forEach((canvas, index) => {
      expect(canvasesAfterInitialization[index]).toBe(canvas);
    });
    expect(container.textContent).toContain('First place');
    expect(container.textContent).toContain('Second place');
  });

  it('keeps the semantic status fallback visible when interactive maps are unavailable', async () => {
    mocks.configHook.mockReturnValue({
      data: {
        ...config,
        enabled: false,
        available: false,
        unavailableReason: 'disabled',
      },
      isPending: false,
      isError: false,
    });

    await act(async () => renderWidgets([firstSpec]));

    expect(container.querySelector('[data-map-status]')?.textContent).toContain(
      'Interactive maps are disabled.',
    );
    expect(container.querySelectorAll('[data-map-canvas]')).toHaveLength(1);
    expect(mocks.leafletMap).not.toHaveBeenCalled();
  });

  it('keeps provider attributions and a tile failure local to its own map', async () => {
    const multiAttributionSpec: PersistableMapSpec = {
      ...firstSpec,
      attributions: ['Provider A', 'Provider B'],
    };

    await act(async () => renderWidgets([multiAttributionSpec, secondSpec]));
    expect(container.textContent).toContain('Provider A');
    expect(container.textContent).toContain('Provider B');

    for (const observer of FakeIntersectionObserver.instances) {
      await act(async () => observer.trigger());
      await act(settle);
    }

    expect(mocks.leafletMap).toHaveBeenCalledTimes(2);
    expect(mocks.leaflet.map).toHaveBeenCalledTimes(2);
    expect(
      mocks.leafletMap.mock.results[0]?.value.attributionControl.addAttribution,
    ).toHaveBeenCalledWith('Provider A');
    expect(
      mocks.leafletMap.mock.results[0]?.value.attributionControl.addAttribution,
    ).toHaveBeenCalledWith('Provider B');

    const firstTileError = mocks.tileLayers[0]?.on.mock.calls.find(
      ([event]) => event === 'tileerror',
    )?.[1] as (() => void) | undefined;
    expect(firstTileError).toBeDefined();
    await act(async () => firstTileError?.());

    const widgets = [...container.querySelectorAll('[data-map-widget]')];
    expect(widgets[0]?.getAttribute('data-map-render-state')).toBe(
      'tile-error',
    );
    expect(widgets[1]?.getAttribute('data-map-render-state')).toBe('ready');
    expect(widgets[1]?.textContent).toContain('Second place');
  });
});
