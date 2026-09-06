import type { openaiCompatibleProviders } from '@/lib/db/schema';
import {
  decryptHeaderValues,
  getSecretHeaderNames,
  validateSecretHeaders,
} from '@/lib/http/secretHeaders';

export type OpenAICompatibleProviderRow =
  typeof openaiCompatibleProviders.$inferSelect;
export type OpenAICompatibleProviderInsert =
  typeof openaiCompatibleProviders.$inferInsert;

export type OpenAICompatibleProviderRuntime = Omit<
  OpenAICompatibleProviderRow,
  'headers'
> & {
  headers: Record<string, string>;
};

export type RedactedOpenAICompatibleProvider = Omit<
  OpenAICompatibleProviderRow,
  'headers'
> & {
  headerNames: string[];
};

export interface CreateOpenAICompatibleProviderInput {
  name: string;
  baseUrl: string;
  enabled?: boolean;
  supportsEmbeddings?: boolean;
  headers?: Record<string, string>;
}

export interface PatchOpenAICompatibleProviderInput {
  name?: string;
  baseUrl?: string;
  enabled?: boolean;
  supportsEmbeddings?: boolean;
  headersPatch?: Record<string, string | null>;
}

export const OPENAI_COMPATIBLE_PROVIDER_KEY_PREFIX = 'openai-compatible:';

export function openAICompatibleProviderKey(id: string): string {
  return `${OPENAI_COMPATIBLE_PROVIDER_KEY_PREFIX}${id}`;
}

export const getOpenAICompatibleProviderKey = openAICompatibleProviderKey;

export class OpenAICompatibleProviderValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenAICompatibleProviderValidationError';
  }
}

export class OpenAICompatibleProviderConflictError extends Error {
  constructor(message = 'A provider with that name already exists') {
    super(message);
    this.name = 'OpenAICompatibleProviderConflictError';
  }
}

export function normalizeOpenAICompatibleProviderName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new OpenAICompatibleProviderValidationError('name is required');
  }
  const name = value.trim();
  if (!name) {
    throw new OpenAICompatibleProviderValidationError('name is required');
  }
  if (name.length > 100) {
    throw new OpenAICompatibleProviderValidationError(
      'name exceeds the maximum length',
    );
  }
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    throw new OpenAICompatibleProviderValidationError(
      'name contains control characters',
    );
  }
  return name;
}

export function normalizeOpenAICompatibleProviderNameKey(name: string): string {
  return normalizeOpenAICompatibleProviderName(name).toLowerCase();
}

export function normalizeOpenAICompatibleBaseUrl(value: unknown): string {
  if (typeof value !== 'string') {
    throw new OpenAICompatibleProviderValidationError('baseUrl is required');
  }
  const raw = value.trim();
  if (!raw) {
    throw new OpenAICompatibleProviderValidationError('baseUrl is required');
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new OpenAICompatibleProviderValidationError(
      'baseUrl is not a valid URL',
    );
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new OpenAICompatibleProviderValidationError(
      'baseUrl must use http or https',
    );
  }

  const authority = raw.match(/^[a-z][a-z\d+.-]*:\/\/([^/?#]*)/i)?.[1] ?? '';
  if (parsed.username || parsed.password || authority.includes('@')) {
    throw new OpenAICompatibleProviderValidationError(
      'baseUrl must not contain userinfo',
    );
  }
  if (parsed.search || parsed.hash || raw.includes('?') || raw.includes('#')) {
    throw new OpenAICompatibleProviderValidationError(
      'baseUrl must not contain a query or fragment',
    );
  }

  const pathname = parsed.pathname.replace(/\/+$/, '');
  if (pathname !== '' && pathname !== '/v1') {
    throw new OpenAICompatibleProviderValidationError(
      'baseUrl must be an HTTP(S) root or end in /v1',
    );
  }

  return `${parsed.origin}/v1`;
}

export function validateOpenAICompatibleHeaders(
  value: unknown,
  { allowNull = false }: { allowNull?: boolean } = {},
): string | null {
  return validateSecretHeaders(value, { allowNull });
}

export function redactOpenAICompatibleProvider(
  row: OpenAICompatibleProviderRow,
): RedactedOpenAICompatibleProvider {
  const { headers: _headers, ...rest } = row;
  return { ...rest, headerNames: getSecretHeaderNames(row.headers) };
}

export function hydrateOpenAICompatibleProvider(
  row: OpenAICompatibleProviderRow,
): OpenAICompatibleProviderRuntime {
  return {
    ...row,
    headers: decryptHeaderValues(row.headers, `headers for provider ${row.id}`),
  };
}

export type CompatibleModelDescriptor = {
  id: string;
  name?: string;
};
