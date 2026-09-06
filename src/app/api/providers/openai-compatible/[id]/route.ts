import { NextRequest, NextResponse } from 'next/server';
import {
  hasNonEmptySecretHeaderValue,
  validateSecretHeaders,
} from '@/lib/http/secretHeaders';
import {
  deleteOpenAICompatibleProvider,
  getOpenAICompatibleProvider,
  redactProvider,
  updateOpenAICompatibleProvider,
} from '@/lib/providers/openaiCompatible/store';
import {
  normalizeOpenAICompatibleBaseUrl,
  normalizeOpenAICompatibleProviderName,
  OpenAICompatibleProviderConflictError,
  OpenAICompatibleProviderValidationError,
  type PatchOpenAICompatibleProviderInput,
} from '@/lib/providers/openaiCompatible/types';
import {
  EncryptionNotConfiguredError,
  isEncryptionConfigured,
} from '@/lib/encryption';
import { invalidateOpenAICompatibleProviderDiscovery } from '@/lib/providers/openaiCompatible/client';
import { invalidateModelCache } from '@/lib/providers/modelCache';
import { openAICompatibleProviderKey } from '@/lib/providers/openaiCompatible/types';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

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

function parsePatch(
  body: Record<string, unknown>,
): PatchOpenAICompatibleProviderInput {
  validateBoolean(body, 'enabled');
  validateBoolean(body, 'supportsEmbeddings');

  for (const field of ['name', 'baseUrl']) {
    if (field in body && typeof body[field] !== 'string') {
      throw new OpenAICompatibleProviderValidationError(
        `${field} must be a string`,
      );
    }
  }
  if (body.name !== undefined) normalizeOpenAICompatibleProviderName(body.name);
  if (body.baseUrl !== undefined)
    normalizeOpenAICompatibleBaseUrl(body.baseUrl);

  if (body.headersPatch !== undefined) {
    const error = validateSecretHeaders(body.headersPatch, { allowNull: true });
    if (error) throw new OpenAICompatibleProviderValidationError(error);
  }

  return {
    name: body.name as string | undefined,
    baseUrl: body.baseUrl as string | undefined,
    enabled: body.enabled as boolean | undefined,
    supportsEmbeddings: body.supportsEmbeddings as boolean | undefined,
    headersPatch: body.headersPatch as
      Record<string, string | null> | undefined,
  };
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

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  try {
    const provider = await getOpenAICompatibleProvider(id);
    if (!provider)
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ provider: redactProvider(provider) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  try {
    const body = await readObject(req);
    const patch = parsePatch(body);
    if (!(await getOpenAICompatibleProvider(id)))
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const headersPatch = patch.headersPatch;
    if (
      headersPatch &&
      hasNonEmptySecretHeaderValue(headersPatch) &&
      !isEncryptionConfigured()
    ) {
      throw new EncryptionNotConfiguredError();
    }

    const provider = await updateOpenAICompatibleProvider(id, patch);
    if (!provider)
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    try {
      invalidateOpenAICompatibleProviderDiscovery(id);
      invalidateModelCache(openAICompatibleProviderKey(id));
    } catch {
      // Cache invalidation is best-effort; the persisted provider is already saved.
    }
    return NextResponse.json({ provider: redactProvider(provider) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  try {
    const deleted = await deleteOpenAICompatibleProvider(id);
    if (!deleted)
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    try {
      invalidateOpenAICompatibleProviderDiscovery(id);
      invalidateModelCache(openAICompatibleProviderKey(id));
    } catch {
      // Cache invalidation is best-effort; the provider is already deleted.
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
