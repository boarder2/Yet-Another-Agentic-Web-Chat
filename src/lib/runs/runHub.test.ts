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
  it('broadcasts session overlays live without adding them to the event log or persister', async () => {
    const run = testRun();
    const persister = vi.fn();
    setEventPersister(persister);
    const signal = new AbortController();
    const reader = subscribe(run, 0, signal.signal).getReader();

    await expect(readEvent(reader)).resolves.toEqual({
      type: 'replay_complete',
      content: '',
    });

    pushEvent(run, {
      type: 'map_session_overlay',
      messageId: run.aiMessageId,
      data: {
        mapId: 'private-map-1',
        origin: { lat: 40.1, lon: -75.1 },
        clientSessionId: 'page-1',
        expiresAt: '2026-08-27T12:10:00.000Z',
      },
    });
    await expect(readEvent(reader)).resolves.toMatchObject({
      type: 'map_session_overlay',
      data: { origin: { lat: 40.1, lon: -75.1 } },
    });

    pushEvent(run, {
      type: 'map_spec',
      messageId: run.aiMessageId,
      data: {
        mapId: 'private-map-1',
        handle: 'map_1',
        spec: mapSpec,
      },
    });
    await expect(readEvent(reader)).resolves.toMatchObject({
      type: 'map_spec',
      data: { mapId: 'private-map-1' },
    });

    expect(run.eventLog.map(({ ev }) => ev.type)).toEqual(['map_spec']);
    expect(persister).toHaveBeenCalledTimes(1);
    expect(persister.mock.calls[0][1].ev.type).toBe('map_spec');
    expect(JSON.stringify(run.eventLog)).not.toContain('40.1');

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

  it('clears server-only mapping dependencies when a run becomes terminal', () => {
    const chatId = `map-hub-terminal-${nextChat++}`;
    activeChats.push(chatId);
    const mappingConfig = { enabled: true } as never;
    const mappingService = { provider: 'private-runtime-service' } as never;
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
    }).run;

    expect(run.mappingConfig).toBe(mappingConfig);
    expect(run.mappingService).toBe(mappingService);

    terminateRun(run, 'cancelled');

    expect(run.mappingConfig).toBeNull();
    expect(run.mappingService).toBeNull();
  });
});
