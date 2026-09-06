import { NextRequest, NextResponse } from 'next/server';
import {
  hasNonEmptySecretHeaderValue,
  validateSecretHeaders,
} from '@/lib/http/secretHeaders';
import {
  createOpenAICompatibleProvider,
  listOpenAICompatibleProviders,
  redactProvider,
} from '@/lib/providers/openaiCompatible/store';
import { invalidateOpenAICompatibleProviderDiscovery } from '@/lib/providers/openaiCompatible/client';
import { invalidateModelCache } from '@/lib/providers/modelCache';
import { openAICompatibleProviderKey } from '@/lib/providers/openaiCompatible/types';
import {
  normalizeOpenAICompatibleBaseUrl,
  normalizeOpenAICompatibleProviderName,
  OpenAICompatibleProviderConflictError,
  OpenAICompatibleProviderValidationError,
} from '@/lib/providers/openaiCompatible/types';
import {
  EncryptionNotConfiguredError,
  isEncryptionConfigured,
} from '@/lib/encryption';

export const runtime = 'nodejs';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readObject(req: NextRequest): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new OpenAICompatibleProviderValidationError(
      'Request body must be a JSON object',
    );
  }
  if (!isObject(body)) {
    throw new OpenAICompatibleProviderValidationError(
      'Request body must be a JSON object',
    );
  }
  return body;
}

function validateBoolean(body: Record<string, unknown>, field: string): void {
  if (field in body && typeof body[field] !== 'boolean') {
    throw new OpenAICompatibleProviderValidationError(
      `${field} must be a boolean`,
    );
  }
}

function validateCreateBody(body: Record<string, unknown>): void {
  if (typeof body.name !== 'string') {
    throw new OpenAICompatibleProviderValidationError('name is required');
  }
  if (typeof body.baseUrl !== 'string') {
    throw new OpenAICompatibleProviderValidationError('baseUrl is required');
  }
  normalizeOpenAICompatibleProviderName(body.name);
  normalizeOpenAICompatibleBaseUrl(body.baseUrl);
  validateBoolean(body, 'enabled');
  validateBoolean(body, 'supportsEmbeddings');
  if (body.headers !== undefined) {
    const error = validateSecretHeaders(body.headers);
    if (error) throw new OpenAICompatibleProviderValidationError(error);
  }
}

function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof OpenAICompatibleProviderValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof OpenAICompatibleProviderConflictError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof EncryptionNotConfiguredError) {
    return NextResponse.json(
      {
        error:
          'No encryption passphrase configured. Set SECURITY.ENCRYPTION_PASSPHRASE in config.toml before saving provider headers.',
      },
      { status: 503 },
    );
  }
  console.error('Failed to handle OpenAI-compatible provider request:', error);
  return NextResponse.json(
    { error: 'Failed to handle OpenAI-compatible provider request' },
    { status: 500 },
  );
}

export async function GET() {
  try {
    const providers = await listOpenAICompatibleProviders();
    return NextResponse.json({ providers: providers.map(redactProvider) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await readObject(req);
    validateCreateBody(body);

    const headers = body.headers as Record<string, string> | undefined;
    if (
      headers &&
      hasNonEmptySecretHeaderValue(headers) &&
      !isEncryptionConfigured()
    ) {
      throw new EncryptionNotConfiguredError();
    }

    const provider = await createOpenAICompatibleProvider({
      name: body.name as string,
      baseUrl: body.baseUrl as string,
      enabled: body.enabled as boolean | undefined,
      supportsEmbeddings: body.supportsEmbeddings as boolean | undefined,
      headers,
    });
    try {
      invalidateOpenAICompatibleProviderDiscovery();
      invalidateModelCache(openAICompatibleProviderKey(provider.id));
    } catch {
      // Cache invalidation is best-effort; the persisted provider is already saved.
    }
    return NextResponse.json(
      { provider: redactProvider(provider) },
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
