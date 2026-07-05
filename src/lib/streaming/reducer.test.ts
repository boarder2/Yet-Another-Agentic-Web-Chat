import { describe, it, expect } from 'vitest';
import {
  reduceStreamEvent,
  initialChatStreamState,
  type ChatStreamState,
  type StreamAction,
} from './reducer';
import type { StreamEvent } from './events';
import type { Message } from './chatState';

const AI = 'ai1';

/** Drive a sequence of actions from an initial state, returning the final state
 *  and the flattened effects. */
function run(state: ChatStreamState, actions: StreamAction[]) {
  const effects = [];
  let s = state;
  for (const a of actions) {
    const r = reduceStreamEvent(s, a);
    s = r.state;
    effects.push(...r.effects);
  }
  return { state: s, effects };
}

function liveStart(): ChatStreamState {
  return reduceStreamEvent(initialChatStreamState(), {
    type: 'stream_started',
    mode: 'live',
    chatId: 'c1',
    aiMessageId: AI,
  }).state;
}

function attachStart(seed = ''): ChatStreamState {
  const runningRow: Message = {
    messageId: AI,
    chatId: 'c1',
    role: 'assistant',
    content: seed,
    createdAt: new Date(),
    runStatus: 'running',
  };
  return reduceStreamEvent(initialChatStreamState([runningRow]), {
    type: 'stream_started',
    mode: 'attach',
    chatId: 'c1',
    aiMessageId: AI,
    seedContent: seed,
  }).state;
}

const ev = (e: Partial<StreamEvent> & { type: string }) => e as StreamEvent;
const rowContent = (s: ChatStreamState, id = AI) =>
  s.messages.find((m) => m.messageId === id)?.content;

describe('response streaming', () => {
  it('creates the assistant row on the first token in live mode', () => {
    const s = reduceStreamEvent(
      liveStart(),
      ev({ type: 'response', data: 'A' }),
    ).state;
    expect(s.messages).toHaveLength(1);
    expect(rowContent(s)).toBe('A');
    expect(s.rowAdded).toBe(true);
  });

  it('buffers subsequent tokens, committing every 5', () => {
    const { state } = run(liveStart(), [
      ev({ type: 'response', data: 'a' }), // commits (first)
      ev({ type: 'response', data: 'b' }),
      ev({ type: 'response', data: 'c' }),
      ev({ type: 'response', data: 'd' }),
      ev({ type: 'response', data: 'e' }), // buffered
    ]);
    // Row reflects only the first commit; receivedMessage has them all.
    expect(rowContent(state)).toBe('a');
    expect(state.receivedMessage).toBe('abcde');
    const after = reduceStreamEvent(
      state,
      ev({ type: 'response', data: 'f' }),
    ).state; // 5th buffered token → commit
    expect(rowContent(after)).toBe('abcdef');
  });

  it('gates response tokens during attach replay until replay_complete', () => {
    let s = attachStart('seed');
    s = reduceStreamEvent(s, ev({ type: 'response', data: 'X' })).state;
    expect(s.receivedMessage).toBe('seed'); // ignored in replay
    s = reduceStreamEvent(s, {
      type: 'replay_complete',
      content: 'seed',
    }).state;
    expect(s.inReplay).toBe(false);
    s = reduceStreamEvent(s, ev({ type: 'response', data: 'Y' })).state;
    expect(s.receivedMessage).toBe('seedY');
  });

  it('corrects the seed to authoritative content on replay_complete', () => {
    let s = attachStart('short');
    s = reduceStreamEvent(s, {
      type: 'replay_complete',
      content: 'short+live',
    }).state;
    expect(s.receivedMessage).toBe('short+live');
    expect(rowContent(s)).toBe('short+live');
  });
});

describe('tool call markup', () => {
  it('appends started markup and updates status on success', () => {
    const started = ev({
      type: 'tool_call_started',
      data: {
        content:
          '<ToolCall type="x" status="running" toolCallId="t1"></ToolCall>',
        toolCallId: 't1',
        status: 'running',
      },
    });
    let s = reduceStreamEvent(liveStart(), started).state;
    expect(rowContent(s)).toContain('toolCallId="t1"');
    expect(rowContent(s)).toContain('status="running"');
    s = reduceStreamEvent(
      s,
      ev({
        type: 'tool_call_success',
        data: { toolCallId: 't1', status: 'success' },
      }),
    ).state;
    expect(rowContent(s)).toContain('status="success"');
  });

  it('is idempotent: replaying the same started event does not duplicate markup', () => {
    const started = ev({
      type: 'tool_call_started',
      data: {
        content:
          '<ToolCall type="x" status="running" toolCallId="t1"></ToolCall>',
        toolCallId: 't1',
        status: 'running',
      },
    });
    const s = run(liveStart(), [started, started]).state;
    const occurrences = (rowContent(s)!.match(/toolCallId="t1"/g) ?? []).length;
    expect(occurrences).toBe(1);
  });
});

describe('bucket key unification', () => {
  it('uses event.messageId when present', () => {
    const s = reduceStreamEvent(
      liveStart(),
      ev({ type: 'response', data: 'A', messageId: 'other' }),
    ).state;
    expect(rowContent(s, 'other')).toBe('A');
  });

  it('falls back to activeAiMessageId when the event omits messageId', () => {
    const s = reduceStreamEvent(
      liveStart(),
      ev({ type: 'response', data: 'A' }),
    ).state;
    expect(rowContent(s, AI)).toBe('A');
  });

  it('adopts the assistant id from a carrying event so id-less answers bucket right', () => {
    // Live mode: the client starts with the user message id; the first bucketed
    // event carries the real assistant id, which id-less *_answered events reuse.
    const started = reduceStreamEvent(initialChatStreamState(), {
      type: 'stream_started',
      mode: 'live',
      chatId: 'c1',
      aiMessageId: 'user1',
    }).state;
    const withPending = run(started, [
      ev({
        type: 'ask_user_pending',
        messageId: 'assistant1',
        data: { approvalId: 'q1', question: 'ok?' },
      }),
    ]).state;
    expect(withPending.activeAiMessageId).toBe('assistant1');
    expect(withPending.pendingQuestions['assistant1']).toHaveLength(1);
    // The answered event omits messageId; it must still find the 'assistant1' bucket.
    const answered = reduceStreamEvent(
      withPending,
      ev({ type: 'ask_user_answered', data: { approvalId: 'q1' } }),
    ).state;
    expect(answered.pendingQuestions['assistant1'][0].status).toBe('answered');
  });
});

describe('sources', () => {
  it('accumulates gathering sources by searchQuery', () => {
    const doc = { pageContent: 'x', metadata: {} } as never;
    const s = run(liveStart(), [
      ev({ type: 'sources_added', data: [doc], searchQuery: 'q1' }),
      ev({ type: 'sources_added', data: [doc], searchQuery: 'q1' }),
      ev({ type: 'sources_added', data: [doc], searchQuery: 'q2' }),
    ]).state;
    expect(s.gatheringSources).toHaveLength(2);
    expect(s.gatheringSources[0].sources).toHaveLength(2);
  });

  it('sets final sources on the assistant row', () => {
    const doc = { pageContent: 'x', metadata: {} } as never;
    const s = reduceStreamEvent(
      liveStart(),
      ev({ type: 'sources', data: [doc], searchQuery: 'q', searchUrl: 'u' }),
    ).state;
    const row = s.messages.find((m) => m.messageId === AI);
    expect(row?.sources).toHaveLength(1);
    expect(row?.searchQuery).toBe('q');
  });
});

describe('charts and todos', () => {
  it('records chart specs per message', () => {
    const s = reduceStreamEvent(
      liveStart(),
      ev({
        type: 'chart_spec',
        data: { chartId: 'ch1', spec: { kind: 'bar' } as never },
      }),
    ).state;
    expect(s.chartSpecsByMessage[AI].ch1).toEqual({ kind: 'bar' });
  });

  it('replaces todo items', () => {
    const s = reduceStreamEvent(
      liveStart(),
      ev({
        type: 'todo_update',
        data: { todos: [{ content: 't', status: 'pending' }] },
      }),
    ).state;
    expect(s.todoItems).toHaveLength(1);
  });
});

describe('approval lifecycle', () => {
  const pending = ev({
    type: 'code_execution_pending',
    data: { approvalId: 'a1', code: 'print(1)', toolCallId: 't1' },
  });

  it('adds a pending execution and dedups repeats', () => {
    const s = run(liveStart(), [pending, pending]).state;
    expect(s.pendingExecutions[AI]).toHaveLength(1);
    expect(s.pendingExecutions[AI][0].status).toBe('pending');
  });

  it('scrolls when a new pending item appears, but not on a dedup', () => {
    const first = reduceStreamEvent(liveStart(), pending);
    expect(first.effects).toContainEqual({ kind: 'bumpScroll' });
    const dup = reduceStreamEvent(first.state, pending);
    expect(dup.effects).not.toContainEqual({ kind: 'bumpScroll' });
  });

  it('marks answered/denied', () => {
    const s = run(liveStart(), [
      pending,
      ev({
        type: 'code_execution_answered',
        data: { approvalId: 'a1', response: { approved: false } },
      }),
    ]).state;
    expect(s.pendingExecutions[AI][0].status).toBe('denied');
  });

  it('sweeps every bucket to cancelled on *_cancelled', () => {
    const s = run(liveStart(), [
      pending,
      ev({ type: 'code_execution_cancelled', data: { approvalId: 'a1' } }),
    ]).state;
    expect(s.pendingExecutions[AI][0].status).toBe('cancelled');
  });

  it('emits a toast and cancels on *_stale', () => {
    const editPending = ev({
      type: 'workspace_edit_pending',
      data: { approvalId: 'e1', file: 'a.txt' },
    });
    const { state, effects } = run(liveStart(), [
      editPending,
      ev({
        type: 'workspace_edit_stale',
        data: { approvalId: 'e1', reason: 'changed' },
      }),
    ]);
    expect(state.pendingEditApprovals[AI][0].status).toBe('cancelled');
    expect(effects.some((e) => e.kind === 'toastError')).toBe(true);
  });
});

describe('finalization and errors', () => {
  it('finalizes on messageEnd: row content, cleared live state, effects', () => {
    let s = liveStart();
    s = reduceStreamEvent(s, ev({ type: 'response', data: 'hello' })).state;
    const { state, effects } = run(s, [
      ev({
        type: 'messageEnd',
        messageId: AI,
        modelStats: { modelName: 'm', usedLocation: false },
        searchQuery: 'q',
      }),
    ]);
    const row = state.messages.find((m) => m.messageId === AI);
    expect(row?.content).toBe('hello');
    expect(row?.runStatus).toBeUndefined();
    expect(row?.modelStats?.modelName).toBe('m');
    expect(state.todoItems).toHaveLength(0);
    expect(state.liveModelStats).toBeNull();
    expect(effects.map((e) => e.kind)).toEqual(
      expect.arrayContaining([
        'setLoading',
        'invalidateActiveRuns',
        'fetchSuggestions',
      ]),
    );
  });

  it('clears pending maps and signals on error', () => {
    const s = run(liveStart(), [
      ev({ type: 'code_execution_pending', data: { approvalId: 'a1' } }),
    ]).state;
    const { state, effects } = reduceStreamEvent(s, {
      type: 'error',
      data: 'boom',
    });
    expect(state.pendingExecutions).toEqual({});
    expect(effects.map((e) => e.kind)).toEqual(
      expect.arrayContaining([
        'toastError',
        'setLoading',
        'invalidateActiveRuns',
      ]),
    );
  });

  it('clears runStatus on gone', () => {
    const { state, effects } = reduceStreamEvent(attachStart('x'), {
      type: 'gone',
    });
    expect(state.messages[0].runStatus).toBeUndefined();
    expect(effects).toContainEqual({ kind: 'setLoading', value: false });
  });
});

describe('replay idempotency', () => {
  it('yields identical row content when a subagent milestone is replayed', () => {
    const started = ev({
      type: 'subagent_started',
      executionId: 's1',
      name: 'researcher',
      task: 'dig',
    });
    const once = reduceStreamEvent(liveStart(), started).state;
    const twice = reduceStreamEvent(once, started).state;
    expect(rowContent(twice)).toBe(rowContent(once));
  });
});

describe('workspace_file_changed', () => {
  it('emits an invalidateWorkspace effect', () => {
    const { effects } = reduceStreamEvent(
      liveStart(),
      ev({
        type: 'workspace_file_changed',
        data: { workspaceId: 'w1', file: 'a.txt', action: 'edit' },
      }),
    );
    expect(effects).toContainEqual({
      kind: 'invalidateWorkspace',
      workspaceId: 'w1',
    });
  });
});

describe('local actions', () => {
  it('set_messages folds an updater over the messages slice', () => {
    const seeded = initialChatStreamState([
      {
        messageId: 'm1',
        chatId: 'c1',
        role: 'user',
        content: 'hi',
        createdAt: new Date(),
      },
    ]);
    const s = reduceStreamEvent(seeded, {
      type: 'set_messages',
      updater: (prev) => prev.map((m) => ({ ...m, content: m.content + '!' })),
    }).state;
    expect(rowContent(s, 'm1')).toBe('hi!');
  });

  it('seed_approvals seeds a message bucket that later pending events dedup against', () => {
    const seeded = reduceStreamEvent(attachStart('x'), {
      type: 'seed_approvals',
      messageId: AI,
      questions: [{ questionId: 'q1', question: 'ok?', status: 'pending' }],
    }).state;
    expect(seeded.pendingQuestions[AI]).toHaveLength(1);
    // The concurrent SSE replay re-emits the same approval; the reducer must not
    // duplicate it against the seeded bucket.
    const after = reduceStreamEvent(
      seeded,
      ev({
        type: 'ask_user_pending',
        messageId: AI,
        data: { approvalId: 'q1', question: 'ok?' },
      }),
    ).state;
    expect(after.pendingQuestions[AI]).toHaveLength(1);
  });
});
