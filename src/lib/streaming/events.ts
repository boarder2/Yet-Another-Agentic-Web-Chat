/**
 * The stream-event vocabulary — defined once.
 *
 * A run's work is streamed as typed events over a single EventEmitter channel
 * ({@link STREAM_EVENT_CHANNEL}). There are two vocabularies that share payload
 * shapes:
 *
 * - {@link AgentEmitEvent} — what producers (the agent, its tools, the panel
 *   coordinator, subagent executors) emit and what run-host / runner consume.
 *   Includes control events (`model_stats`, `interrupt`, `agent_end`,
 *   `agent_error`, `tool_llm_usage`) that never reach a client.
 * - {@link StreamEvent} — the wire vocabulary: what run-host pushes into the
 *   hub, what `run_events` persists, and what the client reducer consumes. The
 *   run host translates control events into wire events (`model_stats`→`stats`,
 *   `interrupt`→`${kind}_pending`, `agent_end`→`messageEnd`, …) and stamps most
 *   events with `messageId`.
 *
 * The wire JSON is persisted and replayed, so wire shapes are frozen.
 */

import type { EventEmitter } from 'events';
import type { Document } from '@langchain/core/documents';
import type { SubagentExecution } from '@/lib/state/chatAgentState';
import type { ChartSpec } from '@/lib/chart/chartSpec';

// ── Shared payload types (single source of truth) ────────────────────────────

export type TokenUsage = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
};

export type ModelStats = {
  modelName: string; // chat model name (legacy total field)
  responseTime?: number;
  usage?: TokenUsage; // combined usage (legacy)
  modelNameChat?: string;
  modelNameSystem?: string;
  usageChat?: TokenUsage;
  usageSystem?: TokenUsage;
  usageImageGen?: TokenUsage & { modelName?: string };
  usedLocation?: boolean;
  usedPersonalization?: boolean;
  memoriesUsed?: number;
  firstChatCallInputTokens?: number;
  projectedNextInputTokens?: number;
};

/** Kinds of tool that raise an approval interrupt. Drives `${kind}_*` events. */
export type ToolKind =
  | 'ask_user'
  | 'code_execution'
  | 'workspace_edit'
  | 'workspace_create'
  | 'skill_edit'
  | 'mcp_tool';

export interface InterruptValue {
  kind: ToolKind;
  toolCallId: string;
  markupKey?: string | null;
  payload: Record<string, unknown>;
  snapshot?: Record<string, unknown> | null;
}

export interface LangGraphInterrupt {
  id: string;
  value: InterruptValue;
}

export type PanelUsage = {
  usageChat: TokenUsage;
  usageSystem: TokenUsage;
};

export type ToolCallStartedData = {
  content: string;
  toolCallId: string;
  status: 'running' | 'success';
};
export type ToolCallSuccessData = {
  toolCallId: string;
  status: 'success';
  extra?: Record<string, string>;
};
export type ToolCallErrorData = {
  toolCallId: string;
  status: 'error';
  error: string;
};
export type TodoUpdateData = {
  todos: Array<{ content: string; status: string }>;
};
export type ChartSpecData = {
  chartId: string;
  spec: ChartSpec;
  source?: string;
  toolCallId?: string;
};
export type CodeExecutionResultData = {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  timedOut?: boolean;
  oomKilled?: boolean;
  toolCallId?: string;
  executionId?: string;
  chartIds?: string[];
  denied?: boolean;
  denyReason?: string;
};
export type WorkspaceFileChangedData = {
  workspaceId: string;
  file: string;
  action: 'create' | 'edit';
};
export type WidgetProposalData = {
  revision: number;
  proposed: unknown;
  rationale: string;
};
export type ToolLlmUsageTarget = 'chat' | 'system' | 'image_gen';

// ── Agent-emit vocabulary (producer → run host) ──────────────────────────────

export type AgentEmitEvent =
  | { type: 'response'; data: string }
  | {
      type: 'sources' | 'sources_added';
      data: Document[];
      searchQuery: string;
      searchUrl: string;
    }
  | { type: 'tool_call_started'; data: ToolCallStartedData }
  | { type: 'tool_call_success'; data: ToolCallSuccessData }
  | { type: 'tool_call_error'; data: ToolCallErrorData }
  | { type: 'todo_update'; data: TodoUpdateData }
  | { type: 'chart_spec'; data: ChartSpecData }
  | { type: 'code_execution_result'; data: CodeExecutionResultData }
  | { type: 'workspace_file_changed'; data: WorkspaceFileChangedData }
  | { type: 'widget_proposal'; data: WidgetProposalData }
  | {
      type: 'context_grew';
      kind: string;
      tokens: number;
      totalEstimated: number;
    }
  | {
      type: 'subagent_started';
      executionId: string;
      name: string;
      task: string;
    }
  | ({ type: 'subagent_completed' } & SubagentExecution)
  | ({ type: 'subagent_error' } & SubagentExecution)
  | {
      type: 'subagent_data';
      subagentId: string;
      subagentName: string;
      data: AgentEmitEvent;
    }
  | { type: 'panel_executor_started'; executorIdx: number; model: string }
  | { type: 'panel_executor_data'; executorIdx: number; token: string }
  | {
      type: 'panel_executor_completed';
      executorIdx: number;
      model: string;
      sourceCount: number;
      usage?: PanelUsage;
    }
  | {
      type: 'panel_executor_error';
      executorIdx: number;
      model: string;
      error: string;
    }
  // Control events — consumed by the run host / the agent itself, never wired.
  | { type: 'model_stats'; data: ModelStats }
  | { type: 'interrupt'; interrupts: LangGraphInterrupt[] }
  | { type: 'agent_end' }
  | { type: 'agent_error'; data: string }
  | {
      type: 'tool_llm_usage';
      target: ToolLlmUsageTarget;
      modelName?: string;
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
    };

// ── Wire vocabulary (run host → client) ──────────────────────────────────────

type WithMessageId = { messageId?: string };

export type ApprovalPendingEvent = {
  type: `${ToolKind}_pending`;
  data: {
    approvalId: string;
    toolCallId?: string;
    markupToolCallId?: string;
    [key: string]: unknown;
  };
} & WithMessageId;
export type ApprovalAnsweredEvent = {
  type: `${ToolKind}_answered`;
  data: {
    approvalId: string;
    response?: unknown;
    [key: string]: unknown;
  };
} & WithMessageId;
export type ApprovalStaleEvent = {
  type: `${ToolKind}_stale`;
  data: { approvalId: string; reason: string };
} & WithMessageId;
export type ApprovalCancelledEvent = {
  type: `${ToolKind}_cancelled`;
  data: { approvalId: string };
} & WithMessageId;

export type StreamEvent =
  | ({ type: 'response'; data: string } & WithMessageId)
  | ({
      type: 'sources' | 'sources_added';
      data: Document[];
      searchQuery?: string;
      searchUrl?: string;
    } & WithMessageId)
  | ({ type: 'tool_call_started'; data: ToolCallStartedData } & WithMessageId)
  | ({ type: 'tool_call_success'; data: ToolCallSuccessData } & WithMessageId)
  | ({ type: 'tool_call_error'; data: ToolCallErrorData } & WithMessageId)
  | ({ type: 'todo_update'; data: TodoUpdateData } & WithMessageId)
  | ({ type: 'chart_spec'; data: ChartSpecData } & WithMessageId)
  | ({
      type: 'code_execution_result';
      data: CodeExecutionResultData;
    } & WithMessageId)
  | ({
      type: 'workspace_file_changed';
      data: WorkspaceFileChangedData;
    } & WithMessageId)
  | ({ type: 'widget_proposal'; data: WidgetProposalData } & WithMessageId)
  | ({
      type: 'context_grew';
      kind: string;
      tokens: number;
      totalEstimated: number;
    } & WithMessageId)
  | ({
      type: 'subagent_started';
      executionId: string;
      name: string;
      task: string;
    } & WithMessageId)
  | ({ type: 'subagent_completed' } & SubagentExecution & WithMessageId)
  | ({ type: 'subagent_error' } & SubagentExecution & WithMessageId)
  | ({
      type: 'subagent_data';
      subagentId: string;
      subagentName: string;
      data: AgentEmitEvent;
    } & WithMessageId)
  | ({
      type: 'panel_executor_started';
      executorIdx: number;
      model: string;
    } & WithMessageId)
  | ({
      type: 'panel_executor_data';
      executorIdx: number;
      token: string;
    } & WithMessageId)
  | ({
      type: 'panel_executor_completed';
      executorIdx: number;
      model: string;
      sourceCount: number;
      usage?: PanelUsage;
    } & WithMessageId)
  | ({
      type: 'panel_executor_error';
      executorIdx: number;
      model: string;
      error: string;
    } & WithMessageId)
  | ({ type: 'stats'; data: ModelStats } & WithMessageId)
  | ({
      type: 'messageEnd';
      modelStats: ModelStats;
      searchQuery?: string;
      searchUrl?: string;
      usedLocation?: boolean;
      usedPersonalization?: boolean;
      memoriesUsed?: Array<{ id: string; content: string }>;
      projectedNextInputTokens?: number;
    } & WithMessageId)
  | { type: 'error'; data: string }
  | {
      type: 'memory_updated';
      data: { saved: number; updated: number; memoryIds: string[] };
    }
  | { type: 'ping'; timestamp: number }
  | { type: 'replay_complete'; content: string }
  | { type: 'gone' }
  | ApprovalPendingEvent
  | ApprovalAnsweredEvent
  | ApprovalStaleEvent
  | ApprovalCancelledEvent;

/** Parse result for an event that isn't part of the current vocabulary. */
export type UnknownStreamEvent = { type: 'unknown'; raw: unknown };

// ── Emit / consume helpers ───────────────────────────────────────────────────

/** The single EventEmitter channel every stream event travels on. */
export const STREAM_EVENT_CHANNEL = 'stream_event';

/** Emit a typed event onto a run/agent emitter. */
export function emitStreamEvent(
  emitter: EventEmitter,
  event: AgentEmitEvent,
): void {
  emitter.emit(STREAM_EVENT_CHANNEL, event);
}

/** Subscribe to a run/agent emitter's typed events. */
export function onStreamEvent(
  emitter: EventEmitter,
  handler: (event: AgentEmitEvent) => void,
): void {
  emitter.on(STREAM_EVENT_CHANNEL, handler);
}

const AGENT_CONTROL_TYPES = new Set<string>([
  'model_stats',
  'interrupt',
  'agent_end',
  'agent_error',
  'tool_llm_usage',
]);

/**
 * Whether an event is a control signal consumed by the run host or the agent
 * itself (never forwarded to a client). Used by subagent forwarding to relay
 * only the child's wire-bound events.
 */
export function isAgentControlEvent(event: { type: string }): boolean {
  return AGENT_CONTROL_TYPES.has(event.type);
}

// ── Legacy alias normalization ───────────────────────────────────────────────

/**
 * Older `run_events` rows persist approval events under pre-canonical type
 * names. Map them to the current `${kind}_(pending|answered)` vocabulary so a
 * replayed historical chat feeds the same reducer branches as a live one.
 */
const LEGACY_TYPE_ALIASES: Record<string, string> = {
  user_question_pending: 'ask_user_pending',
  user_question_answered: 'ask_user_answered',
  workspace_edit_approval_pending: 'workspace_edit_pending',
  workspace_edit_approval_answered: 'workspace_edit_answered',
  skill_edit_approval_pending: 'skill_edit_pending',
  skill_edit_approval_answered: 'skill_edit_answered',
};

/**
 * Parse a wire line into a {@link StreamEvent}, tolerating malformed JSON and
 * unknown/legacy types. Unknown types surface as `{ type: 'unknown', raw }` so
 * the reducer can ignore them without throwing.
 */
export function parseStreamEvent(
  line: string,
): StreamEvent | UnknownStreamEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { type: 'unknown', raw: line };
  }
  return normalizeStreamEvent(parsed);
}

/** Normalize an already-parsed event object (e.g. a persisted `run_events.data`). */
export function normalizeStreamEvent(
  parsed: unknown,
): StreamEvent | UnknownStreamEvent {
  if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) {
    return { type: 'unknown', raw: parsed };
  }
  const ev = parsed as { type: string } & Record<string, unknown>;
  const canonical = LEGACY_TYPE_ALIASES[ev.type];
  if (canonical) {
    return { ...ev, type: canonical } as StreamEvent;
  }
  return ev as StreamEvent;
}
