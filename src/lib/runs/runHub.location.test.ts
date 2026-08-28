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
import {
  getLocationSession,
  locationTokenStore,
  mintLocationToken,
} from '@/lib/maps/locationSessions';
import { TurnMapRegistry } from '@/lib/maps/turnMapRegistry';

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

let nextRun = 0;
const activeChatIds: string[] = [];

function makeRun() {
  const chatId = `location-hub-chat-${++nextRun}`;
  activeChatIds.push(chatId);
  const mapRegistry = new TurnMapRegistry();
  const run = startRun({
    chatId,
    messageId: `${chatId}-user`,
    aiMessageId: `${chatId}-assistant`,
    threadId: `${chatId}:thread`,
    emitter: new EventEmitter(),
    abortController: new AbortController(),
    retrievalController: new AbortController(),
    mapRegistry,
    clientSessionId: 'page-1',
  }).run;
  const registration = mapRegistry.register(mapSpec);
  return { run, mapId: registration.mapId };
}

async function nextEvent(
  reader: ReadableStreamDefaultReader<string>,
): Promise<Record<string, unknown>> {
  const result = await reader.read();
  expect(result.done).toBe(false);
  return JSON.parse(result.value ?? '') as Record<string, unknown>;
}

afterEach(() => {
  setEventPersister(null);
  locationTokenStore.clear();
  for (const chatId of activeChatIds.splice(0)) evictByChatId(chatId);
});

describe('runHub precise-location delivery', () => {
  it('delivers an exact overlay only to the approving page session and never persists it', async () => {
    const { run, mapId } = makeRun();
    const persister = vi.fn();
    setEventPersister(persister);

    const firstAbort = new AbortController();
    const firstReader = subscribe(
      run,
      0,
      firstAbort.signal,
      'page-1',
    ).getReader();
    await expect(nextEvent(firstReader)).resolves.toEqual({
      type: 'replay_complete',
      content: '',
    });

    const overlay = {
      type: 'map_session_overlay' as const,
      messageId: run.aiMessageId,
      data: {
        mapId,
        origin: { lat: 40.1234, lon: -75.5678 },
        clientSessionId: 'page-1',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    };
    pushEvent(run, overlay);

    await expect(nextEvent(firstReader)).resolves.toMatchObject({
      type: 'map_session_overlay',
      data: {
        mapId,
        origin: { lat: 40.1234, lon: -75.5678 },
        clientSessionId: 'page-1',
      },
    });
    expect(run.eventLog).toHaveLength(0);
    expect(persister).not.toHaveBeenCalled();

    const otherAbort = new AbortController();
    const otherReader = subscribe(
      run,
      0,
      otherAbort.signal,
      'page-2',
    ).getReader();
    await expect(nextEvent(otherReader)).resolves.toEqual({
      type: 'replay_complete',
      content: '',
    });

    const samePageAbort = new AbortController();
    const samePageReader = subscribe(
      run,
      0,
      samePageAbort.signal,
      'page-1',
    ).getReader();
    await expect(nextEvent(samePageReader)).resolves.toEqual({
      type: 'replay_complete',
      content: '',
    });
    await expect(nextEvent(samePageReader)).resolves.toMatchObject({
      type: 'map_session_overlay',
      data: { origin: { lat: 40.1234, lon: -75.5678 } },
    });

    otherAbort.abort();
    samePageAbort.abort();
    firstAbort.abort();
  });

  it('does not deliver an exact overlay to another active page session', async () => {
    const { run, mapId } = makeRun();
    const firstAbort = new AbortController();
    const otherAbort = new AbortController();
    const firstReader = subscribe(
      run,
      0,
      firstAbort.signal,
      'page-1',
    ).getReader();
    const otherReader = subscribe(
      run,
      0,
      otherAbort.signal,
      'page-2',
    ).getReader();
    await nextEvent(firstReader);
    await nextEvent(otherReader);

    pushEvent(run, {
      type: 'map_session_overlay',
      messageId: run.aiMessageId,
      data: {
        mapId,
        origin: { lat: 40.1234, lon: -75.5678 },
        clientSessionId: 'page-1',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });

    await expect(nextEvent(firstReader)).resolves.toMatchObject({
      type: 'map_session_overlay',
      data: { origin: { lat: 40.1234, lon: -75.5678 } },
    });
    const otherRead = otherReader.read().then(() => 'event' as const);
    const outcome = await Promise.race([
      otherRead,
      new Promise<'timeout'>((resolve) => setTimeout(resolve, 25, 'timeout')),
    ]);
    expect(outcome).toBe('timeout');
    expect(run.eventLog).toHaveLength(0);

    firstAbort.abort();
    otherAbort.abort();
  });

  it('rejects overlays for another page session or an unregistered map', async () => {
    const { run, mapId } = makeRun();
    const abort = new AbortController();
    const reader = subscribe(run, 0, abort.signal, 'page-1').getReader();
    await nextEvent(reader);

    pushEvent(run, {
      type: 'map_session_overlay',
      messageId: run.aiMessageId,
      data: {
        mapId,
        origin: { lat: 40, lon: -75 },
        clientSessionId: 'page-2',
      },
    });
    pushEvent(run, {
      type: 'map_session_overlay',
      messageId: run.aiMessageId,
      data: {
        mapId: 'private-map-not-registered',
        origin: { lat: 41, lon: -76 },
        clientSessionId: 'page-1',
      },
    });

    expect(run.eventLog).toHaveLength(0);
    abort.abort();
  });

  it('revokes the opaque location token when a run becomes terminal', () => {
    const { run } = makeRun();
    const session = mintLocationToken({
      coordinate: { lat: 40.1234, lon: -75.5678 },
      binding: {
        approvalId: 'approval-1',
        runId: run.threadId,
        chatId: run.chatId,
        messageId: run.messageId,
        aiMessageId: run.aiMessageId,
        clientSessionId: 'page-1',
      },
      authorizedPurposes: ['routing'],
      authorizedHosts: ['tiles.example.test'],
      configHash: 'config-hash',
      retention: 'once',
    });

    expect(getLocationSession(session.token)).not.toBeNull();
    terminateRun(run, 'cancelled');
    expect(getLocationSession(session.token)).toBeNull();
  });
});
