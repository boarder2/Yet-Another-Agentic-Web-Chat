import 'server-only';

import db from '@/lib/db';
import { credentials } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  encrypt,
  tryDecrypt,
  isEncryptionConfigured,
  EncryptionNotConfiguredError,
} from '@/lib/encryption';
import { readLegacyCredentialsConfig } from '@/lib/config';

/** The 9 active provider/search API keys stored encrypted in the `credentials` table. */
export const CREDENTIAL_KEYS = [
  'model.openai',
  'model.anthropic',
  'model.gemini',
  'model.deepseek',
  'model.openrouter',
  'model.customOpenai',
  'search.braveSearch',
  'search.braveLLM',
  'search.mojeek',
] as const;

export type CredentialKey = (typeof CREDENTIAL_KEYS)[number];

/** Credential rows retired with their providers; removed directly at startup. */
export const RETIRED_CREDENTIAL_KEYS = ['model.groq', 'model.aimlapi'] as const;

/**
 * Read + decrypt a credential. Returns `''` if no row exists, if no
 * encryption passphrase is configured, or if decryption fails (e.g. the
 * passphrase was changed since this credential was encrypted) — callers use
 * this the same way as "no key set" to decide provider availability, so these
 * all degrade to "nothing configured" rather than throwing on every read (a
 * single stale credential must not take down the whole config route). The
 * distinct "not configured at all" state is surfaced separately via
 * `isEncryptionConfigured()` (see `GET /api/config`'s `encryptionConfigured`).
 */
export function getCredential(key: CredentialKey): string {
  if (!isEncryptionConfigured()) return '';
  const row = db
    .select({ value: credentials.value })
    .from(credentials)
    .where(eq(credentials.key, key))
    .get();
  if (!row) return '';
  return tryDecrypt(row.value, `credential '${key}'`) ?? '';
}

/**
 * Encrypt + upsert a credential; deletes the row if `plaintext` is null/empty.
 * Throws `EncryptionNotConfiguredError` if no passphrase is set — callers
 * (Settings UI write routes) must check `isEncryptionConfigured()` first and
 * refuse the write with a clear error rather than let this throw.
 */
export function setCredential(key: CredentialKey, plaintext: string | null) {
  if (!plaintext) {
    db.delete(credentials).where(eq(credentials.key, key)).run();
    return;
  }
  if (!isEncryptionConfigured()) {
    throw new EncryptionNotConfiguredError();
  }
  const value = encrypt(plaintext);
  db.insert(credentials)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: credentials.key,
      set: { value, updatedAt: new Date() },
    })
    .run();
}

/** Remove credential rows for providers no longer supported by the application. */
export function purgeRetiredCredentials(): void {
  for (const key of RETIRED_CREDENTIAL_KEYS) {
    db.delete(credentials).where(eq(credentials.key, key)).run();
  }
}

/**
 * One-time migration: copy any legacy plaintext config.toml credential into the
 * encrypted `credentials` table. Idempotent by checking DB presence (not
 * config.toml), so a key later cleared via Settings is never re-seeded from a
 * stale config.toml value on a future boot. Invoked from `instrumentation.ts`.
 */
export function migrateLegacyCredentials(): void {
  const legacy = readLegacyCredentialsConfig();
  const keys = Object.keys(legacy) as CredentialKey[];
  if (keys.length === 0) return;

  const existing = new Set(
    db
      .select({ key: credentials.key })
      .from(credentials)
      .all()
      .map((row) => row.key),
  );

  const toMigrate = keys.filter((key) => !existing.has(key));
  if (toMigrate.length === 0) return;

  for (const key of toMigrate) {
    setCredential(key, legacy[key]);
  }

  console.log(
    `[credentials] Migrated ${toMigrate.length} legacy credential(s) from config.toml into the database: ${toMigrate.join(', ')}`,
  );
}
