import 'server-only';

import { randomBytes } from 'node:crypto';
import { MapCoordinateSchema, type MapCoordinate } from './types';
import {
  ClientSessionIdSchema,
  LocationApprovalResponseSchema,
  LocationHostListSchema,
  LocationRetentionSchema,
  LocationPurposeSchema,
  LOCATION_TOKEN_TTL_MS,
  normalizeClientSessionId,
  type LocationApprovalPayload,
  type LocationApprovalResponse,
  type LocationRetention,
  type LocationPurpose,
} from './locationSchemas';

export {
  BrowserLocationRequestSchema,
  ClientSessionIdSchema,
  LocationApprovalPayloadSchema,
  LocationApprovalResponseSchema,
  LocationDeclineReasonSchema,
  LocationResumeResponseSchema,
  LocationRetentionSchema,
  LocationTokenResumeResponseSchema,
  containsCoordinateText,
  LOCATION_DECLINE_REASONS,
  LOCATION_PURPOSES,
  LOCATION_RETENTIONS,
  LOCATION_SESSION_TTL_MS,
  LOCATION_TOKEN_TTL_MS,
  LocationPurposeSchema,
  normalizeClientSessionId,
} from './locationSchemas';
export type {
  BrowserLocationRequest,
  LocationApprovalPayload,
  LocationApprovalResponse,
  LocationDeclineReason,
  LocationResumeResponse,
  LocationRetention,
  LocationPurpose,
  LocationTokenResumeResponse,
} from './locationSchemas';

export interface LocationSessionBinding {
  approvalId: string;
  runId: string;
  chatId: string;
  messageId: string;
  aiMessageId: string;
  clientSessionId: string;
}

export interface LocationSession {
  /** Opaque bearer value; never include it in model or client responses. */
  readonly token: string;
  readonly coordinate: MapCoordinate;
  readonly binding: LocationSessionBinding;
  readonly authorizedPurposes: readonly LocationPurpose[];
  readonly authorizedHosts: readonly string[];
  readonly configHash: string;
  readonly retention: LocationRetention;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface MintLocationSessionInput {
  coordinate: MapCoordinate;
  binding: LocationSessionBinding;
  authorizedPurposes: readonly LocationPurpose[];
  authorizedHosts: readonly string[];
  configHash: string;
  retention: LocationRetention;
  now?: number;
  ttlMs?: number;
}

export interface LocationSessionRequirements {
  binding?: Partial<LocationSessionBinding>;
  purpose?: LocationPurpose;
  authorizedHosts?: readonly string[];
  configHash?: string;
}

export function isLocationApprovalExpired(
  payload: Pick<LocationApprovalPayload, 'expiresAt'>,
  now = Date.now(),
): boolean {
  return !Number.isFinite(now) || payload.expiresAt <= now;
}

/** Keep persisted approval windows bounded to the server's current clock. */
export function isLocationApprovalWindowBounded(
  payload: Pick<LocationApprovalPayload, 'createdAt' | 'expiresAt'>,
  now = Date.now(),
): boolean {
  return (
    Number.isFinite(now) &&
    payload.createdAt <= now &&
    payload.expiresAt <= now + LOCATION_TOKEN_TTL_MS
  );
}

type Clock = () => number;
type TokenFactory = () => string;

function cloneBinding(binding: LocationSessionBinding): LocationSessionBinding {
  return { ...binding };
}

function cloneSession(session: LocationSession): LocationSession {
  return {
    ...session,
    coordinate: { ...session.coordinate },
    binding: cloneBinding(session.binding),
    authorizedPurposes: [...session.authorizedPurposes],
    authorizedHosts: [...session.authorizedHosts],
  };
}

function normalizedHosts(hosts: readonly string[]): string[] {
  return [...new Set(hosts.map((host) => host.trim().toLowerCase()))].sort();
}

function sameHosts(left: readonly string[], right: readonly string[]): boolean {
  const a = normalizedHosts(left);
  const b = normalizedHosts(right);
  return a.length === b.length && a.every((host, index) => host === b[index]);
}

function validBinding(binding: LocationSessionBinding): boolean {
  const validId = (value: unknown, max = 200): value is string =>
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= max &&
    !/[\u0000-\u001f\u007f]/.test(value);
  return (
    validId(binding.approvalId) &&
    validId(binding.runId) &&
    validId(binding.chatId) &&
    validId(binding.messageId) &&
    validId(binding.aiMessageId) &&
    ClientSessionIdSchema.safeParse(binding.clientSessionId).success
  );
}

/**
 * Process-local store for exact browser locations. Nothing in this class is
 * durable; expiry and run cleanup remove the only copy of the coordinates.
 */
export class LocationTokenStore {
  private readonly sessions = new Map<string, LocationSession>();
  private readonly expiryTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly clock: Clock;
  private readonly tokenFactory: TokenFactory;

  constructor(options: { clock?: Clock; tokenFactory?: TokenFactory } = {}) {
    this.clock = options.clock ?? Date.now;
    this.tokenFactory =
      options.tokenFactory ?? (() => randomBytes(32).toString('base64url'));
  }

  get size(): number {
    this.pruneExpired();
    return this.sessions.size;
  }

  mint(input: MintLocationSessionInput): LocationSession {
    const coordinate = MapCoordinateSchema.safeParse(input.coordinate);
    if (!coordinate.success) throw new Error('Invalid browser location');
    if (!validBinding(input.binding))
      throw new Error('Invalid location binding');
    const clientSessionId = normalizeClientSessionId(
      input.binding.clientSessionId,
    );
    if (!clientSessionId) throw new Error('Invalid location binding');
    if (!LocationRetentionSchema.safeParse(input.retention).success) {
      throw new Error('Invalid location retention');
    }

    const purposes = [...input.authorizedPurposes];
    if (
      !LocationPurposeSchema.array().safeParse(purposes).success ||
      purposes.length === 0 ||
      new Set(purposes).size !== purposes.length
    ) {
      throw new Error('Invalid location purposes');
    }
    const hosts = [...input.authorizedHosts].map((host) => host.trim());
    if (!LocationHostListSchema.safeParse(hosts).success) {
      throw new Error('Invalid location hosts');
    }
    if (
      typeof input.configHash !== 'string' ||
      input.configHash.trim().length === 0 ||
      input.configHash.length > 2_000
    ) {
      throw new Error('Invalid location configuration hash');
    }
    const now = input.now ?? this.clock();
    if (!Number.isFinite(now) || now < 0) {
      throw new Error('Invalid location session clock');
    }
    const requestedTtl = input.ttlMs ?? LOCATION_TOKEN_TTL_MS;
    if (!Number.isFinite(requestedTtl) || requestedTtl < 1) {
      throw new Error('Invalid location token TTL');
    }
    const ttl = Math.min(Math.trunc(requestedTtl), LOCATION_TOKEN_TTL_MS);
    this.pruneExpired(now);

    let token = '';
    for (let attempt = 0; attempt < 10 && !token; attempt += 1) {
      const candidate = this.tokenFactory();
      if (
        typeof candidate === 'string' &&
        /^[A-Za-z0-9_-]{32,200}$/.test(candidate) &&
        !this.sessions.has(candidate)
      ) {
        token = candidate;
      }
    }
    if (!token) throw new Error('Could not allocate a location token');

    const session: LocationSession = {
      token,
      coordinate: { ...coordinate.data },
      binding: cloneBinding({
        ...input.binding,
        clientSessionId,
      }),
      authorizedPurposes: purposes,
      authorizedHosts: normalizedHosts(hosts),
      configHash: input.configHash.trim(),
      retention: input.retention,
      createdAt: now,
      expiresAt: now + ttl,
    };
    this.sessions.set(token, session);
    this.scheduleExpiry(token, ttl);
    return cloneSession(session);
  }

  private scheduleExpiry(token: string, delayMs: number): void {
    const prior = this.expiryTimers.get(token);
    if (prior !== undefined) clearTimeout(prior);
    const timer = setTimeout(
      () => {
        // The timer is a wall-clock upper bound, while `get`/`size` also use the
        // injected clock for deterministic callers. Never keep the coordinate
        // past the requested TTL just because a custom test clock stood still.
        if (this.sessions.has(token)) this.remove(token);
        else this.expiryTimers.delete(token);
      },
      Math.max(1, Math.trunc(delayMs)),
    );
    this.expiryTimers.set(token, timer);
    const unref = (timer as unknown as { unref?: () => void }).unref;
    if (unref) unref.call(timer);
  }

  private remove(token: string): void {
    const timer = this.expiryTimers.get(token);
    if (timer !== undefined) clearTimeout(timer);
    this.expiryTimers.delete(token);
    this.sessions.delete(token);
  }

  /** Resolve a token only when every supplied binding fact matches exactly. */
  get(
    token: unknown,
    requirements: LocationSessionRequirements = {},
  ): LocationSession | null {
    if (typeof token !== 'string' || token.length < 32 || token.length > 200) {
      return null;
    }
    const session = this.sessions.get(token);
    if (!session) return null;
    const now = this.clock();
    if (!Number.isFinite(now) || session.expiresAt <= now) {
      this.remove(token);
      return null;
    }

    const binding = requirements.binding;
    if (
      binding &&
      Object.entries(binding).some(
        ([key, value]) =>
          value !== undefined &&
          session.binding[key as keyof LocationSessionBinding] !== value,
      )
    ) {
      return null;
    }
    if (
      requirements.purpose !== undefined &&
      !session.authorizedPurposes.includes(requirements.purpose)
    ) {
      return null;
    }
    if (
      requirements.authorizedHosts !== undefined &&
      !sameHosts(session.authorizedHosts, requirements.authorizedHosts)
    ) {
      return null;
    }
    if (
      requirements.configHash !== undefined &&
      session.configHash !== requirements.configHash
    ) {
      return null;
    }
    return cloneSession(session);
  }

  getForPurpose(
    token: unknown,
    requirements: Omit<LocationSessionRequirements, 'purpose'> & {
      purpose: LocationPurpose;
    },
  ): LocationSession | null {
    return this.get(token, requirements);
  }

  has(token: unknown): boolean {
    return this.get(token) !== null;
  }

  revoke(token: unknown): void {
    if (typeof token === 'string') this.remove(token);
  }

  clearForRun(runId: string): void {
    for (const [token, session] of this.sessions) {
      if (session.binding.runId === runId) this.remove(token);
    }
  }

  clearForMessage(messageId: string): void {
    for (const [token, session] of this.sessions) {
      if (session.binding.messageId === messageId) this.remove(token);
    }
  }

  clear(): void {
    for (const timer of this.expiryTimers.values()) clearTimeout(timer);
    this.expiryTimers.clear();
    this.sessions.clear();
  }

  pruneExpired(now = this.clock()): void {
    for (const [token, session] of this.sessions) {
      if (session.expiresAt <= now) this.remove(token);
    }
  }
}

declare global {
  // Keep the process-local token store shared across Next route/server chunks.
  // The location route mints the token and the resumed agent may execute from a
  // different server bundle, but neither path may need a durable coordinate.
  var __yaawcLocationTokenStore: LocationTokenStore | undefined;
}

export const locationTokenStore =
  globalThis.__yaawcLocationTokenStore ??
  (globalThis.__yaawcLocationTokenStore = new LocationTokenStore());
export const locationSessionStore = locationTokenStore;

export function mintLocationToken(
  input: MintLocationSessionInput,
): LocationSession {
  return locationTokenStore.mint(input);
}

export function getLocationSession(
  token: unknown,
  requirements: LocationSessionRequirements = {},
): LocationSession | null {
  return locationTokenStore.get(token, requirements);
}

export function revokeLocationToken(token: unknown): void {
  locationTokenStore.revoke(token);
}

export function clearLocationTokensForRun(runOrMessageId: string): void {
  // Callers commonly have the user-message run key rather than the checkpoint
  // thread ID. Clear both explicit binding dimensions without making the
  // store's `clearForRun` method over-broad for direct callers.
  locationTokenStore.clearForRun(runOrMessageId);
  locationTokenStore.clearForMessage(runOrMessageId);
}

export function isValidClientSessionId(value: unknown): value is string {
  return normalizeClientSessionId(value) !== null;
}

export function safeLocationApprovalResponse(
  value: unknown,
): LocationApprovalResponse | null {
  const parsed = LocationApprovalResponseSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function locationHostsMatch(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return sameHosts(left, right);
}

export function locationSessionIsUsable(
  session: LocationSession | undefined | null,
  purpose: LocationPurpose,
  now = Date.now(),
): session is LocationSession {
  return Boolean(
    session &&
    Number.isFinite(now) &&
    session.expiresAt > now &&
    session.authorizedPurposes.includes(purpose),
  );
}

export type { MapCoordinate };
