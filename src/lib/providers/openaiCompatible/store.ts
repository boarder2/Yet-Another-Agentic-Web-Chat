import 'server-only';

import { asc, eq, sql } from 'drizzle-orm';
import db from '@/lib/db';
import { openaiCompatibleProviders } from '@/lib/db/schema';
import {
  encryptHeaderPatch,
  encryptHeaderValues,
  hasNonEmptySecretHeaderValue,
  validateSecretHeaders,
} from '@/lib/http/secretHeaders';
import { EncryptionNotConfiguredError } from '@/lib/encryption';
import {
  hydrateOpenAICompatibleProvider,
  normalizeOpenAICompatibleBaseUrl,
  normalizeOpenAICompatibleProviderName,
  normalizeOpenAICompatibleProviderNameKey,
  redactOpenAICompatibleProvider,
  OpenAICompatibleProviderConflictError,
  OpenAICompatibleProviderValidationError,
  type CreateOpenAICompatibleProviderInput,
  type OpenAICompatibleProviderRow,
  type OpenAICompatibleProviderRuntime,
  type PatchOpenAICompatibleProviderInput,
  type RedactedOpenAICompatibleProvider,
} from './types';

function validateHeaders(
  headers: unknown,
  options: { allowNull?: boolean } = {},
): void {
  const error = validateSecretHeaders(headers, options);
  if (error) throw new OpenAICompatibleProviderValidationError(error);
}

function nonEmptyHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> {
  if (!headers) return {};
  return Object.fromEntries(
    Object.entries(headers).filter(([, value]) => value.length > 0),
  );
}

function nonEmptyHeaderPatch(
  patch: Record<string, string | null>,
): Record<string, string | null> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value === null || value !== ''),
  );
}

function buildHeaderPatchExpression(patch: Record<string, string | null>) {
  const lowerNames = Object.keys(patch).map((name) => name.toLowerCase());
  // Filter the current column inside the UPDATE rather than using the row read
  // above. SQLite serializes writers, so concurrent patches each remove every
  // current case variant before applying their own value.
  const withoutPatchedNames = sql`(
    SELECT json_group_object(header.key, header.value)
    FROM json_each(coalesce(${openaiCompatibleProviders.headers}, '{}')) AS header
    WHERE lower(header.key) NOT IN (${sql.join(
      lowerNames.map((name) => sql`${name}`),
      sql`, `,
    )})
  )`;

  return sql`json_patch(${withoutPatchedNames}, ${JSON.stringify(
    encryptHeaderPatch(patch),
  )})`;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Error && error.message.toLowerCase().includes('unique')
  );
}

function throwStoreError(error: unknown): never {
  if (isUniqueConstraintError(error)) {
    throw new OpenAICompatibleProviderConflictError();
  }
  throw error;
}

function encryptHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  if (Object.keys(headers).length === 0) return {};
  try {
    return encryptHeaderValues(headers);
  } catch (error) {
    if (error instanceof EncryptionNotConfiguredError) throw error;
    throw error;
  }
}

export async function listOpenAICompatibleProviders(): Promise<
  OpenAICompatibleProviderRow[]
> {
  return db
    .select()
    .from(openaiCompatibleProviders)
    .orderBy(asc(openaiCompatibleProviders.normalizedName));
}

export async function listEnabledOpenAICompatibleProviders(): Promise<
  OpenAICompatibleProviderRow[]
> {
  return db
    .select()
    .from(openaiCompatibleProviders)
    .where(eq(openaiCompatibleProviders.enabled, true))
    .orderBy(asc(openaiCompatibleProviders.normalizedName));
}

export async function getOpenAICompatibleProvider(
  id: string,
): Promise<OpenAICompatibleProviderRow | null> {
  return (
    (await db.query.openaiCompatibleProviders.findFirst({
      where: eq(openaiCompatibleProviders.id, id),
    })) ?? null
  );
}

export async function getOpenAICompatibleProviderRuntime(
  id: string,
): Promise<OpenAICompatibleProviderRuntime | null> {
  const row = await getOpenAICompatibleProvider(id);
  return row ? hydrateOpenAICompatibleProvider(row) : null;
}

export function redactProvider(
  row: OpenAICompatibleProviderRow,
): RedactedOpenAICompatibleProvider {
  return redactOpenAICompatibleProvider(row);
}

export async function createOpenAICompatibleProvider(
  input: CreateOpenAICompatibleProviderInput,
): Promise<OpenAICompatibleProviderRow> {
  const name = normalizeOpenAICompatibleProviderName(input.name);
  const normalizedName = normalizeOpenAICompatibleProviderNameKey(name);
  const baseUrl = normalizeOpenAICompatibleBaseUrl(input.baseUrl);
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') {
    throw new OpenAICompatibleProviderValidationError(
      'enabled must be a boolean',
    );
  }
  if (
    input.supportsEmbeddings !== undefined &&
    typeof input.supportsEmbeddings !== 'boolean'
  ) {
    throw new OpenAICompatibleProviderValidationError(
      'supportsEmbeddings must be a boolean',
    );
  }
  if (input.headers !== undefined) validateHeaders(input.headers);
  const headers = input.headers ?? {};
  const storedHeaders = nonEmptyHeaders(headers);
  const now = new Date();

  try {
    const rows = await db
      .insert(openaiCompatibleProviders)
      .values({
        id: crypto.randomUUID(),
        name,
        normalizedName,
        baseUrl,
        enabled: input.enabled ?? true,
        supportsEmbeddings: input.supportsEmbeddings ?? false,
        headers: encryptHeaders(storedHeaders),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return rows[0];
  } catch (error) {
    throwStoreError(error);
  }
}

export async function updateOpenAICompatibleProvider(
  id: string,
  input: PatchOpenAICompatibleProviderInput,
): Promise<OpenAICompatibleProviderRow | null> {
  const existing = await getOpenAICompatibleProvider(id);
  if (!existing) return null;

  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (input.name !== undefined) {
    const name = normalizeOpenAICompatibleProviderName(input.name);
    updates.name = name;
    updates.normalizedName = normalizeOpenAICompatibleProviderNameKey(name);
  }
  if (input.baseUrl !== undefined) {
    updates.baseUrl = normalizeOpenAICompatibleBaseUrl(input.baseUrl);
  }
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== 'boolean') {
      throw new OpenAICompatibleProviderValidationError(
        'enabled must be a boolean',
      );
    }
    updates.enabled = input.enabled;
  }
  if (input.supportsEmbeddings !== undefined) {
    if (typeof input.supportsEmbeddings !== 'boolean') {
      throw new OpenAICompatibleProviderValidationError(
        'supportsEmbeddings must be a boolean',
      );
    }
    updates.supportsEmbeddings = input.supportsEmbeddings;
  }

  if (input.headersPatch !== undefined) {
    validateHeaders(input.headersPatch, { allowNull: true });
    const patch = nonEmptyHeaderPatch(input.headersPatch);
    if (Object.keys(patch).length > 0) {
      updates.headers = buildHeaderPatchExpression(patch);
    }
  }

  try {
    const rows = await db
      .update(openaiCompatibleProviders)
      .set(updates)
      .where(eq(openaiCompatibleProviders.id, id))
      .returning();
    return rows[0] ?? null;
  } catch (error) {
    throwStoreError(error);
  }
}

export async function deleteOpenAICompatibleProvider(
  id: string,
): Promise<boolean> {
  const result = await db
    .delete(openaiCompatibleProviders)
    .where(eq(openaiCompatibleProviders.id, id))
    .run();
  return result.changes > 0;
}

export { hasNonEmptySecretHeaderValue };
export {
  EncryptionNotConfiguredError,
  OpenAICompatibleProviderConflictError,
  OpenAICompatibleProviderValidationError,
};
