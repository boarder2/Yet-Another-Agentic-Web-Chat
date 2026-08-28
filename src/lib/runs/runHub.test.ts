import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  evictByChatId,
  pushEvent,
  setEventPersister,
  startRun,
  subscribe,
  terminateRun,
} from './runHub';
import { TurnMapRegistry } from '@/lib/maps/turnMapRegistry';

let nextChat = 1;
const activeChats: string[] = [];

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

function testRun() {
  const chatId = `map-hub-chat-${nextChat++}`;
  activeChats.push(chatId);
  return startRun({
    chatId,
    messageId: `${chatId}-user`,
    aiMessageId: `${chatId}-assistant`,
    threadId: `${chatId}:thread`,
    emitter: new EventEmitter(),
    abortController: new AbortController(),
    retrievalController: new AbortController(),
  }).run;
}

async function readEvent(
  reader: ReadableStreamDefaultReader<string>,
): Promise<Record<string, unknown>> {
  const result = await reader.read();
  expect(result.done).toBe(false);
  return JSON.parse(result.value ?? '') as Record<string, unknown>;
}

afterEach(() => {
  for (const chatId of activeChats.splice(0)) evictByChatId(chatId);
  setEventPersister(null);
});

describe('runHub map event delivery', () => {
  it('rejects precise overlays from an unbound run instead of creating a legacy delivery path', async () => {
    const run = testRun();
    const persister = vi.fn();
    setEventPersister(persister);

    pushEvent(run, {
      type: 'map_session_overlay',
      messageId: run.aiMessageId,
      data: {
        mapId: 'private-map-1',
        origin: { lat: 40.1, lon: -75.1 },
        clientSessionId: 'page-1',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });

    expect(run.eventLog).toEqual([]);
    expect(persister).not.toHaveBeenCalled();
  });

  it('keeps multiple map events sequenced and forwards each to the persister', async () => {
    const run = testRun();
    const persister = vi.fn();
    setEventPersister(persister);
    const signal = new AbortController();
    const reader = subscribe(run, 0, signal.signal).getReader();

    await expect(readEvent(reader)).resolves.toEqual({
      type: 'replay_complete',
      content: '',
    });

    for (const [index, title] of ['First map', 'Second map']) {
      pushEvent(run, {
        type: 'map_spec',
        messageId: run.aiMessageId,
        data: {
          mapId: `private-map-${index + 1}`,
          spec: { ...mapSpec, title },
        },
      });
      await expect(readEvent(reader)).resolves.toMatchObject({
        type: 'map_spec',
        data: { mapId: `private-map-${index + 1}` },
      });
    }

    expect(run.eventLog.map(({ ev }) => ev.type)).toEqual([
      'map_spec',
      'map_spec',
    ]);
    expect(run.eventLog.map(({ seq }) => seq)).toEqual([1, 2]);
    expect(persister).toHaveBeenCalledTimes(2);
    expect(
      persister.mock.calls.map(([, seqEvent]) => seqEvent.ev.type),
    ).toEqual(['map_spec', 'map_spec']);

    signal.abort();
  });

  it('does not replay a session overlay to a later subscriber', async () => {
    const run = testRun();
    const overlay = {
      type: 'map_session_overlay' as const,
      messageId: run.aiMessageId,
      data: {
        mapId: 'private-map-1',
        route: {
          mode: 'driving' as const,
          origin: { lat: 40.1, lon: -75.1 },
          destination: { lat: 40.2, lon: -75.2 },
          distanceMeters: 1_000,
          durationSeconds: 120,
          geometry: {
            type: 'LineString' as const,
            coordinates: [
              [-75.1, 40.1],
              [-75.2, 40.2],
            ] as [number, number][],
          },
          sourceUrl: 'https://router.example/route',
          navigationUrl: 'https://maps.example/nav',
          provider: 'test',
          attribution: 'Test routing provider',
        },
      },
    };
    pushEvent(run, overlay);

    const signal = new AbortController();
    const reader = subscribe(run, 0, signal.signal).getReader();
    await expect(readEvent(reader)).resolves.toEqual({
      type: 'replay_complete',
      content: '',
    });

    signal.abort();
    expect(run.eventLog).toHaveLength(0);
  });

  it('creates a turn-local map registry when none is supplied', () => {
    const run = testRun();
    expect(run.mapRegistry).toBeDefined();
    expect(run.mapRegistry.registrationCount).toBe(0);
  });

  it('clears server-only mapping dependencies and all turn maps when a run becomes terminal', () => {
    const chatId = `map-hub-terminal-${nextChat++}`;
    activeChats.push(chatId);
    const mappingConfig = { enabled: true } as never;
    const mappingService = { provider: 'private-runtime-service' } as never;
    const mapRegistry = new TurnMapRegistry();
    const [place] = mapRegistry.registerPlaces([
      {
        id: 'node/terminal',
        name: 'Terminal place',
        coordinate: { lat: 40, lon: -75 },
        sourceUrl: 'https://www.openstreetmap.org/node/terminal',
        provider: 'test',
        attribution: 'Test provider',
      },
    ]);
    mapRegistry.composeMap({ placeHandles: [place.handle] });
    const run = startRun({
      chatId,
      messageId: `${chatId}-user`,
      aiMessageId: `${chatId}-assistant`,
      threadId: `${chatId}:thread`,
      emitter: new EventEmitter(),
      abortController: new AbortController(),
      retrievalController: new AbortController(),
      mappingConfig,
      mappingService,
      mapRegistry,
    }).run;

    expect(run.mappingConfig).toBe(mappingConfig);
    expect(run.mappingService).toBe(mappingService);
    expect(run.mapRegistry.registrationCount).toBe(1);
    expect(run.mapRegistry.placeCount).toBe(1);

    terminateRun(run, 'cancelled');

    expect(run.mappingConfig).toBeNull();
    expect(run.mappingService).toBeNull();
    expect(run.mapRegistry.registrationCount).toBe(0);
    expect(run.mapRegistry.placeCount).toBe(0);
    expect(run.mapRegistry.placementCount).toBe(0);
  });
});
