import 'server-only';

import {
  ChatOpenAI,
  OpenAIEmbeddings,
  type ChatOpenAIFields,
  type ClientOptions,
} from '@langchain/openai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Embeddings } from '@langchain/core/embeddings';
import { decryptHeaderValues } from '@/lib/http/secretHeaders';
import {
  hydrateOpenAICompatibleProvider,
  type CompatibleModelDescriptor,
  type OpenAICompatibleProviderRow,
  type OpenAICompatibleProviderRuntime,
} from './types';

export const OPENAI_COMPATIBLE_DISCOVERY_TIMEOUT_MS = 20_000;

export type OpenAICompatibleDiscoveryErrorKind =
  'timeout' | 'redirect' | 'connection' | 'http' | 'json' | 'shape';

const DISCOVERY_ERROR_MESSAGES: Record<
  OpenAICompatibleDiscoveryErrorKind,
  string
> = {
  timeout: 'Provider discovery timed out',
  redirect: 'Provider discovery rejected a redirect',
  connection: 'Unable to connect to provider',
  http: 'Provider returned an error response',
  json: 'Provider returned invalid JSON',
  shape: 'Provider returned an invalid models response',
};

export class OpenAICompatibleDiscoveryError extends Error {
  constructor(
    public readonly kind: OpenAICompatibleDiscoveryErrorKind,
    message = DISCOVERY_ERROR_MESSAGES[kind],
  ) {
    super(message);
    this.name = 'OpenAICompatibleDiscoveryError';
  }
}

export const CompatibleProviderDiscoveryError = OpenAICompatibleDiscoveryError;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseOpenAICompatibleModels(
  value: unknown,
): CompatibleModelDescriptor[] {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new OpenAICompatibleDiscoveryError('shape');
  }

  const seen = new Set<string>();
  const models: CompatibleModelDescriptor[] = [];
  for (const item of value.data) {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id.trim()) {
      throw new OpenAICompatibleDiscoveryError('shape');
    }
    if (seen.has(item.id)) {
      throw new OpenAICompatibleDiscoveryError('shape');
    }
    if (item.name !== undefined && typeof item.name !== 'string') {
      throw new OpenAICompatibleDiscoveryError('shape');
    }
    seen.add(item.id);
    models.push({
      id: item.id,
      ...(item.name === undefined ? {} : { name: item.name }),
    });
  }
  return models;
}

function cacheSignature(provider: OpenAICompatibleProviderRow): string {
  const updatedAt = provider.updatedAt;
  const timestamp =
    updatedAt instanceof Date
      ? updatedAt.getTime()
      : new Date(updatedAt).getTime();
  return `${provider.id}:${Number.isFinite(timestamp) ? timestamp : String(updatedAt)}`;
}

function buildRequestHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const entries = Object.entries(headers);
  if (!entries.some(([name]) => name.toLowerCase() === 'accept')) {
    entries.push(['Accept', 'application/json']);
  }
  return Object.fromEntries(entries);
}

function isRedirectError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === 'string')
    return error.toLowerCase().includes('redirect');
  if (typeof error !== 'object') return false;
  const candidate = error as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    cause?: unknown;
  };
  const text = [candidate.name, candidate.message, candidate.code]
    .map((value) => String(value ?? ''))
    .join(' ')
    .toLowerCase();
  return (
    text.includes('redirect') ||
    text.includes('und_err_redirect') ||
    isRedirectError(candidate.cause)
  );
}

function isTimeoutError(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: unknown; message?: unknown };
  const name = String(candidate.name ?? '').toLowerCase();
  const message = String(candidate.message ?? '').toLowerCase();
  return (
    name === 'aborterror' ||
    name === 'timeouterror' ||
    message.includes('timed out') ||
    message.includes('timeout')
  );
}

function providerUrl(provider: OpenAICompatibleProviderRuntime): string {
  return `${provider.baseUrl.replace(/\/+$/, '')}/models`;
}

const discoveryCache = new Map<
  string,
  { models: CompatibleModelDescriptor[]; expiresAt: number }
>();
type DiscoveryInFlight = {
  promise: Promise<CompatibleModelDescriptor[]>;
  cacheResult: boolean;
};

const discoveryInFlight = new Map<string, DiscoveryInFlight>();
const DISCOVERY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let discoveryGeneration = 0;
const providerDiscoveryGenerations = new Map<string, number>();

function providerDiscoveryGeneration(id: string): string {
  return `${discoveryGeneration}:${providerDiscoveryGenerations.get(id) ?? 0}`;
}

/** Clear cached discovery for one provider or all compatible providers. */
export function invalidateOpenAICompatibleProviderDiscovery(id?: string): void {
  if (id === undefined) {
    discoveryGeneration += 1;
    discoveryCache.clear();
    discoveryInFlight.clear();
    return;
  }

  providerDiscoveryGenerations.set(
    id,
    (providerDiscoveryGenerations.get(id) ?? 0) + 1,
  );
  for (const key of discoveryCache.keys()) {
    if (key.startsWith(`${id}:`)) discoveryCache.delete(key);
  }
  for (const key of discoveryInFlight.keys()) {
    if (key.startsWith(`${id}:`)) discoveryInFlight.delete(key);
  }
}

function classifyFetchError(
  error: unknown,
  signal: AbortSignal,
): OpenAICompatibleDiscoveryError {
  if (isTimeoutError(error, signal)) {
    return new OpenAICompatibleDiscoveryError('timeout');
  }
  if (isRedirectError(error)) {
    return new OpenAICompatibleDiscoveryError('redirect');
  }
  return new OpenAICompatibleDiscoveryError('connection');
}

async function fetchModels(
  provider: OpenAICompatibleProviderRuntime,
): Promise<CompatibleModelDescriptor[]> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new OpenAICompatibleDiscoveryError('timeout'));
    }, OPENAI_COMPATIBLE_DISCOVERY_TIMEOUT_MS);
  });

  const request = (async () => {
    let response: Response;
    try {
      response = await fetch(providerUrl(provider), {
        method: 'GET',
        headers: buildRequestHeaders(provider.headers),
        redirect: 'error',
        cache: 'no-store',
        signal: controller.signal,
      });
    } catch (error) {
      throw classifyFetchError(error, controller.signal);
    }

    const status = response.status;
    if ((response as Response & { redirected?: boolean }).redirected) {
      throw new OpenAICompatibleDiscoveryError('redirect');
    }
    if (status >= 300 && status < 400) {
      throw new OpenAICompatibleDiscoveryError('redirect');
    }
    const ok =
      typeof response.ok === 'boolean'
        ? response.ok
        : status >= 200 && status < 300;
    if (!ok) throw new OpenAICompatibleDiscoveryError('http');

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      if (controller.signal.aborted) {
        throw new OpenAICompatibleDiscoveryError('timeout');
      }
      throw new OpenAICompatibleDiscoveryError('json');
    }
    return parseOpenAICompatibleModels(body);
  })();

  try {
    return await Promise.race([request, timeoutPromise]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export interface DiscoverOpenAICompatibleModelsOptions {
  forceRefresh?: boolean;
  /** Do not retain a successful result in the process cache. */
  cacheResult?: boolean;
}

/** Discover the standard OpenAI `/v1/models` list for a provider. */
export async function discoverOpenAICompatibleModels(
  provider: OpenAICompatibleProviderRow,
  options: DiscoverOpenAICompatibleModelsOptions = {},
): Promise<CompatibleModelDescriptor[]> {
  const runtime = hydrateOpenAICompatibleProvider(provider);
  const key = cacheSignature(provider);
  const generation = providerDiscoveryGeneration(provider.id);
  const now = Date.now();
  const useCache = options.cacheResult !== false;

  // Join an already-running refresh before consulting an older cached result.
  // This keeps concurrent catalog reads on the same provider revision from
  // observing different discovery generations.
  const existing = discoveryInFlight.get(key);
  if (existing) {
    // A transient Test request may share a fetch already needed by the model
    // catalog. Let any normal catalog waiter retain the successful result.
    if (useCache) existing.cacheResult = true;
    return existing.promise;
  }

  if (!options.forceRefresh && useCache) {
    const cached = discoveryCache.get(key);
    if (cached && cached.expiresAt > now) return cached.models;
    if (cached) discoveryCache.delete(key);
  }

  const entry: DiscoveryInFlight = {
    promise: Promise.resolve([]),
    cacheResult: useCache,
  };
  entry.promise = fetchModels(runtime)
    .then((models) => {
      if (
        entry.cacheResult &&
        providerDiscoveryGeneration(provider.id) === generation
      ) {
        discoveryCache.set(key, {
          models,
          expiresAt: Date.now() + DISCOVERY_CACHE_TTL_MS,
        });
      }
      return models;
    })
    .finally(() => {
      if (discoveryInFlight.get(key) === entry) {
        discoveryInFlight.delete(key);
      }
    });
  discoveryInFlight.set(key, entry);
  return entry.promise;
}

export const discoverCompatibleProviderModels = discoverOpenAICompatibleModels;

export function getDecryptedProviderHeaders(
  provider: OpenAICompatibleProviderRow,
): Record<string, string> {
  return decryptHeaderValues(
    provider.headers,
    `headers for provider ${provider.id}`,
  );
}

const NO_AMBIENT_OPENAI_API_KEY = 'yaawc-compatible-provider';

function configuredHeaderNames(headers: Record<string, string>): Set<string> {
  return new Set(Object.keys(headers).map((name) => name.toLowerCase()));
}

function isChatCompletionsRequest(input: string | URL | Request): boolean {
  const inputUrl =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;

  try {
    return new URL(inputUrl).pathname
      .replace(/\/+$/, '')
      .endsWith('/chat/completions');
  } catch {
    return false;
  }
}

/**
 * Stricter OpenAI-compatible servers reject `name` on non-tool messages.
 * Normalize only the serialized request body; LangChain messages remain intact.
 */
export function normalizeOpenAICompatibleChatBody(
  body: unknown,
): string | undefined {
  if (typeof body !== 'string') return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.messages)) return body;

  let changed = false;
  const messages = parsed.messages.map((message) => {
    if (
      !isRecord(message) ||
      message.role === 'tool' ||
      !Object.prototype.hasOwnProperty.call(message, 'name')
    ) {
      return message;
    }

    changed = true;
    const { name: _name, ...withoutName } = message;
    return withoutName;
  });

  return changed ? JSON.stringify({ ...parsed, messages }) : body;
}

function ambientOpenAICustomHeaders(): Array<[string, string]> {
  const raw = process.env.OPENAI_CUSTOM_HEADERS;
  if (!raw) return [];
  return raw
    .split('\n')
    .map((line) => {
      const separator = line.indexOf(':');
      if (separator < 0) return null;
      return [
        line.slice(0, separator).trim().toLowerCase(),
        line.slice(separator + 1).trim(),
      ] as [string, string];
    })
    .filter(
      (entry): entry is [string, string] => entry !== null && entry[0] !== '',
    );
}

/**
 * OpenAI's client requires an API key even for endpoints that authenticate via
 * arbitrary headers. It also reads OPENAI_* environment variables by default.
 * Use a private sentinel for construction, then remove its generated auth and
 * any ambient organization/project headers before the request leaves YAAWC.
 */
function createProviderFetch(
  headers: Record<string, string>,
): NonNullable<ClientOptions['fetch']> {
  const names = configuredHeaderNames(headers);
  return (async (input, init) => {
    const requestHeaders = new Headers(init?.headers);
    if (!names.has('authorization')) requestHeaders.delete('authorization');
    if (!names.has('openai-organization')) {
      requestHeaders.delete('openai-organization');
    }
    if (!names.has('openai-project')) {
      requestHeaders.delete('openai-project');
    }

    // The OpenAI SDK also imports OPENAI_CUSTOM_HEADERS when no provider is
    // configured. Remove those ambient values unless the endpoint explicitly
    // configured the same header; this keeps an unrelated OpenAI environment
    // from being forwarded to a user-selected endpoint.
    for (const [name] of ambientOpenAICustomHeaders()) {
      if (!names.has(name)) requestHeaders.delete(name);
    }

    // Reapply configured values after the SDK has built its defaults so a
    // provider Authorization (or any other application header) is authoritative.
    for (const [name, value] of Object.entries(headers)) {
      requestHeaders.set(name, value);
    }

    const requestInit: RequestInit = {
      ...init,
      headers: requestHeaders,
      redirect: 'error',
      cache: 'no-store',
    };
    if (isChatCompletionsRequest(input)) {
      const normalizedBody = normalizeOpenAICompatibleChatBody(init?.body);
      if (normalizedBody !== undefined) requestInit.body = normalizedBody;
    }

    return fetch(input, requestInit);
  }) as NonNullable<ClientOptions['fetch']>;
}

function providerClientConfiguration(
  provider: OpenAICompatibleProviderRow,
  headers: Record<string, string>,
): ClientOptions {
  return {
    baseURL: provider.baseUrl,
    // Keep decrypted values in the request closure rather than in the model
    // configuration, where LangChain tracing/serialization could expose them.
    defaultHeaders: {},
    fetch: createProviderFetch(headers),
    // Explicit nulls prevent OpenAI's constructor from reading ambient
    // credential/org/project/webhook env vars; createProviderFetch removes the
    // corresponding generated or custom headers.
    apiKey: NO_AMBIENT_OPENAI_API_KEY,
    adminAPIKey: null,
    organization: null,
    project: null,
    webhookSecret: null,
  };
}

export class CompatibleChatOpenAI extends ChatOpenAI {
  constructor(fields: ChatOpenAIFields) {
    super({
      ...fields,
      apiKey: NO_AMBIENT_OPENAI_API_KEY,
      streaming: true,
      useResponsesApi: false,
    });
  }

  protected override _useResponsesApi(): boolean {
    return false;
  }

  override withConfig(
    config: Parameters<ChatOpenAI['withConfig']>[0],
  ): ReturnType<ChatOpenAI['withConfig']> {
    const model = new CompatibleChatOpenAI(this.fields ?? {});
    model.defaultOptions = {
      ...this.defaultOptions,
      ...config,
    };
    return model;
  }
}

export function createOpenAICompatibleChatModel(
  provider: OpenAICompatibleProviderRow,
  modelName: string,
): BaseChatModel {
  const headers = getDecryptedProviderHeaders(provider);
  return new CompatibleChatOpenAI({
    model: modelName,
    configuration: providerClientConfiguration(provider, headers),
  }) as unknown as BaseChatModel;
}

export function createOpenAICompatibleEmbeddingModel(
  provider: OpenAICompatibleProviderRow,
  modelName: string,
): Embeddings {
  const headers = getDecryptedProviderHeaders(provider);
  return new OpenAIEmbeddings({
    model: modelName,
    modelName,
    apiKey: NO_AMBIENT_OPENAI_API_KEY,
    configuration: providerClientConfiguration(provider, headers),
  }) as unknown as Embeddings;
}

export const createCompatibleChatModel = createOpenAICompatibleChatModel;
export const createCompatibleEmbeddingModel =
  createOpenAICompatibleEmbeddingModel;
export const getOpenAICompatibleChatModel = createOpenAICompatibleChatModel;
export const getOpenAICompatibleEmbeddingModel =
  createOpenAICompatibleEmbeddingModel;
