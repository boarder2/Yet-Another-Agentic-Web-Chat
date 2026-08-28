import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  insertPartialAssistantRow: vi.fn().mockResolvedValue(undefined),
  updateAssistantRow: vi.fn().mockResolvedValue(undefined),
  sumMessageContentChars: vi.fn().mockResolvedValue(0),
  enqueueRunEvent: vi.fn(),
  flushRunEvents: vi.fn().mockResolvedValue(undefined),
  dropRunEventBuffer: vi.fn(),
  deleteCheckpoint: vi.fn().mockResolvedValue(undefined),
  cleanupCancelToken: vi.fn(),
  registerCancelToken: vi.fn(),
  cleanupRun: vi.fn(),
  registerRetrieval: vi.fn(),
  clearSoftStop: vi.fn(),
  dbUpdate: vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        execute: vi.fn().mockResolvedValue({ changes: 1 }),
      })),
    })),
  })),
}));

vi.mock('@/lib/db', () => ({ default: { update: mocks.dbUpdate } }));
vi.mock('@/lib/db/queries', () => ({
  insertPartialAssistantRow: mocks.insertPartialAssistantRow,
  updateAssistantRow: mocks.updateAssistantRow,
  sumMessageContentChars: mocks.sumMessageContentChars,
}));
vi.mock('@/lib/runs/runEventsPersistence', () => ({
  enqueueRunEvent: mocks.enqueueRunEvent,
  flushRunEvents: mocks.flushRunEvents,
  dropRunEventBuffer: mocks.dropRunEventBuffer,
  mapDiscoveryEventForPersistence: (event: unknown) => event,
  mapEventForPersistence: (event: unknown) => event,
  sanitizeLocationMilestone: (event: unknown) => event,
}));
vi.mock('@/lib/runs/checkpointer', () => ({
  deleteCheckpoint: mocks.deleteCheckpoint,
}));
vi.mock('@/lib/cancel-tokens', () => ({
  cleanupCancelToken: mocks.cleanupCancelToken,
  registerCancelToken: mocks.registerCancelToken,
}));
vi.mock('@/lib/utils/runControl', () => ({
  cleanupRun: mocks.cleanupRun,
  registerRetrieval: mocks.registerRetrieval,
  clearSoftStop: mocks.clearSoftStop,
}));
vi.mock('@/lib/search/agentStreamDriver', () => ({
  deduplicateDocuments: (documents: unknown[]) => documents,
}));
vi.mock('@/lib/utils/chatTitle', () => ({
  generateChatTitle: vi.fn(),
}));
vi.mock('@/lib/sandbox/codeExecutionCorrelation', () => ({
  popCallbackRunId: vi.fn(),
}));
vi.mock('@/lib/userQuestion/questionCorrelation', () => ({
  popCallbackRunId: vi.fn(),
}));

import { attachResumedRunHost, attachRunHost } from './runHost';
import { evictByChatId, setEventPersister, type Run } from './runHub';
import { TurnChartRegistry } from '@/lib/chart/turnChartRegistry';
import { TurnMapRegistry } from '@/lib/maps/turnMapRegistry';
import { emitStreamEvent } from '@/lib/streaming/events';

const mapSpec = {
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

const createdRuns: Run[] = [];
let nextRun = 1;

function makeRun(status: Run['status'] = 'running'): Run {
  const id = `map-host-${nextRun++}`;
  const run: Run = {
    chatId: `${id}-chat`,
    messageId: `${id}-user`,
    aiMessageId: `${id}-assistant`,
    threadId: `${id}:thread`,
    status,
    emitter: new EventEmitter(),
    eventLog: [],
    subscribers: new Map(),
    abortController: new AbortController(),
    retrievalController: new AbortController(),
    seq: 0,
    startedAt: Date.now(),
    recievedMessage: '',
    chartRegistry: new TurnChartRegistry(),
    mapRegistry: new TurnMapRegistry({
      idFactory: (() => {
        let value = 0;
        return () => `private-map-${++value}`;
      })(),
    }),
  };
  createdRuns.push(run);
  return run;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for run host');
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.insertPartialAssistantRow.mockResolvedValue(undefined);
  mocks.updateAssistantRow.mockResolvedValue(undefined);
  mocks.sumMessageContentChars.mockResolvedValue(0);
  mocks.flushRunEvents.mockResolvedValue(undefined);
  mocks.deleteCheckpoint.mockResolvedValue(undefined);
});

afterEach(() => {
  setEventPersister(null);
  for (const run of createdRuns.splice(0)) {
    if (run.ttlTimer !== undefined) clearTimeout(run.ttlTimer);
    evictByChatId(run.chatId);
  }
});

describe('runHost map durability boundary', () => {
  it('writes an explicitly composed map and placement to content/metadata while dropping overlays from durable state', async () => {
    const run = makeRun();
    const [place] = run.mapRegistry.registerPlaces([mapSpec.places[0]]);
    const placement = run.mapRegistry.composeMap({
      placeHandles: [place.handle],
      title: 'Nearby places',
    });

    await attachRunHost({
      run,
      startTime: run.startedAt,
      userMessageId: run.messageId,
      usedLocation: false,
      usedPersonalization: false,
      memoriesUsed: [],
      isResume: false,
    });

    emitStreamEvent(run.emitter, {
      type: 'map_spec',
      data: {
        mapId: placement.mapId,
        spec: placement.spec,
        source: 'show_map',
      },
    });
    emitStreamEvent(run.emitter, {
      type: 'map_placement',
      data: {
        placementId: placement.placementId,
        mapId: placement.mapId,
        placementNumber: placement.placementNumber,
      },
    });
    emitStreamEvent(run.emitter, {
      type: 'map_session_overlay',
      data: {
        mapId: placement.mapId,
        origin: { lat: 40.1, lon: -75.1 },
        clientSessionId: 'page-1',
      },
    });
    emitStreamEvent(run.emitter, { type: 'agent_end' });

    await waitFor(() => run.status === 'completed');

    expect(run.recievedMessage).toContain('```yaawc:map');
    expect(run.recievedMessage).not.toContain('40.1');
    expect(run.eventLog.map(({ ev }) => ev.type)).toEqual(
      expect.arrayContaining(['map_spec', 'map_placement', 'messageEnd']),
    );
    expect(run.eventLog.map(({ ev }) => ev.type)).not.toContain(
      'map_session_overlay',
    );
    expect(
      mocks.enqueueRunEvent.mock.calls.some(
        ([, , seqEvent]) => seqEvent.ev.type === 'map_session_overlay',
      ),
    ).toBe(false);

    const finalUpdate = mocks.updateAssistantRow.mock.calls.at(-1);
    expect(finalUpdate?.[0]).toBe(run.aiMessageId);
    expect(finalUpdate?.[1]).toMatchObject({
      content: expect.stringContaining('```yaawc:map'),
      metadata: {
        mapSpecs: {
          [placement.mapId]: expect.objectContaining({
            title: 'Nearby places',
          }),
        },
      },
    });
    expect(JSON.stringify(finalUpdate?.[1].metadata)).not.toContain('40.1');
  });

  it('rebuilds all explicit map placements and discovery handles from persisted milestones', async () => {
    const source = new TurnMapRegistry({
      idFactory: (() => {
        let value = 0;
        return () => `private-map-${++value}`;
      })(),
    });
    const [firstPlace, secondPlace] = source.registerPlaces([
      mapSpec.places[0],
      {
        ...mapSpec.places[0],
        id: 'node/2',
        name: 'North Market',
        coordinate: { lat: 40.1, lon: -75.1 },
        sourceUrl: 'https://www.openstreetmap.org/node/2',
      },
    ]);
    const first = source.composeMap({
      placeHandles: [firstPlace.handle, secondPlace.handle],
      title: 'Both places',
    });
    const second = source.composeMap({
      placeHandles: [secondPlace.handle],
      title: 'One place',
    });
    const snapshot = source.snapshot();

    const run = makeRun('awaiting_user');
    run.recievedMessage = 'Answer';
    run.eventLog = [
      {
        seq: 1,
        ev: {
          type: 'map_places_discovered',
          messageId: run.aiMessageId,
          data: { places: snapshot.places ?? [] },
        },
      },
      {
        seq: 2,
        ev: {
          type: 'map_spec',
          messageId: run.aiMessageId,
          data: {
            mapId: first.mapId,
            spec: first.spec,
          },
        },
      },
      {
        seq: 3,
        ev: {
          type: 'map_spec',
          messageId: run.aiMessageId,
          data: {
            mapId: second.mapId,
            spec: second.spec,
          },
        },
      },
      {
        seq: 4,
        ev: {
          type: 'map_placement',
          messageId: run.aiMessageId,
          data: {
            placementId: first.placementId,
            mapId: first.mapId,
            placementNumber: first.placementNumber,
          },
        },
      },
      {
        seq: 5,
        ev: {
          type: 'map_placement',
          messageId: run.aiMessageId,
          data: {
            placementId: second.placementId,
            mapId: second.mapId,
            placementNumber: second.placementNumber,
          },
        },
      },
    ];

    await attachResumedRunHost(run);

    expect(run.mapRegistry.placeCount).toBe(2);
    expect(run.mapRegistry.registrationCount).toBe(2);
    expect(run.mapRegistry.placementCount).toBe(2);
    expect(run.mapRegistry.resolvePlace('place_1')?.place.name).toBe(
      'Central Cafe',
    );
    expect(run.mapRegistry.resolveById(first.mapId)?.title).toBe('Both places');
    expect(run.mapRegistry.resolveById(second.mapId)?.title).toBe('One place');
    expect(run.mapRegistry.isPlacementAccepted(first.placementId)).toBe(true);
    expect(run.mapRegistry.isPlacementAccepted(second.placementId)).toBe(true);
    expect(run.recievedMessage).toContain('Answer');
    expect(run.recievedMessage.match(/```yaawc:map/g)).toHaveLength(2);
    expect(run.recievedMessage).toContain('Central Cafe');
    expect(run.recievedMessage).toContain('North Market');
    expect(mocks.updateAssistantRow).not.toHaveBeenCalled();
  });

  it('retains the legacy map registration reconstruction path for historical widgets', async () => {
    const run = makeRun('awaiting_user');
    run.recievedMessage = 'Answer';
    run.eventLog = [
      {
        seq: 1,
        ev: {
          type: 'map_spec',
          messageId: run.aiMessageId,
          data: {
            mapId: 'private-map-1',
            handle: 'map_1',
            spec: mapSpec,
          },
        },
      },
      {
        seq: 2,
        ev: {
          type: 'map_placement',
          messageId: run.aiMessageId,
          data: {
            placementId: 'map_placement_1',
            mapId: 'private-map-1',
            handle: 'map_1',
            placementNumber: 1,
          },
        },
      },
    ];

    await attachResumedRunHost(run);

    expect(run.mapRegistry.resolve('map_1')).toMatchObject({
      mapId: 'private-map-1',
      title: 'Nearby places',
    });
    expect(run.mapRegistry.isPlacementAccepted('map_placement_1')).toBe(true);
    expect(run.recievedMessage).toContain('Answer');
    expect(run.recievedMessage).toContain('```yaawc:map');
    expect(run.recievedMessage).toContain('Central Cafe');
    expect(mocks.updateAssistantRow).not.toHaveBeenCalled();
  });
});
