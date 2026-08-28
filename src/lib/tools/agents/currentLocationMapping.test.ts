import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import {
  mappingLocationHosts,
  resolveMappingConfiguration,
} from '@/lib/maps/config';
import { mappingConfigurationFingerprint } from '@/lib/maps/runtime';
import {
  locationTokenStore,
  mintLocationToken,
} from '@/lib/maps/locationSessions';
import { createMappingService } from '@/lib/maps/service';
import { createTestMappingProvider } from '@/lib/maps/providers/test';
import { TurnMapRegistry } from '@/lib/maps/turnMapRegistry';
import {
  STREAM_EVENT_CHANNEL,
  type AgentEmitEvent,
} from '@/lib/streaming/events';
import { getRouteTool } from './getRouteTool';
import { searchPlacesTool } from './searchPlacesTool';

type InvokableTool = {
  invoke(input: unknown, config: unknown): Promise<unknown>;
};

type Runtime = {
  context: Record<string, unknown>;
  toolCallId: string;
  state: Record<string, unknown>;
  config: Record<string, unknown>;
  store: null;
  writer: null;
};

const mappingConfig = resolveMappingConfiguration(
  { mappingEnabled: 'true', mappingProvider: 'test' },
  { testProviderEnabled: true },
);
const provider = createTestMappingProvider({ enabled: true });
if (!provider) throw new Error('deterministic mapping provider is required');
const mappingService = createMappingService(provider, { useCache: false });

function makeRuntime(
  retention: 'once' | 'save',
  options: {
    purpose?: 'nearby' | 'routing';
    coordinate?: { lat: number; lon: number };
  } = {},
): {
  runtime: Runtime;
  token: string;
  events: AgentEmitEvent[];
} {
  const emitter = new EventEmitter();
  const events: AgentEmitEvent[] = [];
  emitter.on(STREAM_EVENT_CHANNEL, (event: AgentEmitEvent) =>
    events.push(event),
  );
  const mapRegistry = new TurnMapRegistry({
    idFactory: (() => {
      let value = 0;
      return () => `private-map-${++value}`;
    })(),
  });
  const purpose = options.purpose ?? 'routing';
  const coordinate = options.coordinate ?? { lat: 40.1234, lon: -75.5678 };
  const tokenSession = mintLocationToken({
    coordinate,
    binding: {
      approvalId: 'approval-1',
      runId: 'thread-1',
      chatId: 'chat-1',
      messageId: 'message-1',
      aiMessageId: 'assistant-1',
      clientSessionId: 'page-1',
    },
    authorizedPurposes: [purpose],
    authorizedHosts: mappingLocationHosts(mappingConfig),
    configHash: mappingConfigurationFingerprint(mappingConfig),
    retention,
  });
  return {
    token: tokenSession.token,
    events,
    runtime: {
      context: {
        emitter,
        mapRegistry,
        mappingConfig,
        mappingService,
        locationToken: tokenSession.token,
        clientSessionId: 'page-1',
        assistantMessageId: 'assistant-1',
        threadId: 'thread-1',
        chatId: 'chat-1',
        messageId: 'message-1',
      },
      toolCallId: `route-${retention}`,
      state: {},
      config: {},
      store: null,
      writer: null,
    },
  };
}

async function invoke(runtime: Runtime): Promise<unknown> {
  return (getRouteTool as unknown as InvokableTool).invoke(
    {
      type: 'tool_call',
      name: 'get_route',
      id: runtime.toolCallId,
      args: {
        origin: 'current location',
        destination: 'north',
        mode: 'driving',
      },
    },
    runtime,
  );
}

async function invokeNearby(runtime: Runtime): Promise<unknown> {
  return (searchPlacesTool as unknown as InvokableTool).invoke(
    {
      type: 'tool_call',
      name: 'search_places',
      id: runtime.toolCallId,
      args: {
        near: 'current location',
        category: 'cafe',
        radiusMeters: 500,
        limit: 12,
      },
    },
    runtime,
  );
}

function resultText(result: unknown): string {
  const update = (
    result as { update?: { messages?: Array<{ content?: unknown }> } }
  ).update;
  const content = update?.messages?.[0]?.content;
  if (typeof content !== 'string') throw new Error('expected textual result');
  return content;
}

afterEach(() => locationTokenStore.clear());

describe('current-location route privacy', () => {
  it('redacts a transient route from the map snapshot and model-visible result while emitting one exact live overlay', async () => {
    const { runtime, token, events } = makeRuntime('once');
    const result = await invoke(runtime);
    const text = resultText(result);
    const mapRegistry = runtime.context.mapRegistry as TurnMapRegistry;
    const registration = mapRegistry.resolve('map_1');

    expect(text).toContain('Current location');
    expect(text).toContain('navigationLink');
    expect(text).not.toContain(token);
    expect(text).not.toContain('40.1234');
    expect(text).not.toContain('-75.5678');
    expect(mapRegistry.resolveRoute('route_1')).toBeUndefined();
    expect(registration?.spec.route).toMatchObject({
      destination: { lat: 40.004, lon: -75.002 },
      routeNotRetained: true,
    });
    expect(JSON.stringify(registration?.spec)).not.toContain('40.1234');
    expect(JSON.stringify(registration?.spec)).not.toContain(
      'deterministic-route',
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: 'map_spec',
      data: { mapId: 'private-map-1', spec: { routeNotRetained: true } },
    });
    expect(events[1]).toMatchObject({
      type: 'map_session_overlay',
      data: {
        mapId: 'private-map-1',
        clientSessionId: 'page-1',
        origin: { lat: 40.1234, lon: -75.5678 },
        route: {
          origin: { lat: 40.1234, lon: -75.5678 },
        },
      },
    });
  });

  it('retains the exact route only for an explicit save choice and never emits a transient overlay', async () => {
    const { runtime, events } = makeRuntime('save');
    const result = await invoke(runtime);
    const text = resultText(result);
    const mapRegistry = runtime.context.mapRegistry as TurnMapRegistry;
    const registration = mapRegistry.resolve('map_1');

    expect(text).toContain('navigationLink');
    expect(text).not.toContain('40.1234');
    expect(text).not.toContain('Route not retained');
    expect(registration?.spec.route).toMatchObject({
      origin: { lat: 40.1234, lon: -75.5678 },
      navigationUrl: expect.stringContaining('directions'),
    });
    expect(mapRegistry.resolveRoute('route_1')).toBeDefined();
    expect(events.map((event) => event.type)).toEqual(['map_spec']);
  });

  it('retains the approved origin in a saved current-location nearby map', async () => {
    const { runtime, events } = makeRuntime('save', {
      purpose: 'nearby',
      coordinate: { lat: 40, lon: -75 },
    });
    const result = await invokeNearby(runtime);
    const text = resultText(result);
    const mapRegistry = runtime.context.mapRegistry as TurnMapRegistry;
    const registration = mapRegistry.resolve('map_1');

    expect(text).toContain('Deterministic Central Cafe');
    expect(text).not.toContain('40.000');
    expect(text).not.toContain('-75.000');
    expect(registration?.spec).toMatchObject({
      origin: { lat: 40, lon: -75 },
      places: [expect.objectContaining({ name: 'Deterministic Central Cafe' })],
    });
    expect(events.map((event) => event.type)).toEqual(['map_spec']);
    expect(events[0]).toMatchObject({
      type: 'map_spec',
      data: { spec: { origin: { lat: 40, lon: -75 } } },
    });
  });

  it('refuses a current-location route when the token lacks routing authorization', async () => {
    const { runtime } = makeRuntime('once');
    const replacement = mintLocationToken({
      coordinate: { lat: 40.1234, lon: -75.5678 },
      binding: {
        approvalId: 'approval-2',
        runId: 'thread-1',
        chatId: 'chat-1',
        messageId: 'message-1',
        aiMessageId: 'assistant-1',
        clientSessionId: 'page-1',
      },
      authorizedPurposes: ['nearby'],
      authorizedHosts: mappingLocationHosts(mappingConfig),
      configHash: mappingConfigurationFingerprint(mappingConfig),
      retention: 'once',
    });
    runtime.context.locationToken = replacement.token;

    const result = await invoke(runtime);

    expect(resultText(result)).toContain('No approved current location');
    expect(
      (runtime.context.mapRegistry as TurnMapRegistry).registrationCount,
    ).toBe(0);
  });
});
