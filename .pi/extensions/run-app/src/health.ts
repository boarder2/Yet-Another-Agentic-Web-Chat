import { HEALTH_PATH, PORT_END, PORT_START } from './constants.ts';
import type { Health } from './types.ts';

export interface HealthProbe {
  url: string;
  healthy: boolean;
  identified: boolean;
  status: number | null;
  reason?: string;
}

export interface JsonResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type Fetcher = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<JsonResponse>;

export interface PortProbe extends HealthProbe {
  port: number;
}

export function nextHealthState(
  previous: Health,
  consecutiveFailures: number,
  result: HealthProbe,
): { health: Health; consecutiveFailures: number } {
  if (result.healthy) return { health: 'healthy', consecutiveFailures: 0 };
  const failures = consecutiveFailures + 1;
  return {
    health: failures >= 2 ? 'unhealthy' : previous,
    consecutiveFailures: failures,
  };
}

export function appUrl(port: number): string {
  return `http://localhost:${port}`;
}

export function healthUrl(url: string): string {
  return `${url.replace(/\/$/, '')}${HEALTH_PATH}`;
}

export function isYAAWCConfig(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.prototype.hasOwnProperty.call(value, 'chatModelProviders')
  );
}

export async function probeYAAWC(
  url: string,
  options: {
    fetcher?: Fetcher;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): Promise<HealthProbe> {
  const fetcher = options.fetcher ?? defaultFetcher;
  const timeoutMs = options.timeoutMs ?? 750;
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutController.signal])
    : timeoutController.signal;

  try {
    const response = await fetcher(healthUrl(url), { signal });
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return {
        url,
        healthy: false,
        identified: false,
        status: response.status,
        reason: 'health endpoint did not return JSON',
      };
    }

    const identified = isYAAWCConfig(payload);
    return {
      url,
      healthy: response.ok && identified,
      identified,
      status: response.status,
      reason: identified
        ? response.ok
          ? undefined
          : `health endpoint returned HTTP ${response.status}`
        : 'health JSON did not contain chatModelProviders',
    };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return {
      url,
      healthy: false,
      identified: false,
      status: null,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function scanYAAWCPorts(
  options: {
    probe?: (url: string, signal?: AbortSignal) => Promise<HealthProbe>;
    signal?: AbortSignal;
  } = {},
): Promise<PortProbe | null> {
  const probe = options.probe ?? ((url, signal) => probeYAAWC(url, { signal }));
  for (let port = PORT_START; port <= PORT_END; port++) {
    if (options.signal?.aborted)
      throw new DOMException('Aborted', 'AbortError');
    const result = await probe(appUrl(port), options.signal);
    if (result.healthy) return { ...result, port };
  }
  return null;
}

export function parseSelectedPort(log: string): number | null {
  const patterns = [
    /\bLocal:\s+https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{1,5})\b/i,
    /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{1,5})\b/i,
    /\b(?:port|listening|started server on)\D{0,20}(\d{1,5})\b/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(log);
    if (!match) continue;
    const port = Number(match[1]);
    if (Number.isInteger(port) && port >= 1 && port <= 65_535) return port;
  }
  return null;
}

const defaultFetcher: Fetcher = (url, init) => globalThis.fetch(url, init);
