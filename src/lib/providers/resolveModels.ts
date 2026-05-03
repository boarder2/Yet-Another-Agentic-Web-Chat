import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOllama } from '@langchain/ollama';
import { ChatOpenAI } from '@langchain/openai';
import {
  getAvailableChatModelProviders,
  getAvailableEmbeddingModelProviders,
} from '@/lib/providers';
import {
  getCustomOpenaiApiKey,
  getCustomOpenaiApiUrl,
  getCustomOpenaiModelName,
  getSelectedSystemModel,
  getSelectedEmbeddingModel,
} from '@/lib/config';
import { CachedEmbeddings } from '@/lib/utils/cachedEmbeddings';

export type ModelRef = {
  provider: string;
  name: string;
  contextWindowSize?: number;
};
export type EmbeddingRef = { provider: string; name: string };

export async function resolveChatAndEmbedding(input: {
  chatModel?: ModelRef | null;
  systemModel?: ModelRef | null;
  embeddingModel?: EmbeddingRef | null;
}): Promise<{
  chatLlm: BaseChatModel;
  systemLlm: BaseChatModel;
  embedding: CachedEmbeddings;
}> {
  const [chatModelProviders, embeddingModelProviders] = await Promise.all([
    getAvailableChatModelProviders(),
    getAvailableEmbeddingModelProviders(),
  ]);

  const chatModelProvider =
    chatModelProviders[
      input.chatModel?.provider || Object.keys(chatModelProviders)[0]
    ];
  const chatModelEntry =
    chatModelProvider?.[
      input.chatModel?.name || Object.keys(chatModelProvider || {})[0]
    ];

  // Embedding model: prefer explicit input, then config.toml, then first available
  const selectedEmbedding = getSelectedEmbeddingModel();
  const embeddingProviderKey =
    input.embeddingModel?.provider ||
    selectedEmbedding.provider ||
    Object.keys(embeddingModelProviders)[0];
  const embeddingProvider = embeddingModelProviders[embeddingProviderKey];
  const embeddingModelName =
    input.embeddingModel?.name ||
    (embeddingProviderKey === selectedEmbedding.provider
      ? selectedEmbedding.name
      : undefined) ||
    Object.keys(embeddingProvider || {})[0];
  const embeddingModelEntry = embeddingProvider?.[embeddingModelName];

  let chatLlm: BaseChatModel | undefined;
  let systemLlm: BaseChatModel | undefined;

  if (!embeddingModelEntry) {
    throw new Error('Invalid embedding model');
  }

  const embedding = new CachedEmbeddings(
    embeddingModelEntry.model,
    embeddingProviderKey,
    embeddingModelName,
  );

  if (input.chatModel?.provider === 'custom_openai') {
    chatLlm = new ChatOpenAI({
      apiKey: getCustomOpenaiApiKey(),
      modelName: getCustomOpenaiModelName(),
      configuration: {
        baseURL: getCustomOpenaiApiUrl(),
      },
    }) as unknown as BaseChatModel;
  } else if (chatModelProvider && chatModelEntry) {
    chatLlm = chatModelEntry.model;

    if (chatLlm) {
      const cw = input.chatModel?.contextWindowSize || 32768;
      if (
        chatLlm instanceof ChatOllama &&
        input.chatModel?.provider === 'ollama'
      ) {
        chatLlm.numCtx = cw;
      }
      (chatLlm as unknown as { contextWindowSize?: number }).contextWindowSize =
        cw;
    }
  }

  if (input.systemModel) {
    const sysProvider = input.systemModel.provider;
    const sysName = input.systemModel.name;
    if (sysProvider === 'custom_openai') {
      systemLlm = new ChatOpenAI({
        apiKey: getCustomOpenaiApiKey(),
        modelName: getCustomOpenaiModelName(),
        configuration: {
          baseURL: getCustomOpenaiApiUrl(),
        },
      }) as unknown as BaseChatModel;
    } else if (
      chatModelProviders[sysProvider] &&
      chatModelProviders[sysProvider][sysName]
    ) {
      systemLlm = chatModelProviders[sysProvider][sysName].model as unknown as
        | BaseChatModel
        | undefined;
    }
    if (systemLlm) {
      const cw = input.systemModel?.contextWindowSize || 32768;
      if (
        systemLlm instanceof ChatOllama &&
        input.systemModel?.provider === 'ollama'
      ) {
        systemLlm.numCtx = cw;
      }
      (
        systemLlm as unknown as { contextWindowSize?: number }
      ).contextWindowSize = cw;
    }
  }
  if (!systemLlm) {
    // Fall back to config.toml SELECTED_MODELS.system, then to chat model
    const selectedSystem = getSelectedSystemModel();
    if (
      selectedSystem.provider &&
      selectedSystem.name &&
      chatModelProviders[selectedSystem.provider]?.[selectedSystem.name]
    ) {
      systemLlm = chatModelProviders[selectedSystem.provider][
        selectedSystem.name
      ].model as unknown as BaseChatModel | undefined;
      if (systemLlm) {
        const cw = input.systemModel?.contextWindowSize || 32768;
        if (
          systemLlm instanceof ChatOllama &&
          selectedSystem.provider === 'ollama'
        ) {
          systemLlm.numCtx = cw;
        }
        (
          systemLlm as unknown as { contextWindowSize?: number }
        ).contextWindowSize = cw;
      }
    }
  }
  if (!systemLlm) systemLlm = chatLlm;

  if (!chatLlm) {
    throw new Error('Invalid chat model');
  }

  return { chatLlm, systemLlm: systemLlm!, embedding };
}
