import { describe, expect, it } from 'vitest';
import {
  BrowserLocationRequestSchema,
  LocationApprovalPayloadSchema,
  LocationApprovalResponseSchema,
  LOCATION_TOKEN_TTL_MS,
  safeLocationApprovalResponse,
  LocationTokenStore,
  type LocationSessionBinding,
} from './locationSessions';

const binding: LocationSessionBinding = {
  approvalId: 'approval-1',
  runId: 'thread-1',
  chatId: 'chat-1',
  messageId: 'message-1',
  aiMessageId: 'assistant-1',
  clientSessionId: 'page-1',
};

const inputFor = (overrides: Record<string, unknown> = {}) => ({
  coordinate: { lat: 40.1234, lon: -75.5678 },
  binding,
  authorizedPurposes: ['nearby', 'routing'] as const,
  authorizedHosts: ['maps.example.test', 'tiles.example.test'],
  configHash: 'config-hash',
  retention: 'once' as const,
  now: 1_000,
  ...overrides,
});

describe('location approval schemas', () => {
  const payload = {
    authorizedPurposes: ['nearby', 'routing', 'tiles'],
    authorizedHosts: ['maps.example.test', 'tiles.example.test'],
    providerHosts: ['maps.example.test'],
    tileHosts: ['tiles.example.test'],
    configHash: 'config-hash',
    clientSessionId: 'page-1',
    aiMessageId: 'assistant-1',
    allowSave: true,
    createdAt: 1_000,
    expiresAt: 1_000 + LOCATION_TOKEN_TTL_MS,
  };

  it('requires disclosed hosts to exactly match the provider and tile hosts', () => {
    expect(LocationApprovalPayloadSchema.safeParse(payload).success).toBe(true);
    expect(
      LocationApprovalPayloadSchema.safeParse({
        ...payload,
        authorizedHosts: ['maps.example.test'],
      }).success,
    ).toBe(false);
  });

  it('rejects approvals that exceed the ten-minute lifetime or contain invalid hosts', () => {
    expect(
      LocationApprovalPayloadSchema.safeParse({
        ...payload,
        expiresAt: payload.expiresAt + 1,
      }).success,
    ).toBe(false);
    expect(
      LocationApprovalPayloadSchema.safeParse({
        ...payload,
        tileHosts: ['https://tiles.example.test'],
        authorizedHosts: ['maps.example.test', 'https://tiles.example.test'],
      }).success,
    ).toBe(false);
  });

  it('accepts only opaque approval responses and browser coordinates at the dedicated shape', () => {
    expect(
      LocationApprovalResponseSchema.safeParse({
        approved: true,
        retention: 'once',
      }).success,
    ).toBe(true);
    expect(
      LocationApprovalResponseSchema.safeParse({
        approved: true,
        retention: 'once',
        coordinates: { lat: 40, lon: -75 },
      }).success,
    ).toBe(false);
    expect(
      LocationApprovalResponseSchema.safeParse({
        approved: false,
        retention: 'once',
        locationToken: 'a'.repeat(64),
      }).success,
    ).toBe(false);
    expect(
      BrowserLocationRequestSchema.safeParse({
        approvalId: 'approval-1',
        clientSessionId: 'page-1',
        coordinates: { lat: 40, lon: -75 },
        retention: 'once',
      }).success,
    ).toBe(true);
    expect(
      BrowserLocationRequestSchema.safeParse({
        approvalId: 'approval-1',
        clientSessionId: 'page-1',
        coordinates: { lat: 91, lon: -75 },
        retention: 'once',
      }).success,
    ).toBe(false);
    expect(
      safeLocationApprovalResponse({
        approved: true,
        retention: 'save',
      }),
    ).toEqual({ approved: true, retention: 'save' });
  });
});

describe('LocationTokenStore', () => {
  it('mints an opaque, normalized session and enforces binding, purpose, host, and config isolation', () => {
    const now = 1_000;
    const store = new LocationTokenStore({
      clock: () => now,
      tokenFactory: () => 'a'.repeat(64),
    });

    const session = store.mint(
      inputFor({
        binding: { ...binding, clientSessionId: ' page-1 ' },
        authorizedHosts: ['Tiles.Example.Test', 'maps.example.test'],
      }),
    );

    expect(session.token).toMatch(/^[A-Za-z0-9_-]{32,200}$/);
    expect(session.binding.clientSessionId).toBe('page-1');
    expect(session.authorizedHosts).toEqual([
      'maps.example.test',
      'tiles.example.test',
    ]);
    expect(session.coordinate).toEqual({ lat: 40.1234, lon: -75.5678 });
    expect(store.get(session.token, { binding })).toMatchObject({
      token: session.token,
      coordinate: { lat: 40.1234, lon: -75.5678 },
    });
    expect(
      store.get(session.token, {
        binding: { ...binding, clientSessionId: 'other-page' },
      }),
    ).toBeNull();
    expect(
      store.get(session.token, { binding: { approvalId: 'other-approval' } }),
    ).toBeNull();
    expect(
      store.get(session.token, { binding: { runId: 'other-run' } }),
    ).toBeNull();
    expect(
      store.get(session.token, { binding: { chatId: 'other-chat' } }),
    ).toBeNull();
    expect(
      store.get(session.token, { binding: { messageId: 'other-message' } }),
    ).toBeNull();
    expect(
      store.get(session.token, { binding: { aiMessageId: 'other-assistant' } }),
    ).toBeNull();
    expect(store.getForPurpose(session.token, { purpose: 'tiles' })).toBeNull();
    expect(
      store.get(session.token, { authorizedHosts: ['maps.example.test'] }),
    ).toBeNull();
    expect(
      store.get(session.token, { configHash: 'different-config' }),
    ).toBeNull();

    const returned = store.get(session.token);
    if (!returned) throw new Error('expected token session');
    returned.coordinate.lat = 0;
    (returned.authorizedHosts as string[]).push('mutated.example.test');
    expect(store.get(session.token)?.coordinate.lat).toBe(40.1234);
    expect(store.get(session.token)?.authorizedHosts).not.toContain(
      'mutated.example.test',
    );

    const restartedStore = new LocationTokenStore({ clock: () => now });
    expect(restartedStore.get(session.token)).toBeNull();
    restartedStore.clear();
    store.clear();
  });

  it('caps the token lifetime at ten minutes and expires by the injected clock', () => {
    let now = 1_000;
    const store = new LocationTokenStore({
      clock: () => now,
      tokenFactory: () => 'b'.repeat(64),
    });
    const session = store.mint(inputFor({ ttlMs: LOCATION_TOKEN_TTL_MS * 2 }));

    expect(session.expiresAt).toBe(1_000 + LOCATION_TOKEN_TTL_MS);
    expect(store.size).toBe(1);
    now += LOCATION_TOKEN_TTL_MS;
    expect(store.get(session.token)).toBeNull();
    expect(store.size).toBe(0);
  });

  it('clears all exact coordinates for a run or message', () => {
    let nextToken = 0;
    const store = new LocationTokenStore({
      tokenFactory: () =>
        `${String(++nextToken).padStart(2, '0')}${'c'.repeat(62)}`,
    });
    const first = store.mint(inputFor());
    const second = store.mint(
      inputFor({
        binding: { ...binding, messageId: 'message-2' },
      }),
    );

    store.clearForRun('thread-1');
    expect(store.has(first.token)).toBe(false);
    expect(store.has(second.token)).toBe(false);

    const third = store.mint(inputFor());
    store.clearForMessage('message-1');
    expect(store.has(third.token)).toBe(false);
    expect(store.size).toBe(0);
    store.clear();
  });
});
