'use client';

/**
 * Database-backed persistence + hydration for the migrated settings keys.
 *
 * The DB (`app_settings`) is the durable, cross-device source of truth;
 * localStorage is demoted to a synchronous local cache so existing
 * synchronous reads (hooks' `getSnapshot`, chat send-time reads) keep working
 * with no flash. We capture writes by wrapping `localStorage.setItem` /
 * `removeItem` once, rather than editing every call site, which guarantees no
 * write path is missed. Only keys in the allowlist trigger persistence.
 */

import { writeLocalStorageBatch } from '@/lib/hooks/useLocalStorage';
import {
  MIGRATED_SETTING_KEYS,
  isMigratedSettingKey,
} from '@/lib/settings/keys';
import {
  fetchSettings,
  patchSettings,
  type SettingsPatch,
} from '@/lib/hooks/api/useSettings';

let installed = false;
let hydrated = false;
// While true, cache writes (from applying server values) must NOT persist back.
let hydrating = false;
// Whether hydration has reconciled with the server (or given up offline).
// Consumers that read localStorage once and write their state back (e.g.
// useDashboard) must not persist until this is true, otherwise stale
// local-on-mount values can clobber newer DB values.
let settingsHydrated = false;
const SETTINGS_HYDRATED_EVENT = 'settings-hydrated';
// Fired after the cache is updated from the DB — on initial hydration AND on
// every later focus/visibility re-sync. Consumers that snapshot localStorage on
// mount (e.g. useDashboard) listen for this to re-read freshly-synced values.
const SETTINGS_SYNCED_EVENT = 'settings-synced';

/** Whether settings hydration has completed (success or offline give-up). */
export function isSettingsHydrated(): boolean {
  return settingsHydrated;
}

/**
 * Run `cb` whenever the cache is (re-)synced from the DB. Unlike
 * `subscribeSettingsHydrated`, this fires on every later re-sync too, so an
 * already-mounted view can refresh when another device's changes arrive.
 * Returns an unsubscribe function.
 */
export function subscribeSettingsSynced(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => cb();
  window.addEventListener(SETTINGS_SYNCED_EVENT, handler);
  return () => window.removeEventListener(SETTINGS_SYNCED_EVENT, handler);
}

function emitSynced() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(SETTINGS_SYNCED_EVENT));
  }
}

/**
 * Run `cb` once settings hydration completes — immediately if it already has.
 * Returns an unsubscribe function.
 */
export function subscribeSettingsHydrated(cb: () => void): () => void {
  if (settingsHydrated) {
    cb();
    return () => {};
  }
  if (typeof window === 'undefined') return () => {};
  const handler = () => cb();
  window.addEventListener(SETTINGS_HYDRATED_EVENT, handler);
  return () => window.removeEventListener(SETTINGS_HYDRATED_EVENT, handler);
}

function markHydrated() {
  if (settingsHydrated) return;
  settingsHydrated = true;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(SETTINGS_HYDRATED_EVENT));
  }
}

const pending = new Set<string>();
// Keys whose normal (non-keepalive) PATCH is currently awaiting a response.
// Tracked so the pagehide keepalive flush can re-send them if the browser
// aborts the in-flight request on unload.
const inFlight = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
// Guards against overlapping PATCHes: an older, slower request must never land
// after a newer one and resurrect a stale value. Only one flush runs at a time.
let flushInFlight = false;
const FLUSH_DELAY_MS = 400;
// If the hydration fetch hangs (neither resolves nor rejects), open the gate
// anyway so hydration-gated consumers don't suppress writes forever.
const HYDRATION_WATCHDOG_MS = 10_000;

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

// localStorage marker (deliberately NOT a migrated/synced key) recording that
// THIS browser has reconciled its local cache with the DB at least once. Until
// it is set, the DB is treated as possibly-incomplete — it may have been seeded
// from config.toml on the server, or written by another device, without this
// browser's localStorage-only settings — so hydration MERGES (server values win
// for the keys it has; local-only keys are backed up) instead of letting the
// server delete keys it happens not to have. Once set, the server is
// authoritative and cross-device deletions propagate.
const SETTINGS_MIGRATED_MARKER = 'settingsDbMigrated';

function isMigrationComplete(): boolean {
  return readRaw(SETTINGS_MIGRATED_MARKER) === 'true';
}

function markMigrationComplete() {
  // Goes through the patched setItem, but record() ignores non-migrated keys,
  // so this never syncs to the DB (keeping the marker per-browser).
  try {
    localStorage.setItem(SETTINGS_MIGRATED_MARKER, 'true');
  } catch {
    // Best-effort; if storage is unavailable the next load simply re-merges.
  }
}

function buildPatch(keys: Iterable<string>): SettingsPatch {
  const patch: SettingsPatch = {};
  for (const key of keys) patch[key] = readRaw(key);
  return patch;
}

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_DELAY_MS);
}

async function flush() {
  // Serialize: if a flush is already running, it drains `pending` in its loop,
  // so just let it. This prevents two concurrent in-flight PATCHes racing.
  if (flushInFlight || pending.size === 0) return;
  flushInFlight = true;
  try {
    while (pending.size > 0) {
      const keys = [...pending];
      pending.clear();
      for (const key of keys) inFlight.add(key);
      try {
        await patchSettings(buildPatch(keys));
      } catch {
        // Re-queue on failure and stop; a later write (or pagehide) retries.
        for (const key of keys) pending.add(key);
        break;
      } finally {
        for (const key of keys) inFlight.delete(key);
      }
    }
  } finally {
    flushInFlight = false;
  }
}

function record(key: string) {
  if (hydrating || !isMigratedSettingKey(key)) return;
  pending.add(key);
  scheduleFlush();
}

/**
 * Wrap localStorage mutators once so every write to a migrated key — whether
 * through the reactive hooks or a direct `localStorage.setItem` call — is
 * persisted to the DB. Non-migrated keys pass through untouched.
 *
 * We patch `Storage.prototype`, NOT the `localStorage` instance. `localStorage`
 * is an exotic Storage object: assigning `localStorage.setItem = fn` does not
 * shadow the prototype method (it's silently dropped), so the instance method
 * keeps resolving to the native implementation and no write is ever intercepted.
 * Patching the prototype is what `localStorage.setItem(...)` actually invokes.
 *
 * `localStorage` and `sessionStorage` share `Storage.prototype`, so the wrappers
 * also fire for `sessionStorage` writes. We guard on `this === localStorage` so
 * a (current or future) `sessionStorage` write of a migrated-key name can never
 * be persisted to the DB — only the real localStorage cache syncs.
 */
export function installSettingsPersistence() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  try {
    const proto = Object.getPrototypeOf(window.localStorage) as Storage;
    const origSetItem = proto.setItem;
    const origRemoveItem = proto.removeItem;

    proto.setItem = function (key: string, value: string) {
      origSetItem.call(this, key, value);
      if (this === window.localStorage) record(key);
    };
    proto.removeItem = function (key: string) {
      origRemoveItem.call(this, key);
      if (this === window.localStorage) record(key);
    };
  } catch {
    // If the environment forbids patching Storage, persistence is best-effort.
    installed = false;
    return;
  }

  // Best-effort flush of anything still pending when the page is hidden/unloaded.
  window.addEventListener('pagehide', flushOnExit);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushOnExit();
    else void resyncSettingsFromDb();
  });
  // Re-pull from the DB when the tab regains focus so changes made on another
  // device land here (the once-per-load hydration can't do this on its own).
  window.addEventListener('focus', () => void resyncSettingsFromDb());
}

function flushOnExit() {
  // Union pending with keys whose normal (non-keepalive) PATCH may still be in
  // flight — the browser can abort that request on unload, so re-send with
  // keepalive. The upsert is idempotent, so a duplicate send is harmless.
  const keys = [...new Set([...pending, ...inFlight])];
  if (keys.length === 0) return;
  pending.clear();
  try {
    void fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPatch(keys)),
      keepalive: true,
    });
  } catch {
    for (const key of keys) pending.add(key);
  }
}

/**
 * Apply a DB settings map onto the localStorage cache, making the cache match
 * the (authoritative) server for migrated keys. `hydrating` is held true across
 * the batch so the wrapped mutators don't echo these writes back to the server.
 *
 * - Keys present in `server` are upserted.
 * - With `removeAbsent`, migrated keys NOT in `server` are deleted locally, so a
 *   value cleared on another device (its DB row deleted, hence absent here)
 *   propagates instead of lingering. The server map is the full settings table,
 *   so absence is authoritative — except on a fresh DB (no migrated rows), where
 *   the caller backfills local→server instead of calling this.
 * - Keys with an unflushed local write (pending/in-flight) are always left
 *   alone so a sync can't clobber or delete a change just made on this device.
 *
 * Returns whether anything changed.
 */
function applyServerValues(
  server: Record<string, string>,
  {
    skipPending = false,
    removeAbsent = false,
  }: { skipPending?: boolean; removeAbsent?: boolean } = {},
): boolean {
  const isProtected = (key: string) =>
    skipPending && (pending.has(key) || inFlight.has(key));

  const entries: [string, string | null][] = [];
  for (const key of Object.keys(server)) {
    if (isMigratedSettingKey(key) && !isProtected(key)) {
      entries.push([key, server[key]]);
    }
  }
  if (removeAbsent) {
    for (const key of MIGRATED_SETTING_KEYS) {
      if (key in server || isProtected(key)) continue;
      if (readRaw(key) !== null) entries.push([key, null]);
    }
  }

  if (entries.length === 0) return false;
  hydrating = true;
  try {
    writeLocalStorageBatch(entries);
  } finally {
    hydrating = false;
  }
  return true;
}

/**
 * Load settings from the DB into the localStorage cache on startup. On a fresh
 * database (no rows) this instead backfills the current local values up to the
 * server — the one-time client→server migration. After hydration the server is
 * authoritative and overwrites local values for the keys it returns.
 */
export async function hydrateSettingsFromDb() {
  if (hydrated || typeof window === 'undefined') return;
  hydrated = true;

  // The try/finally below only runs once the fetch settles. If it hangs (server
  // reachable but unresponsive), the finally never fires and hydration-gated
  // consumers (useDashboard) would suppress writes forever. This watchdog opens
  // the gate regardless. markHydrated() is idempotent.
  const watchdog = setTimeout(markHydrated, HYDRATION_WATCHDOG_MS);

  try {
    let server: Record<string, string>;
    try {
      server = await fetchSettings();
    } catch {
      // Offline / server error: keep using the local cache as-is. The migration
      // marker stays unset so the next load retries the reconciliation.
      return;
    }

    if (isMigrationComplete()) {
      // Steady state: this browser has already reconciled with the DB, so the
      // server is authoritative and deletions made elsewhere propagate.
      if (
        applyServerValues(server, { skipPending: true, removeAbsent: true })
      ) {
        emitSynced();
      }
      return;
    }

    // First reconciliation for THIS browser. The DB may already hold settings —
    // seeded from config.toml on the server, or written by another device — but
    // it does NOT necessarily reflect this browser's localStorage-only values
    // (chat model, presets, personalization, TTS, dashboard, …). Merge instead
    // of letting the server win outright: apply the server's values WITHOUT
    // removeAbsent (so nothing local is deleted), then back up any migrated key
    // the server is missing. Server values win for keys it has, matching the
    // pre-migration runtime behavior where config.toml was authoritative.
    const applied = applyServerValues(server, {
      skipPending: true,
      removeAbsent: false,
    });

    // Only send non-null values — backfill must NEVER delete. A null for a
    // locally-unset key could otherwise wipe a row another device wrote during
    // the migration window.
    const patch: SettingsPatch = {};
    for (const key of MIGRATED_SETTING_KEYS) {
      if (key in server) continue; // already applied from the server above
      const value = readRaw(key);
      if (value !== null) patch[key] = value; // local-only → preserve it
    }

    if (Object.keys(patch).length > 0) {
      try {
        await patchSettings(patch);
      } catch {
        // Couldn't upload this browser's local-only values. Leave the marker
        // unset so the next load retries BEFORE the server is ever allowed to
        // delete keys it doesn't have (resync is gated on the marker too).
        if (applied) emitSynced();
        return;
      }
    }

    // Reconciliation succeeded: the DB now reflects this browser's settings, so
    // future loads/resyncs may treat the server as authoritative.
    markMigrationComplete();
    if (applied || Object.keys(patch).length > 0) emitSynced();
  } finally {
    clearTimeout(watchdog);
    // Signal completion on every exit path (including offline) so
    // hydration-gated consumers unblock and never permanently withhold writes.
    markHydrated();
  }
}

// Re-sync state: a throttle so a burst of focus/visibility events does at most
// one fetch, and a single-flight guard.
let lastResync = 0;
let resyncInFlight = false;
const RESYNC_MIN_INTERVAL_MS = 2_000;

/**
 * Re-pull the DB settings into the local cache after initial hydration, so a
 * long-lived tab picks up changes another device made. Throttled and
 * single-flight; a no-op until the first hydration has completed. Skips keys
 * with an unflushed local write so it never clobbers a pending local change.
 */
export async function resyncSettingsFromDb() {
  // Gated on the migration marker as well: until this browser has reconciled its
  // local-only settings up to the DB, a removeAbsent resync could delete keys the
  // server doesn't have yet (e.g. a backfill that failed on first hydration).
  if (
    typeof window === 'undefined' ||
    !settingsHydrated ||
    !isMigrationComplete() ||
    resyncInFlight
  ) {
    return;
  }
  const now = Date.now();
  if (now - lastResync < RESYNC_MIN_INTERVAL_MS) return;
  resyncInFlight = true;
  try {
    let server: Record<string, string>;
    try {
      server = await fetchSettings();
    } catch {
      return; // Offline / transient error: keep the local cache as-is.
    }
    lastResync = Date.now();
    if (applyServerValues(server, { skipPending: true, removeAbsent: true })) {
      emitSynced();
    }
  } finally {
    resyncInFlight = false;
  }
}
