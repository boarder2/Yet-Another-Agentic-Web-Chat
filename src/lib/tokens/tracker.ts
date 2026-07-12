/**
 * Centralized per-model token tracking for a user-visible turn (ModelStats v2).
 *
 * One `TokenTracker` is created per turn (chat route, scheduled task runner)
 * and passed down explicitly to the agent, its tools, and any child runs
 * (panel executors, deep_research subagents). Callers `register()` a
 * `Recorder` at model-resolution time — when a `{provider, model}` identity is
 * known — and call `record()` on it as usage arrives. Every `record()` emits a
 * fresh `model_stats` snapshot on the turn's emitter, matching the previous
 * per-call emission cadence.
 *
 * Row identity is (provider, model) only — the same model used in different
 * roles (chat answer + tool calls) or scopes (panel executors, subagents)
 * collapses into a single row. `role` exists solely to fill the frozen legacy
 * wire shapes (`PanelUsage`'s `usageChat`/`usageSystem` split) via
 * `scopeUsage()`; it plays no part in `perModel()`'s identity.
 */

import type { EventEmitter } from 'events';
import {
  emitStreamEvent,
  type ModelStatsV2,
  type PanelUsage,
  type TokenUsage,
} from '@/lib/streaming/events';

export type RecorderRole = 'chat' | 'system' | 'image_gen';

export interface Recorder {
  /** Accumulate usage onto the registered (provider, model, role, scope) entry and emit a snapshot. */
  record(usage: TokenUsage): void;
}

interface RegisterOptions {
  provider: string;
  model: string;
  /** Used ONLY to fill frozen legacy wire shapes (`scopeUsage`'s chat/system split). */
  role: RecorderRole;
  /** `'panel_executor:N'` | `'subagent:<id>'` | absent (root turn scope). */
  scope?: string;
}

const ZERO_USAGE: TokenUsage = {
  input_tokens: 0,
  output_tokens: 0,
  total_tokens: 0,
};

function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input_tokens: a.input_tokens + (b.input_tokens || 0),
    output_tokens: a.output_tokens + (b.output_tokens || 0),
    total_tokens: a.total_tokens + (b.total_tokens || 0),
  };
}

const ROOT_SCOPE = '';

interface Entry {
  provider: string;
  model: string;
  role: RecorderRole;
  scope: string;
  usage: TokenUsage;
  /** A model only appears in `perModel()` once it has recorded ≥1 call. */
  recorded: boolean;
}

/**
 * Normalize usage metadata from different LLM providers into the canonical
 * `{input_tokens, output_tokens, total_tokens}` shape.
 */
export function normalizeUsageMetadata(
  usageData: Record<string, number>,
): TokenUsage {
  if (!usageData) return { ...ZERO_USAGE };

  const inputTokens =
    usageData.input_tokens ||
    usageData.prompt_tokens ||
    usageData.promptTokens ||
    usageData.usedTokens ||
    0;

  const outputTokens =
    usageData.output_tokens ||
    usageData.completion_tokens ||
    usageData.completionTokens ||
    0;

  const totalTokens =
    usageData.total_tokens ||
    usageData.totalTokens ||
    usageData.usedTokens ||
    inputTokens + outputTokens;

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
  };
}

export class TokenTracker {
  private emitter: EventEmitter;
  private entries: Entry[] = [];
  private rootChatKey: string | null = null;
  private rootChatRecorded = false;
  private firstChatCallInputTokens = 0;
  private rootIdentities = new Map<
    RecorderRole,
    { provider: string; model: string }
  >();

  constructor(emitter: EventEmitter) {
    this.emitter = emitter;
  }

  /** Register a (provider, model, role, scope) identity and get a `Recorder` for it. */
  register(opts: RegisterOptions): Recorder {
    const scope = opts.scope ?? ROOT_SCOPE;
    const entry: Entry = {
      provider: opts.provider,
      model: opts.model,
      role: opts.role,
      scope,
      usage: { ...ZERO_USAGE },
      recorded: false,
    };
    this.entries.push(entry);

    const isRootChat = opts.role === 'chat' && scope === ROOT_SCOPE;
    if (isRootChat && this.rootChatKey === null) {
      this.rootChatKey = modelKey(opts.provider, opts.model);
    }
    if (scope === ROOT_SCOPE && !this.rootIdentities.has(opts.role)) {
      this.rootIdentities.set(opts.role, {
        provider: opts.provider,
        model: opts.model,
      });
    }

    return {
      record: (usage: TokenUsage) => {
        entry.usage = addUsage(entry.usage, usage);
        entry.recorded = true;
        if (isRootChat && !this.rootChatRecorded) {
          this.rootChatRecorded = true;
          this.firstChatCallInputTokens = usage.input_tokens || 0;
        }
        emitStreamEvent(this.emitter, {
          type: 'model_stats',
          data: this.statsV2(),
        });
      },
    };
  }

  /** Per-model rollup across all scopes/roles: chat model first, then total desc. */
  perModel(): ModelStatsV2['perModel'] {
    const map = new Map<
      string,
      { provider: string; model: string; usage: TokenUsage }
    >();
    for (const e of this.entries) {
      if (!e.recorded) continue;
      const key = modelKey(e.provider, e.model);
      const existing = map.get(key);
      if (existing) {
        existing.usage = addUsage(existing.usage, e.usage);
      } else {
        map.set(key, {
          provider: e.provider,
          model: e.model,
          usage: { ...e.usage },
        });
      }
    }
    const rows = Array.from(map.values());
    rows.sort((a, b) => {
      const aIsChat = modelKey(a.provider, a.model) === this.rootChatKey;
      const bIsChat = modelKey(b.provider, b.model) === this.rootChatKey;
      if (aIsChat !== bIsChat) return aIsChat ? -1 : 1;
      return b.usage.total_tokens - a.usage.total_tokens;
    });
    return rows;
  }

  /** Role-split subtotal for a scope, matching the frozen `PanelUsage` shape. */
  scopeUsage(scope: string): PanelUsage {
    let usageChat = { ...ZERO_USAGE };
    let usageSystem = { ...ZERO_USAGE };
    for (const e of this.entries) {
      if (e.scope !== scope) continue;
      if (e.role === 'chat') {
        usageChat = addUsage(usageChat, e.usage);
      } else {
        // 'system' and 'image_gen' both fold into the system bucket for this
        // legacy role-split shape.
        usageSystem = addUsage(usageSystem, e.usage);
      }
    }
    return { usageChat, usageSystem };
  }

  /** The (provider, model) identity registered for a role at the root (turn) scope, if any. */
  rootIdentity(
    role: RecorderRole,
  ): { provider: string; model: string } | undefined {
    return this.rootIdentities.get(role);
  }

  /** Current snapshot: per-model rollup + turn-level bookkeeping fields. */
  statsV2(): ModelStatsV2 {
    return {
      version: 2,
      perModel: this.perModel(),
      firstChatCallInputTokens: this.firstChatCallInputTokens,
    };
  }
}

function modelKey(provider: string, model: string): string {
  return `${provider}::${model}`;
}

/**
 * Create a turn's `TokenTracker` and its root chat/system `Recorder`s in one
 * call — the shape every turn entry point (chat route, widget-builder route,
 * resume, scheduled-task runner) needs. `systemModel` falls back to
 * `chatModel`, matching `resolveChatAndEmbedding`'s own system-model fallback.
 */
export function createTurnTracker(
  emitter: EventEmitter,
  chatModel: { provider: string; name: string },
  systemModel?: { provider: string; name: string } | null,
): { tracker: TokenTracker; chatRecorder: Recorder; systemRecorder: Recorder } {
  const tracker = new TokenTracker(emitter);
  const chatRecorder = tracker.register({
    provider: chatModel.provider,
    model: chatModel.name,
    role: 'chat',
  });
  const sys = systemModel ?? chatModel;
  const systemRecorder = tracker.register({
    provider: sys.provider,
    model: sys.name,
    role: 'system',
  });
  return { tracker, chatRecorder, systemRecorder };
}
