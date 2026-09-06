import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { DEFAULT_CONTEXT_WINDOW } from '@/lib/models/presets';
import {
  getAvailableChatModelProviders,
  getAvailableEmbeddingModelProviders,
} from '@/lib/providers';
import { getEmbeddingModelSelection } from '@/lib/settings/server';
import { CachedEmbeddings } from '@/lib/utils/cachedEmbeddings';
import {
  clampReasoningEffort,
  getNativeReasoningEffortConfig,
  getSupportedReasoningEfforts,
  isReasoningEffort,
  parseModelReference,
  parseReasoningEffort,
  withoutReasoningEffort,
  type ModelRefContract,
  type ReasoningEffort,
} from './reasoningEffort';

export {
  modelRefSchema,
  parseModelReference,
  ModelReferenceValidationError,
} from './reasoningEffort';

export type ModelRef = ModelRefContract;

export interface ResolvedModelRef {
  model: BaseChatModel;
  /** The request-local effective reference, including a clamped effort. */
  ref: ModelRef;
  supportedReasoningEfforts?: ReasoningEffort[];
}

type MutableModel = BaseChatModel & Record<string, unknown>;

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function cloneConfigObject(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const cloned = { ...(value as Record<string, unknown>) };
  for (const key of [
    'reasoning',
    'modelKwargs',
    'outputConfig',
    'thinkingConfig',
  ]) {
    if (cloned[key] && typeof cloned[key] === 'object') {
      cloned[key] = { ...(cloned[key] as Record<string, unknown>) };
    }
  }
  return cloned;
}

function cloneModel(model: BaseChatModel): BaseChatModel {
  const cloned = Object.assign(
    Object.create(Object.getPrototypeOf(model)),
    model,
  ) as MutableModel;

  // Clone request configuration as well as the instance. ChatOpenAI delegates
  // invocation to transport-specific child models, so clone those children too
  // or DeepSeek/OpenAI options can leak back to the cached singleton.
  for (const key of [
    'defaultOptions',
    'fields',
    'modelKwargs',
    'reasoning',
    'outputConfig',
    'thinkingConfig',
  ]) {
    const copied = cloneConfigObject(cloned[key]);
    if (copied) cloned[key] = copied;
  }

  for (const key of ['responses', 'completions']) {
    const child = cloned[key];
    if (!child || typeof child !== 'object') continue;
    const childClone = Object.assign(
      Object.create(Object.getPrototypeOf(child)),
      child,
    ) as MutableModel;
    for (const childKey of [
      'defaultOptions',
      'fields',
      'modelKwargs',
      'reasoning',
      'outputConfig',
      'thinkingConfig',
    ]) {
      const copied = cloneConfigObject(childClone[childKey]);
      if (copied) childClone[childKey] = copied;
    }
    cloned[key] = childClone;
  }

  return cloned;
}

/**
 * Bind one resolved effort to a private model copy. The catalog models are
 * cached singletons, so provider-specific fields must never be changed in
 * place while another run may be using the same entry.
 */
export function applyReasoningEffort(
  model: BaseChatModel,
  provider: string,
  modelName: string,
  effort: ReasoningEffort | undefined,
  supportedReasoningEfforts?: readonly ReasoningEffort[],
  options?: { preserveEffort?: boolean },
): BaseChatModel {
  if (effort === undefined) return model;
  if (!isReasoningEffort(effort)) {
    throw new Error('Invalid reasoning effort.');
  }

  const supported =
    supportedReasoningEfforts ??
    getSupportedReasoningEfforts(provider, modelName);
  const effectiveEffort = options?.preserveEffort
    ? effort
    : clampReasoningEffort(effort, supported);
  if (effectiveEffort === undefined) return model;

  const config = getNativeReasoningEffortConfig(
    provider,
    modelName,
    effectiveEffort,
  );
  if (!config) return model;

  const cloned = cloneModel(model) as MutableModel;
  const request = config.request as Record<string, unknown>;

  switch (config.provider) {
    case 'openrouter': {
      const reasoning = request.reasoning;
      if (reasoning && typeof reasoning === 'object') {
        const current = asObject(cloned.modelKwargs);
        cloned.modelKwargs = {
          ...current,
          reasoning: {
            ...asObject(current.reasoning),
            ...reasoning,
          },
        };
      }
      break;
    }
    case 'openai': {
      const reasoning = request.reasoning;
      if (reasoning && typeof reasoning === 'object') {
        const currentReasoning = asObject(cloned.reasoning);
        const nextReasoning = { ...currentReasoning, ...reasoning };
        cloned.reasoning = nextReasoning;

        const defaultOptions = asObject(cloned.defaultOptions);
        cloned.defaultOptions = {
          ...defaultOptions,
          reasoning: {
            ...asObject(defaultOptions.reasoning),
            ...reasoning,
          },
        };

        const fields = asObject(cloned.fields);
        cloned.fields = {
          ...fields,
          reasoning: {
            ...asObject(fields.reasoning),
            ...nextReasoning,
          },
        };

        for (const childKey of ['responses', 'completions']) {
          const child = cloned[childKey];
          if (!child || typeof child !== 'object') continue;
          const mutableChild = child as MutableModel;
          mutableChild.reasoning = {
            ...asObject(mutableChild.reasoning),
            ...nextReasoning,
          };
          const childDefaultOptions = asObject(mutableChild.defaultOptions);
          mutableChild.defaultOptions = {
            ...childDefaultOptions,
            reasoning: {
              ...asObject(childDefaultOptions.reasoning),
              ...nextReasoning,
            },
          };
        }
      }
      break;
    }
    case 'anthropic': {
      const outputConfig = request.output_config;
      if (outputConfig && typeof outputConfig === 'object') {
        const current = asObject(cloned.outputConfig);
        cloned.outputConfig = { ...current, ...outputConfig };
      } else if (
        cloned.outputConfig &&
        typeof cloned.outputConfig === 'object'
      ) {
        const { effort: _ignored, ...withoutEffort } = asObject(
          cloned.outputConfig,
        );
        cloned.outputConfig = withoutEffort;
      }

      const thinking = request.thinking;
      if (thinking && typeof thinking === 'object') {
        cloned.thinking = thinking;
        cloned.thinkingExplicitlySet = true;
      }
      break;
    }
    case 'gemini': {
      const generationConfig = asObject(request.generationConfig);
      const thinkingConfig = generationConfig.thinkingConfig;
      if (thinkingConfig && typeof thinkingConfig === 'object') {
        // Do not retain a token-budget field alongside the named level.
        cloned.thinkingConfig = { ...thinkingConfig };
      } else if (effectiveEffort === 'off') {
        cloned.thinkingConfig = undefined;
      }
      break;
    }
    case 'deepseek': {
      const current = asObject(cloned.modelKwargs);
      const { reasoning_effort: _ignored, ...withoutEffort } = current;
      const next = { ...withoutEffort, ...request };
      cloned.modelKwargs = next;
      if (cloned.fields && typeof cloned.fields === 'object') {
        cloned.fields = {
          ...asObject(cloned.fields),
          modelKwargs: { ...next },
        };
      }
      for (const childKey of ['responses', 'completions']) {
        const child = cloned[childKey];
        if (child && typeof child === 'object') {
          (child as MutableModel).modelKwargs = { ...next };
        }
      }
      break;
    }
  }

  return cloned;
}

function resolveRequestedEffort(
  requested: unknown,
  supported: readonly ReasoningEffort[] | undefined,
  preserveEffort = false,
): ReasoningEffort | undefined {
  const parsed = parseReasoningEffort(requested);
  return preserveEffort ? parsed : clampReasoningEffort(parsed, supported);
}

type ReasoningModelEntry = {
  supportedReasoningEfforts?: ReasoningEffort[];
  supportedParameters?: string[];
};

function getEntrySupportedEfforts(
  provider: string,
  model: string,
  entry: ReasoningModelEntry | undefined,
): ReasoningEffort[] | undefined {
  if (entry?.supportedReasoningEfforts !== undefined) {
    return entry.supportedReasoningEfforts;
  }

  return getSupportedReasoningEfforts(
    provider,
    model,
    provider.toLowerCase() === 'openrouter'
      ? { supportedParameters: entry?.supportedParameters }
      : undefined,
  );
}

function effectiveModelRef(
  ref: ModelRef,
  effort: ReasoningEffort | undefined,
): ModelRef {
  const withoutEffort = withoutReasoningEffort(ref);
  return effort === undefined
    ? withoutEffort
    : { ...withoutEffort, reasoningEffort: effort };
}

function setContextWindow(model: BaseChatModel, ref: ModelRef): void {
  (model as unknown as { contextWindowSize?: number }).contextWindowSize =
    ref.contextWindowSize || DEFAULT_CONTEXT_WINDOW;
}

function bindCatalogModel(
  ref: ModelRef,
  entry: ReasoningModelEntry & { model: BaseChatModel },
  opts: { isolate?: boolean; preserveEffort?: boolean } = {},
): ResolvedModelRef {
  const supportedReasoningEfforts = getEntrySupportedEfforts(
    ref.provider,
    ref.name,
    entry,
  );
  const effectiveReasoningEffort = resolveRequestedEffort(
    ref.reasoningEffort,
    supportedReasoningEfforts,
    opts.preserveEffort,
  );

  // Catalog entries are cached singletons. Any caller-specific setting must
  // use a private copy, including the default context window.
  let llm = entry.model;
  if (
    opts.isolate ||
    effectiveReasoningEffort !== undefined ||
    ref.contextWindowSize !== undefined
  ) {
    llm = cloneModel(llm);
  }
  llm = applyReasoningEffort(
    llm,
    ref.provider,
    ref.name,
    effectiveReasoningEffort,
    supportedReasoningEfforts,
    { preserveEffort: opts.preserveEffort },
  );

  if (ref.contextWindowSize !== undefined) {
    (llm as unknown as { contextWindowSize?: number }).contextWindowSize =
      ref.contextWindowSize;
  }

  return {
    model: llm,
    ref: effectiveModelRef(ref, effectiveReasoningEffort),
    ...(supportedReasoningEfforts
      ? { supportedReasoningEfforts: [...supportedReasoningEfforts] }
      : {}),
  };
}

/**
 * Resolve one model and return both its private runtime instance and its
 * request-local effective reference. A valid stale effort is clamped against
 * the live catalog; an unprofiled model receives Provider default (omission).
 */
export async function resolveModelRefWithReference(
  ref: ModelRef,
  opts?: { isolate?: boolean; preserveEffort?: boolean },
): Promise<ResolvedModelRef | null> {
  const parsedRef = parseModelReference(ref);

  const providers = await getAvailableChatModelProviders();
  const modelEntry = providers[parsedRef.provider]?.[parsedRef.name];
  if (!modelEntry) return null;

  return bindCatalogModel(parsedRef, modelEntry, opts);
}

/** Alias for callers that want to make the effective-reference boundary clear. */
export const resolveModelReference = resolveModelRefWithReference;

/**
 * Resolve a single chat model from a `ModelRef` against the live provider
 * catalog. Returns null if the model isn't available.
 */
export async function resolveModelRef(
  ref: ModelRef,
  opts?: { isolate?: boolean; preserveEffort?: boolean },
): Promise<BaseChatModel | null> {
  const resolved = await resolveModelRefWithReference(ref, opts);
  return resolved?.model ?? null;
}

export async function resolveChatAndEmbedding(input: {
  chatModel?: ModelRef | null;
  systemModel?: ModelRef | null;
  /** Keep the snapshotted effort on resume even if live metadata changed. */
  preserveEffort?: boolean;
}): Promise<{
  chatLlm: BaseChatModel;
  systemLlm: BaseChatModel;
  embedding: CachedEmbeddings;
  chatModelRef: ModelRef;
  systemModelRef: ModelRef;
}> {
  // Parse both references before looking up providers so malformed values are
  // rejected consistently.
  const chatInput =
    input.chatModel == null ? undefined : parseModelReference(input.chatModel);
  const systemInput =
    input.systemModel == null
      ? undefined
      : parseModelReference(input.systemModel);

  const [chatModelProviders, embeddingModelProviders] = await Promise.all([
    getAvailableChatModelProviders(),
    getAvailableEmbeddingModelProviders(),
  ]);

  const chatSelectionPresent = chatInput !== undefined;
  const chatProviderName = chatSelectionPresent
    ? chatInput.provider
    : Object.keys(chatModelProviders)[0];
  const chatModelProvider = chatProviderName
    ? chatModelProviders[chatProviderName]
    : undefined;
  const chatModelName = chatSelectionPresent
    ? chatInput.name
    : Object.keys(chatModelProvider || {})[0];
  const chatModelEntry = chatModelName
    ? chatModelProvider?.[chatModelName]
    : undefined;

  // Embedding model is a system-level setting: always resolve from the DB
  // (source of truth), never from the request. This keeps indexing, querying,
  // and the embedding cache on one model so their vectors stay comparable.
  const selectedEmbedding = getEmbeddingModelSelection();
  const embeddingSelectionPresent =
    selectedEmbedding.provider !== '' || selectedEmbedding.name !== '';
  const embeddingProviderKey = embeddingSelectionPresent
    ? selectedEmbedding.provider
    : Object.keys(embeddingModelProviders)[0];
  const embeddingProvider = embeddingModelProviders[embeddingProviderKey];
  const embeddingModelName = embeddingSelectionPresent
    ? selectedEmbedding.name
    : Object.keys(embeddingProvider || {})[0];
  const embeddingModelEntry = embeddingModelName
    ? embeddingProvider?.[embeddingModelName]
    : undefined;

  if (!embeddingModelEntry) {
    throw new Error('Invalid embedding model');
  }

  const embedding = new CachedEmbeddings(
    embeddingModelEntry.model,
    embeddingProviderKey,
    embeddingModelName,
  );

  let chatResolved: ResolvedModelRef | undefined;
  if (chatProviderName && chatModelName && chatModelEntry) {
    chatResolved = bindCatalogModel(
      chatInput ?? {
        provider: chatProviderName,
        name: chatModelName,
      },
      chatModelEntry,
      {
        isolate: true,
        preserveEffort: input.preserveEffort,
      },
    );
  }

  if (!chatResolved) throw new Error('Invalid chat model');
  setContextWindow(chatResolved.model, chatResolved.ref);

  let systemResolved: ResolvedModelRef | undefined;
  if (systemInput) {
    const systemEntry =
      chatModelProviders[systemInput.provider]?.[systemInput.name];
    if (!systemEntry) throw new Error('Invalid system model');
    systemResolved = bindCatalogModel(systemInput, systemEntry, {
      isolate: true,
      preserveEffort: input.preserveEffort,
    });
    setContextWindow(systemResolved.model, systemResolved.ref);
  }

  // An omitted system model follows the complete effective Chat reference,
  // including its clamped effort and context window configuration.
  if (!systemInput) systemResolved = chatResolved;
  if (!systemResolved) throw new Error('Invalid system model');

  return {
    chatLlm: chatResolved.model,
    systemLlm: systemResolved.model,
    embedding,
    chatModelRef: chatResolved.ref,
    systemModelRef: systemResolved.ref,
  };
}
