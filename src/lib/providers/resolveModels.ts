import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { DEFAULT_CONTEXT_WINDOW } from '@/lib/models/presets';
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
import { getEmbeddingModelSelection } from '@/lib/settings/server';
import { CachedEmbeddings } from '@/lib/utils/cachedEmbeddings';

export type ModelRef = {
  provider: string;
  name: string;
  contextWindowSize?: number;
};

/**
 * Resolve a single chat model from a `ModelRef` against the live provider
 * catalog (or the custom_openai config). Returns null if the model isn't
 * available, so callers can fall back. Used by features that pick their own
 * model independent of the chat/system pair (e.g. TTS narration).
 */
export async function resolveModelRef(
  ref: ModelRef,
  opts?: { isolate?: boolean },
): Promise<BaseChatModel | null> {
  if (ref.provider === 'custom_openai') {
    return new ChatOpenAI({
      apiKey: getCustomOpenaiApiKey(),
      modelName: getCustomOpenaiModelName(),
      configuration: {
        baseURL: getCustomOpenaiApiUrl(),
      },
    }) as unknown as BaseChatModel;
  }

  const providers = await getAvailableChatModelProviders();
  let llm = providers[ref.provider]?.[ref.name]?.model as unknown as
    | BaseChatModel
    | undefined;
  if (!llm) return null;

  // `isolate` callers (e.g. panel executors) run this model concurrently with
  // other agents that may share the same cached singleton. Shallow-clone the
  // instance (preserving its prototype/methods) up front so this caller gets its
  // own copy — any later numCtx/contextWindowSize write here, or a write by a
  // concurrent non-panel request to the shared singleton, can't race or clobber
  // it. Done unconditionally (not gated on contextWindowSize) so isolation holds
  // even when no context window is supplied.
  //
  // Note: transport handles held as own properties (e.g. a ChatOllama `client`,
  // an OpenAI `client`, the shared `caller`) are copied by reference, so they
  // remain shared. That's deliberate — those are concurrency-safe connection
  // objects, and for an Ollama client a per-run abort that cancels all of a
  // run's in-flight requests is exactly the desired stop-all behavior. Only the
  // per-call config (numCtx/contextWindowSize) needs to be private, and it is.
  if (opts?.isolate) {
    llm = Object.assign(
      Object.create(Object.getPrototypeOf(llm)),
      llm,
    ) as BaseChatModel;
  }

  // Only mutate the model instance when the caller explicitly asks for a context
  // window. Non-isolate callers that don't care (e.g. TTS narration) leave the
  // shared instance untouched so they can't clobber the window of a concurrent
  // agent request using the same singleton.
  if (ref.contextWindowSize) {
    if (llm instanceof ChatOllama && ref.provider === 'ollama') {
      llm.numCtx = ref.contextWindowSize;
    }
    (llm as unknown as { contextWindowSize?: number }).contextWindowSize =
      ref.contextWindowSize;
  }
  return llm;
}

export async function resolveChatAndEmbedding(input: {
  chatModel?: ModelRef | null;
  systemModel?: ModelRef | null;
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

  // Embedding model is a system-level setting: always resolve from the DB
  // (source of truth), never from the request. This keeps indexing, querying,
  // and the embedding cache on one model so their vectors stay comparable.
  const selectedEmbedding = getEmbeddingModelSelection();
  const embeddingProviderKey =
    selectedEmbedding.provider || Object.keys(embeddingModelProviders)[0];
  const embeddingProvider = embeddingModelProviders[embeddingProviderKey];
  const embeddingModelName =
    selectedEmbedding.name || Object.keys(embeddingProvider || {})[0];
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
      const cw = input.chatModel?.contextWindowSize || DEFAULT_CONTEXT_WINDOW;
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
      const cw = input.systemModel?.contextWindowSize || DEFAULT_CONTEXT_WINDOW;
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
  if (!systemLlm) systemLlm = chatLlm;

  if (!chatLlm) {
    throw new Error('Invalid chat model');
  }

  return { chatLlm, systemLlm: systemLlm!, embedding };
}
