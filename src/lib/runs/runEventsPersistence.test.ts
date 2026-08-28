import { describe, expect, it } from 'vitest';
import {
  isMilestoneEvent,
  mapEventForPersistence,
} from './runEventsPersistence';

describe('run-event milestones', () => {
  it('persists cumulative stats snapshots for resume reconstruction', () => {
    expect(isMilestoneEvent('stats')).toBe(true);
  });

  it('persists chart registrations and both placement families for reconstruction', () => {
    expect(isMilestoneEvent('chart_spec')).toBe(true);
    expect(isMilestoneEvent('chart_placement')).toBe(true);
    expect(isMilestoneEvent('panel_executor_chart')).toBe(true);
  });

  it('persists map registrations and placements but not session overlays', () => {
    expect(isMilestoneEvent('map_spec')).toBe(true);
    expect(isMilestoneEvent('map_placement')).toBe(true);
    expect(isMilestoneEvent('map_session_overlay')).toBe(false);

    const spec = {
      places: [
        {
          id: 'node/1',
          name: 'Central Cafe',
          coordinate: { lat: 40, lon: -75 },
          sourceUrl: 'https://www.openstreetmap.org/node/1',
          provider: 'openstreetmap',
          attribution: '© OpenStreetMap contributors',
        },
      ],
      attribution: '© OpenStreetMap contributors',
      retrievedAt: '2026-08-27T12:00:00.000Z',
      title: 'Nearby places',
    };
    const event = {
      type: 'map_spec' as const,
      messageId: 'assistant-1',
      data: {
        mapId: 'private-map-1',
        handle: 'map_1',
        spec,
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

  it('redacts unsafe map milestone identities and malformed placements', () => {
    const spec = {
      places: [],
      attribution: 'Test provider',
      retrievedAt: '2026-08-27T12:00:00.000Z',
    };
    const valid = {
      type: 'map_spec' as const,
      messageId: 'assistant-1',
      data: { mapId: 'private-map-1', handle: 'map_1', spec },
    };

    expect(
      mapEventForPersistence({
        ...valid,
        data: { ...valid.data, handle: 'not-a-map-handle' },
      }),
    ).toBeNull();
    expect(
      mapEventForPersistence({
        ...valid,
        data: {
          ...valid.data,
          handle: 'map_1',
          turnHandle: 'map_2',
        },
      }),
    ).toBeNull();
    expect(
      mapEventForPersistence({
        type: 'map_placement',
        messageId: 'assistant-1',
        data: {
          placementId: 'placement-1',
          mapId: 'private-map-1',
          handle: 'map_1',
          placementNumber: 2,
        },
      }),
    ).toBeNull();
    expect(
      mapEventForPersistence({
        type: 'map_placement',
        messageId: 'assistant-1',
        data: {
          placementId: 'placement-1',
          mapId: 'private-map-1',
          handle: 'map_1',
        },
      }),
    ).toMatchObject({
      type: 'map_placement',
      data: { placementId: 'placement-1', mapId: 'private-map-1' },
    });
  });

  it('does not persist response token deltas as chart milestones', () => {
    expect(isMilestoneEvent('response')).toBe(false);
    expect(isMilestoneEvent('panel_executor_data')).toBe(false);
    expect(isMilestoneEvent(undefined)).toBe(false);
  });
});
