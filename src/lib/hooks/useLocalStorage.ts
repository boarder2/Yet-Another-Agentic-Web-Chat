'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * localStorage-backed hooks built on useSyncExternalStore.
 *
 * These hooks keep React state in sync with localStorage reactively:
 * - Same-tab updates propagate via a shared CustomEvent dispatched by the
 *   setters exported here (`local-storage-change`).
 * - Cross-tab updates propagate via the native `storage` event.
 *
 * Anywhere you write to one of these keys outside the hook, go through
 * `writeLocalStorage` so subscribers are notified.
 */

const EVENT = 'local-storage-change';

type ChangeDetail = { key: string };

const notify = (key: string) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<ChangeDetail>(EVENT, { detail: { key } }),
  );
};

const readRaw = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

/**
 * Imperatively write a localStorage key and notify all subscribers (same tab).
 * Passing `null` removes the key.
 */
export const writeLocalStorage = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // ignore quota / access errors
  }
  notify(key);
};

const makeSubscribe = (key: string) => (cb: () => void) => {
  const handleCustom = (e: Event) => {
    const detail = (e as CustomEvent<ChangeDetail>).detail;
    if (!detail || detail.key === key) cb();
  };
  const handleStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === key) cb();
  };
  window.addEventListener(EVENT, handleCustom);
  window.addEventListener('storage', handleStorage);
  return () => {
    window.removeEventListener(EVENT, handleCustom);
    window.removeEventListener('storage', handleStorage);
  };
};

/**
 * React to a string-valued localStorage key. Returns `[value, setValue]`.
 * When the key is absent, `defaultValue` is returned.
 */
export function useLocalStorageString(
  key: string,
  defaultValue: string,
): [string, (value: string) => void] {
  const subscribe = useCallback(
    (cb: () => void) => makeSubscribe(key)(cb),
    [key],
  );
  const getSnapshot = useCallback(
    () => readRaw(key) ?? defaultValue,
    [key, defaultValue],
  );
  const getServerSnapshot = useCallback(() => defaultValue, [defaultValue]);
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setValue = useCallback(
    (next: string) => writeLocalStorage(key, next),
    [key],
  );
  return [value, setValue];
}

/**
 * React to a boolean-valued localStorage key, serialized as `'true'`/`'false'`.
 */
export function useLocalStorageBoolean(
  key: string,
  defaultValue: boolean,
): [boolean, (value: boolean) => void] {
  const subscribe = useCallback(
    (cb: () => void) => makeSubscribe(key)(cb),
    [key],
  );
  const getSnapshot = useCallback(() => {
    const raw = readRaw(key);
    if (raw === null) return defaultValue;
    return raw === 'true';
  }, [key, defaultValue]);
  const getServerSnapshot = useCallback(() => defaultValue, [defaultValue]);
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setValue = useCallback(
    (next: boolean) => writeLocalStorage(key, next ? 'true' : 'false'),
    [key],
  );
  return [value, setValue];
}

// Cache parsed JSON per key so `getSnapshot` returns a stable reference when
// the raw string hasn't changed — required by useSyncExternalStore.
type JsonCacheEntry = { raw: string | null; parsed: unknown };
const jsonCache = new Map<string, JsonCacheEntry>();

/**
 * React to a JSON-serialized localStorage key. Pass a stable reference for
 * `defaultValue` (e.g. a module constant) — it is returned when the key is
 * missing or contains invalid JSON.
 */
export function useLocalStorageJSON<T>(
  key: string,
  defaultValue: T,
): [T, (value: T | null) => void] {
  const subscribe = useCallback(
    (cb: () => void) => makeSubscribe(key)(cb),
    [key],
  );
  const getSnapshot = useCallback((): T => {
    const raw = readRaw(key);
    const cached = jsonCache.get(key);
    if (cached && cached.raw === raw) return cached.parsed as T;
    let parsed: T = defaultValue;
    if (raw !== null) {
      try {
        parsed = JSON.parse(raw) as T;
      } catch {
        parsed = defaultValue;
      }
    }
    jsonCache.set(key, { raw, parsed });
    return parsed;
  }, [key, defaultValue]);
  const getServerSnapshot = useCallback(() => defaultValue, [defaultValue]);
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setValue = useCallback(
    (next: T | null) => {
      if (next === null) writeLocalStorage(key, null);
      else writeLocalStorage(key, JSON.stringify(next));
    },
    [key],
  );
  return [value, setValue];
}
