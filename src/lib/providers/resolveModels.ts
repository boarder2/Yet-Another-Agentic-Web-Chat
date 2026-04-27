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
} from '@/lib/config';
import { CachedEmbeddings } from '@/lib/utils/cachedEmbeddings';

export type ModelRef = {
  provider: string;
  name: string;
  ollamaContextWindow?: number;
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

  const embeddingProvider =
    embeddingModelProviders[
      input.embeddingModel?.provider || Object.keys(embeddingModelProviders)[0]
    ];
  const embeddingModelEntry =
    embeddingProvider?.[
      input.embeddingModel?.name || Object.keys(embeddingProvider || {})[0]
    ];

  let chatLlm: BaseChatModel | undefined;
  let systemLlm: BaseChatModel | undefined;

  if (!embeddingModelEntry) {
    throw new Error('Invalid embedding model');
  }

  const embedding = new CachedEmbeddings(
    embeddingModelEntry.model,
    input.embeddingModel?.provider || Object.keys(embeddingModelProviders)[0],
    input.embeddingModel?.name || Object.keys(embeddingProvider || {})[0],
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

    if (
      chatLlm instanceof ChatOllama &&
      input.chatModel?.provider === 'ollama'
    ) {
      chatLlm.numCtx = input.chatModel.ollamaContextWindow || 2048;
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
    if (
      systemLlm instanceof ChatOllama &&
      input.systemModel?.provider === 'ollama'
    ) {
      systemLlm.numCtx = input.systemModel.ollamaContextWindow || 2048;
    }
  }
  if (!systemLlm) systemLlm = chatLlm;

  if (!chatLlm) {
    throw new Error('Invalid chat model');
  }

  return { chatLlm, systemLlm: systemLlm!, embedding };
}
