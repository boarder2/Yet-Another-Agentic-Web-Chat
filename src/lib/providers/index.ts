import { Embeddings } from '@langchain/core/embeddings';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { loadOpenAIChatModels, loadOpenAIEmbeddingModels } from './openai';
import { loadAnthropicChatModels } from './anthropic';
import { loadGeminiChatModels, loadGeminiEmbeddingModels } from './gemini';
import { loadTransformersEmbeddingsModels } from './transformers';
import { loadDeepseekChatModels } from './deepseek';
import { loadOpenrouterChatModels } from './openrouter';
import { loadTestChatModels, loadTestEmbeddingModels } from './test';
import {
  getCachedChatModels,
  getCachedEmbeddingModels,
  setCachedChatModels,
  setCachedEmbeddingModels,
  NEGATIVE_CACHE_TTL_MS,
} from './modelCache';
import { PROVIDER_METADATA, type ProviderMetadata } from './metadata';
import type { ReasoningEffort } from './reasoningEffort';
import { isHiddenModel, type HiddenModel } from '@/lib/models/hiddenModels';
import { openAICompatibleProviderKey } from './openaiCompatible/types';

export { PROVIDER_METADATA };
export type { ProviderMetadata } from './metadata';
export type { ReasoningEffort } from './reasoningEffort';

export interface ChatModel {
  displayName: string;
  model: BaseChatModel;
  /** Native named effort levels advertised by this model, if any. */
  supportedReasoningEfforts?: ReasoningEffort[];
  /** Provider discovery metadata retained for capability-aware refreshes. */
  supportedParameters?: string[];
}

export interface EmbeddingModel {
  displayName: string;
  model: Embeddings;
}

export const chatModelProviders: Record<
  string,
  () => Promise<Record<string, ChatModel>>
> = {
  openai: loadOpenAIChatModels,
  anthropic: loadAnthropicChatModels,
  gemini: loadGeminiChatModels,
  deepseek: loadDeepseekChatModels,
  openrouter: loadOpenrouterChatModels,
};

export const embeddingModelProviders: Record<
  string,
  () => Promise<Record<string, EmbeddingModel>>
> = {
  openai: loadOpenAIEmbeddingModels,
  gemini: loadGeminiEmbeddingModels,
  transformers: loadTransformersEmbeddingsModels,
};

if (process.env.YAAWC_TEST_MODE === 'true') {
  chatModelProviders.test = loadTestChatModels;
  embeddingModelProviders.test = loadTestEmbeddingModels;
}

type CatalogOptions = { includeHidden?: boolean; forceRefresh?: boolean };

type CatalogEntry = ChatModel | EmbeddingModel;

async function listEnabledCompatibleProviders() {
  try {
    const { listEnabledOpenAICompatibleProviders } =
      await import('./openaiCompatible/store');
    return await listEnabledOpenAICompatibleProviders();
  } catch (error) {
    console.error('Error loading OpenAI-compatible providers:', error);
    return [];
  }
}

async function listAllCompatibleProviders() {
  try {
    const { listOpenAICompatibleProviders } =
      await import('./openaiCompatible/store');
    return await listOpenAICompatibleProviders();
  } catch (error) {
    console.error('Error loading OpenAI-compatible provider metadata:', error);
    return [];
  }
}

async function loadStaticCatalog<T extends CatalogEntry>(
  registry: Record<string, () => Promise<Record<string, T>>>,
  getCached: <V>(provider: string) => V | null,
  setCached: <V>(provider: string, value: V, ttlMs?: number) => void,
  forceRefresh: boolean,
): Promise<Record<string, Record<string, T>>> {
  const models: Record<string, Record<string, T>> = {};
  const providerNames = Object.keys(registry);

  const loaded = await Promise.all(
    providerNames.map(async (provider) => {
      if (!forceRefresh) {
        const cached = getCached<Record<string, T>>(provider);
        if (cached) {
          // Visibility filtering is request-scoped; never mutate a cached
          // provider map while removing hidden entries.
          return { provider, result: { ...cached } };
        }
      }
      try {
        const result = await registry[provider]();
        if (Object.keys(result).length > 0) {
          setCached(provider, result);
        } else {
          // Cache empty results briefly so an unavailable built-in does not
          // cause a slow discovery request on every catalog read.
          setCached(provider, result, NEGATIVE_CACHE_TTL_MS);
        }
        return { provider, result: { ...result } };
      } catch (err) {
        console.error(`Error loading models for ${provider}:`, err);
        setCached(provider, {} as Record<string, T>, NEGATIVE_CACHE_TTL_MS);
        return { provider, result: {} as Record<string, T> };
      }
    }),
  );

  for (const { provider, result } of loaded) {
    if (Object.keys(result).length === 0) continue;
    const sortedModels: Record<string, T> = {};
    Object.keys(result)
      .sort()
      .forEach((key) => {
        sortedModels[key] = result[key];
      });
    models[provider] = sortedModels;
  }

  return models;
}

async function loadCompatibleChatCatalog(
  forceRefresh: boolean,
): Promise<Record<string, Record<string, ChatModel>>> {
  const providers = (await listEnabledCompatibleProviders()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const { createOpenAICompatibleChatModel, discoverOpenAICompatibleModels } =
    await import('./openaiCompatible/client');
  const models: Record<string, Record<string, ChatModel>> = {};

  const loaded = await Promise.all(
    providers.map(async (provider) => {
      try {
        const descriptors = await discoverOpenAICompatibleModels(provider, {
          forceRefresh,
        });
        const result = Object.fromEntries(
          descriptors.map((descriptor) => [
            descriptor.id,
            {
              displayName: descriptor.name?.trim() || descriptor.id,
              model: createOpenAICompatibleChatModel(provider, descriptor.id),
            },
          ]),
        );
        return { provider, result };
      } catch (error) {
        console.error(
          `Error loading models for OpenAI-compatible provider ${provider.id}:`,
          error instanceof Error ? error.message : error,
        );
        return { provider, result: {} as Record<string, ChatModel> };
      }
    }),
  );

  for (const { provider, result } of loaded) {
    if (Object.keys(result).length > 0) {
      models[openAICompatibleProviderKey(provider.id)] = Object.fromEntries(
        Object.entries(result).sort(([a], [b]) => a.localeCompare(b)),
      );
    }
  }
  return models;
}

async function loadCompatibleEmbeddingCatalog(
  forceRefresh: boolean,
): Promise<Record<string, Record<string, EmbeddingModel>>> {
  const providers = (await listEnabledCompatibleProviders())
    .filter((provider) => provider.supportsEmbeddings)
    .sort((a, b) => a.name.localeCompare(b.name));
  const {
    createOpenAICompatibleEmbeddingModel,
    discoverOpenAICompatibleModels,
  } = await import('./openaiCompatible/client');
  const models: Record<string, Record<string, EmbeddingModel>> = {};

  const loaded = await Promise.all(
    providers.map(async (provider) => {
      try {
        const descriptors = await discoverOpenAICompatibleModels(provider, {
          forceRefresh,
        });
        const result = Object.fromEntries(
          descriptors.map((descriptor) => [
            descriptor.id,
            {
              displayName: descriptor.name?.trim() || descriptor.id,
              model: createOpenAICompatibleEmbeddingModel(
                provider,
                descriptor.id,
              ),
            },
          ]),
        );
        return { provider, result };
      } catch (error) {
        console.error(
          `Error loading embeddings for OpenAI-compatible provider ${provider.id}:`,
          error instanceof Error ? error.message : error,
        );
        return { provider, result: {} as Record<string, EmbeddingModel> };
      }
    }),
  );

  for (const { provider, result } of loaded) {
    if (Object.keys(result).length > 0) {
      models[openAICompatibleProviderKey(provider.id)] = Object.fromEntries(
        Object.entries(result).sort(([a], [b]) => a.localeCompare(b)),
      );
    }
  }
  return models;
}

function filterHiddenModels<T extends CatalogEntry>(
  models: Record<string, Record<string, T>>,
  hiddenModels: readonly HiddenModel[],
): void {
  for (const provider of Object.keys(models)) {
    for (const modelKey of Object.keys(models[provider])) {
      if (isHiddenModel(hiddenModels, provider, modelKey)) {
        delete models[provider][modelKey];
      }
    }
    if (Object.keys(models[provider]).length === 0) delete models[provider];
  }
}

async function applyHiddenFilter<T extends CatalogEntry>(
  models: Record<string, Record<string, T>>,
  includeHidden: boolean,
): Promise<void> {
  if (includeHidden) return;
  const { getHiddenModels } = await import('@/lib/settings/server');
  const hiddenModels = getHiddenModels();
  if (hiddenModels.length === 0) return;
  filterHiddenModels(models, hiddenModels);
}

/**
 * Static metadata is always available. Configured compatible providers are
 * included even while disabled or offline so saved references can keep their
 * display label without making the provider selectable.
 */
export async function getAvailableProviderMetadata(): Promise<
  Record<string, ProviderMetadata>
> {
  const metadata: Record<string, ProviderMetadata> = {
    ...PROVIDER_METADATA,
  };
  const providers = await listAllCompatibleProviders();
  for (const provider of [...providers].sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const key = openAICompatibleProviderKey(provider.id);
    metadata[key] = { key, displayName: provider.name };
  }
  return metadata;
}

export const getProviderMetadata = getAvailableProviderMetadata;

export const getAvailableChatModelProviders = async (
  options: CatalogOptions = {},
) => {
  const { includeHidden = false, forceRefresh = false } = options;
  // Start compatible discovery before built-in loaders so a concurrent chat +
  // embedding catalog request shares the same provider fetch even when a
  // built-in loader is slow.
  const dynamicPromise = loadCompatibleChatCatalog(forceRefresh).catch(
    (error) => {
      console.error('Error loading OpenAI-compatible chat catalog:', error);
      return {};
    },
  );
  const models = await loadStaticCatalog(
    chatModelProviders,
    getCachedChatModels,
    setCachedChatModels,
    forceRefresh,
  );
  Object.assign(models, await dynamicPromise);

  await applyHiddenFilter(models, includeHidden);
  return models;
};

export const getAvailableEmbeddingModelProviders = async (
  options: CatalogOptions = {},
) => {
  const { includeHidden = false, forceRefresh = false } = options;
  const dynamicPromise = loadCompatibleEmbeddingCatalog(forceRefresh).catch(
    (error) => {
      console.error(
        'Error loading OpenAI-compatible embedding catalog:',
        error,
      );
      return {};
    },
  );
  const models = await loadStaticCatalog(
    embeddingModelProviders,
    getCachedEmbeddingModels,
    setCachedEmbeddingModels,
    forceRefresh,
  );
  Object.assign(models, await dynamicPromise);

  await applyHiddenFilter(models, includeHidden);
  return models;
};
