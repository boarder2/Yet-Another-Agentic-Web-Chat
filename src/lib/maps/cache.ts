import 'server-only';

import { createHash } from 'node:crypto';
import { eq, lte } from 'drizzle-orm';
import db from '@/lib/db';
import { mapCache } from '@/lib/db/schema';
import { MapError } from './request';

export const MAP_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MAP_MEMORY_CACHE_TTL_MS = 5 * 60 * 1000;
export const MAP_MEMORY_CACHE_MAX_ENTRIES = 64;
export const MAP_CACHE_MAX_VALUE_BYTES = 512_000;
export const MAP_MEMORY_CACHE_MAX_SIZE = MAP_MEMORY_CACHE_MAX_ENTRIES;

export const MAP_CACHE_KINDS = ['coarse_locality', 'public_business'] as const;
export type DurableMapCacheKind = (typeof MAP_CACHE_KINDS)[number];
export type MapCacheStorage = DurableMapCacheKind | 'memory';

export interface MapCacheClassificationInput {
  kind?: DurableMapCacheKind | 'memory';
  operation?: string;
  query?: string;
  publicRecord?: boolean;
  exact?: boolean;
  userAssociated?: boolean;
  currentLocation?: boolean;
  coordinate?: unknown;
  center?: unknown;
  origin?: unknown;
  destination?: unknown;
}

const SENSITIVE_OPERATIONS = new Set([
  'exact_address',
  'exactaddress',
  'nearby',
  'current_location',
  'currentlocation',
  'route',
  'routing',
]);

const ASSOCIATION_KEYS = new Set([
  'userid',
  'user_id',
  'chatid',
  'chat_id',
  'workspaceid',
  'workspace_id',
  'messageid',
  'message_id',
  'sessionid',
  'session_id',
  'clientsessionid',
  'client_session_id',
  'approvalid',
  'approval_id',
]);

const SENSITIVE_DURABLE_KEYS = new Set([
  'route',
  'geometry',
  'coordinates',
  'origin',
  'destination',
  'origincoordinate',
  'destinationcoordinate',
  'routegeometry',
  'currentlocation',
  'browsercoordinates',
  'center',
  'nearbycenter',
]);

const COORDINATE_FIELD_KEYS = new Set([
  'lat',
  'lon',
  'lng',
  'latitude',
  'longitude',
]);

const NAMED_STREET_ADDRESS_PATTERN =
  /\b(?:alley|avenue|boulevard|circle|close|court|crescent|drive|freeway|garden|gardens|grove|highway|lane|mews|parkway|place|plaza|road|route|square|street|terrace|trail|way|rue|calle|camino|via)\b/i;

function hasCoordinateInput(input: MapCacheClassificationInput): boolean {
  return (
    input.coordinate !== undefined ||
    input.center !== undefined ||
    input.origin !== undefined ||
    input.destination !== undefined ||
    input.currentLocation === true
  );
}

export function isLikelyExactAddress(query: string | undefined): boolean {
  if (!query) return false;
  // A leading house number or recognizable named street address is kept out
  // of the durable locality cache. The conservative match intentionally has
  // false positives: failing to cache a locality is preferable to retaining
  // an exact address. Coordinate-shaped queries are sensitive for the same
  // reason.
  const normalized = query.trim();
  return (
    /^\s*\d{1,6}[A-Za-z]?(?:[-/]\d{1,6})?(?:\s+|,\s+)\S+/.test(normalized) ||
    /^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?\s*,\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?\s*$/i.test(
      normalized,
    ) ||
    (normalized.includes(',') && NAMED_STREET_ADDRESS_PATTERN.test(normalized))
  );
}

/** Decide whether a result may be durable or must remain memory-only. */
export function classifyMapCache(
  input: MapCacheClassificationInput,
): MapCacheStorage {
  const operation = input.operation
    ?.trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (
    input.userAssociated ||
    input.exact ||
    hasCoordinateInput(input) ||
    (input.query !== undefined && isLikelyExactAddress(input.query)) ||
    (operation ? SENSITIVE_OPERATIONS.has(operation) : false)
  ) {
    return 'memory';
  }
  if (input.kind === 'memory') return 'memory';
  if (input.kind === 'public_business') return 'public_business';
  if (input.kind === 'coarse_locality') {
    return isLikelyExactAddress(input.query) ? 'memory' : 'coarse_locality';
  }
  if (
    input.publicRecord === true ||
    operation === 'business' ||
    operation === 'details' ||
    operation === 'place_details' ||
    operation === 'placedetails' ||
    operation === 'business_details' ||
    operation === 'businessdetails'
  ) {
    return 'public_business';
  }
  if (
    (operation === 'locality' ||
      operation === 'geocode' ||
      operation === 'search') &&
    !isLikelyExactAddress(input.query)
  ) {
    return 'coarse_locality';
  }
  return 'memory';
}

export const classifyMapCacheEntry = classifyMapCache;

function stableStringify(
  value: unknown,
  ancestors = new WeakSet<object>(),
): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (ancestors.has(value)) {
    throw new MapError(
      'invalid_request',
      'Mapping cache key is not serializable',
    );
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value
        .map((entry) => stableStringify(entry, ancestors))
        .join(',')}]`;
    }
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([key, entry]) =>
          `${JSON.stringify(key)}:${stableStringify(entry, ancestors)}`,
      )
      .join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

/** Hash request material before using it as a cache key, including for memory-only entries. */
export function hashMapCacheKey(namespace: string, value: unknown): string {
  const source = `${namespace}:${stableStringify(value)}`;
  return createHash('sha256').update(source).digest('hex');
}

function containsAssociationKey(
  value: unknown,
  ancestors = new WeakSet<object>(),
): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (ancestors.has(value)) return true;
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.some((child) => containsAssociationKey(child, ancestors));
    }
    return Object.entries(value as Record<string, unknown>).some(
      ([key, child]) =>
        ASSOCIATION_KEYS.has(key.toLowerCase()) ||
        ASSOCIATION_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, '')) ||
        containsAssociationKey(child, ancestors),
    );
  } finally {
    ancestors.delete(value);
  }
}

function isPublicMapRecord(value: object): boolean {
  if (Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.name === 'string' &&
    (typeof record.sourceUrl === 'string' ||
      typeof record.provider === 'string')
  );
}

function hasSensitiveDurableField(
  value: unknown,
  ancestors = new WeakSet<object>(),
  allowRecordCoordinate = false,
): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (ancestors.has(value)) return true;
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.some((child) =>
        hasSensitiveDurableField(child, ancestors, false),
      );
    }
    const record = value as Record<string, unknown>;
    const recordHasCoordinate = isPublicMapRecord(value);
    return Object.entries(record).some(([key, child]) => {
      const normalizedKey = key.toLowerCase();
      if (SENSITIVE_DURABLE_KEYS.has(normalizedKey)) return true;
      if (COORDINATE_FIELD_KEYS.has(normalizedKey) && !allowRecordCoordinate) {
        return true;
      }
      if (
        (normalizedKey === 'query' || normalizedKey === 'address') &&
        typeof child === 'string' &&
        isLikelyExactAddress(child) &&
        !recordHasCoordinate
      ) {
        return true;
      }
      return hasSensitiveDurableField(
        child,
        ancestors,
        normalizedKey === 'coordinate' && recordHasCoordinate,
      );
    });
  } finally {
    ancestors.delete(value);
  }
}

function serializeDurableValue(value: unknown): string {
  if (containsAssociationKey(value)) {
    throw new MapError(
      'invalid_request',
      'Mapping cache values cannot contain user associations',
    );
  }
  if (hasSensitiveDurableField(value)) {
    throw new MapError(
      'invalid_request',
      'Precise mapping data cannot enter the durable cache',
    );
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new MapError(
      'invalid_request',
      'Mapping cache value is not serializable',
    );
  }
  if (
    serialized === undefined ||
    Buffer.byteLength(serialized, 'utf8') > MAP_CACHE_MAX_VALUE_BYTES
  ) {
    throw new MapError(
      'response_too_large',
      'Mapping cache value exceeded the size limit',
    );
  }
  return serialized;
}

function deserializeValue<T>(value: unknown): T | null {
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    // A valid cached primitive string is already decoded by Drizzle; only
    // double-encoded legacy rows need the JSON.parse path above.
    return value as T;
  }
}

/** Durable cache backed by `map_cache`; only the two explicitly classified kinds are accepted. */
function storageKey(key: string): string {
  if (/^[a-f0-9]{64}$/.test(key)) return key;
  if (!key || key.length > 2_048) {
    throw new MapError('invalid_request', 'Mapping cache key is invalid');
  }
  return hashMapCacheKey('cache-key', key);
}

export class MapCacheStore {
  get<T>(key: string, kind?: DurableMapCacheKind, now = Date.now()): T | null {
    const persistedKey = storageKey(key);
    pruneMapCache(now);
    const row = db
      .select()
      .from(mapCache)
      .where(eq(mapCache.key, persistedKey))
      .limit(1)
      .all()[0];
    const expiresAt =
      row && row.expiresAt instanceof Date
        ? row.expiresAt.getTime()
        : Number(row?.expiresAt);
    if (
      !row ||
      !MAP_CACHE_KINDS.includes(row.kind as DurableMapCacheKind) ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= now
    ) {
      return null;
    }
    if (kind && row.kind !== kind) return null;
    const value = deserializeValue<T>(row.value);
    try {
      // Validate legacy/tampered rows on read as well as on write. A cache
      // hit must never reintroduce data that the durable policy forbids.
      serializeDurableValue(value);
    } catch {
      return null;
    }
    return value;
  }

  set<T>(
    key: string,
    kind: DurableMapCacheKind,
    value: T,
    now = Date.now(),
  ): void {
    if (!MAP_CACHE_KINDS.includes(kind)) {
      throw new MapError('invalid_request', 'Mapping cache kind is invalid');
    }
    pruneMapCache(now);
    const persistedKey = storageKey(key);
    const serialized = serializeDurableValue(value);
    const createdAt = new Date(now);
    const expiresAt = new Date(now + MAP_CACHE_TTL_MS);
    const driverValue = JSON.parse(serialized) as unknown;
    db.insert(mapCache)
      .values({
        key: persistedKey,
        kind,
        value: driverValue,
        createdAt,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: mapCache.key,
        set: { kind, value: driverValue, createdAt, expiresAt },
      })
      .run();
  }

  prune(now = Date.now()): number {
    return pruneMapCache(now);
  }

  clear(): number {
    return clearMapCache();
  }
}

export const mapCacheStore = new MapCacheStore();

export function getMapCache<T>(
  key: string,
  kind?: DurableMapCacheKind,
  now = Date.now(),
): T | null {
  return mapCacheStore.get<T>(key, kind, now);
}

export function setMapCache<T>(
  key: string,
  kind: DurableMapCacheKind,
  value: T,
  now = Date.now(),
): void {
  mapCacheStore.set(key, kind, value, now);
}

export function pruneMapCache(now = Date.now()): number {
  return db
    .delete(mapCache)
    .where(lte(mapCache.expiresAt, new Date(now)))
    .run().changes;
}

export function clearMapCache(): number {
  try {
    return db.delete(mapCache).run().changes;
  } finally {
    // Sensitive values are process-local and must be dropped even if the
    // durable-table delete fails.
    sensitiveMapCache.clear();
  }
}

type MemoryEntry = {
  value: unknown;
  expiresAt: number;
  lastAccess: number;
};

/** Bounded, process-local cache for exact, nearby, current-location, and route operations. */
export class BoundedMapMemoryCache {
  private readonly entries = new Map<string, MemoryEntry>();

  private readonly maxEntries: number;
  private readonly defaultTtlMs: number;
  private readonly now: () => number;

  constructor(
    maxEntries = MAP_MEMORY_CACHE_MAX_ENTRIES,
    defaultTtlMs = MAP_MEMORY_CACHE_TTL_MS,
    now: () => number = Date.now,
  ) {
    this.maxEntries = Number.isFinite(maxEntries)
      ? Math.max(1, Math.trunc(maxEntries))
      : MAP_MEMORY_CACHE_MAX_ENTRIES;
    this.defaultTtlMs = Number.isFinite(defaultTtlMs)
      ? Math.max(1, Math.trunc(defaultTtlMs))
      : MAP_MEMORY_CACHE_TTL_MS;
    this.now = now;
  }

  get<T>(key: string): T | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    const now = this.now();
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return null;
    }
    entry.lastAccess = now;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs = this.defaultTtlMs): void {
    const now = this.now();
    const boundedTtl = Number.isFinite(ttlMs)
      ? Math.max(1, Math.min(this.defaultTtlMs, Math.trunc(ttlMs)))
      : this.defaultTtlMs;
    this.entries.delete(key);
    this.entries.set(key, {
      value,
      expiresAt: now + boundedTtl,
      lastAccess: now,
    });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  prune(): number {
    const now = this.now();
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
        removed++;
      }
    }
    return removed;
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    this.prune();
    return this.entries.size;
  }
}

export const sensitiveMapCache = new BoundedMapMemoryCache();

export function getSensitiveMapCache<T>(key: string): T | null {
  return sensitiveMapCache.get<T>(key);
}

export function setSensitiveMapCache<T>(
  key: string,
  value: T,
  ttlMs = MAP_MEMORY_CACHE_TTL_MS,
): void {
  sensitiveMapCache.set(key, value, ttlMs);
}

export function clearSensitiveMapCache(): void {
  sensitiveMapCache.clear();
}
