import { describe, expect, it } from 'vitest';

import { encrypt } from '@/lib/encryption';
import {
  hydrateOpenAICompatibleProvider,
  normalizeOpenAICompatibleBaseUrl,
  normalizeOpenAICompatibleProviderName,
  normalizeOpenAICompatibleProviderNameKey,
  openAICompatibleProviderKey,
  OpenAICompatibleProviderValidationError,
  redactOpenAICompatibleProvider,
  type OpenAICompatibleProviderRow,
} from './types';

const provider = (
  overrides: Partial<OpenAICompatibleProviderRow> = {},
): OpenAICompatibleProviderRow =>
  ({
    id: 'provider-1',
    name: 'Provider',
    normalizedName: 'provider',
    baseUrl: 'https://example.com/v1',
    enabled: true,
    supportsEmbeddings: false,
    headers: {},
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  }) as OpenAICompatibleProviderRow;

function expectValidation(callback: () => unknown, message: RegExp): void {
  expect(callback).toThrowError(OpenAICompatibleProviderValidationError);
  expect(callback).toThrowError(message);
}

describe('OpenAI-compatible provider names and keys', () => {
  it('trims display names and derives case-insensitive uniqueness keys', () => {
    expect(normalizeOpenAICompatibleProviderName('  Local Gateway  ')).toBe(
      'Local Gateway',
    );
    expect(normalizeOpenAICompatibleProviderNameKey('  Local Gateway  ')).toBe(
      'local gateway',
    );
    expect(openAICompatibleProviderKey('provider-1')).toBe(
      'openai-compatible:provider-1',
    );
  });

  it.each([
    ['', /name is required/],
    ['   ', /name is required/],
    ['name\nwith-control', /control characters/],
    ['x'.repeat(101), /maximum length/],
  ])('rejects invalid name %j', (value, message) => {
    expectValidation(
      () => normalizeOpenAICompatibleProviderName(value),
      message,
    );
  });
});

describe('normalizeOpenAICompatibleBaseUrl', () => {
  it.each([
    ['https://example.com', 'https://example.com/v1'],
    ['https://example.com/', 'https://example.com/v1'],
    ['https://example.com/v1', 'https://example.com/v1'],
    ['https://example.com/v1/', 'https://example.com/v1'],
    ['HTTP://EXAMPLE.COM/', 'http://example.com/v1'],
  ])('canonicalizes %s', (value, expected) => {
    expect(normalizeOpenAICompatibleBaseUrl(value)).toBe(expected);
  });

  it.each([
    ['not a URL', /not a valid URL/],
    ['ftp://example.com', /must use http or https/],
    ['https://user:pass@example.com', /must not contain userinfo/],
    ['https://example.com/v1?token=secret', /query or fragment/],
    ['https://example.com/v1#fragment', /query or fragment/],
    ['https://example.com/api', /root or end in \/v1/],
  ])('rejects %s', (value, message) => {
    expectValidation(() => normalizeOpenAICompatibleBaseUrl(value), message);
  });
});

describe('provider redaction and hydration', () => {
  it('returns header names only and decrypts values only at the runtime boundary', () => {
    const row = provider({
      headers: {
        Authorization: encrypt('Bearer secret'),
        'X-API-Key': encrypt('api-secret'),
      },
    });

    const redacted = redactOpenAICompatibleProvider(row);
    expect(redacted.headerNames).toEqual(['Authorization', 'X-API-Key']);
    expect(redacted).not.toHaveProperty('headers');
    expect(JSON.stringify(redacted)).not.toContain('secret');

    expect(hydrateOpenAICompatibleProvider(row).headers).toEqual({
      Authorization: 'Bearer secret',
      'X-API-Key': 'api-secret',
    });
  });
});
