import { MAP_LIMITS } from './types';

export const MAP_REQUEST_TIMEOUT_MS = 10_000;
export const MAP_REQUEST_MIN_INTERVAL_MS = 1_000;
export const MAP_RESPONSE_MAX_BYTES = MAP_LIMITS.maxResponseBytes;

export type MapErrorCode =
  | 'aborted'
  | 'timeout'
  | 'rate_limited'
  | 'response_too_large'
  | 'malformed_response'
  | 'provider_http'
  | 'provider_unavailable'
  | 'invalid_configuration'
  | 'invalid_request'
  | 'not_found'
  | 'unsupported';

export class MapError extends Error {
  readonly retryable: boolean;
  readonly status?: number;
  readonly mapErrorCode: MapErrorCode;

  constructor(
    public readonly code: MapErrorCode,
    message: string,
    options?: { retryable?: boolean; status?: number },
  ) {
    super(safeErrorMessage(message));
    this.name = 'MapError';
    this.mapErrorCode = code;
    this.retryable = options?.retryable ?? false;
    this.status = options?.status;
  }
}

export class MapConfigurationError extends MapError {
  constructor(message: string) {
    super('invalid_configuration', message);
    this.name = 'MapConfigurationError';
  }
}

export class MapValidationError extends MapError {
  constructor(message: string) {
    super('invalid_request', message);
    this.name = 'MapValidationError';
  }
}

export type MapFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface MapRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
  minIntervalMs?: number;
  headers?: HeadersInit;
  method?: string;
  body?: BodyInit | null;
  fetchImpl?: MapFetch;
}

/** Structural seam used by provider adapters and deterministic tests. */
export interface MapRequestClientLike {
  json<T>(input: RequestInfo | URL, options?: MapRequestOptions): Promise<T>;
}

type Clock = () => number;
type Sleeper = (milliseconds: number) => Promise<void>;

interface HostThrottle {
  lastStartedAt?: number;
  queue: Promise<void>;
}

const hostThrottles = new Map<string, HostThrottle>();

function safeErrorMessage(message: string): string {
  return message
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[redacted URL]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function hostForUrl(input: RequestInfo | URL): string {
  const raw =
    typeof Request !== 'undefined' && input instanceof Request
      ? input.url
      : input.toString();
  try {
    return new URL(raw).host.toLowerCase();
  } catch {
    return '';
  }
}

function abortError(): MapError {
  return new MapError('aborted', 'Mapping request was cancelled', {
    retryable: true,
  });
}

function sleepWithAbort(
  milliseconds: number,
  signal: AbortSignal | undefined,
  sleeper: Sleeper,
): Promise<void> {
  if (milliseconds <= 0) {
    if (signal?.aborted) return Promise.reject(abortError());
    return Promise.resolve();
  }
  if (signal?.aborted) return Promise.reject(abortError());

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: MapError) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    function onAbort() {
      finish(abortError());
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    void Promise.resolve()
      .then(() => sleeper(milliseconds))
      .then(
        () => finish(),
        () =>
          finish(
            new MapError(
              'provider_unavailable',
              'Mapping request could not be scheduled',
              { retryable: true },
            ),
          ),
      );
  });
}

async function waitForQueue(
  queue: Promise<void>,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (!signal) {
    await queue;
    return;
  }
  if (signal.aborted) throw abortError();
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: MapError) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => finish(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    void queue.then(
      () => finish(),
      () =>
        finish(
          new MapError(
            'provider_unavailable',
            'Mapping request could not be scheduled',
            { retryable: true },
          ),
        ),
    );
  });
}

async function waitForHost(
  input: RequestInfo | URL,
  options: {
    minIntervalMs: number;
    signal?: AbortSignal;
    now: Clock;
    sleeper: Sleeper;
  },
): Promise<void> {
  const host = hostForUrl(input);
  if (!host || options.minIntervalMs <= 0) {
    if (options.signal?.aborted) throw abortError();
    return;
  }

  const previous = hostThrottles.get(host);
  const prior = previous?.queue ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  hostThrottles.set(host, {
    lastStartedAt: previous?.lastStartedAt,
    queue: prior.then(() => current),
  });

  try {
    await waitForQueue(prior, options.signal);
    const state = hostThrottles.get(host);
    const lastStartedAt = state?.lastStartedAt ?? previous?.lastStartedAt;
    const wait =
      lastStartedAt === undefined
        ? 0
        : Math.max(0, lastStartedAt + options.minIntervalMs - options.now());
    await sleepWithAbort(wait, options.signal, options.sleeper);
    if (options.signal?.aborted) throw abortError();
    const currentState = hostThrottles.get(host);
    if (currentState) currentState.lastStartedAt = options.now();
  } finally {
    release();
  }
}

function sanitizeHttpStatus(status: number): MapError {
  if (status === 429) {
    return new MapError('rate_limited', 'Mapping provider rate limit reached', {
      retryable: true,
      status,
    });
  }
  if (status === 404) {
    return new MapError(
      'not_found',
      'Mapping provider could not find that resource',
      {
        status,
      },
    );
  }
  if (status >= 500) {
    return new MapError(
      'provider_unavailable',
      'Mapping provider is unavailable',
      {
        retryable: true,
        status,
      },
    );
  }
  return new MapError(
    'provider_http',
    'Mapping provider rejected the request',
    {
      status,
    },
  );
}

async function readResponseText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new MapError(
        'response_too_large',
        'Mapping provider response exceeded the size limit',
      );
    }
  }

  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new MapError(
        'response_too_large',
        'Mapping provider response exceeded the size limit',
      );
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // Preserve the bounded-response error even if the provider stream
          // rejects cancellation after exceeding the cap.
        }
        throw new MapError(
          'response_too_large',
          'Mapping provider response exceeded the size limit',
        );
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export function sanitizeMapError(error: unknown): MapError {
  if (error instanceof MapError) return error;
  if (
    typeof DOMException !== 'undefined' &&
    error instanceof DOMException &&
    error.name === 'AbortError'
  ) {
    return abortError();
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return abortError();
  }
  if (
    error instanceof Error &&
    (error as { mapErrorCode?: unknown }).mapErrorCode === 'invalid_request'
  ) {
    return new MapError('invalid_request', error.message);
  }
  return new MapError(
    'provider_unavailable',
    'Mapping provider request failed',
    {
      retryable: true,
    },
  );
}

function boundedRequestNumber(
  value: number | undefined,
  fallback: number,
  maximum: number,
  minimum = 1,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)));
}

export class MapRequestClient {
  private readonly fetchImpl: MapFetch;
  private readonly now: Clock;
  private readonly sleeper: Sleeper;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly minIntervalMs: number;

  constructor(
    options: {
      fetchImpl?: MapFetch;
      now?: Clock;
      sleeper?: Sleeper;
      timeoutMs?: number;
      maxBytes?: number;
      minIntervalMs?: number;
    } = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.sleeper =
      options.sleeper ??
      (async (milliseconds) => {
        await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
      });
    this.timeoutMs = boundedRequestNumber(
      options.timeoutMs,
      MAP_REQUEST_TIMEOUT_MS,
      60_000,
    );
    this.maxBytes = boundedRequestNumber(
      options.maxBytes,
      MAP_RESPONSE_MAX_BYTES,
      MAP_RESPONSE_MAX_BYTES,
    );
    this.minIntervalMs = boundedRequestNumber(
      options.minIntervalMs,
      MAP_REQUEST_MIN_INTERVAL_MS,
      60_000,
      0,
    );
  }

  async json<T>(
    input: RequestInfo | URL,
    options: MapRequestOptions = {},
  ): Promise<T> {
    if (options.signal?.aborted) throw abortError();
    const timeoutMs = boundedRequestNumber(
      options.timeoutMs,
      this.timeoutMs,
      60_000,
    );
    const maxBytes = boundedRequestNumber(
      options.maxBytes,
      this.maxBytes,
      MAP_RESPONSE_MAX_BYTES,
    );
    const minIntervalMs = boundedRequestNumber(
      options.minIntervalMs,
      this.minIntervalMs,
      60_000,
      0,
    );

    try {
      await waitForHost(input, {
        minIntervalMs,
        signal: options.signal,
        now: this.now,
        sleeper: this.sleeper,
      });
    } catch (error) {
      throw sanitizeMapError(error);
    }
    if (options.signal?.aborted) throw abortError();

    const controller = new AbortController();
    let timedOut = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;

    const requestPromise = (async () => {
      const response = await (options.fetchImpl ?? this.fetchImpl)(input, {
        method: options.method ?? 'GET',
        headers: options.headers,
        body: options.body,
        signal: controller.signal,
      });
      if (!response.ok) throw sanitizeHttpStatus(response.status);
      const text = await readResponseText(response, maxBytes);
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new MapError(
          'malformed_response',
          'Mapping provider returned malformed data',
        );
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(
          new MapError('timeout', 'Mapping provider request timed out', {
            retryable: true,
          }),
        );
      }, timeoutMs);
    });

    const controlPromises: Promise<T>[] = [requestPromise, timeoutPromise];
    if (options.signal) {
      const abortPromise = new Promise<never>((_, reject) => {
        onAbort = () => {
          controller.abort();
          reject(abortError());
        };
        options.signal!.addEventListener('abort', onAbort, { once: true });
        // Abort can happen between the preflight check and listener
        // registration. Re-checking closes that small race without ever
        // passing a caller-owned signal to the provider fetch.
        if (options.signal!.aborted) onAbort();
      });
      controlPromises.push(abortPromise);
    }

    try {
      return await Promise.race(controlPromises);
    } catch (error) {
      if (options.signal?.aborted) throw abortError();
      if (timedOut) {
        throw new MapError('timeout', 'Mapping provider request timed out', {
          retryable: true,
        });
      }
      throw sanitizeMapError(error);
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      if (onAbort && options.signal) {
        options.signal.removeEventListener('abort', onAbort);
      }
    }
  }
}

export const defaultMapRequestClient = new MapRequestClient();

export function requestMapJson<T>(
  input: RequestInfo | URL,
  options: MapRequestOptions = {},
): Promise<T> {
  return defaultMapRequestClient.json<T>(input, options);
}

/** Test and shutdown helper; it does not expose request URLs or response data. */
export function resetMapRequestThrottle(): void {
  hostThrottles.clear();
}
