import { describe, expect, it } from 'vitest';
import {
  isMilestoneEvent,
  mapDiscoveryEventForPersistence,
  mapEventForPersistence,
} from './runEventsPersistence';
import type { StreamEvent } from '@/lib/streaming/events';
import type { MapPlace, MapRoute } from '@/lib/maps/types';

const place = (number: number): MapPlace => ({
  id: `node/${number}`,
  name: `Place ${number}`,
  coordinate: { lat: 40 + number / 100, lon: -75 - number / 100 },
  sourceUrl: `https://www.openstreetmap.org/node/${number}`,
  provider: 'openstreetmap',
  attribution: '© OpenStreetMap contributors',
});

const route: MapRoute = {
  mode: 'driving',
  origin: { lat: 40.01, lon: -75.01 },
  destination: { lat: 40.02, lon: -75.02 },
  distanceMeters: 12_000,
  durationSeconds: 900,
  geometry: {
    type: 'LineString',
    coordinates: [
      [-75.01, 40.01],
      [-75.02, 40.02],
    ],
  },
  sourceUrl: 'https://router.example/route?from=40.01,-75.01&to=40.02,-75.02',
  navigationUrl: 'https://router.example/nav?from=40.01,-75.01&to=40.02,-75.02',
  provider: 'router',
  attribution: 'Routing provider',
};

const mapSpec = {
  places: [place(1)],
  attribution: '© OpenStreetMap contributors',
  retrievedAt: '2026-08-27T12:00:00.000Z',
  title: 'Nearby places',
};

describe('run-event milestones', () => {
  it('persists cumulative stats snapshots for resume reconstruction', () => {
    expect(isMilestoneEvent('stats')).toBe(true);
  });

  it('persists chart registrations and both placement families for reconstruction', () => {
    expect(isMilestoneEvent('chart_spec')).toBe(true);
    expect(isMilestoneEvent('chart_placement')).toBe(true);
    expect(isMilestoneEvent('panel_executor_chart')).toBe(true);
  });

  it('persists map discovery, registrations, and placements but not session overlays', () => {
    expect(isMilestoneEvent('map_places_discovered')).toBe(true);
    expect(isMilestoneEvent('map_place_discovered')).toBe(true);
    expect(isMilestoneEvent('map_route_discovered')).toBe(true);
    expect(isMilestoneEvent('map_spec')).toBe(true);
    expect(isMilestoneEvent('map_placement')).toBe(true);
    expect(isMilestoneEvent('map_session_overlay')).toBe(false);

    const event = {
      type: 'map_spec' as const,
      messageId: 'assistant-1',
      data: {
        mapId: 'private-map-1',
        handle: 'map_1',
        spec: mapSpec,
        source: 'mapping-tool',
      },
    };

    expect(mapEventForPersistence(event)).toEqual(event);
    expect(
      mapEventForPersistence({
        type: 'map_session_overlay',
        messageId: 'assistant-1',
        data: {
          mapId: 'private-map-1',
          origin: { lat: 40.1, lon: -75.1 },
          clientSessionId: 'page-1',
        },
      }),
    ).toBeNull();
  });

  it('sanitizes provider-grounded place and route discovery milestones', () => {
    const placesEvent = {
      type: 'map_places_discovered',
      messageId: 'assistant-1',
      data: {
        places: [
          {
            handle: 'place_1',
            place: place(1),
            retrievedAt: '2026-08-27T12:00:00.000Z',
            mapHandle: 'map_1',
            unexpected: 'discarded',
          },
          {
            handle: 'place_2',
            place: place(2),
          },
        ],
      },
    } as unknown as StreamEvent;

    expect(mapDiscoveryEventForPersistence(placesEvent)).toEqual({
      type: 'map_places_discovered',
      messageId: 'assistant-1',
      data: {
        places: [
          {
            handle: 'place_1',
            place: place(1),
            retrievedAt: '2026-08-27T12:00:00.000Z',
          },
          { handle: 'place_2', place: place(2) },
        ],
      },
    });

    const routeEvent = {
      type: 'map_route_discovered',
      messageId: 'assistant-1',
      data: {
        handle: 'route_1',
        route,
        placeHandles: ['place_1', 'place_2'],
        retrievedAt: '2026-08-27T12:00:00.000Z',
        routeRetained: true,
        mapHandle: 'map_1',
        secret: 'discarded',
      },
    } as unknown as StreamEvent;

    expect(mapDiscoveryEventForPersistence(routeEvent)).toEqual({
      type: 'map_route_discovered',
      messageId: 'assistant-1',
      data: {
        handle: 'route_1',
        route,
        placeHandles: ['place_1', 'place_2'],
        originPlaceHandle: 'place_1',
        destinationPlaceHandle: 'place_2',
        retrievedAt: '2026-08-27T12:00:00.000Z',
      },
    });
  });

  it('redacts transient route discoveries before durable storage while retaining the destination projection', () => {
    const event = {
      type: 'map_route_discovered',
      messageId: 'assistant-1',
      data: {
        handle: 'route_1',
        route,
        placeHandles: ['place_1', 'place_2'],
        routeRetained: false,
      },
    } as unknown as StreamEvent;

    const persisted = mapDiscoveryEventForPersistence(event, {
      retainRoute: false,
      retainOrigin: false,
    });

    expect(persisted).toMatchObject({
      type: 'map_route_discovered',
      messageId: 'assistant-1',
      data: {
        handle: 'route_1',
        placeHandles: ['place_2'],
        destinationPlaceHandle: 'place_2',
        route: {
          routeNotRetained: true,
          destination: route.destination,
          distanceMeters: route.distanceMeters,
          durationSeconds: route.durationSeconds,
          provider: route.provider,
          attribution: route.attribution,
        },
        routeRetained: false,
      },
    });
    const serialized = JSON.stringify(persisted);
    expect(serialized).not.toContain('40.01');
    expect(serialized).not.toContain('-75.01');
    expect(serialized).not.toContain('router.example');
    expect(serialized).not.toContain('geometry');
  });

  it('rejects malformed discovery identities and placement payloads but accepts any positive placement number', () => {
    const specEvent = {
      type: 'map_spec' as const,
      messageId: 'assistant-1',
      data: { mapId: 'private-map-1', spec: mapSpec },
    };

    expect(
      mapEventForPersistence({
        ...specEvent,
        data: { ...specEvent.data, mapId: '<unsafe>' },
      }),
    ).toBeNull();
    expect(
      mapEventForPersistence({
        ...specEvent,
        data: {
          ...specEvent.data,
          handle: 'map_1',
          turnHandle: 'map_2',
        },
      }),
    ).toBeNull();
    expect(
      mapEventForPersistence({
        type: 'map_places_discovered',
        data: { places: [{ handle: 'map_1', place: place(1) }] },
      } as unknown as StreamEvent),
    ).toBeNull();
    expect(
      mapEventForPersistence({
        type: 'map_route_discovered',
        data: { handle: 'route_1', route, placeHandles: ['place_1', 'bad'] },
      } as unknown as StreamEvent),
    ).toBeNull();
    expect(
      mapEventForPersistence({
        type: 'map_placement',
        messageId: 'assistant-1',
        data: {
          placementId: '<unsafe>',
          mapId: 'private-map-1',
          placementNumber: 2,
        },
      }),
    ).toBeNull();
    expect(
      mapEventForPersistence({
        type: 'map_placement',
        messageId: 'assistant-1',
        data: {
          placementId: 'placement-2',
          mapId: 'private-map-1',
          placementNumber: 2,
        },
      }),
    ).toMatchObject({
      type: 'map_placement',
      data: {
        placementId: 'placement-2',
        mapId: 'private-map-1',
        placementNumber: 2,
      },
    });
  });

  it('does not persist response token deltas as map milestones', () => {
    expect(isMilestoneEvent('response')).toBe(false);
    expect(isMilestoneEvent('panel_executor_data')).toBe(false);
    expect(isMilestoneEvent(undefined)).toBe(false);
  });
});
