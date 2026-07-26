import { describe, it, expect } from 'vitest';

import {
  buildRequestInit,
  encryptHeaderPatch,
  parseExtraHeaders,
  redactServer,
  validateExtraHeaders,
  type McpServerRow,
} from './types';

/**
 * Minimal row factory. Header values are left as plaintext —
 * `decryptTolerant` passes non-encrypted values straight through, so these
 * tests exercise the parsing/merging logic without a passphrase.
 */
const row = (overrides: Partial<McpServerRow> = {}): McpServerRow =>
  ({
    id: 'srv-1',
    name: 'Test',
    url: 'https://example.com/mcp',
    transport: 'auto',
    resolvedTransport: null,
    authType: 'none',
    enabled: true,
    toolConfig: null,
    visibleInGeneralChat: false,
    headerName: null,
    secretToken: null,
    extraHeaders: null,
    oauthClientId: null,
    oauthClientSecret: null,
    oauthScope: null,
    lastConnectedAt: null,
    status: 'unknown',
    lastError: null,
    authFailureUntil: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  }) as McpServerRow;

describe('parseExtraHeaders', () => {
  it('returns {} when unset', () => {
    expect(parseExtraHeaders(row())).toEqual({});
  });

  it('parses a JSON map', () => {
    const r = row({ extraHeaders: { 'X-Api-Key': 'abc' } });
    expect(parseExtraHeaders(r)).toEqual({ 'X-Api-Key': 'abc' });
  });

  it('degrades to {} on a non-object column rather than throwing', () => {
    expect(
      parseExtraHeaders(
        row({ extraHeaders: 'not an object' as unknown as never }),
      ),
    ).toEqual({});
  });

  it('drops non-string values and rejects arrays', () => {
    expect(
      parseExtraHeaders(
        row({ extraHeaders: { a: 1, b: 'ok' } as unknown as never }),
      ),
    ).toEqual({ b: 'ok' });
    expect(
      parseExtraHeaders(row({ extraHeaders: ['a'] as unknown as never })),
    ).toEqual({});
  });
});

describe('encryptHeaderPatch', () => {
  it('preserves nulls so RFC 7386 deletion survives encryption', () => {
    const out = encryptHeaderPatch({ 'X-Keep': 'v', 'X-Drop': null });
    expect(out['X-Drop']).toBeNull();
    // The kept value is transformed, not passed through in the clear.
    expect(out['X-Keep']).not.toBe('v');
  });
});

describe('validateExtraHeaders patch mode', () => {
  it('rejects a null value by default', () => {
    expect(validateExtraHeaders({ a: null })).toMatch(/string value/);
  });

  it('accepts a null value when deletions are allowed', () => {
    expect(validateExtraHeaders({ a: null }, { allowNull: true })).toBeNull();
  });

  it('still rejects bad names and CRLF in patch mode', () => {
    expect(
      validateExtraHeaders({ 'bad name': null }, { allowNull: true }),
    ).toMatch(/invalid header name/);
    expect(validateExtraHeaders({ a: 'x\r\ny' }, { allowNull: true })).toMatch(
      /control characters/,
    );
  });
});

describe('buildRequestInit', () => {
  it('returns undefined when there is nothing to send', () => {
    expect(buildRequestInit(row())).toBeUndefined();
  });

  it('builds a Bearer header for authType bearer', () => {
    const r = row({ authType: 'bearer', secretToken: 'tok' });
    expect(buildRequestInit(r)).toEqual({
      requestInit: { headers: { Authorization: 'Bearer tok' } },
    });
  });

  it('uses a custom header name verbatim, without the Bearer prefix', () => {
    const r = row({
      authType: 'bearer',
      headerName: 'X-Api-Key',
      secretToken: 'tok',
    });
    expect(buildRequestInit(r)).toEqual({
      requestInit: { headers: { 'X-Api-Key': 'tok' } },
    });
  });

  it('sends extra headers even when authType is none', () => {
    const r = row({ extraHeaders: { 'X-Api-Key': 'abc' } });
    expect(buildRequestInit(r)).toEqual({
      requestInit: { headers: { 'X-Api-Key': 'abc' } },
    });
  });

  it('combines a bearer gate token with a second credential header', () => {
    const r = row({
      authType: 'bearer',
      secretToken: 'gate',
      extraHeaders: { 'X-Portainer-API-Key': 'ptr_1' },
    });
    expect(buildRequestInit(r)).toEqual({
      requestInit: {
        headers: {
          Authorization: 'Bearer gate',
          'X-Portainer-API-Key': 'ptr_1',
        },
      },
    });
  });

  it('lets an extra header override the auth header on conflict', () => {
    const r = row({
      authType: 'bearer',
      secretToken: 'gate',
      extraHeaders: { Authorization: 'Custom xyz' },
    });
    expect(buildRequestInit(r)?.requestInit.headers).toEqual({
      Authorization: 'Custom xyz',
    });
  });
});

describe('redactServer', () => {
  it('exposes header names but never values', () => {
    const r = row({
      secretToken: 'tok',
      extraHeaders: { 'X-Api-Key': 'super-secret' },
    });
    const sanitized = redactServer(r);
    expect(sanitized.extraHeaderNames).toEqual(['X-Api-Key']);
    expect(sanitized.hasToken).toBe(true);
    expect(JSON.stringify(sanitized)).not.toContain('super-secret');
    expect(JSON.stringify(sanitized)).not.toContain('tok');
  });
});

describe('validateExtraHeaders', () => {
  it('accepts a flat string map', () => {
    expect(validateExtraHeaders({ 'X-Api-Key': 'abc' })).toBeNull();
  });

  it('rejects non-objects and arrays', () => {
    expect(validateExtraHeaders('x')).toMatch(/must be an object/);
    expect(validateExtraHeaders(['x'])).toMatch(/must be an object/);
    expect(validateExtraHeaders(null)).toMatch(/must be an object/);
  });

  it('rejects non-string values', () => {
    expect(validateExtraHeaders({ a: 1 })).toMatch(/string value/);
  });

  it('rejects CRLF in values, which could smuggle a second header', () => {
    expect(validateExtraHeaders({ a: 'x\r\nEvil: 1' })).toMatch(
      /control characters/,
    );
    expect(validateExtraHeaders({ a: 'x\n' })).toMatch(/control characters/);
  });

  it('rejects header names outside the RFC 7230 token grammar', () => {
    expect(validateExtraHeaders({ 'bad name': 'v' })).toMatch(
      /invalid header name/,
    );
    expect(validateExtraHeaders({ 'a:b': 'v' })).toMatch(/invalid header name/);
  });

  it('rejects prototype-polluting keys', () => {
    // Built via JSON.parse, which creates a real own "__proto__" key — an
    // object literal would set the prototype instead. This is the shape an API
    // request body actually arrives in.
    expect(validateExtraHeaders(JSON.parse('{"__proto__":"v"}'))).toMatch(
      /invalid header name/,
    );
  });

  it('rejects more entries than the cap', () => {
    const many = Object.fromEntries(
      Array.from({ length: 51 }, (_, i) => [`H${i}`, 'v']),
    );
    expect(validateExtraHeaders(many)).toMatch(/too many entries/);
  });
});
