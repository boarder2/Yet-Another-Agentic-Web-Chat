import 'server-only';

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'crypto';
import { getEncryptionPassphrase } from '@/lib/config';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const ENCRYPTED_PATTERN = /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/i;
const KEY_LENGTH = 32; // 256-bit AES key

// Fixed, non-secret KDF salt. Not generated or stored anywhere — its only job
// is to bind the derived key to this app rather than a generic wordlist; all
// the actual secrecy comes from the user-supplied passphrase. There is
// deliberately no auto-generated key material of any kind: if the user hasn't
// set SECURITY.ENCRYPTION_PASSPHRASE, there is no key, full stop.
const KDF_SALT = 'yaawc-credential-encryption-v1';

/** Thrown when `SECURITY.ENCRYPTION_PASSPHRASE` is not configured. */
export class EncryptionNotConfiguredError extends Error {
  constructor() {
    super(
      'No encryption passphrase configured. Set SECURITY.ENCRYPTION_PASSPHRASE in config.toml.',
    );
    this.name = 'EncryptionNotConfiguredError';
  }
}

/** Whether a usable encryption passphrase is configured. Never exposes the passphrase itself. */
export function isEncryptionConfigured(): boolean {
  return !!getEncryptionPassphrase();
}

// Deriving via scrypt is deliberately slow; cache the derived key for the life
// of the process so every encrypt/decrypt call isn't paying that cost. Keyed
// by the raw passphrase so an in-place config.toml edit + restart (the only
// way the passphrase can change) always re-derives correctly.
let cachedKey: { passphrase: string; key: Buffer } | null = null;

function getKeyBuffer(): Buffer {
  const passphrase = getEncryptionPassphrase();
  if (!passphrase) {
    throw new EncryptionNotConfiguredError();
  }
  if (cachedKey !== null && cachedKey.passphrase === passphrase) {
    return cachedKey.key;
  }
  const key = scryptSync(passphrase, KDF_SALT, KEY_LENGTH);
  cachedKey = { passphrase, key };
  return key;
}

/** Encrypt a plaintext string, returning `ivHex:authTagHex:ciphertextHex`. */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKeyBuffer(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

/** Decrypt a payload produced by `encrypt()`. Throws if malformed or tampered. */
export function decrypt(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted payload');
  }
  const [ivHex, authTagHex, ciphertextHex] = parts;
  const decipher = createDecipheriv(
    ALGORITHM,
    getKeyBuffer(),
    Buffer.from(ivHex, 'hex'),
  );
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, 'hex')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

/** Whether a value matches the `ivHex:authTagHex:ciphertextHex` encrypted format. */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && ENCRYPTED_PATTERN.test(value);
}

/**
 * Best-effort decrypt: returns `null` (rather than throwing) if the payload is
 * malformed or the passphrase has changed since it was encrypted, logging once
 * with `label` for context. Callers treat `null` as "unset" so a single stale
 * secret can't take down a whole request.
 */
export function tryDecrypt(value: string, label: string): string | null {
  try {
    return decrypt(value);
  } catch (err) {
    console.error(
      `[encryption] Failed to decrypt ${label} — the encryption passphrase may have changed since it was saved. Treating as unset.`,
      err,
    );
    return null;
  }
}

/**
 * Decrypt a value that may predate encryption-at-rest: encrypted values are
 * decrypted (or `null` if decryption fails — see `tryDecrypt`), legacy plaintext
 * (not yet caught by the boot migrations) passes through unchanged, and
 * null/empty in yields `null`. Lets read paths handle both storage eras.
 */
export function decryptTolerant(
  value: string | null | undefined,
  label: string,
): string | null {
  if (!value) return null;
  return isEncrypted(value) ? tryDecrypt(value, label) : value;
}
