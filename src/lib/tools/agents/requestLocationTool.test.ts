import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mappingLocationHosts,
  resolveMappingConfiguration,
} from '@/lib/maps/config';
import { mappingConfigurationFingerprint } from '@/lib/maps/runtime';
import {
  locationTokenStore,
  type LocationSessionBinding,
} from '@/lib/maps/locationSessions';
import { TurnMapRegistry } from '@/lib/maps/turnMapRegistry';

const mocks = vi.hoisted(() => ({
  interrupt: vi.fn(),
}));

vi.mock('@langchain/langgraph', async () => {
  const actual = await vi.importActual<typeof import('@langchain/langgraph')>(
    '@langchain/langgraph',
  );
  return { ...actual, interrupt: mocks.interrupt };
});

import { requestLocationTool } from './requestLocationTool';

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

const config = resolveMappingConfiguration(
  {
    mappingEnabled: 'true',
    mappingPublicServicesAcknowledged: 'true',
  },
  { testProviderEnabled: true },
);
const hosts = mappingLocationHosts(config);

function makeRuntime(overrides: Record<string, unknown> = {}): Runtime {
  return {
    context: {
      emitter: new EventEmitter(),
      mapRegistry: new TurnMapRegistry(),
      mappingConfig: config,
      mappingService: {},
      interactiveSession: true,
      clientSessionId: 'page-1',
      assistantMessageId: 'assistant-1',
      threadId: 'thread-1',
      chatId: 'chat-1',
      messageId: 'message-1',
      isPrivate: false,
      ...overrides,
    },
    toolCallId: 'request-location-1',
    state: {},
    config: {},
    store: null,
    writer: null,
  };
}

async function invoke(args: unknown, runtime: Runtime): Promise<unknown> {
  return (requestLocationTool as unknown as InvokableTool).invoke(
    {
      type: 'tool_call',
      name: 'request_location',
      id: runtime.toolCallId,
      args,
    },
    runtime,
  );
}

function textResult(result: unknown): string {
  const update = (
    result as { update?: { messages?: Array<{ content?: unknown }> } }
  ).update;
  const content = update?.messages?.[0]?.content;
  if (typeof content !== 'string') throw new Error('expected textual result');
  return content;
}

afterEach(() => {
  mocks.interrupt.mockReset();
  locationTokenStore.clear();
});

describe('request_location', () => {
  it('interrupts only with disclosure metadata and lists every provider/tile host', async () => {
    mocks.interrupt.mockReturnValue({
      approved: false,
      retention: 'once',
      reason: 'cancelled',
      clientSessionId: 'page-1',
    });

    const result = await invoke(
      { reason: 'Find places near me' },
      makeRuntime(),
    );
    const interruptValue = mocks.interrupt.mock.calls[0]?.[0] as {
      kind: string;
      payload: Record<string, unknown>;
      snapshot: unknown;
    };

    expect(interruptValue.kind).toBe('location');
    expect(interruptValue.snapshot).toBeNull();
    expect(interruptValue.payload).toMatchObject({
      reason: 'Find places near me',
      authorizedPurposes: ['nearby', 'routing', 'tiles'],
      providerHosts: [
        'nominatim.openstreetmap.org',
        'overpass-api.de',
        'router.project-osrm.org',
      ],
      tileHosts: ['tile.openstreetmap.org'],
      clientSessionId: 'page-1',
      aiMessageId: 'assistant-1',
      allowSave: true,
    });
    expect(interruptValue.payload.authorizedHosts).toEqual(hosts);
    expect(JSON.stringify(interruptValue)).not.toContain('coordinates');
    expect(JSON.stringify(interruptValue)).not.toContain('locationToken');
    expect(textResult(result)).toContain('user did not approve');
  });

  it('does not offer saving in a private chat', async () => {
    mocks.interrupt.mockReturnValue({
      approved: false,
      retention: 'once',
      reason: 'cancelled',
      clientSessionId: 'page-1',
    });

    await invoke({ reason: 'Build a route' }, makeRuntime({ isPrivate: true }));

    expect(
      (
        mocks.interrupt.mock.calls[0]?.[0] as {
          payload: Record<string, unknown>;
        }
      ).payload.allowSave,
    ).toBe(false);
  });

  it('passes only an opaque token into an approved resume and keeps it out of the tool message', async () => {
    const binding: LocationSessionBinding = {
      approvalId: 'approval-1',
      runId: 'thread-1',
      chatId: 'chat-1',
      messageId: 'message-1',
      aiMessageId: 'assistant-1',
      clientSessionId: 'page-1',
    };
    const session = locationTokenStore.mint({
      coordinate: { lat: 40.1234, lon: -75.5678 },
      binding,
      authorizedPurposes: ['nearby', 'routing'],
      authorizedHosts: hosts,
      configHash: mappingConfigurationFingerprint(config),
      retention: 'once',
    });
    mocks.interrupt.mockReturnValue({
      locationToken: session.token,
      retention: 'once',
      clientSessionId: 'page-1',
    });

    const result = await invoke({ reason: 'Find a route' }, makeRuntime());

    expect(textResult(result)).toContain('approved for this turn');
    expect(textResult(result)).not.toContain(session.token);
    expect(textResult(result)).not.toContain('40.1234');
    expect(textResult(result)).not.toContain('-75.5678');
  });

  it('falls back without interrupting when the turn is not an eligible interactive session', async () => {
    const result = await invoke(
      { reason: 'Find nearby places' },
      makeRuntime({ interactiveSession: false }),
    );

    expect(mocks.interrupt).not.toHaveBeenCalled();
    expect(textResult(result)).toContain('top-level interactive session');
  });
});
