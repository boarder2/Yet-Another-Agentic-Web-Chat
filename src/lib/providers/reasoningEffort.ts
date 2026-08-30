/**
 * Shared reasoning-effort contract. Keep this module free of server-only
 * imports so the model catalog and client-side selectors can use it safely.
 */

import { z } from 'zod';

export const REASONING_EFFORT_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

/** Stable ordering used by selectors and stale-value resolution. */
export const REASONING_EFFORT_ORDER = REASONING_EFFORT_LEVELS;

export type ReasoningEffort = (typeof REASONING_EFFORT_LEVELS)[number];

/** Runtime schema used by every JSON model-reference boundary. */
export const reasoningEffortSchema = z.enum(REASONING_EFFORT_LEVELS);

export const REASONING_EFFORT_LABELS: Record<ReasoningEffort, string> = {
  off: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'X-high',
  max: 'Max',
};

export interface ReasoningEffortOption {
  readonly value: ReasoningEffort;
  readonly label: string;
}

export const REASONING_EFFORT_OPTIONS = REASONING_EFFORT_LEVELS.map(
  (value) => ({
    value,
    label: REASONING_EFFORT_LABELS[value],
  }),
) as readonly ReasoningEffortOption[];

const REASONING_EFFORT_SET: ReadonlySet<string> = new Set(
  REASONING_EFFORT_LEVELS,
);
const REASONING_EFFORT_INDEX: ReadonlyMap<ReasoningEffort, number> = new Map(
  REASONING_EFFORT_LEVELS.map((value, index) => [value, index]),
);

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === 'string' && REASONING_EFFORT_SET.has(value);
}

/** Alias for callers that want a predicate-shaped validator. */
export const validateReasoningEffort = isReasoningEffort;

/**
 * Parse the optional model-reference value. Provider default is represented by
 * omission; a present value must be one of the normalized levels.
 */
export function parseReasoningEffort(
  value: unknown,
): ReasoningEffort | undefined {
  if (value === undefined) return undefined;
  if (!isReasoningEffort(value)) {
    throw new Error(
      `Invalid reasoning effort. Expected one of: ${REASONING_EFFORT_LEVELS.join(
        ', ',
      )}.`,
    );
  }
  return value;
}

export function assertReasoningEffort(value: unknown): ReasoningEffort {
  const parsed = parseReasoningEffort(value);
  if (parsed === undefined) {
    throw new Error('Reasoning effort is required.');
  }
  return parsed;
}

/** Return recognized levels in canonical order, removing duplicates. */
export function normalizeReasoningEfforts(
  values: readonly unknown[],
): ReasoningEffort[] {
  const selected = new Set<ReasoningEffort>();
  for (const value of values) {
    if (isReasoningEffort(value)) selected.add(value);
  }
  return REASONING_EFFORT_LEVELS.filter((value) => selected.has(value));
}

/**
 * Resolve a requested level against a model's currently advertised levels.
 * Equal-distance ties use the lower level in the stable ordering.
 */
export function clampReasoningEffort(
  requested: ReasoningEffort | undefined,
  supported: readonly ReasoningEffort[] | undefined,
): ReasoningEffort | undefined {
  if (requested === undefined || !supported || supported.length === 0) {
    return undefined;
  }

  const normalized = normalizeReasoningEfforts(supported);
  if (normalized.length === 0) return undefined;
  if (normalized.includes(requested)) return requested;

  const requestedIndex = REASONING_EFFORT_INDEX.get(requested);
  if (requestedIndex === undefined) return undefined;

  let closest = normalized[0];
  let closestDistance = Math.abs(
    (REASONING_EFFORT_INDEX.get(closest) ?? 0) - requestedIndex,
  );

  for (const candidate of normalized.slice(1)) {
    const distance = Math.abs(
      (REASONING_EFFORT_INDEX.get(candidate) ?? 0) - requestedIndex,
    );
    if (distance < closestDistance) {
      closest = candidate;
      closestDistance = distance;
    }
  }

  return closest;
}

/** Alias emphasizing that this resolves stale persisted values. */
export const resolveReasoningEffort = clampReasoningEffort;
export const getNearestSupportedReasoningEffort = clampReasoningEffort;

/**
 * The canonical JSON model reference. Model identity remains exact; effort is
 * invocation configuration and is omitted for Provider default.
 */
export const modelRefSchema = z
  .object({
    provider: z.string().min(1),
    name: z.string().min(1),
    contextWindowSize: z.number().int().positive().optional(),
    reasoningEffort: reasoningEffortSchema.optional(),
  })
  .strict();

export type ModelRefContract = z.infer<typeof modelRefSchema>;

export class ModelReferenceValidationError extends Error {
  readonly issues: z.ZodIssue[];

  constructor(message: string, issues: z.ZodIssue[] = []) {
    super(message);
    this.name = 'ModelReferenceValidationError';
    this.issues = issues;
  }
}

function describeModelReferenceIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'model';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

/** Parse a model reference without coercing or dropping malformed fields. */
export function parseModelReference(value: unknown): ModelRefContract {
  const parsed = modelRefSchema.safeParse(value);
  if (!parsed.success) {
    const effortIssue = parsed.error.issues.find(
      (issue) => issue.path.length === 1 && issue.path[0] === 'reasoningEffort',
    );
    const detail = effortIssue
      ? `Invalid reasoning effort: ${effortIssue.message}`
      : describeModelReferenceIssues(parsed.error.issues);
    throw new ModelReferenceValidationError(
      `Invalid model reference: ${detail}`,
      parsed.error.issues,
    );
  }
  return parsed.data;
}

/** Return a model reference with Provider default represented by omission. */
export function withoutReasoningEffort<T extends object>(
  ref: T,
): Omit<T, 'reasoningEffort'> {
  const withoutEffort = { ...ref } as T & { reasoningEffort?: unknown };
  delete withoutEffort.reasoningEffort;
  return withoutEffort as Omit<T, 'reasoningEffort'>;
}

export type ReasoningEffortProvider =
  'openrouter' | 'openai' | 'anthropic' | 'gemini' | 'groq' | 'deepseek';

export interface NativeReasoningEffortProfile {
  readonly provider: ReasoningEffortProvider;
  readonly pattern: RegExp;
  readonly supportedReasoningEfforts: readonly ReasoningEffort[];
  /** Whether non-off effort uses Anthropic adaptive thinking. */
  readonly anthropicAdaptive?: boolean;
}

const OPENAI_GPT_56_LEVELS = [
  'off',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const satisfies readonly ReasoningEffort[];
const OPENAI_GPT_55_LEVELS = [
  'off',
  'low',
  'medium',
  'high',
  'xhigh',
] as const satisfies readonly ReasoningEffort[];
const OPENAI_GPT_54_LEVELS = OPENAI_GPT_55_LEVELS;
const OPENAI_GPT_53_CODEX_LEVELS = [
  'off',
  'low',
  'medium',
  'high',
  'xhigh',
] as const satisfies readonly ReasoningEffort[];
const OPENAI_GPT_52_CODEX_LEVELS = [
  'low',
  'medium',
  'high',
  'xhigh',
] as const satisfies readonly ReasoningEffort[];
const OPENAI_GPT_51_LEVELS = [
  'off',
  'low',
  'medium',
  'high',
] as const satisfies readonly ReasoningEffort[];
const OPENAI_GPT_5_LEVELS = [
  'minimal',
  'low',
  'medium',
  'high',
] as const satisfies readonly ReasoningEffort[];
const OPENAI_O_SERIES_LEVELS = [
  'low',
  'medium',
  'high',
] as const satisfies readonly ReasoningEffort[];
const OPENAI_GPT_52_CHAT_LEVELS = [
  'medium',
] as const satisfies readonly ReasoningEffort[];

const ANTHROPIC_LOW_TO_HIGH_LEVELS = [
  'low',
  'medium',
  'high',
] as const satisfies readonly ReasoningEffort[];
const ANTHROPIC_OPTIONAL_LOW_TO_HIGH_LEVELS = [
  'off',
  ...ANTHROPIC_LOW_TO_HIGH_LEVELS,
] as const satisfies readonly ReasoningEffort[];
const ANTHROPIC_MAX_LEVELS = [
  'low',
  'medium',
  'high',
  'max',
] as const satisfies readonly ReasoningEffort[];
const ANTHROPIC_OPTIONAL_MAX_LEVELS = [
  'off',
  ...ANTHROPIC_MAX_LEVELS,
] as const satisfies readonly ReasoningEffort[];
const ANTHROPIC_XHIGH_MAX_LEVELS = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const satisfies readonly ReasoningEffort[];
const ANTHROPIC_OPTIONAL_XHIGH_MAX_LEVELS = [
  'off',
  ...ANTHROPIC_XHIGH_MAX_LEVELS,
] as const satisfies readonly ReasoningEffort[];

const GEMINI_MINIMAL_TO_HIGH_LEVELS = [
  'minimal',
  'low',
  'medium',
  'high',
] as const satisfies readonly ReasoningEffort[];
const GEMINI_LOW_TO_HIGH_LEVELS = [
  'low',
  'medium',
  'high',
] as const satisfies readonly ReasoningEffort[];
const GEMINI_LOW_HIGH_LEVELS = [
  'low',
  'high',
] as const satisfies readonly ReasoningEffort[];

const GROQ_OFF_LEVELS = ['off'] as const satisfies readonly ReasoningEffort[];
const GROQ_LOW_TO_HIGH_LEVELS = [
  'low',
  'medium',
  'high',
] as const satisfies readonly ReasoningEffort[];
const GROQ_OFF_TO_HIGH_LEVELS = [
  'off',
  ...GROQ_LOW_TO_HIGH_LEVELS,
] as const satisfies readonly ReasoningEffort[];

const DEEPSEEK_LEVELS = [
  'off',
  'low',
  'high',
  'max',
] as const satisfies readonly ReasoningEffort[];

function profile(
  provider: ReasoningEffortProvider,
  pattern: RegExp,
  supportedReasoningEfforts: readonly ReasoningEffort[],
  options?: Pick<NativeReasoningEffortProfile, 'anthropicAdaptive'>,
): NativeReasoningEffortProfile {
  return {
    provider,
    pattern,
    supportedReasoningEfforts,
    ...options,
  };
}

/** Direct-provider profiles. Do not infer capabilities from model names. */
const DIRECT_REASONING_EFFORT_PROFILES: readonly NativeReasoningEffortProfile[] =
  [
    profile(
      'openai',
      /^gpt-5\.6(?:-(?:luna|terra|sol))?(?:-pro)?(?:-\d{4}-\d{2}-\d{2})?$/i,
      OPENAI_GPT_56_LEVELS,
    ),
    profile(
      'openai',
      /^gpt-5\.5(?:-\d{4}-\d{2}-\d{2})?$/i,
      OPENAI_GPT_55_LEVELS,
    ),
    profile('openai', /^gpt-5\.5-pro(?:-\d{4}-\d{2}-\d{2})?$/i, [
      'medium',
      'high',
      'xhigh',
    ]),
    profile(
      'openai',
      /^gpt-5\.4(?:-(?:mini|nano))?(?:-\d{4}-\d{2}-\d{2})?$/i,
      OPENAI_GPT_54_LEVELS,
    ),
    profile('openai', /^gpt-5\.4-pro(?:-\d{4}-\d{2}-\d{2})?$/i, [
      'medium',
      'high',
      'xhigh',
    ]),
    profile(
      'openai',
      /^gpt-5\.3-codex(?:-spark)?(?:-\d{4}-\d{2}-\d{2})?$/i,
      OPENAI_GPT_53_CODEX_LEVELS,
    ),
    profile(
      'openai',
      /^gpt-5\.2-chat-latest(?:-\d{4}-\d{2}-\d{2})?$/i,
      OPENAI_GPT_52_CHAT_LEVELS,
    ),
    profile('openai', /^gpt-5\.2-pro(?:-\d{4}-\d{2}-\d{2})?$/i, [
      'medium',
      'high',
      'xhigh',
    ]),
    profile(
      'openai',
      /^gpt-5\.2-codex(?:-\d{4}-\d{2}-\d{2})?$/i,
      OPENAI_GPT_52_CODEX_LEVELS,
    ),
    profile(
      'openai',
      /^gpt-5\.2(?:-\d{4}-\d{2}-\d{2})?$/i,
      OPENAI_GPT_54_LEVELS,
    ),
    profile(
      'openai',
      /^gpt-5\.1-codex-max(?:-\d{4}-\d{2}-\d{2})?$/i,
      OPENAI_GPT_52_CODEX_LEVELS,
    ),
    profile(
      'openai',
      /^gpt-5\.1-codex(?:-mini)?(?:-\d{4}-\d{2}-\d{2})?$/i,
      OPENAI_O_SERIES_LEVELS,
    ),
    profile(
      'openai',
      /^gpt-5\.1(?:-\d{4}-\d{2}-\d{2})?$/i,
      OPENAI_GPT_51_LEVELS,
    ),
    profile(
      'openai',
      /^gpt-5(?:-(?:mini|nano))?(?:-\d{4}-\d{2}-\d{2})?$/i,
      OPENAI_GPT_5_LEVELS,
    ),
    profile('openai', /^gpt-5-pro(?:-\d{4}-\d{2}-\d{2})?$/i, ['high']),
    profile(
      'openai',
      /^o(?:1(?:-mini|-pro)?|3(?:-mini|-pro)?|4-mini)(?:-\d{4}-\d{2}-\d{2})?$/i,
      OPENAI_O_SERIES_LEVELS,
    ),

    // Claude models with named effort are the only direct Anthropic models
    // included here. Budget-token-only models intentionally have no profile.
    profile(
      'anthropic',
      /^claude-(?:fable-5|mythos-5|mythos-preview)(?:-\d{8})?$/i,
      ANTHROPIC_XHIGH_MAX_LEVELS,
      { anthropicAdaptive: true },
    ),
    profile(
      'anthropic',
      /^claude-(?:opus-5|opus-4-7|opus-4-8|sonnet-5)(?:-\d{8})?$/i,
      ANTHROPIC_OPTIONAL_XHIGH_MAX_LEVELS,
      { anthropicAdaptive: true },
    ),
    profile(
      'anthropic',
      /^claude-opus-4-6(?:-\d{8})?$/i,
      ANTHROPIC_OPTIONAL_MAX_LEVELS,
      { anthropicAdaptive: true },
    ),
    profile(
      'anthropic',
      /^claude-sonnet-4-6(?:-\d{8})?$/i,
      ANTHROPIC_OPTIONAL_MAX_LEVELS,
      { anthropicAdaptive: true },
    ),
    profile(
      'anthropic',
      /^claude-opus-4-5(?:-20251101)?$/i,
      ANTHROPIC_OPTIONAL_LOW_TO_HIGH_LEVELS,
      { anthropicAdaptive: false },
    ),

    // Gemini 2.5 exposes a token budget, not a named effort, so it is omitted.
    profile(
      'gemini',
      /^(?!.*(?:image|live|tts|audio))gemini-(?:flash-lite-latest|flash-latest)$/i,
      GEMINI_MINIMAL_TO_HIGH_LEVELS,
    ),
    profile(
      'gemini',
      /^(?!.*(?:image|live|tts|audio))gemini-3\.7-flash(?:-[\w.-]+)?$/i,
      GEMINI_LOW_TO_HIGH_LEVELS,
    ),
    profile(
      'gemini',
      /^(?!.*(?:image|live|tts|audio))gemini-3\.(?:1|5|6)-flash(?:-lite)?(?:-[\w.-]+)?$/i,
      GEMINI_MINIMAL_TO_HIGH_LEVELS,
    ),
    profile(
      'gemini',
      /^(?!.*(?:image|live|tts|audio))gemini-3-flash(?:-[\w.-]+)?$/i,
      GEMINI_MINIMAL_TO_HIGH_LEVELS,
    ),
    profile(
      'gemini',
      /^(?!.*(?:image|live|tts|audio))gemini-3\.1-pro(?:-[\w.-]+)?$/i,
      GEMINI_LOW_TO_HIGH_LEVELS,
    ),
    // Keep the model alias supported by the Google catalog as a documented
    // exception; image variants are excluded by the negative look-ahead.
    profile(
      'gemini',
      /^(?!.*(?:image|live|tts|audio))gemini-3-pro(?:-[\w.-]+)?$/i,
      GEMINI_LOW_HIGH_LEVELS,
    ),

    profile('groq', /^openai\/gpt-oss-(?:20b|120b)$/i, GROQ_LOW_TO_HIGH_LEVELS),
    profile('groq', /^qwen\/qwen3\.6-27b$/i, GROQ_OFF_LEVELS),
    profile('groq', /^qwen\/qwen3\.8-27b$/i, GROQ_OFF_TO_HIGH_LEVELS),
    profile('groq', /^qwen\/qwen3-32b$/i, GROQ_OFF_TO_HIGH_LEVELS),

    profile(
      'deepseek',
      /^deepseek-v4-(?:flash|pro)(?:-(?:latest|0731|0813))?(?:-vision-exp)?$/i,
      DEEPSEEK_LEVELS,
    ),
  ];

/**
 * OpenRouter has no level list in its model response. Its supported parameter
 * list supplies the base capability and these exceptions carry documented
 * model-specific levels and toggle behavior.
 */
const OPENROUTER_REASONING_EFFORT_PROFILES: readonly NativeReasoningEffortProfile[] =
  [
    profile(
      'openrouter',
      /^openai\/gpt-5\.6(?:-(?:luna|terra|sol))?(?:-pro)?$/i,
      OPENAI_GPT_56_LEVELS,
    ),
    profile('openrouter', /^openai\/gpt-5\.5$/i, OPENAI_GPT_55_LEVELS),
    profile('openrouter', /^openai\/gpt-5\.5-pro$/i, [
      'medium',
      'high',
      'xhigh',
    ]),
    profile(
      'openrouter',
      /^openai\/gpt-5\.4(?:-(?:mini|nano))?$/i,
      OPENAI_GPT_54_LEVELS,
    ),
    profile('openrouter', /^openai\/gpt-5\.4-pro$/i, [
      'medium',
      'high',
      'xhigh',
    ]),
    profile('openrouter', /^openai\/gpt-5\.3-codex(?:-spark)?$/i, [
      ...OPENAI_GPT_53_CODEX_LEVELS,
    ]),
    profile('openrouter', /^openai\/gpt-5\.2-chat-latest$/i, [
      ...OPENAI_GPT_52_CHAT_LEVELS,
    ]),
    profile('openrouter', /^openai\/gpt-5\.2-pro$/i, [
      'medium',
      'high',
      'xhigh',
    ]),
    profile('openrouter', /^openai\/gpt-5\.2-codex$/i, [
      ...OPENAI_GPT_52_CODEX_LEVELS,
    ]),
    profile('openrouter', /^openai\/gpt-5\.2$/i, OPENAI_GPT_54_LEVELS),
    profile('openrouter', /^openai\/gpt-5\.1-codex-max$/i, [
      ...OPENAI_GPT_52_CODEX_LEVELS,
    ]),
    profile('openrouter', /^openai\/gpt-5\.1-codex(?:-mini)?$/i, [
      ...OPENAI_O_SERIES_LEVELS,
    ]),
    profile('openrouter', /^openai\/gpt-5\.1$/i, OPENAI_GPT_51_LEVELS),
    profile('openrouter', /^openai\/gpt-5(?:-(?:mini|nano))?$/i, [
      ...OPENAI_GPT_5_LEVELS,
    ]),
    profile('openrouter', /^openai\/gpt-5-pro$/i, ['high']),
    profile('openrouter', /^openai\/o(?:1|3|4-mini)$/i, ['off']),
    profile(
      'openrouter',
      /^openai\/gpt-oss-(?:20b|120b)$/i,
      GROQ_LOW_TO_HIGH_LEVELS,
    ),

    profile(
      'openrouter',
      /^anthropic\/claude-(?:fable-5|mythos-5|mythos-preview)$/i,
      ANTHROPIC_XHIGH_MAX_LEVELS,
    ),
    profile(
      'openrouter',
      /^anthropic\/claude-(?:opus-5|opus-4[.-]7|opus-4[.-]8|sonnet-5)$/i,
      ANTHROPIC_OPTIONAL_XHIGH_MAX_LEVELS,
    ),
    profile(
      'openrouter',
      /^anthropic\/(?:claude-opus-4[.-]6|claude-sonnet-4[.-]6)$/i,
      ANTHROPIC_OPTIONAL_MAX_LEVELS,
    ),
    profile(
      'openrouter',
      /^anthropic\/claude-opus-4[.-]5(?:-20251101)?$/i,
      ANTHROPIC_OPTIONAL_LOW_TO_HIGH_LEVELS,
    ),

    profile(
      'openrouter',
      /^google\/gemini-3\.7-flash$/i,
      GEMINI_LOW_TO_HIGH_LEVELS,
    ),
    profile(
      'openrouter',
      /^(?!.*(?:image|live|tts|audio))google\/gemini-(?:flash-lite|flash)-latest$/i,
      GEMINI_LOW_TO_HIGH_LEVELS,
    ),
    profile(
      'openrouter',
      /^(?!.*(?:image|live|tts|audio))google\/gemini-3\.(?:1|5|6)-flash(?:-lite)?(?:-preview)?$/i,
      GEMINI_MINIMAL_TO_HIGH_LEVELS,
    ),
    profile(
      'openrouter',
      /^(?!.*(?:image|live|tts|audio))google\/gemini-3-flash-preview$/i,
      GEMINI_MINIMAL_TO_HIGH_LEVELS,
    ),
    profile(
      'openrouter',
      /^(?!.*(?:image|live|tts|audio))google\/gemini-3\.1-pro-preview(?:-customtools)?$/i,
      GEMINI_LOW_TO_HIGH_LEVELS,
    ),

    profile(
      'openrouter',
      /^deepseek\/deepseek-v4-(?:flash|pro)(?:-(?:latest|0731|0813))?(?:-vision-exp)?$/i,
      DEEPSEEK_LEVELS,
    ),
    profile('openrouter', /^deepseek\/deepseek-r1(?:-\d+)?$/i, ['off']),

    profile('openrouter', /^qwen\/qwen3\.8-27b$/i, [
      'off',
      'low',
      'medium',
      'xhigh',
    ]),
    profile('openrouter', /^qwen\/qwen3\.6-27b$/i, ['off']),
    profile('openrouter', /^google\/gemini-2\.5-(?:flash|pro)/i, ['off']),

    profile('openrouter', /^x-ai\/grok-4\.6(?:-.*)?$/i, [
      'low',
      'medium',
      'high',
      'xhigh',
    ]),
    profile('openrouter', /^x-ai\/grok-4\.5(?:-.*)?$/i, [
      'low',
      'medium',
      'high',
    ]),
    profile('openrouter', /^x-ai\/grok-4\.3(?:-.*)?$/i, [
      'off',
      'low',
      'medium',
      'high',
    ]),
    profile('openrouter', /^z-ai\/glm-5\.3(?:-flash)?(?:-.*)?$/i, [
      'low',
      'high',
      'max',
    ]),
    profile('openrouter', /^z-ai\/glm-5\.2(?::free)?$/i, [
      'off',
      'high',
      'xhigh',
    ]),
    profile('openrouter', /^thinkingmachines\/inkling(?:-small)?$/i, [
      'off',
      'minimal',
      'low',
      'medium',
      'high',
      'max',
    ]),
    profile('openrouter', /^mistralai\/mistral-(?:medium-3-5|small-2603)$/i, [
      'off',
      'high',
    ]),
  ];

/** All documented native profiles, kept in one table for adapters and tests. */
export const NATIVE_REASONING_EFFORT_PROFILES: readonly NativeReasoningEffortProfile[] =
  [
    ...DIRECT_REASONING_EFFORT_PROFILES,
    ...OPENROUTER_REASONING_EFFORT_PROFILES,
  ];

export const REASONING_EFFORT_PROFILES = NATIVE_REASONING_EFFORT_PROFILES;

function modelCandidates(provider: string, model: string): string[] {
  if (provider !== 'openrouter') return [model];
  // OpenRouter route suffixes (for example :free and :batch) do not change
  // the underlying model's native effort levels.
  return [model, model.split(':', 1)[0]];
}

export function getNativeReasoningEffortProfile(
  provider: string,
  model: string,
): NativeReasoningEffortProfile | undefined {
  const normalizedProvider = provider.toLowerCase();
  return NATIVE_REASONING_EFFORT_PROFILES.find(
    (candidate) =>
      candidate.provider === normalizedProvider &&
      modelCandidates(normalizedProvider, model).some((candidateModel) => {
        candidate.pattern.lastIndex = 0;
        return candidate.pattern.test(candidateModel);
      }),
  );
}

export interface OpenRouterReasoningMetadata {
  readonly mandatory?: boolean;
  readonly defaultEnabled?: boolean;
  readonly default_enabled?: boolean;
  readonly defaultEffort?: unknown;
  readonly default_effort?: unknown;
  readonly supportedEfforts?: readonly unknown[] | null;
  readonly supported_efforts?: readonly unknown[] | null;
}

export interface OpenRouterReasoningOption {
  readonly type?: unknown;
  readonly values?: readonly unknown[];
}

export interface ReasoningEffortDiscoveryOptions {
  readonly supportedParameters?: readonly unknown[];
  readonly supported_parameters?: readonly unknown[];
  readonly reasoning?: OpenRouterReasoningMetadata;
  readonly reasoningOptions?: readonly OpenRouterReasoningOption[] | null;
  readonly reasoning_options?: readonly OpenRouterReasoningOption[] | null;
}

const OPENROUTER_PARAMETER_LEVELS = [
  'low',
  'medium',
  'high',
] as const satisfies readonly ReasoningEffort[];

function normalizeOpenRouterReasoningEfforts(
  values: readonly unknown[],
): ReasoningEffort[] {
  return normalizeReasoningEfforts(
    values.map((value) => (value === 'none' ? 'off' : value)),
  );
}

function getParameters(
  options: ReasoningEffortDiscoveryOptions,
): string[] | undefined {
  const raw = options.supportedParameters ?? options.supported_parameters;
  if (raw === undefined) return undefined;
  return raw.filter((value): value is string => typeof value === 'string');
}

function hasReasoningParameter(
  options: ReasoningEffortDiscoveryOptions,
): boolean {
  return (
    getParameters(options)?.some(
      (parameter) =>
        parameter.toLowerCase() === 'reasoning' ||
        parameter.toLowerCase() === 'reasoning_effort',
    ) ?? false
  );
}

function getOpenRouterSupportedEfforts(
  reasoning: OpenRouterReasoningMetadata | undefined,
): readonly unknown[] | null | undefined {
  if (!reasoning) return undefined;
  if (Object.prototype.hasOwnProperty.call(reasoning, 'supportedEfforts')) {
    return reasoning.supportedEfforts;
  }
  return reasoning.supported_efforts;
}

function getOpenRouterReasoningOptions(
  options: ReasoningEffortDiscoveryOptions,
): readonly OpenRouterReasoningOption[] | null | undefined {
  if (Object.prototype.hasOwnProperty.call(options, 'reasoningOptions')) {
    return options.reasoningOptions;
  }
  return options.reasoning_options;
}

function getEffortsFromReasoningOptions(
  options: ReasoningEffortDiscoveryOptions,
): ReasoningEffort[] | undefined {
  const rawOptions = getOpenRouterReasoningOptions(options);
  if (rawOptions === undefined || rawOptions === null) return undefined;

  const efforts: unknown[] = [];
  let hasToggle = false;
  for (const option of rawOptions) {
    if (option?.type === 'toggle') hasToggle = true;
    if (option?.type === 'effort' && Array.isArray(option.values)) {
      efforts.push(...option.values);
    }
  }

  const normalized = normalizeOpenRouterReasoningEfforts(efforts);
  if (hasToggle && !normalized.includes('off')) normalized.unshift('off');
  return normalized.length > 0 ? normalized : undefined;
}

function withoutOff(levels: readonly ReasoningEffort[]): ReasoningEffort[] {
  return levels.filter((level) => level !== 'off');
}

/**
 * Return the native named levels a model can accept. Direct providers use the
 * static profiles. OpenRouter uses its supported parameter list for the base
 * trio and explicit metadata/profiles for model-specific levels.
 */
export function getSupportedReasoningEfforts(
  provider: string,
  model: string,
  options?: ReasoningEffortDiscoveryOptions,
): ReasoningEffort[] | undefined {
  const normalizedProvider = provider.toLowerCase();
  const profile = getNativeReasoningEffortProfile(provider, model);

  if (normalizedProvider !== 'openrouter' || options === undefined) {
    return profile ? [...profile.supportedReasoningEfforts] : undefined;
  }

  const parameters = getParameters(options);
  const hasParameterMetadata = parameters !== undefined;
  const hasReasoningParameterValue = hasReasoningParameter(options);
  const rawSupportedEfforts = getOpenRouterSupportedEfforts(options.reasoning);
  const hasExplicitEfforts = Array.isArray(rawSupportedEfforts);
  const hasReasoningOptions =
    getOpenRouterReasoningOptions(options) !== undefined;
  const optionEfforts = getEffortsFromReasoningOptions(options);
  // An explicit parameter list without a reasoning parameter is authoritative;
  // in particular, budget-only models must not receive named effort controls.
  if (hasParameterMetadata && !hasReasoningParameterValue) return undefined;

  let supported: ReasoningEffort[] | undefined;
  if (hasExplicitEfforts) {
    supported = normalizeOpenRouterReasoningEfforts(rawSupportedEfforts);
  } else if (rawSupportedEfforts === null) {
    supported = [...REASONING_EFFORT_LEVELS];
  } else if (optionEfforts) {
    supported = optionEfforts;
  } else if (hasReasoningOptions) {
    // An explicitly empty reasoning-options list means no named effort.
    return undefined;
  } else if (profile) {
    supported = [...profile.supportedReasoningEfforts];
  } else if (hasReasoningParameterValue) {
    // OpenRouter's generic reasoning object documents low/medium/high. More
    // permissive levels are added only by an explicit model profile.
    supported = [...OPENROUTER_PARAMETER_LEVELS];
  }

  if (!supported || supported.length === 0) return undefined;
  const resolved = options.reasoning?.mandatory
    ? withoutOff(supported)
    : supported;
  return resolved.length > 0 ? resolved : undefined;
}

export function getReasoningEffortMetadata(
  provider: string,
  model: string,
  options?: ReasoningEffortDiscoveryOptions,
): { supportedReasoningEfforts?: ReasoningEffort[] } {
  const supportedReasoningEfforts = getSupportedReasoningEfforts(
    provider,
    model,
    options,
  );
  return supportedReasoningEfforts ? { supportedReasoningEfforts } : {};
}

export interface NativeReasoningEffortConfig {
  readonly provider: ReasoningEffortProvider;
  readonly effort: ReasoningEffort;
  readonly nativeEffort?: string;
  /** Provider-native request fragment, before it is bound to a model. */
  readonly request: Readonly<Record<string, unknown>>;
}

const NATIVE_PROVIDERS: ReadonlySet<string> = new Set([
  'openrouter',
  'openai',
  'anthropic',
  'gemini',
  'groq',
  'deepseek',
]);

/** Return the provider-native request fragment for one normalized level. */
export function getNativeReasoningEffortConfig(
  provider: string,
  model: string,
  effort: ReasoningEffort,
): NativeReasoningEffortConfig | undefined {
  const normalizedProvider = provider.toLowerCase();
  if (!NATIVE_PROVIDERS.has(normalizedProvider)) return undefined;
  const nativeProvider = normalizedProvider as ReasoningEffortProvider;

  if (normalizedProvider === 'openrouter') {
    const nativeEffort = effort === 'off' ? 'none' : effort;
    return {
      provider: nativeProvider,
      effort,
      nativeEffort,
      request: { reasoning: { effort: nativeEffort } },
    };
  }

  if (normalizedProvider === 'openai') {
    const nativeEffort = effort === 'off' ? 'none' : effort;
    return {
      provider: nativeProvider,
      effort,
      nativeEffort,
      request: { reasoning: { effort: nativeEffort } },
    };
  }

  if (normalizedProvider === 'anthropic') {
    if (effort === 'off') {
      return {
        provider: nativeProvider,
        effort,
        request: { thinking: { type: 'disabled' } },
      };
    }

    const profile = getNativeReasoningEffortProfile(provider, model);
    return {
      provider: nativeProvider,
      effort,
      nativeEffort: effort,
      request: {
        output_config: { effort },
        ...(profile?.anthropicAdaptive
          ? { thinking: { type: 'adaptive' } }
          : {}),
      },
    };
  }

  if (normalizedProvider === 'gemini') {
    return {
      provider: nativeProvider,
      effort,
      nativeEffort: effort === 'off' ? undefined : effort.toUpperCase(),
      request:
        effort === 'off'
          ? {}
          : {
              generationConfig: {
                thinkingConfig: { thinkingLevel: effort.toUpperCase() },
              },
            },
    };
  }

  if (normalizedProvider === 'groq') {
    const nativeEffort = effort === 'off' ? 'none' : effort;
    return {
      provider: nativeProvider,
      effort,
      nativeEffort,
      request: { reasoning_effort: nativeEffort },
    };
  }

  if (effort === 'off') {
    return {
      provider: nativeProvider,
      effort,
      request: { thinking: { type: 'disabled' } },
    };
  }

  return {
    provider: nativeProvider,
    effort,
    nativeEffort: effort,
    request: {
      reasoning_effort: effort,
      thinking: { type: 'enabled' },
    },
  };
}

export const mapReasoningEffort = getNativeReasoningEffortConfig;
