import { describe, it, expect } from 'vitest';
import {
  reduceStreamEvent,
  initialChatStreamState,
  type ChatStreamState,
  type StreamAction,
} from './reducer';
import type { StreamEvent, ModelStatsV1 } from './events';
import type { Message } from './chatState';
import { normalizeChartInput } from '@/lib/chart/chartInput';
import {
  findWidget,
  type MapPayload,
  type PanelPayload,
} from '@/lib/widgets/envelope';

const AI = 'ai1';
const chartSpec = normalizeChartInput({
  type: 'line',
  title: 'Trend',
  labels: ['A', 'B'],
  series: [{ label: 'Value', values: [1, 2] }],
});

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

describe('tool call widgets', () => {
  it('appends a tool_call envelope and updates status on success', () => {
    const started = ev({
      type: 'tool_call_started',
      data: { toolCallId: 't1', toolType: 'x', status: 'running' },
    });
    let s = reduceStreamEvent(liveStart(), started).state;
    expect(rowContent(s)).toContain('yaawc:tool_call');
    expect(rowContent(s)).toContain('"id":"t1"');
    expect(rowContent(s)).toContain('"status":"running"');
    s = reduceStreamEvent(
      s,
      ev({
        type: 'tool_call_success',
        data: { toolCallId: 't1', status: 'success' },
      }),
    ).state;
    expect(rowContent(s)).toContain('"status":"success"');
  });

  it('is idempotent: replaying the same started event does not duplicate the widget', () => {
    const started = ev({
      type: 'tool_call_started',
      data: { toolCallId: 't1', toolType: 'x', status: 'running' },
    });
    const s = run(liveStart(), [started, started]).state;
    const occurrences = (rowContent(s)!.match(/"id":"t1"/g) ?? []).length;
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

describe('structured chart placement', () => {
  const registration = (chartId = 'private-chart-1') =>
    ev({
      type: 'chart_spec',
      data: {
        chartId,
        handle: 'chart_1',
        spec: chartSpec,
      },
    });

  const placement = (
    chartId = 'private-chart-1',
    placementId = 'placement_1',
  ) =>
    ev({
      type: 'chart_placement',
      data: { chartId, placementId, handle: 'chart_1' },
    });

  it('keeps a registered chart invisible until a writer placement arrives', () => {
    const registered = reduceStreamEvent(liveStart(), registration()).state;
    expect(registered.messages).toHaveLength(0);
    expect(registered.receivedMessage).toBe('');
    expect(registered.chartSpecsByMessage[AI]['private-chart-1']).toEqual(
      chartSpec,
    );

    const shown = run(registered, [placement()]).state;
    expect(rowContent(shown)).toContain('```yaawc:chart');
    expect(rowContent(shown)).toContain('private-chart-1');
    expect(rowContent(shown)).not.toContain('<Chart');
    expect(rowContent(shown)).not.toContain('Loading chart');
  });

  it('allows repeated displays but makes replaying one placement idempotent', () => {
    const { state, effects } = run(liveStart(), [
      registration(),
      placement('private-chart-1', 'placement_1'),
      placement('private-chart-1', 'placement_1'),
      placement('private-chart-1', 'placement_2'),
    ]);

    expect(rowContent(state)?.match(/```yaawc:chart/g)).toHaveLength(2);
    expect(rowContent(state)).toContain('"id":"placement_1"');
    expect(rowContent(state)).toContain('"id":"placement_2"');
    expect(
      effects.filter((effect) => effect.kind === 'bumpScroll'),
    ).toHaveLength(2);

    const replayed = run(state, [registration(), placement()]).state;
    expect(rowContent(replayed)).toBe(rowContent(state));
  });

  it('ignores a placement for an unregistered private chart id', () => {
    const started = liveStart();
    const result = reduceStreamEvent(started, placement('guessed-id'));

    expect(result.state).toBe(started);
    expect(result.state.messages).toHaveLength(0);
    expect(result.effects).toEqual([]);
  });

  it('places isolated executor charts in the matching panel column even with overlapping handles', () => {
    const panelEvents: StreamAction[] = [
      ev({ type: 'panel_executor_started', executorIdx: 0, model: 'model-a' }),
      ev({ type: 'panel_executor_started', executorIdx: 1, model: 'model-b' }),
      ev({
        type: 'chart_spec',
        data: {
          chartId: 'panel_0_private-chart',
          handle: 'chart_1',
          executorIdx: 0,
          spec: chartSpec,
        },
      }),
      ev({
        type: 'chart_spec',
        data: {
          chartId: 'panel_1_private-chart',
          handle: 'chart_1',
          executorIdx: 1,
          spec: chartSpec,
        },
      }),
      ev({
        type: 'panel_executor_chart',
        executorIdx: 0,
        data: {
          placementId: 'panel_0_placement_1',
          chartId: 'panel_0_private-chart',
          handle: 'chart_1',
        },
      }),
      ev({
        type: 'panel_executor_chart',
        executorIdx: 1,
        data: {
          placementId: 'panel_1_placement_1',
          chartId: 'panel_1_private-chart',
          handle: 'chart_1',
        },
      }),
    ];
    const { state } = run(liveStart(), panelEvents);
    const panel = findWidget<PanelPayload>(
      rowContent(state)!,
      'panel',
      'panel',
    );

    expect(panel?.columns).toHaveLength(2);
    expect(panel?.columns[0].responseText).toContain('panel_0_private-chart');
    expect(panel?.columns[0].responseText).not.toContain(
      'panel_1_private-chart',
    );
    expect(panel?.columns[1].responseText).toContain('panel_1_private-chart');
    expect(panel?.columns[1].responseText).not.toContain(
      'panel_0_private-chart',
    );
    expect(rowContent(state)?.match(/```yaawc:chart/g)).toHaveLength(2);
  });

  it('removes a raw chart tag split across response chunks without a loading placeholder', () => {
    let state = liveStart();
    for (const data of ['Before ', '<Chart id="stale"', '/>', ' after']) {
      state = reduceStreamEvent(state, ev({ type: 'response', data })).state;
    }

    expect(state.receivedMessage).toBe('Before  after');
    expect(rowContent(state)).toBe('Before ');
    expect(rowContent(state)).not.toContain('<Chart');
    expect(rowContent(state)).not.toContain('Loading chart');
  });
});

describe('structured map registration and placement', () => {
  const mapSpec = {
    places: [
      {
        id: 'node/1',
        name: 'Central Cafe',
        coordinate: { lat: 40, lon: -75 },
        sourceUrl: 'https://www.openstreetmap.org/node/1',
        provider: 'openstreetmap',
        attribution: '© OpenStreetMap contributors',
      },
    ],
    attribution: '© OpenStreetMap contributors',
    retrievedAt: '2026-08-27T12:00:00.000Z',
    title: 'Nearby places',
    summary: 'One grounded place',
  };

  const registration = (mapId = 'private-map-1') =>
    ev({
      type: 'map_spec',
      data: {
        mapId,
        handle: 'map_1',
        spec: mapSpec,
        source: 'mapping-tool',
      },
    });

  const placement = (
    mapId = 'private-map-1',
    placementId = 'map_placement_1',
  ) =>
    ev({
      type: 'map_placement',
      data: {
        mapId,
        placementId,
        handle: 'map_1',
        placementNumber: 1,
      },
    });

  it('records a grounded map without rendering it until a placement arrives', () => {
    const registered = reduceStreamEvent(liveStart(), registration()).state;

    expect(registered.messages).toHaveLength(0);
    expect(registered.receivedMessage).toBe('');
    expect(registered.mapSpecsByMessage[AI]['private-map-1']).toEqual(mapSpec);
    expect(registered.mapHandlesByMessage[AI]['private-map-1']).toBe('map_1');
  });

  it('accepts only the registered private map and enforces one map per answer', () => {
    const { state } = run(liveStart(), [
      registration(),
      registration('private-map-2'),
      placement(),
      placement('private-map-1', 'map_placement_2'),
      placement('guessed-map', 'map_placement_3'),
    ]);

    expect(Object.keys(state.mapSpecsByMessage[AI])).toEqual(['private-map-1']);
    expect(state.mapPlacementIdsByMessage[AI]).toEqual(['map_placement_1']);
    const widget = findWidget<MapPayload>(
      rowContent(state)!,
      'map',
      'map_placement_1',
    );
    expect(widget).toMatchObject({
      mapId: 'private-map-1',
      fallback: expect.stringContaining('1. Central Cafe'),
      attribution: '© OpenStreetMap contributors',
    });
    expect(rowContent(state)?.match(/```yaawc:map/g)).toHaveLength(1);
  });

  it('deduplicates a replayed placement and can reconstruct the same row from an attach stream', () => {
    const live = run(liveStart(), [registration(), placement()]).state;
    const attached = run(attachStart(live.receivedMessage), [
      registration(),
      placement(),
      ev({ type: 'replay_complete', content: live.receivedMessage }),
    ]).state;

    expect(attached.receivedMessage).toBe(live.receivedMessage);
    expect(rowContent(attached)).toBe(rowContent(live));
    expect(attached.mapPlacementIdsByMessage[AI]).toEqual(['map_placement_1']);
    expect(attached.inReplay).toBe(false);
  });

  it('keeps a session overlay live-only in reducer state and replaces it for the same map', () => {
    const firstOverlay = ev({
      type: 'map_session_overlay',
      data: {
        mapId: 'private-map-1',
        origin: { lat: 40.1, lon: -75.1 },
        clientSessionId: 'page-1',
        expiresAt: '2026-08-27T12:10:00.000Z',
      },
    });
    const secondOverlay = ev({
      type: 'map_session_overlay',
      data: {
        mapId: 'private-map-1',
        origin: { lat: 40.2, lon: -75.2 },
        clientSessionId: 'page-1',
        expiresAt: '2026-08-27T12:11:00.000Z',
      },
    });

    const withOverlay = run(liveStart(), [
      registration(),
      firstOverlay,
      secondOverlay,
    ]).state;
    expect(withOverlay.mapSessionOverlaysByMessage[AI]).toEqual([
      {
        mapId: 'private-map-1',
        origin: { lat: 40.2, lon: -75.2 },
        clientSessionId: 'page-1',
        expiresAt: '2026-08-27T12:11:00.000Z',
      },
    ]);
    expect(withOverlay.receivedMessage).not.toContain('40.2');
    expect(rowContent(withOverlay)).toBeUndefined();

    const reset = reduceStreamEvent(withOverlay, {
      type: 'stream_started',
      mode: 'attach',
      chatId: 'c1',
      aiMessageId: AI,
      seedContent: withOverlay.receivedMessage,
    }).state;
    expect(reset.mapSessionOverlaysByMessage).toEqual({});
  });

  it('ignores overlays before registration and malformed or mismatched placements', () => {
    const overlay = ev({
      type: 'map_session_overlay',
      data: { mapId: 'private-map-1', origin: { lat: 40, lon: -75 } },
    });
    const unregisteredPlacement = placement();
    const mismatchedPlacement = ev({
      type: 'map_placement',
      data: {
        placementId: 'map_placement_1',
        mapId: 'private-map-1',
        handle: 'map_2',
        placementNumber: 1,
      },
    });

    const before = reduceStreamEvent(liveStart(), overlay).state;
    expect(before.mapSessionOverlaysByMessage).toEqual({});
    expect(before.receivedMessage).toBe('');

    const after = run(liveStart(), [
      unregisteredPlacement,
      registration(),
      mismatchedPlacement,
      ev({
        type: 'map_placement',
        data: {
          placementId: 'map_placement_1',
          mapId: 'private-map-1',
          handle: 'map_1',
          placementNumber: 2,
        },
      }),
    ]).state;
    expect(after.mapPlacementIdsByMessage).toEqual({});
    expect(after.messages).toHaveLength(0);
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
    expect((row?.modelStats as ModelStatsV1 | undefined)?.modelName).toBe('m');
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

  it('finalizes on messageEnd with v2 modelStats (per-model rows)', () => {
    let s = liveStart();
    s = reduceStreamEvent(s, ev({ type: 'response', data: 'hello' })).state;
    const { state } = run(s, [
      ev({
        type: 'messageEnd',
        messageId: AI,
        modelStats: {
          version: 2,
          perModel: [
            {
              provider: 'openai',
              model: 'gpt-5',
              usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
            },
          ],
          usedLocation: false,
        },
        searchQuery: 'q',
      }),
    ]);
    const row = state.messages.find((m) => m.messageId === AI);
    expect(row?.modelStats).toMatchObject({
      version: 2,
      perModel: [
        {
          provider: 'openai',
          model: 'gpt-5',
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        },
      ],
      usedLocation: false,
    });
    expect(state.liveModelStats).toBeNull();
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

describe('nested widget token buffering', () => {
  const started = ev({
    type: 'subagent_started',
    executionId: 's1',
    name: 'researcher',
    task: 'dig',
  });
  const tok = (data: string) =>
    ev({
      type: 'subagent_data',
      subagentId: 's1',
      subagentName: 'researcher',
      data: { type: 'response', data },
    });

  it('buffers subagent response tokens, committing every 5', () => {
    const { state } = run(liveStart(), [
      started,
      tok('a'),
      tok('b'),
      tok('c'),
      tok('d'),
    ]);
    expect(rowContent(state)).not.toContain('responseText');
    const after = reduceStreamEvent(state, tok('e')).state;
    expect(rowContent(after)).toContain('"responseText":"abcde"');
    expect(after.receivedMessage).toContain('"responseText":"abcde"');
    expect(after.pendingWidgetTokens).toEqual({});
  });

  it('flushes buffered tokens before any other event applies', () => {
    const { state } = run(liveStart(), [started, tok('a'), tok('b')]);
    const done = reduceStreamEvent(
      state,
      ev({ type: 'subagent_completed', id: 's1', summary: 'done' }),
    ).state;
    expect(rowContent(done)).toContain('"responseText":"ab"');
    expect(rowContent(done)).toContain('"status":"success"');
  });

  it('buffers panel executor tokens per column', () => {
    const panelTok = (executorIdx: number, token: string) =>
      ev({ type: 'panel_executor_data', executorIdx, token });
    const { state } = run(liveStart(), [
      ev({ type: 'panel_executor_started', executorIdx: 0, model: 'm1' }),
      ev({ type: 'panel_executor_started', executorIdx: 1, model: 'm2' }),
      panelTok(0, 'a'),
      panelTok(1, 'x'),
      panelTok(0, 'b'),
    ]);
    // Interleaved columns buffer independently — nothing committed yet.
    expect(rowContent(state)).toContain('"responseText":""');
    const after = run(state, [
      panelTok(0, 'c'),
      panelTok(0, 'd'),
      panelTok(0, 'e'),
    ]).state;
    // Column 0 hit the threshold; the flush commits column 1's buffer too.
    expect(rowContent(after)).toContain('"responseText":"abcde"');
    expect(rowContent(after)).toContain('"responseText":"x"');
    expect(after.pendingWidgetTokens).toEqual({});
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

describe('chatTitle', () => {
  it('emits a setChatTitle effect and leaves messages untouched', () => {
    const start = liveStart();
    const seeded = reduceStreamEvent(
      start,
      ev({ type: 'response', data: 'Hello there' }),
    ).state;
    const before = seeded.messages;
    const { state, effects } = reduceStreamEvent(
      seeded,
      ev({
        type: 'chatTitle',
        chatId: 'c1',
        title: 'A Concise Title',
        messageId: AI,
      }),
    );
    expect(effects).toContainEqual({
      kind: 'setChatTitle',
      chatId: 'c1',
      title: 'A Concise Title',
    });
    // No message-state mutation: same row contents, same length.
    expect(state.messages).toEqual(before);
  });
});

describe('artifact_saved', () => {
  const saved = (over: Record<string, unknown> = {}) =>
    ev({
      type: 'artifact_saved',
      messageId: AI,
      data: {
        artifactId: 'art-1',
        title: 'Quarterly Report',
        version: 1,
        action: 'create',
        ...over,
      },
    });

  it('writes an artifact card into the assistant row', () => {
    const { state } = reduceStreamEvent(liveStart(), saved());
    expect(rowContent(state)).toContain('yaawc:artifact');
    expect(rowContent(state)).toContain('"title":"Quarterly Report"');
  });

  it('opens the panel at the saved version and refreshes the artifact list', () => {
    const { effects } = reduceStreamEvent(liveStart(), saved({ version: 2 }));
    expect(effects).toContainEqual({
      kind: 'openArtifact',
      artifactId: 'art-1',
      version: 2,
    });
    expect(effects).toContainEqual({
      kind: 'invalidateArtifacts',
      chatId: 'c1',
    });
  });

  it('keeps one card per artifact across repeated saves in a turn', () => {
    const { state } = run(liveStart(), [
      saved(),
      saved({ version: 2, action: 'edit' }),
      saved({ version: 3, action: 'edit' }),
    ]);
    expect(rowContent(state)?.match(/yaawc:artifact/g)).toHaveLength(1);
    expect(rowContent(state)).toContain('"version":3');
    expect(rowContent(state)).not.toContain('"version":1');
  });

  it('gives each artifact its own card', () => {
    const { state } = run(liveStart(), [
      saved(),
      saved({ artifactId: 'art-2', title: 'Appendix' }),
    ]);
    expect(rowContent(state)?.match(/yaawc:artifact/g)).toHaveLength(2);
  });

  it('still writes the card during replay, so the transcript matches a live run', () => {
    const { state } = reduceStreamEvent(attachStart('seed'), saved());
    expect(rowContent(state)).toContain('yaawc:artifact');
  });

  it('does not pop the panel when replaying a finished run', () => {
    const { effects } = reduceStreamEvent(attachStart('seed'), saved());
    expect(effects.map((e) => e.kind)).not.toContain('openArtifact');
    expect(effects.map((e) => e.kind)).not.toContain('invalidateArtifacts');
  });

  it('resumes opening the panel once replay completes', () => {
    let s = attachStart('seed');
    s = reduceStreamEvent(
      s,
      ev({ type: 'replay_complete', content: 'seed' }),
    ).state;
    const { effects } = reduceStreamEvent(s, saved());
    expect(effects).toContainEqual({
      kind: 'openArtifact',
      artifactId: 'art-1',
      version: 1,
    });
  });

  it('preserves prose already streamed into the row', () => {
    const { state } = run(liveStart(), [
      ev({ type: 'response', data: 'Here is the report.' }),
      saved(),
    ]);
    expect(rowContent(state)).toContain('Here is the report.');
    expect(rowContent(state)).toContain('yaawc:artifact');
  });
});
