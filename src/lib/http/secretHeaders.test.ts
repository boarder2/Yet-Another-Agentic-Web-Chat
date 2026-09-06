import { afterEach, describe, expect, it, vi } from 'vitest';

import { encrypt } from '@/lib/encryption';
import {
  decryptHeaderValues,
  encryptHeaderPatch,
  encryptHeaderValues,
  getSecretHeaderNames,
  hasNonEmptySecretHeaderValue,
  SECRET_HEADER_VALUE_MAX_BYTES,
  SECRET_HEADERS_MAX_ENTRIES,
  validateSecretHeaders,
} from './secretHeaders';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('validateSecretHeaders', () => {
  it('accepts application headers, including empty values', () => {
    expect(
      validateSecretHeaders({
        Authorization: 'Bearer token',
        'X-API-Key': 'key',
        'X-Empty': '',
      }),
    ).toBeNull();
  });

  it('rejects non-object, array, and non-string payloads', () => {
    expect(validateSecretHeaders(null)).toMatch(/must be an object/);
    expect(validateSecretHeaders(['X-API-Key'])).toMatch(/must be an object/);
    expect(validateSecretHeaders({ 'X-API-Key': 42 })).toMatch(
      /must have a string value/,
    );
  });

  it('rejects duplicate names case-insensitively', () => {
    expect(
      validateSecretHeaders({ Authorization: 'one', authorization: 'two' }),
    ).toMatch(/duplicate header name/);
  });

  it('rejects reserved, invalid, and transport-controlled names', () => {
    expect(validateSecretHeaders(JSON.parse('{"__proto__":"value"}'))).toMatch(
      /invalid header name/,
    );
    expect(validateSecretHeaders({ 'bad name': 'value' })).toMatch(
      /invalid header name/,
    );
    expect(validateSecretHeaders({ Host: 'example.com' })).toMatch(
      /controlled by the transport/,
    );
  });

  it('rejects control characters and oversized values', () => {
    expect(
      validateSecretHeaders({ 'X-Key': 'value\r\nInjected: yes' }),
    ).toMatch(/control characters/);
    expect(
      validateSecretHeaders({
        'X-Key': 'x'.repeat(SECRET_HEADER_VALUE_MAX_BYTES + 1),
      }),
    ).toMatch(/exceeds the maximum size/);
  });

  it('enforces entry and serialized-map limits', () => {
    const tooMany = Object.fromEntries(
      Array.from({ length: SECRET_HEADERS_MAX_ENTRIES + 1 }, (_, index) => [
        `X-${index}`,
        'value',
      ]),
    );
    expect(validateSecretHeaders(tooMany)).toMatch(/too many entries/);

    const tooLarge = Object.fromEntries(
      Array.from({ length: SECRET_HEADERS_MAX_ENTRIES }, (_, index) => [
        `X-${index}`,
        'x'.repeat(1_500),
      ]),
    );
    expect(validateSecretHeaders(tooLarge)).toMatch(/exceeds the maximum size/);
  });

  it('allows null only for deletion patches', () => {
    expect(validateSecretHeaders({ 'X-Key': null })).toMatch(
      /must have a string value/,
    );
    expect(
      validateSecretHeaders({ 'X-Key': null }, { allowNull: true }),
    ).toBeNull();
  });
});

describe('secret header encryption boundaries', () => {
  it('encrypts and decrypts values independently without changing names', () => {
    const encrypted = encryptHeaderValues({
      Authorization: 'Bearer secret',
      'X-API-Key': 'api-secret',
    });

    expect(encrypted).toHaveProperty('Authorization');
    expect(encrypted).toHaveProperty('X-API-Key');
    expect(encrypted.Authorization).not.toBe('Bearer secret');
    expect(encrypted['X-API-Key']).not.toBe('api-secret');
    expect(decryptHeaderValues(encrypted)).toEqual({
      Authorization: 'Bearer secret',
      'X-API-Key': 'api-secret',
    });
  });

  it('preserves null patch deletions while encrypting replacements', () => {
    const patch = encryptHeaderPatch({
      'X-Keep': 'replacement',
      'X-Delete': null,
    });

    expect(patch['X-Keep']).not.toBe('replacement');
    expect(patch['X-Delete']).toBeNull();
  });

  it('drops only an undecryptable stored value', () => {
    const bad = encrypt('bad');
    const last = bad.at(-1);
    const tampered = `${bad.slice(0, -1)}${last === '0' ? '1' : '0'}`;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(
      decryptHeaderValues({
        Bad: tampered,
        Good: encrypt('still usable'),
      }),
    ).toEqual({ Good: 'still usable' });
    expect(error).toHaveBeenCalledOnce();
  });
});

describe('secret header metadata helpers', () => {
  it('returns names without values and detects only non-empty strings', () => {
    const headers = { 'X-Empty': '', 'X-Key': 'secret' };

    expect(getSecretHeaderNames(headers)).toEqual(['X-Empty', 'X-Key']);
    expect(JSON.stringify(getSecretHeaderNames(headers))).not.toContain(
      'secret',
    );
    expect(hasNonEmptySecretHeaderValue(headers)).toBe(true);
    expect(hasNonEmptySecretHeaderValue({ 'X-Empty': '' })).toBe(false);
    expect(hasNonEmptySecretHeaderValue({ 'X-Null': null })).toBe(false);
  });
});
