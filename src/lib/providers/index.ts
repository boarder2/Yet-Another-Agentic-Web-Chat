import { Embeddings } from '@langchain/core/embeddings';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  loadOpenAIChatModels,
  loadOpenAIEmbeddingModels,
  PROVIDER_INFO as OpenAIInfo,
} from './openai';
import {
  getCustomOpenaiApiKey,
  getCustomOpenaiApiUrl,
  getCustomOpenaiModelName,
  getHiddenModels,
} from '../config';
import { ChatOpenAI } from '@langchain/openai';
import {
  loadOllamaChatModels,
  loadOllamaEmbeddingModels,
  PROVIDER_INFO as OllamaInfo,
} from './ollama';
import { loadGroqChatModels, PROVIDER_INFO as GroqInfo } from './groq';
import {
  loadAnthropicChatModels,
  PROVIDER_INFO as AnthropicInfo,
} from './anthropic';
import {
  loadGeminiChatModels,
  loadGeminiEmbeddingModels,
  PROVIDER_INFO as GeminiInfo,
} from './gemini';
import {
  loadTransformersEmbeddingsModels,
  PROVIDER_INFO as TransformersInfo,
} from './transformers';
import {
  loadDeepseekChatModels,
  PROVIDER_INFO as DeepseekInfo,
} from './deepseek';
import {
  loadAimlApiChatModels,
  loadAimlApiEmbeddingModels,
  PROVIDER_INFO as AimlApiInfo,
} from './aimlapi';
import {
  loadLMStudioChatModels,
  loadLMStudioEmbeddingsModels,
  PROVIDER_INFO as LMStudioInfo,
} from './lmstudio';
import {
  loadOpenrouterChatModels,
  PROVIDER_INFO as OpenRouterInfo,
} from './openrouter';
import {
  getCachedChatModels,
  getCachedEmbeddingModels,
  setCachedChatModels,
  setCachedEmbeddingModels,
  NEGATIVE_CACHE_TTL_MS,
} from './modelCache';

export const PROVIDER_METADATA = {
  openai: OpenAIInfo,
  ollama: OllamaInfo,
  groq: GroqInfo,
  anthropic: AnthropicInfo,
  gemini: GeminiInfo,
  transformers: TransformersInfo,
  deepseek: DeepseekInfo,
  aimlapi: AimlApiInfo,
  lmstudio: LMStudioInfo,
  openrouter: OpenRouterInfo,
  custom_openai: {
    key: 'custom_openai',
    displayName: 'Custom OpenAI',
  },
};

export interface ChatModel {
  displayName: string;
  model: BaseChatModel;
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
  ollama: loadOllamaChatModels,
  groq: loadGroqChatModels,
  anthropic: loadAnthropicChatModels,
  gemini: loadGeminiChatModels,
  deepseek: loadDeepseekChatModels,
  aimlapi: loadAimlApiChatModels,
  lmstudio: loadLMStudioChatModels,
  openrouter: loadOpenrouterChatModels,
};

export const embeddingModelProviders: Record<
  string,
  () => Promise<Record<string, EmbeddingModel>>
> = {
  openai: loadOpenAIEmbeddingModels,
  ollama: loadOllamaEmbeddingModels,
  gemini: loadGeminiEmbeddingModels,
  transformers: loadTransformersEmbeddingsModels,
  aimlapi: loadAimlApiEmbeddingModels,
  lmstudio: loadLMStudioEmbeddingsModels,
};

export const getAvailableChatModelProviders = async (
  options: { includeHidden?: boolean; forceRefresh?: boolean } = {},
) => {
  const { includeHidden = false, forceRefresh = false } = options;
  const models: Record<string, Record<string, ChatModel>> = {};

  const providerNames = Object.keys(chatModelProviders);

  const loaded = await Promise.all(
    providerNames.map(async (provider) => {
      if (!forceRefresh) {
        const cached = getCachedChatModels<Record<string, ChatModel>>(provider);
        if (cached) return { provider, result: cached };
      }
      try {
        const result = await chatModelProviders[provider]();
        if (Object.keys(result).length > 0) {
          setCachedChatModels(provider, result);
        } else {
          // Cache empty results with a short TTL to avoid repeated
          // slow fetches when a provider is unreachable.
          setCachedChatModels(provider, result, NEGATIVE_CACHE_TTL_MS);
        }
        return { provider, result };
      } catch (err) {
        console.error(`Error loading chat models for ${provider}:`, err);
        return { provider, result: {} as Record<string, ChatModel> };
      }
    }),
  );

  for (const { provider, result } of loaded) {
    if (Object.keys(result).length > 0) {
      const sortedModels: Record<string, ChatModel> = {};
      Object.keys(result)
        .sort()
        .forEach((key) => {
          sortedModels[key] = result[key];
        });
      models[provider] = sortedModels;
    }
  }

  const customOpenAiApiKey = getCustomOpenaiApiKey();
  const customOpenAiApiUrl = getCustomOpenaiApiUrl();
  const customOpenAiModelName = getCustomOpenaiModelName();

  // Only add custom_openai provider if all required fields are configured
  if (customOpenAiApiKey && customOpenAiApiUrl && customOpenAiModelName) {
    models['custom_openai'] = {
      [customOpenAiModelName]: {
        displayName: customOpenAiModelName,
        model: new ChatOpenAI({
          apiKey: customOpenAiApiKey,
          modelName: customOpenAiModelName,
          // temperature: 0.7,
          configuration: {
            baseURL: customOpenAiApiUrl,
          },
        }) as unknown as BaseChatModel,
      },
    };
  }

  // Filter out hidden models if includeHidden is false
  if (!includeHidden) {
    const hiddenModels = getHiddenModels();
    if (hiddenModels.length > 0) {
      for (const provider in models) {
        for (const modelKey in models[provider]) {
          if (hiddenModels.includes(modelKey)) {
            delete models[provider][modelKey];
          }
        }
        // Remove provider if all models are hidden
        if (Object.keys(models[provider]).length === 0) {
          delete models[provider];
        }
      }
    }
  }

  return models;
};

export const getAvailableEmbeddingModelProviders = async (
  options: { includeHidden?: boolean; forceRefresh?: boolean } = {},
) => {
  const { includeHidden = false, forceRefresh = false } = options;
  const models: Record<string, Record<string, EmbeddingModel>> = {};

  const providerNames = Object.keys(embeddingModelProviders);

  const loaded = await Promise.all(
    providerNames.map(async (provider) => {
      if (!forceRefresh) {
        const cached =
          getCachedEmbeddingModels<Record<string, EmbeddingModel>>(provider);
        if (cached) return { provider, result: cached };
      }
      try {
        const result = await embeddingModelProviders[provider]();
        if (Object.keys(result).length > 0) {
          setCachedEmbeddingModels(provider, result);
        } else {
          setCachedEmbeddingModels(provider, result, NEGATIVE_CACHE_TTL_MS);
        }
        return { provider, result };
      } catch (err) {
        console.error(`Error loading embedding models for ${provider}:`, err);
        return { provider, result: {} as Record<string, EmbeddingModel> };
      }
    }),
  );

  for (const { provider, result } of loaded) {
    if (Object.keys(result).length > 0) {
      const sortedModels: Record<string, EmbeddingModel> = {};
      Object.keys(result)
        .sort()
        .forEach((key) => {
          sortedModels[key] = result[key];
        });
      models[provider] = sortedModels;
    }
  }

  // Filter out hidden models if includeHidden is false
  if (!includeHidden) {
    const hiddenModels = getHiddenModels();
    if (hiddenModels.length > 0) {
      for (const provider in models) {
        for (const modelKey in models[provider]) {
          if (hiddenModels.includes(modelKey)) {
            delete models[provider][modelKey];
          }
        }
        // Remove provider if all models are hidden
        if (Object.keys(models[provider]).length === 0) {
          delete models[provider];
        }
      }
    }
  }

  return models;
};
