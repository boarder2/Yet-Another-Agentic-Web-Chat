import 'server-only';

import { decryptTolerant, encrypt } from '@/lib/encryption';

export const SECRET_HEADERS_MAX_ENTRIES = 50;
export const SECRET_HEADER_NAME_MAX_LENGTH = 256;
export const SECRET_HEADER_VALUE_MAX_BYTES = 16 * 1024;
export const SECRET_HEADERS_MAX_BYTES = 64 * 1024;

const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const BLOCKED_HEADER_NAMES = new Set([
  'connection',
  'content-length',
  'expect',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
const RESERVED_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

type SecretHeaderValue = string | null;

export type SecretHeaderPatch = Record<string, SecretHeaderValue>;

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

/** Return the own header names in a stored JSON map without exposing values. */
export function getSecretHeaderNames(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [];
  }
  return Object.keys(value as Record<string, unknown>);
}

/** Whether a header payload contains a value that must be encrypted. */
export function hasNonEmptySecretHeaderValue(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value as Record<string, unknown>).some(
    (entry) => typeof entry === 'string' && entry.length > 0,
  );
}

/**
 * Validate a flat header map. Strict consumers get bounded, case-insensitive
 * names and transport-owned-name checks; PATCH payloads may use null to delete
 * an entry. Legacy consumers can opt out of the stricter additions.
 */
export function validateSecretHeaders(
  value: unknown,
  {
    allowNull = false,
    fieldName,
    rejectTransportControlledNames = true,
    legacyCompatibility = false,
  }: {
    allowNull?: boolean;
    fieldName?: string;
    rejectTransportControlledNames?: boolean;
    /** Preserve the pre-shared-helper rules for an existing consumer. */
    legacyCompatibility?: boolean;
  } = {},
): string | null {
  const field = fieldName ?? (allowNull ? 'headersPatch' : 'headers');
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return `${field} must be an object`;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > SECRET_HEADERS_MAX_ENTRIES) {
    return `${field} has too many entries (max ${SECRET_HEADERS_MAX_ENTRIES})`;
  }

  if (!legacyCompatibility) {
    let serialized: string;
    try {
      serialized = JSON.stringify(value);
    } catch {
      return `${field} must be a JSON object`;
    }
    if (byteLength(serialized) > SECRET_HEADERS_MAX_BYTES) {
      return `${field} exceeds the maximum size`;
    }
  }

  const seen = new Set<string>();
  for (const [name, headerValue] of entries) {
    const lowerName = name.toLowerCase();
    if (
      (legacyCompatibility
        ? RESERVED_NAMES.has(name)
        : RESERVED_NAMES.has(lowerName)) ||
      (!legacyCompatibility && name.length > SECRET_HEADER_NAME_MAX_LENGTH) ||
      !HEADER_NAME_PATTERN.test(name)
    ) {
      return `invalid header name: ${name}`;
    }
    if (!legacyCompatibility && seen.has(lowerName)) {
      return `duplicate header name: ${name}`;
    }
    seen.add(lowerName);
    if (
      !legacyCompatibility &&
      rejectTransportControlledNames &&
      BLOCKED_HEADER_NAMES.has(lowerName)
    ) {
      return `header name is controlled by the transport: ${name}`;
    }

    if (headerValue === null && allowNull) continue;
    if (typeof headerValue !== 'string') {
      return `header "${name}" must have a string value`;
    }
    const hasControlCharacters = legacyCompatibility
      ? /[\r\n\0]/.test(headerValue)
      : /[\r\n\0\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(
          headerValue,
        );
    if (hasControlCharacters) {
      return `header "${name}" value contains control characters`;
    }
    if (
      !legacyCompatibility &&
      byteLength(headerValue) > SECRET_HEADER_VALUE_MAX_BYTES
    ) {
      return `header "${name}" value exceeds the maximum size`;
    }
  }

  return null;
}

/** Encrypt each header value independently, retaining the map shape in SQLite. */
export function encryptHeaderValues(
  headers: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name, encrypt(value)]),
  );
}

/** Encrypt non-null patch values while preserving null deletion markers. */
export function encryptHeaderPatch(
  patch: SecretHeaderPatch,
): SecretHeaderPatch {
  return Object.fromEntries(
    Object.entries(patch).map(([name, value]) => [
      name,
      value === null ? null : encrypt(value),
    ]),
  );
}

/**
 * Decrypt each value independently. A malformed or stale value is dropped so
 * one unusable header cannot disable the endpoint or its other headers.
 */
export function decryptHeaderValues(
  stored: unknown,
  label = 'secret header',
): Record<string, string> {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
    return {};
  }

  const entries: Array<[string, string]> = [];
  for (const [name, value] of Object.entries(
    stored as Record<string, unknown>,
  )) {
    if (typeof value !== 'string') continue;
    const plain = decryptTolerant(value, `${label} ${name}`);
    if (plain !== null) entries.push([name, plain]);
  }
  return Object.fromEntries(entries);
}
