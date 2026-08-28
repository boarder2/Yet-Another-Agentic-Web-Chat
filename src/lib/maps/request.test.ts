import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAP_REQUEST_MIN_INTERVAL_MS,
  MapError,
  MapRequestClient,
  sanitizeMapError,
  resetMapRequestThrottle,
} from './request';

const jsonResponse = (value: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
    ...init,
  });

beforeEach(() => resetMapRequestThrottle());
afterEach(() => {
  resetMapRequestThrottle();
  vi.useRealTimers();
});

describe('bounded mapping request client', () => {
  it('parses successful JSON without passing the caller signal through', async () => {
    const caller = new AbortController();
    let providerSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        providerSignal = init?.signal ?? undefined;
        return jsonResponse({ ok: true });
      },
    );
    const client = new MapRequestClient({ fetchImpl, minIntervalMs: 0 });

    await expect(
      client.json<{ ok: boolean }>('https://maps.example/data', {
        signal: caller.signal,
      }),
    ).resolves.toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(providerSignal).toBeDefined();
    expect(providerSignal).not.toBe(caller.signal);
  });

  it('rejects malformed and oversized responses with sanitized error codes', async () => {
    const malformed = new MapRequestClient({
      fetchImpl: async () => new Response('{not json'),
      minIntervalMs: 0,
    });
    await expect(
      malformed.json('https://maps.example/malformed'),
    ).rejects.toMatchObject({ mapErrorCode: 'malformed_response' });

    const declaredTooLarge = new MapRequestClient({
      fetchImpl: async () =>
        new Response('{"ok":true}', {
          headers: { 'content-length': '100' },
        }),
      minIntervalMs: 0,
    });
    await expect(
      declaredTooLarge.json('https://maps.example/declared', { maxBytes: 10 }),
    ).rejects.toMatchObject({ mapErrorCode: 'response_too_large' });

    const streamedTooLarge = new MapRequestClient({
      fetchImpl: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('x'.repeat(11)));
              controller.close();
            },
          }),
        ),
      minIntervalMs: 0,
    });
    await expect(
      streamedTooLarge.json('https://maps.example/stream', { maxBytes: 10 }),
    ).rejects.toMatchObject({ mapErrorCode: 'response_too_large' });
  });

  it('maps provider HTTP failures to stable, non-sensitive errors', async () => {
    const client = new MapRequestClient({
      fetchImpl: async () => new Response('busy', { status: 429 }),
      minIntervalMs: 0,
    });

    await expect(
      client.json('https://maps.example/rate'),
    ).rejects.toMatchObject({
      code: 'rate_limited',
      mapErrorCode: 'rate_limited',
      retryable: true,
      status: 429,
    });

    const providerError = new MapError(
      'provider_http',
      'upstream https://secret.example/private?token=secret',
    );
    expect(providerError.message).not.toContain('secret.example');
    expect(
      sanitizeMapError(new Error('failed at https://secret.example/x')).message,
    ).toBe('Mapping provider request failed');
  });

  it('enforces a per-host minimum start interval', async () => {
    let now = 0;
    const sleeps: number[] = [];
    const client = new MapRequestClient({
      fetchImpl: async () => jsonResponse({ ok: true }),
      now: () => now,
      sleeper: async (milliseconds) => {
        sleeps.push(milliseconds);
        now += milliseconds;
      },
      minIntervalMs: 100,
    });

    await client.json('https://throttled.example/one');
    await client.json('https://throttled.example/two');

    expect(sleeps).toEqual([100]);
    expect(MAP_REQUEST_MIN_INTERVAL_MS).toBeGreaterThan(0);
  });

  it('aborts queued and in-flight requests without exposing raw provider failures', async () => {
    const queuedController = new AbortController();
    const queued = new MapRequestClient({
      fetchImpl: async () => jsonResponse({ ok: true }),
      minIntervalMs: 0,
    });
    queuedController.abort();
    await expect(
      queued.json('https://maps.example/queued', {
        signal: queuedController.signal,
      }),
    ).rejects.toMatchObject({
      code: 'aborted',
      mapErrorCode: 'aborted',
      retryable: true,
    });

    const caller = new AbortController();
    let callerProviderSignal: AbortSignal | undefined;
    const inFlight = new MapRequestClient({
      fetchImpl: async (_input, init) => {
        callerProviderSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => {});
      },
      minIntervalMs: 0,
    });
    const inFlightPending = inFlight.json('https://maps.example/in-flight', {
      signal: caller.signal,
    });
    await vi.waitFor(() => expect(callerProviderSignal).toBeDefined());
    caller.abort();
    await expect(inFlightPending).rejects.toMatchObject({
      code: 'aborted',
      mapErrorCode: 'aborted',
      retryable: true,
    });
    expect(callerProviderSignal?.aborted).toBe(true);

    vi.useFakeTimers();
    let providerSignal: AbortSignal | undefined;
    const timeoutClient = new MapRequestClient({
      fetchImpl: async (_input, init) => {
        providerSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => {});
      },
      minIntervalMs: 0,
    });
    const pending = timeoutClient.json('https://maps.example/slow', {
      timeoutMs: 25,
    });
    const timeoutAssertion = expect(pending).rejects.toMatchObject({
      code: 'timeout',
      mapErrorCode: 'timeout',
      retryable: true,
    });
    await vi.advanceTimersByTimeAsync(25);
    await timeoutAssertion;
    expect(providerSignal?.aborted).toBe(true);
  });
});
