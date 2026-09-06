import {
  getAnthropicApiKey,
  getDeepseekApiKey,
  getGeminiApiKey,
  getOpenaiApiKey,
  getOpenrouterApiKey,
} from '../config';
import { getOpenrouterQuantizations } from '../settings/server';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const NEGATIVE_CACHE_TTL_MS = 60 * 1000; // 1 minute for empty/failed results

interface CacheEntry<T> {
  signature: string;
  expiresAt: number;
  value: T;
}

// Separate namespaces for chat and embedding caches, keyed by provider name.
const chatCache = new Map<string, CacheEntry<unknown>>();
const embeddingCache = new Map<string, CacheEntry<unknown>>();
const imageGenerationCache = new Map<string, CacheEntry<unknown>>();

/**
 * Config signature per provider. If any input to the loader changes, the
 * signature changes and the cache entry is considered stale.
 */
const providerSignature = (provider: string): string => {
  switch (provider) {
    case 'openai':
      return getOpenaiApiKey() || '';
    case 'anthropic':
      return getAnthropicApiKey() || '';
    case 'gemini':
      return getGeminiApiKey() || '';
    case 'deepseek':
      return getDeepseekApiKey() || '';
    case 'openrouter':
      return JSON.stringify({
        apiKey: getOpenrouterApiKey() || '',
        quantizations: getOpenrouterQuantizations(),
      });
    case 'transformers':
      return 'local';
    default:
      return '';
  }
};

const readCache = <T>(
  cache: Map<string, CacheEntry<unknown>>,
  provider: string,
): T | null => {
  const entry = cache.get(provider);
  if (!entry) return null;
  if (entry.signature !== providerSignature(provider)) return null;
  if (Date.now() >= entry.expiresAt) return null;
  return entry.value as T;
};

const writeCache = <T>(
  cache: Map<string, CacheEntry<unknown>>,
  provider: string,
  value: T,
  ttlMs: number = CACHE_TTL_MS,
) => {
  cache.set(provider, {
    signature: providerSignature(provider),
    expiresAt: Date.now() + ttlMs,
    value,
  });
};

export const getCachedChatModels = <T>(provider: string): T | null =>
  readCache<T>(chatCache, provider);

export const setCachedChatModels = <T>(
  provider: string,
  value: T,
  ttlMs?: number,
): void => writeCache(chatCache, provider, value, ttlMs);

export const getCachedEmbeddingModels = <T>(provider: string): T | null =>
  readCache<T>(embeddingCache, provider);

export const setCachedEmbeddingModels = <T>(
  provider: string,
  value: T,
  ttlMs?: number,
): void => writeCache(embeddingCache, provider, value, ttlMs);

export { NEGATIVE_CACHE_TTL_MS };

export const getCachedImageGenerationModels = <T>(provider: string): T | null =>
  readCache<T>(imageGenerationCache, provider);

export const setCachedImageGenerationModels = <T>(
  provider: string,
  value: T,
  ttlMs?: number,
): void => writeCache(imageGenerationCache, provider, value, ttlMs);

export const invalidateModelCache = (provider?: string): void => {
  if (provider) {
    chatCache.delete(provider);
    embeddingCache.delete(provider);
    imageGenerationCache.delete(provider);
  } else {
    chatCache.clear();
    embeddingCache.clear();
    imageGenerationCache.clear();
  }
};
