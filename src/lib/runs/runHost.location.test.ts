import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resolveMappingConfiguration,
  mappingLocationHosts,
} from '@/lib/maps/config';
import { mappingConfigurationFingerprint } from '@/lib/maps/runtime';
import {
  LocationApprovalPayloadSchema,
  locationTokenStore,
  mintLocationToken,
} from '@/lib/maps/locationSessions';
import { TurnChartRegistry } from '@/lib/chart/turnChartRegistry';
import { TurnMapRegistry } from '@/lib/maps/turnMapRegistry';
import { emitStreamEvent } from '@/lib/streaming/events';
import type { Run } from './runHub';

const mocks = vi.hoisted(() => {
  const dbInsertExecute = vi.fn().mockResolvedValue({ changes: 1 });
  const dbInsertOnConflict = vi.fn(() => ({ execute: dbInsertExecute }));
  const dbInsertValues = vi.fn((_values: unknown) => ({
    onConflictDoNothing: dbInsertOnConflict,
  }));
  const dbUpdateExecute = vi.fn().mockResolvedValue({ changes: 1 });
  const dbUpdateWhere = vi.fn(() => ({ execute: dbUpdateExecute }));
  const dbUpdateSet = vi.fn(() => ({ where: dbUpdateWhere }));
  return {
    db: {
      insert: vi.fn(() => ({ values: dbInsertValues })),
      update: vi.fn(() => ({ set: dbUpdateSet })),
    },
    dbInsertValues,
    dbInsertExecute,
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
  };
});

vi.mock('@/lib/db', () => ({ default: mocks.db }));
vi.mock('@/lib/db/queries', () => ({
  insertPartialAssistantRow: mocks.insertPartialAssistantRow,
  updateAssistantRow: mocks.updateAssistantRow,
  sumMessageContentChars: mocks.sumMessageContentChars,
}));
vi.mock('@/lib/runs/runEventsPersistence', () => ({
  enqueueRunEvent: mocks.enqueueRunEvent,
  flushRunEvents: mocks.flushRunEvents,
  dropRunEventBuffer: mocks.dropRunEventBuffer,
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

import {
  attachRunHost,
  markOpenApprovalsCancelled,
  markOpenApprovalsInterrupted,
} from './runHost';
import { evictByChatId, setEventPersister } from './runHub';

const mappingConfig = resolveMappingConfiguration(
  { mappingEnabled: 'true', mappingPublicServicesAcknowledged: 'true' },
  { testProviderEnabled: true },
);
const hosts = mappingLocationHosts(mappingConfig);

let nextRun = 0;
const createdRuns: Run[] = [];

function makeRun(): Run {
  const id = `location-host-${++nextRun}`;
  const run: Run = {
    chatId: `${id}-chat`,
    messageId: `${id}-message`,
    aiMessageId: `${id}-assistant`,
    threadId: `${id}:thread`,
    status: 'running',
    emitter: new EventEmitter(),
    eventLog: [],
    subscribers: new Map(),
    abortController: new AbortController(),
    retrievalController: new AbortController(),
    seq: 0,
    startedAt: Date.now(),
    recievedMessage: '',
    chartRegistry: new TurnChartRegistry(),
    mapRegistry: new TurnMapRegistry(),
    mappingConfig,
    clientSessionId: 'page-1',
  };
  createdRuns.push(run);
  return run;
}

const payloadFor = (run: Run) => {
  const createdAt = Date.now();
  return LocationApprovalPayloadSchema.parse({
    authorizedPurposes: ['nearby', 'routing', 'tiles'],
    authorizedHosts: hosts,
    providerHosts: [],
    tileHosts: hosts,
    configHash: mappingConfigurationFingerprint(mappingConfig),
    clientSessionId: 'page-1',
    aiMessageId: run.aiMessageId,
    allowSave: true,
    createdAt,
    expiresAt: createdAt + 60_000,
  });
};

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for run host');
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dbInsertExecute.mockResolvedValue({ changes: 1 });
  mocks.insertPartialAssistantRow.mockResolvedValue(undefined);
  mocks.updateAssistantRow.mockResolvedValue(undefined);
  mocks.flushRunEvents.mockResolvedValue(undefined);
});

afterEach(() => {
  setEventPersister(null);
  for (const run of createdRuns.splice(0)) evictByChatId(run.chatId);
});

describe('runHost location approval boundary', () => {
  it('clears exact location tokens when a paused run is cancelled or interrupted', async () => {
    for (const closeRun of [
      markOpenApprovalsCancelled,
      markOpenApprovalsInterrupted,
    ]) {
      const run = makeRun();
      const session = mintLocationToken({
        coordinate: { lat: 40.1234, lon: -75.5678 },
        binding: {
          approvalId: `approval-${run.messageId}`,
          runId: run.threadId,
          chatId: run.chatId,
          messageId: run.messageId,
          aiMessageId: run.aiMessageId,
          clientSessionId: 'page-1',
        },
        authorizedPurposes: ['nearby', 'routing'],
        authorizedHosts: hosts,
        configHash: mappingConfigurationFingerprint(mappingConfig),
        retention: 'once',
      });

      expect(locationTokenStore.has(session.token)).toBe(true);
      await closeRun(run.messageId);
      expect(locationTokenStore.has(session.token)).toBe(false);
    }
  });

  it('redacts a transient route again at the host before content and metadata persistence', async () => {
    const run = makeRun();
    const session = mintLocationToken({
      coordinate: { lat: 40.1234, lon: -75.5678 },
      binding: {
        approvalId: 'approval-route',
        runId: run.threadId,
        chatId: run.chatId,
        messageId: run.messageId,
        aiMessageId: run.aiMessageId,
        clientSessionId: 'page-1',
      },
      authorizedPurposes: ['routing'],
      authorizedHosts: hosts,
      configHash: mappingConfigurationFingerprint(mappingConfig),
      retention: 'once',
    });
    run.locationToken = session.token;
    run.locationRetention = 'once';

    const exactRoute = {
      mode: 'driving' as const,
      origin: { lat: 40.1234, lon: -75.5678 },
      destination: { lat: 40.2, lon: -75.2 },
      distanceMeters: 10_000,
      durationSeconds: 900,
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [-75.5678, 40.1234],
          [-75.2, 40.2],
        ] as [number, number][],
      },
      sourceUrl:
        'https://router.example/route?from=40.1234,-75.5678&to=40.2,-75.2',
      navigationUrl:
        'https://maps.example/nav?origin=40.1234,-75.5678&destination=40.2,-75.2',
      provider: 'test',
      attribution: 'Test routing provider',
    };
    const exactSpec = {
      places: [],
      route: exactRoute,
      attribution: 'Test routing provider',
      retrievedAt: '2026-08-27T12:00:00.000Z',
      title: 'Current route',
    };
    const registration = run.mapRegistry.register(exactSpec);
    const placement = run.mapRegistry.place(registration.handle);

    await attachRunHost({
      run,
      startTime: run.startedAt,
      userMessageId: run.messageId,
      usedLocation: false,
      usedPersonalization: false,
      memoriesUsed: [],
    });
    emitStreamEvent(run.emitter, {
      type: 'map_spec',
      data: {
        mapId: registration.mapId,
        handle: registration.handle,
        spec: exactSpec,
      },
    });
    emitStreamEvent(run.emitter, {
      type: 'map_placement',
      data: {
        placementId: placement.placementId,
        mapId: placement.mapId,
        handle: placement.handle,
        placementNumber: placement.placementNumber,
      },
    });
    emitStreamEvent(run.emitter, {
      type: 'map_session_overlay',
      data: {
        mapId: registration.mapId,
        route: exactRoute,
        clientSessionId: 'page-1',
      },
    });
    emitStreamEvent(run.emitter, { type: 'agent_end' });

    await waitFor(() => run.status === 'completed');

    const finalUpdate = mocks.updateAssistantRow.mock.calls.at(-1);
    const serialized = JSON.stringify({
      content: run.recievedMessage,
      metadata: finalUpdate?.[1],
      events: run.eventLog,
    });
    expect(serialized).not.toContain('40.1234');
    expect(serialized).not.toContain('-75.5678');
    expect(serialized).not.toContain('router.example/route?from=');
    expect(serialized).toContain('routeNotRetained');
    expect(serialized).toContain('Route not retained');
    expect(run.eventLog.map(({ ev }) => ev.type)).not.toContain(
      'map_session_overlay',
    );
  });

  it('persists a location approval with no snapshot or precise response data', async () => {
    const run = makeRun();
    await attachRunHost({
      run,
      startTime: run.startedAt,
      userMessageId: run.messageId,
      usedLocation: false,
      usedPersonalization: false,
      memoriesUsed: [],
    });

    emitStreamEvent(run.emitter, {
      type: 'interrupt',
      interrupts: [
        {
          id: 'approval-1',
          value: {
            kind: 'location',
            toolCallId: 'request-location-1',
            payload: payloadFor(run),
            snapshot: {
              coordinates: { lat: 40.1234, lon: -75.5678 },
            },
          },
        },
      ],
    });
    await waitFor(() => run.status === 'awaiting_user');

    const approval = mocks.dbInsertValues.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(approval).toMatchObject({
      id: 'approval-1',
      toolKind: 'location',
      snapshot: null,
      payload: { clientSessionId: 'page-1', aiMessageId: run.aiMessageId },
    });
    expect(approval).not.toHaveProperty('response');
    expect(JSON.stringify(approval)).not.toContain('40.1234');
    expect(run.eventLog.map(({ ev }) => ev.type)).toContain('location_pending');
    expect(JSON.stringify(run.eventLog)).not.toContain('40.1234');
    expect(mocks.flushRunEvents).toHaveBeenCalledWith(run.messageId);
  });
});
