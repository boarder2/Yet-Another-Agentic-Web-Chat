/**
 * The chat stream reducer — one pure transition for every wire event, shared by
 * the live-send path and the reconnect/attach path in ChatWindow. It replaces
 * the two ~1000-line handlers that had drifted apart; the mode differences
 * (`attach` vs `live`) are folded into a single set of rules:
 *
 * - Bucket key is `event.messageId ?? activeAiMessageId`.
 * - The assistant row is upserted: patched if present, appended if not (this
 *   subsumes the live path's `added` flag and the attach path's pre-existing row).
 * - `inReplay` gates response/panel token events; only the attach path enters
 *   replay (until `replay_complete`).
 * - Idempotency guards and the richer finalization (messageEnd stats merge,
 *   suggestions, activeRuns invalidation) apply in both modes.
 *
 * Side effects are returned as {@link StreamEffect} data, never performed here.
 */
import type { Document } from '@langchain/core/documents';
import type { ChartSpec } from '@/lib/chart/chartSpec';
import {
  appendWidget,
  updateWidget,
  neutralizeSpoofedFences,
  upsertNestedToolCall,
  patchNestedToolCall,
  startPanelColumn,
  appendPanelColumnToken,
  setPanelColumnStatus,
  type ToolCallPayload,
  type SubagentPayload,
} from '@/lib/widgets/envelope';
import type {
  Message,
  ModelStats,
  PendingExecution,
  PendingQuestion,
  PendingEditApproval,
  PendingSkillEditApproval,
  PendingMcpApproval,
} from './chatState';
import { panelExecutorTokens, type StreamEvent } from './events';
import type { StreamEffect } from './effects';

/** How many response tokens accumulate before the assistant row is re-rendered. */
const RESPONSE_BUFFER_THRESHOLD = 5;

/** Buffered nested response tokens for one subagent/panel widget, committed in
 *  batches (like top-level response tokens) so each token doesn't rewrite —
 *  and re-render — the whole assistant row. */
interface PendingWidgetTokens {
  msgId: string;
  kind: 'subagent' | 'panel';
  id: string; // subagent executionId, or panel executor idx as a string
  text: string;
  count: number;
}

export type LiveContextGrew = {
  kind: string;
  tokens: number;
  totalEstimated: number;
  at: number;
} | null;

export type GatheringSource = { searchQuery: string; sources: Document[] };
export type TodoItem = { content: string; status: string };

export interface ChatStreamState {
  // Stream bookkeeping
  mode: 'attach' | 'live';
  chatId: string | undefined;
  activeAiMessageId: string | undefined;
  inReplay: boolean;
  receivedMessage: string;
  rowAdded: boolean;
  tokenCount: number;
  pendingWidgetTokens: Record<string, PendingWidgetTokens>;
  sources: Document[];
  codeExecutionRunIds: Record<string, string>;
  userQuestionRunIds: Record<string, string>;

  // Rendered state
  messages: Message[];
  liveModelStats: ModelStats | null;
  liveContextGrew: LiveContextGrew;
  gatheringSources: GatheringSource[];
  todoItems: TodoItem[];
  pendingExecutions: Record<string, PendingExecution[]>;
  pendingQuestions: Record<string, PendingQuestion[]>;
  pendingEditApprovals: Record<string, PendingEditApproval[]>;
  pendingSkillEditApprovals: Record<string, PendingSkillEditApproval[]>;
  pendingMcpApprovals: Record<string, PendingMcpApproval[]>;
  chartSpecsByMessage: Record<string, Record<string, ChartSpec>>;
}

export type LocalAction =
  | {
      type: 'stream_started';
      mode: 'attach' | 'live';
      chatId: string | undefined;
      aiMessageId: string;
      seedContent?: string;
    }
  | {
      type: 'seed_approvals';
      messageId: string;
      executions?: PendingExecution[];
      questions?: PendingQuestion[];
      editApprovals?: PendingEditApproval[];
      skillEditApprovals?: PendingSkillEditApproval[];
      mcpApprovals?: PendingMcpApproval[];
    }
  | { type: 'set_messages'; updater: (messages: Message[]) => Message[] };

export type StreamAction = StreamEvent | LocalAction;

export interface ReduceResult {
  state: ChatStreamState;
  effects: StreamEffect[];
}

export function initialChatStreamState(
  messages: Message[] = [],
): ChatStreamState {
  return {
    mode: 'live',
    chatId: undefined,
    activeAiMessageId: undefined,
    inReplay: false,
    receivedMessage: '',
    rowAdded: false,
    tokenCount: 0,
    pendingWidgetTokens: {},
    sources: [],
    codeExecutionRunIds: {},
    userQuestionRunIds: {},
    messages,
    liveModelStats: null,
    liveContextGrew: null,
    gatheringSources: [],
    todoItems: [],
    pendingExecutions: {},
    pendingQuestions: {},
    pendingEditApprovals: {},
    pendingSkillEditApprovals: {},
    pendingMcpApprovals: {},
    chartSpecsByMessage: {},
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Patch an existing assistant row by id, or append a fresh one seeded with the
 *  current sources. Subsumes the live `added` flag and the attach pre-existing row. */
function upsertAssistant(
  state: ChatStreamState,
  msgId: string,
  content: string,
  extra?: Partial<Message>,
): Message[] {
  if (state.messages.some((m) => m.messageId === msgId)) {
    return state.messages.map((m) =>
      m.messageId === msgId ? { ...m, content, ...extra } : m,
    );
  }
  return [
    ...state.messages,
    {
      content,
      messageId: msgId,
      chatId: state.chatId ?? '',
      role: 'assistant' as const,
      sources: state.sources,
      createdAt: new Date(),
      ...extra,
    },
  ];
}

/** Apply a content transform to the assistant row (no-op if absent). */
function transformAssistant(
  state: ChatStreamState,
  msgId: string,
  transform: (content: string) => string,
): Message[] {
  return state.messages.map((m) =>
    m.messageId === msgId ? { ...m, content: transform(m.content) } : m,
  );
}

function applyWidgetTokens(content: string, p: PendingWidgetTokens): string {
  return p.kind === 'subagent'
    ? updateWidget<SubagentPayload>(content, 'subagent', p.id, (current) => ({
        ...current,
        responseText: (current.responseText ?? '') + p.text,
      }))
    : appendPanelColumnToken(content, Number(p.id), p.text);
}

/** Commit all buffered nested widget tokens into the row content. */
function flushWidgetTokens(state: ChatStreamState): ChatStreamState {
  const pending = Object.values(state.pendingWidgetTokens);
  if (pending.length === 0) return state;
  let receivedMessage = state.receivedMessage;
  let messages = state.messages;
  for (const p of pending) {
    receivedMessage = applyWidgetTokens(receivedMessage, p);
    messages = messages.map((m) =>
      m.messageId === p.msgId
        ? { ...m, content: applyWidgetTokens(m.content, p) }
        : m,
    );
  }
  return { ...state, receivedMessage, messages, pendingWidgetTokens: {} };
}

/** Accumulate one nested widget token, committing the widget's buffer every
 *  RESPONSE_BUFFER_THRESHOLD tokens. */
function bufferWidgetToken(
  state: ChatStreamState,
  target: Pick<PendingWidgetTokens, 'msgId' | 'kind' | 'id'>,
  token: string,
): { state: ChatStreamState; flushed: boolean } {
  const key = `${target.kind}:${target.msgId}:${target.id}`;
  const prev = state.pendingWidgetTokens[key];
  const entry: PendingWidgetTokens = {
    ...target,
    text: (prev?.text ?? '') + token,
    count: (prev?.count ?? 0) + 1,
  };
  const next: ChatStreamState = {
    ...state,
    pendingWidgetTokens: { ...state.pendingWidgetTokens, [key]: entry },
  };
  if (entry.count < RESPONSE_BUFFER_THRESHOLD) {
    return { state: next, flushed: false };
  }
  return { state: flushWidgetTokens(next), flushed: true };
}

/** Set the status of every matching item across all buckets of a pending map. */
function sweepStatus<T>(
  record: Record<string, T[]>,
  matches: (item: T) => boolean,
  status: string,
): Record<string, T[]> {
  const updated: Record<string, T[]> = {};
  for (const [msgId, items] of Object.entries(record)) {
    updated[msgId] = items.map((item) =>
      matches(item) ? { ...item, status } : item,
    );
  }
  return updated;
}

const msgIdFor = (state: ChatStreamState, event: { messageId?: string }) =>
  event.messageId ?? state.activeAiMessageId ?? '';

// ── reducer ──────────────────────────────────────────────────────────────────

export function reduceStreamEvent(
  state: ChatStreamState,
  action: StreamAction,
): ReduceResult {
  const result = reduceStreamAction(state, action);
  // Live events carry the assistant messageId; adopt it as activeAiMessageId so
  // later id-less events (*_answered / *_stale / *_cancelled) bucket against the
  // same key their *_pending counterparts used.
  const mid = (action as { messageId?: unknown }).messageId;
  if (
    typeof mid === 'string' &&
    mid &&
    result.state.activeAiMessageId !== mid
  ) {
    return {
      state: { ...result.state, activeAiMessageId: mid },
      effects: result.effects,
    };
  }
  return result;
}

function reduceStreamAction(
  state: ChatStreamState,
  action: StreamAction,
): ReduceResult {
  // Any action other than a nested widget token commits buffered tokens first,
  // so event ordering within the row content is preserved.
  const buffersToken =
    action.type === 'panel_executor_data' ||
    (action.type === 'subagent_data' && action.data.type === 'response');
  if (!buffersToken) state = flushWidgetTokens(state);

  const effects: StreamEffect[] = [];
  const scroll = () => effects.push({ kind: 'bumpScroll' });

  switch (action.type) {
    // ── local actions ────────────────────────────────────────────────────────
    case 'stream_started':
      return {
        state: {
          ...state,
          mode: action.mode,
          chatId: action.chatId,
          activeAiMessageId: action.aiMessageId,
          inReplay: action.mode === 'attach',
          receivedMessage: action.seedContent ?? '',
          rowAdded: action.mode === 'attach',
          tokenCount: 0,
          sources: [],
          codeExecutionRunIds: {},
          userQuestionRunIds: {},
          gatheringSources: [],
          liveModelStats: null,
        },
        effects,
      };

    case 'set_messages':
      return {
        state: { ...state, messages: action.updater(state.messages) },
        effects,
      };

    case 'seed_approvals': {
      const next = { ...state };
      if (action.executions)
        next.pendingExecutions = {
          ...state.pendingExecutions,
          [action.messageId]: action.executions,
        };
      if (action.questions)
        next.pendingQuestions = {
          ...state.pendingQuestions,
          [action.messageId]: action.questions,
        };
      if (action.editApprovals)
        next.pendingEditApprovals = {
          ...state.pendingEditApprovals,
          [action.messageId]: action.editApprovals,
        };
      if (action.skillEditApprovals)
        next.pendingSkillEditApprovals = {
          ...state.pendingSkillEditApprovals,
          [action.messageId]: action.skillEditApprovals,
        };
      if (action.mcpApprovals)
        next.pendingMcpApprovals = {
          ...state.pendingMcpApprovals,
          [action.messageId]: action.mcpApprovals,
        };
      return { state: next, effects };
    }

    // ── terminal / control wire events ─────────────────────────────────────────
    case 'gone':
      effects.push({ kind: 'setLoading', value: false });
      return {
        state: {
          ...state,
          messages: state.messages.map((m) =>
            m.messageId === state.activeAiMessageId
              ? { ...m, runStatus: undefined }
              : m,
          ),
        },
        effects,
      };

    case 'error':
      effects.push({ kind: 'toastError', message: action.data });
      effects.push({ kind: 'setLoading', value: false });
      effects.push({ kind: 'invalidateActiveRuns' });
      return {
        state: {
          ...state,
          pendingQuestions: {},
          pendingExecutions: {},
          pendingEditApprovals: {},
          pendingSkillEditApprovals: {},
          pendingMcpApprovals: {},
        },
        effects,
      };

    case 'ping':
    case 'memory_updated':
    case 'widget_proposal':
      return { state, effects };

    case 'chatTitle':
      // Pure notification: no message-state mutation. ChatWindow updates the
      // open chat's title + tab title and refreshes the sidebar.
      effects.push({
        kind: 'setChatTitle',
        chatId: action.chatId,
        title: action.title,
      });
      return { state, effects };

    case 'replay_complete': {
      const next = { ...state, inReplay: false };
      if (
        typeof action.content === 'string' &&
        action.content !== state.receivedMessage &&
        state.activeAiMessageId
      ) {
        next.receivedMessage = action.content;
        next.messages = state.messages.map((m) =>
          m.messageId === state.activeAiMessageId
            ? { ...m, content: action.content }
            : m,
        );
      }
      return { state: next, effects };
    }

    // ── streamed content ───────────────────────────────────────────────────────
    case 'stats':
      return { state: { ...state, liveModelStats: action.data }, effects };

    case 'context_grew':
      return {
        state: {
          ...state,
          liveContextGrew: {
            kind: action.kind,
            tokens: action.tokens,
            totalEstimated: action.totalEstimated,
            at: Date.now(),
          },
        },
        effects,
      };

    case 'sources_added': {
      const searchQuery = action.searchQuery;
      if (!searchQuery?.trim()) return { state, effects };
      const docs = action.data;
      const existingIndex = state.gatheringSources.findIndex(
        (g) => g.searchQuery === searchQuery,
      );
      const gatheringSources =
        existingIndex >= 0
          ? state.gatheringSources.map((g, i) =>
              i === existingIndex
                ? { searchQuery, sources: [...g.sources, ...docs] }
                : g,
            )
          : [...state.gatheringSources, { searchQuery, sources: docs }];
      return { state: { ...state, gatheringSources }, effects };
    }

    case 'sources': {
      const msgId = msgIdFor(state, action);
      const messages = upsertAssistant(
        state,
        msgId,
        state.messages.find((m) => m.messageId === msgId)?.content ?? '',
        {
          sources: action.data,
          searchQuery: action.searchQuery,
          searchUrl: action.searchUrl,
        },
      );
      scroll();
      return {
        state: { ...state, messages, sources: action.data, rowAdded: true },
        effects,
      };
    }

    case 'response': {
      if (state.inReplay) return { state, effects };
      const token = neutralizeSpoofedFences(action.data ?? '');
      const receivedMessage = state.receivedMessage + token;
      const tokenCount = state.tokenCount + 1;
      // Buffer the row re-render: commit every N tokens, or immediately if the
      // row does not exist yet so the assistant bubble appears at once.
      if (tokenCount < RESPONSE_BUFFER_THRESHOLD && state.rowAdded) {
        return { state: { ...state, receivedMessage, tokenCount }, effects };
      }
      const msgId = msgIdFor(state, action);
      const messages = upsertAssistant(state, msgId, receivedMessage);
      scroll();
      return {
        state: {
          ...state,
          receivedMessage,
          tokenCount: 0,
          rowAdded: true,
          messages,
        },
        effects,
      };
    }

    case 'tool_call_started': {
      const msgId = msgIdFor(state, action);
      const { toolCallId, toolType, status, attrs } = action.data;
      const current = state.messages.find(
        (m) => m.messageId === msgId,
      )?.content;
      const apply = (content: string) =>
        appendWidget<ToolCallPayload>(content, 'tool_call', {
          id: toolCallId,
          type: toolType,
          status,
          ...attrs,
        });
      const receivedMessage = apply(current ?? state.receivedMessage);
      const messages = upsertAssistant(state, msgId, receivedMessage);
      scroll();
      return {
        state: { ...state, receivedMessage, rowAdded: true, messages },
        effects,
      };
    }

    case 'tool_call_success':
    case 'tool_call_error': {
      const msgId = msgIdFor(state, action);
      const { toolCallId, status } = action.data;
      const patch: Partial<ToolCallPayload> =
        action.type === 'tool_call_error'
          ? { status, error: action.data.error }
          : { status, ...action.data.extra };
      const apply = (content: string) =>
        updateWidget<ToolCallPayload>(content, 'tool_call', toolCallId, patch);
      const receivedMessage = apply(state.receivedMessage);
      const messages = transformAssistant(state, msgId, apply);
      scroll();
      return { state: { ...state, receivedMessage, messages }, effects };
    }

    case 'subagent_started': {
      const msgId = msgIdFor(state, action);
      const current = state.messages.find(
        (m) => m.messageId === msgId,
      )?.content;
      const apply = (content: string) =>
        appendWidget<SubagentPayload>(content, 'subagent', {
          id: action.executionId,
          name: action.name ?? '',
          task: action.task ?? '',
          status: 'running',
          toolCalls: [],
        });
      const receivedMessage = apply(current ?? state.receivedMessage);
      const messages = upsertAssistant(state, msgId, receivedMessage);
      scroll();
      return {
        state: { ...state, receivedMessage, rowAdded: true, messages },
        effects,
      };
    }

    case 'subagent_completed':
    case 'subagent_error': {
      const msgId = msgIdFor(state, action);
      const status = action.type === 'subagent_completed' ? 'success' : 'error';
      const apply = (content: string) =>
        updateWidget<SubagentPayload>(content, 'subagent', action.id, {
          status,
          summary: action.summary,
          error: action.error,
        });
      const receivedMessage = apply(state.receivedMessage);
      const messages = transformAssistant(state, msgId, apply);
      scroll();
      return { state: { ...state, receivedMessage, messages }, effects };
    }

    case 'subagent_data': {
      const msgId = msgIdFor(state, action);
      const nested = action.data;
      const executionId = action.subagentId;
      if (nested.type === 'response') {
        const buffered = bufferWidgetToken(
          state,
          { msgId, kind: 'subagent', id: executionId },
          nested.data || '',
        );
        if (buffered.flushed) scroll();
        return { state: buffered.state, effects };
      }
      const transform = (content: string): string => {
        if (nested.type === 'tool_call_started') {
          const { toolCallId, toolType, status, attrs } = nested.data;
          return updateWidget<SubagentPayload>(
            content,
            'subagent',
            executionId,
            (current) => ({
              ...current,
              toolCalls: upsertNestedToolCall(current.toolCalls, {
                id: toolCallId,
                type: toolType,
                status,
                ...attrs,
              }),
            }),
          );
        }
        if (
          nested.type === 'tool_call_success' ||
          nested.type === 'tool_call_error'
        ) {
          const patch: Partial<ToolCallPayload> =
            nested.type === 'tool_call_error'
              ? { status: nested.data.status, error: nested.data.error }
              : { status: nested.data.status, ...nested.data.extra };
          return updateWidget<SubagentPayload>(
            content,
            'subagent',
            executionId,
            (current) => ({
              ...current,
              toolCalls: patchNestedToolCall(
                current.toolCalls,
                nested.data.toolCallId,
                patch,
              ),
            }),
          );
        }
        return content;
      };
      const receivedMessage = transform(state.receivedMessage);
      const messages = transformAssistant(state, msgId, transform);
      scroll();
      return { state: { ...state, receivedMessage, messages }, effects };
    }

    case 'panel_executor_started':
    case 'panel_executor_completed':
    case 'panel_executor_error': {
      const msgId = msgIdFor(state, action);
      const idx = action.executorIdx;
      const transform = (content: string): string => {
        if (action.type === 'panel_executor_started') {
          return startPanelColumn(
            content,
            idx,
            action.model ?? `Model ${idx + 1}`,
          );
        }
        if (action.type === 'panel_executor_completed') {
          return setPanelColumnStatus(content, idx, 'success', {
            sourceCount: action.sourceCount,
            tokens: panelExecutorTokens(action.usage),
            model: action.model,
          });
        }
        return setPanelColumnStatus(content, idx, 'error', {
          error: action.error,
          model: action.model,
        });
      };
      const receivedMessage = transform(state.receivedMessage);
      const messages = upsertAssistant(state, msgId, receivedMessage);
      scroll();
      return {
        state: { ...state, receivedMessage, rowAdded: true, messages },
        effects,
      };
    }

    case 'panel_executor_data': {
      if (state.inReplay) return { state, effects };
      const msgId = msgIdFor(state, action);
      const buffered = bufferWidgetToken(
        state,
        { msgId, kind: 'panel', id: String(action.executorIdx) },
        action.token ?? '',
      );
      if (buffered.flushed) scroll();
      return { state: buffered.state, effects };
    }

    case 'chart_spec': {
      const msgId = msgIdFor(state, action);
      const { chartId, spec } = action.data;
      if (!chartId || !spec) return { state, effects };
      return {
        state: {
          ...state,
          chartSpecsByMessage: {
            ...state.chartSpecsByMessage,
            [msgId]: {
              ...(state.chartSpecsByMessage[msgId] ?? {}),
              [chartId]: spec,
            },
          },
        },
        effects,
      };
    }

    case 'todo_update':
      return {
        state: { ...state, todoItems: action.data.todos || [] },
        effects,
      };

    case 'workspace_file_changed':
      effects.push({
        kind: 'invalidateWorkspace',
        workspaceId: action.data.workspaceId,
      });
      return { state, effects };

    // ── approval lifecycle ─────────────────────────────────────────────────────
    case 'code_execution_pending':
      return reduceCodeExecutionPending(state, action, effects);

    case 'code_execution_answered':
      return reduceCodeExecutionAnswered(state, action, effects);

    case 'code_execution_result':
      return reduceCodeExecutionResult(state, action, effects, scroll);

    case 'ask_user_pending':
      return reduceAskUserPending(state, action, effects);

    case 'ask_user_answered':
      return reduceAskUserAnswered(state, action, effects);

    case 'workspace_edit_pending':
    case 'workspace_create_pending':
      return reduceWorkspaceEditPending(state, action, effects);

    case 'workspace_edit_answered':
    case 'workspace_create_answered':
      return reduceWorkspaceEditAnswered(state, action, effects);

    case 'skill_edit_pending':
      return reduceSkillEditPending(state, action, effects);

    case 'skill_edit_answered':
      return reduceSkillEditAnswered(state, action, effects);

    case 'mcp_tool_pending':
      return reduceMcpPending(state, action, effects);

    case 'mcp_tool_answered':
      return reduceMcpAnswered(state, action, effects);

    // ── finalization ───────────────────────────────────────────────────────────
    case 'messageEnd':
      return reduceMessageEnd(state, action, effects, scroll);

    default:
      // Approval *_stale / *_cancelled arrive as ${kind}_stale / ${kind}_cancelled;
      // handle them by suffix. Everything else is ignored.
      if (action.type.endsWith('_stale')) {
        return reduceStale(state, action, effects);
      }
      if (action.type.endsWith('_cancelled')) {
        return reduceCancelled(state, action, effects);
      }
      return { state, effects };
  }
}

// ── approval sub-reducers ──────────────────────────────────────────────────────

type WithData<T> = { data: T; messageId?: string };

function reduceCodeExecutionPending(
  state: ChatStreamState,
  action: WithData<Record<string, unknown>>,
  effects: StreamEffect[],
): ReduceResult {
  const msgId = msgIdFor(state, action);
  const d = action.data;
  const executionId = (d.approvalId ?? d.executionId) as string | undefined;
  const runId = d.markupToolCallId as string | undefined;
  const codeExecutionRunIds = { ...state.codeExecutionRunIds };
  if (runId && executionId) codeExecutionRunIds[executionId] = runId;
  if (runId && typeof d.toolCallId === 'string')
    codeExecutionRunIds[d.toolCallId] = runId;

  const existing = state.pendingExecutions[msgId] ?? [];
  if (existing.some((e) => e.executionId === executionId)) {
    return { state: { ...state, codeExecutionRunIds }, effects };
  }
  effects.push({ kind: 'bumpScroll' });
  return {
    state: {
      ...state,
      codeExecutionRunIds,
      pendingExecutions: {
        ...state.pendingExecutions,
        [msgId]: [
          ...existing,
          {
            executionId,
            code: d.code,
            description: d.description,
            toolCallId: d.toolCallId,
            status: 'pending',
          } as PendingExecution,
        ],
      },
    },
    effects,
  };
}

function reduceCodeExecutionAnswered(
  state: ChatStreamState,
  action: WithData<Record<string, unknown>>,
  effects: StreamEffect[],
): ReduceResult {
  const d = action.data;
  const answeredId = (d.approvalId ?? d.executionId) as string | undefined;
  if (!answeredId) return { state, effects };
  const approved = (d.response as Record<string, unknown> | undefined)
    ?.approved;
  const status = approved === false ? 'denied' : 'approved';
  return {
    state: {
      ...state,
      pendingExecutions: sweepStatus(
        state.pendingExecutions,
        (e) => e.executionId === answeredId,
        status,
      ),
    },
    effects,
  };
}

function reduceCodeExecutionResult(
  state: ChatStreamState,
  action: WithData<Record<string, unknown>>,
  effects: StreamEffect[],
  scroll: () => void,
): ReduceResult {
  const msgId = msgIdFor(state, action);
  const d = action.data;
  const execId = d.executionId as string | undefined;
  const toolCallId = d.toolCallId as string | undefined;
  const pendingExecutions = {
    ...state.pendingExecutions,
    [msgId]: (state.pendingExecutions[msgId] ?? []).map((execution) =>
      (execId && execution.executionId === execId) ||
      (toolCallId && execution.toolCallId === toolCallId)
        ? {
            ...execution,
            status: (d.denied ? 'denied' : 'completed') as
              'denied' | 'completed',
            result: d as PendingExecution['result'],
          }
        : execution,
    ),
  };

  const tcId =
    (execId && state.codeExecutionRunIds[execId]) ||
    (toolCallId && state.codeExecutionRunIds[toolCallId]) ||
    toolCallId;

  let receivedMessage = state.receivedMessage;
  let messages = state.messages;
  if (tcId) {
    const extra: Partial<ToolCallPayload> = {};
    if (d.exitCode !== undefined) extra.exitCode = Number(d.exitCode);
    if (d.stdout) extra.stdout = String(d.stdout).slice(0, 2000);
    if (d.stderr) extra.stderr = String(d.stderr).slice(0, 1000);
    if (d.timedOut) extra.timedOut = true;
    if (d.oomKilled) extra.oomKilled = true;
    if (d.denied) extra.denied = true;
    if (Array.isArray(d.chartIds) && d.chartIds.length > 0)
      extra.chartIds = (d.chartIds as string[]).join(',');
    const apply = (content: string) =>
      updateWidget<ToolCallPayload>(content, 'tool_call', tcId, extra);
    receivedMessage = apply(receivedMessage);
    messages = transformAssistant(state, msgId, apply);
  }
  scroll();
  return {
    state: { ...state, pendingExecutions, receivedMessage, messages },
    effects,
  };
}

function reduceAskUserPending(
  state: ChatStreamState,
  action: WithData<Record<string, unknown>>,
  effects: StreamEffect[],
): ReduceResult {
  const msgId = msgIdFor(state, action);
  const d = action.data;
  const questionId = (d.approvalId ?? d.questionId) as string | undefined;
  const runId = d.markupToolCallId as string | undefined;
  const userQuestionRunIds = { ...state.userQuestionRunIds };
  if (runId && questionId) userQuestionRunIds[questionId] = runId;
  if (runId && typeof d.toolCallId === 'string')
    userQuestionRunIds[d.toolCallId] = runId;

  const existing = state.pendingQuestions[msgId] ?? [];
  if (existing.some((q) => q.questionId === questionId)) {
    return { state: { ...state, userQuestionRunIds }, effects };
  }
  effects.push({ kind: 'bumpScroll' });
  return {
    state: {
      ...state,
      userQuestionRunIds,
      pendingQuestions: {
        ...state.pendingQuestions,
        [msgId]: [
          ...existing,
          {
            questionId,
            question: d.question,
            options: d.options,
            multiSelect: d.multiSelect,
            allowFreeformInput: d.allowFreeformInput,
            context: d.context,
            toolCallId: d.toolCallId,
            createdAt: d.createdAt,
            status: 'pending',
          } as PendingQuestion,
        ],
      },
    },
    effects,
  };
}

function reduceAskUserAnswered(
  state: ChatStreamState,
  action: WithData<Record<string, unknown>>,
  effects: StreamEffect[],
): ReduceResult {
  const msgId = msgIdFor(state, action);
  const d = action.data;
  const answeredId = (d.approvalId ?? d.questionId) as string | undefined;
  const status = d.timedOut ? 'timed_out' : d.skipped ? 'skipped' : 'answered';
  const pendingQuestions = {
    ...state.pendingQuestions,
    [msgId]: (state.pendingQuestions[msgId] ?? []).map((q) =>
      q.questionId === answeredId
        ? { ...q, status: status as PendingQuestion['status'], response: d }
        : q,
    ),
  };

  const tcId =
    (answeredId && state.userQuestionRunIds[answeredId]) ||
    (typeof d.toolCallId === 'string' &&
      state.userQuestionRunIds[d.toolCallId]) ||
    (d.toolCallId as string | undefined);

  let receivedMessage = state.receivedMessage;
  let messages = state.messages;
  if (tcId) {
    const extra: Partial<ToolCallPayload> = {};
    if (Array.isArray(d.selectedOptions) && d.selectedOptions.length)
      extra.selectedOptions = (d.selectedOptions as string[]).join(', ');
    if (d.freeformText)
      extra.freeformText = String(d.freeformText).slice(0, 500);
    if (d.timedOut) extra.timedOut = true;
    if (d.skipped) extra.skipped = true;
    const apply = (content: string) =>
      updateWidget<ToolCallPayload>(content, 'tool_call', tcId, extra);
    receivedMessage = apply(receivedMessage);
    messages = transformAssistant(state, msgId, apply);
  }
  effects.push({ kind: 'bumpScroll' });
  return {
    state: { ...state, pendingQuestions, receivedMessage, messages },
    effects,
  };
}

function reduceWorkspaceEditPending(
  state: ChatStreamState,
  action: WithData<Record<string, unknown>>,
  effects: StreamEffect[],
): ReduceResult {
  const msgId = msgIdFor(state, action);
  const d = action.data;
  const existing = state.pendingEditApprovals[msgId] ?? [];
  if (existing.some((a) => a.approvalId === d.approvalId)) {
    return { state, effects };
  }
  effects.push({ kind: 'bumpScroll' });
  return {
    state: {
      ...state,
      pendingEditApprovals: {
        ...state.pendingEditApprovals,
        [msgId]: [
          ...existing,
          { ...d, status: 'pending' } as unknown as PendingEditApproval,
        ],
      },
    },
    effects,
  };
}

function reduceWorkspaceEditAnswered(
  state: ChatStreamState,
  action: WithData<Record<string, unknown>>,
  effects: StreamEffect[],
): ReduceResult {
  const msgId = msgIdFor(state, action);
  const d = action.data;
  const status =
    d.decision === 'reject' || d.decision === 'always_prompt'
      ? 'rejected'
      : 'accepted';
  return {
    state: {
      ...state,
      pendingEditApprovals: {
        ...state.pendingEditApprovals,
        [msgId]: (state.pendingEditApprovals[msgId] ?? []).map((a) =>
          a.approvalId === d.approvalId
            ? { ...a, status: status as PendingEditApproval['status'] }
            : a,
        ),
      },
    },
    effects,
  };
}

function reduceSkillEditPending(
  state: ChatStreamState,
  action: WithData<Record<string, unknown>>,
  effects: StreamEffect[],
): ReduceResult {
  const msgId = msgIdFor(state, action);
  const d = action.data;
  const existing = state.pendingSkillEditApprovals[msgId] ?? [];
  if (existing.some((a) => a.approvalId === d.approvalId)) {
    return { state, effects };
  }
  effects.push({ kind: 'bumpScroll' });
  return {
    state: {
      ...state,
      pendingSkillEditApprovals: {
        ...state.pendingSkillEditApprovals,
        [msgId]: [
          ...existing,
          { ...d, status: 'pending' } as unknown as PendingSkillEditApproval,
        ],
      },
    },
    effects,
  };
}

function reduceSkillEditAnswered(
  state: ChatStreamState,
  action: WithData<Record<string, unknown>>,
  effects: StreamEffect[],
): ReduceResult {
  const msgId = msgIdFor(state, action);
  const d = action.data;
  const status = d.decision === 'reject' ? 'rejected' : 'accepted';
  const next = {
    ...state,
    pendingSkillEditApprovals: {
      ...state.pendingSkillEditApprovals,
      [msgId]: (state.pendingSkillEditApprovals[msgId] ?? []).map((a) =>
        a.approvalId === d.approvalId
          ? { ...a, status: status as PendingSkillEditApproval['status'] }
          : a,
      ),
    },
  };
  if (
    d.decision !== 'reject' &&
    d.decision !== 'always_prompt' &&
    !d.timedOut
  ) {
    effects.push({ kind: 'refreshSkills' });
  }
  return { state: next, effects };
}

function reduceMcpPending(
  state: ChatStreamState,
  action: WithData<Record<string, unknown>>,
  effects: StreamEffect[],
): ReduceResult {
  const msgId = msgIdFor(state, action);
  const d = action.data;
  const existing = state.pendingMcpApprovals[msgId] ?? [];
  if (existing.some((a) => a.approvalId === d.approvalId)) {
    return { state, effects };
  }
  effects.push({ kind: 'bumpScroll' });
  return {
    state: {
      ...state,
      pendingMcpApprovals: {
        ...state.pendingMcpApprovals,
        [msgId]: [
          ...existing,
          {
            ...d,
            arguments: d.arguments ?? {},
            status: 'pending',
          } as unknown as PendingMcpApproval,
        ],
      },
    },
    effects,
  };
}

function reduceMcpAnswered(
  state: ChatStreamState,
  action: WithData<Record<string, unknown>>,
  effects: StreamEffect[],
): ReduceResult {
  const msgId = msgIdFor(state, action);
  const d = action.data;
  const approved = (d.response as Record<string, unknown> | undefined)
    ?.approved;
  const status = approved === false ? 'denied' : 'approved';
  return {
    state: {
      ...state,
      pendingMcpApprovals: {
        ...state.pendingMcpApprovals,
        [msgId]: (state.pendingMcpApprovals[msgId] ?? []).map((a) =>
          a.approvalId === d.approvalId
            ? { ...a, status: status as PendingMcpApproval['status'] }
            : a,
        ),
      },
    },
    effects,
  };
}

function reduceStale(
  state: ChatStreamState,
  action: { data?: { approvalId?: string; reason?: string } },
  effects: StreamEffect[],
): ReduceResult {
  const approvalId = action.data?.approvalId;
  const reason = action.data?.reason;
  effects.push({
    kind: 'toastError',
    message: reason
      ? `${reason} The assistant will re-check and try again.`
      : 'The target changed while awaiting approval; the assistant will re-check and try again.',
  });
  if (!approvalId) return { state, effects };
  const match = (id?: string) => id === approvalId;
  return {
    state: {
      ...state,
      pendingEditApprovals: sweepStatus(
        state.pendingEditApprovals,
        (a) => match(a.approvalId),
        'cancelled',
      ),
      pendingSkillEditApprovals: sweepStatus(
        state.pendingSkillEditApprovals,
        (a) => match(a.approvalId),
        'cancelled',
      ),
      pendingMcpApprovals: sweepStatus(
        state.pendingMcpApprovals,
        (a) => match(a.approvalId),
        'cancelled',
      ),
      pendingQuestions: sweepStatus(
        state.pendingQuestions,
        (q) => match(q.questionId),
        'cancelled',
      ),
    },
    effects,
  };
}

function reduceCancelled(
  state: ChatStreamState,
  action: { data?: { approvalId?: string } },
  effects: StreamEffect[],
): ReduceResult {
  const approvalId = action.data?.approvalId;
  if (!approvalId) return { state, effects };
  const match = (id?: string) => id === approvalId;
  return {
    state: {
      ...state,
      pendingQuestions: sweepStatus(
        state.pendingQuestions,
        (q) => match(q.questionId),
        'cancelled',
      ),
      pendingExecutions: sweepStatus(
        state.pendingExecutions,
        (e) => match(e.executionId),
        'cancelled',
      ),
      pendingEditApprovals: sweepStatus(
        state.pendingEditApprovals,
        (a) => match(a.approvalId),
        'cancelled',
      ),
      pendingSkillEditApprovals: sweepStatus(
        state.pendingSkillEditApprovals,
        (a) => match(a.approvalId),
        'cancelled',
      ),
      pendingMcpApprovals: sweepStatus(
        state.pendingMcpApprovals,
        (a) => match(a.approvalId),
        'cancelled',
      ),
    },
    effects,
  };
}

function reduceMessageEnd(
  state: ChatStreamState,
  action: Extract<StreamEvent, { type: 'messageEnd' }>,
  effects: StreamEffect[],
  scroll: () => void,
): ReduceResult {
  const msgId = msgIdFor(state, action);
  const usedLocation =
    typeof action.usedLocation === 'boolean' ? action.usedLocation : undefined;
  const usedPersonalization =
    typeof action.usedPersonalization === 'boolean'
      ? action.usedPersonalization
      : undefined;
  const memoriesUsedCount = Array.isArray(action.memoriesUsed)
    ? action.memoriesUsed.length
    : undefined;
  const mergedStats: ModelStats | undefined = action.modelStats
    ? {
        ...action.modelStats,
        ...(usedLocation !== undefined ? { usedLocation } : {}),
        ...(usedPersonalization !== undefined ? { usedPersonalization } : {}),
        ...(memoriesUsedCount !== undefined
          ? { memoriesUsed: memoriesUsedCount }
          : {}),
        ...(typeof action.projectedNextInputTokens === 'number'
          ? { projectedNextInputTokens: action.projectedNextInputTokens }
          : {}),
      }
    : undefined;

  const messages = state.messages.map((m) =>
    m.messageId === msgId
      ? {
          ...m,
          content: state.receivedMessage,
          modelStats: mergedStats ?? undefined,
          searchQuery: m.searchQuery || action.searchQuery,
          searchUrl: m.searchUrl || action.searchUrl,
          runStatus: undefined,
          ...(usedLocation !== undefined ? { usedLocation } : {}),
          ...(usedPersonalization !== undefined ? { usedPersonalization } : {}),
        }
      : m,
  );

  effects.push({ kind: 'setLoading', value: false });
  effects.push({ kind: 'invalidateActiveRuns' });
  effects.push({ kind: 'fetchSuggestions', messageId: msgId });
  scroll();

  return {
    state: {
      ...state,
      messages,
      liveModelStats: null,
      liveContextGrew: null,
      todoItems: [],
      gatheringSources: [],
    },
    effects,
  };
}
