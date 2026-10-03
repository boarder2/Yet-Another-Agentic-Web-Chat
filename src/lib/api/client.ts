import {
  CURRENT_DATE_HEADER,
  TIMEZONE_HEADER,
  localClock,
  localIsoString,
} from '@/lib/clock';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * `fetch` carrying the browser's clock, so the server can tell an LLM the
 * user's date. Use it (or `apiFetch`, built on it) for any request that can
 * reach an LLM; headers the caller sets win, so tests can pin the clock.
 */
export function clientFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  const clock = localClock();
  if (!headers.has(CURRENT_DATE_HEADER)) {
    headers.set(CURRENT_DATE_HEADER, localIsoString(clock));
  }
  if (!headers.has(TIMEZONE_HEADER)) {
    headers.set(TIMEZONE_HEADER, clock.timeZone);
  }
  return fetch(url, { ...init, headers });
}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await clientFetch(url, init);
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      // Routes are split between `error` and `message` keys; accept either so
      // the server's reason reaches the user instead of a bare status code.
      const body = await res.json();
      const reason = body?.error ?? body?.message;
      if (typeof reason === 'string' && reason) message = reason;
    } catch {
      // ignore parse failure
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}
