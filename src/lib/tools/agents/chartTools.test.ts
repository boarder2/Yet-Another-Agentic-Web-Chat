import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { getSubagentDefinition } from '@/lib/search/subagents/definitions';
import {
  STREAM_EVENT_CHANNEL,
  type AgentEmitEvent,
} from '@/lib/streaming/events';
import { TurnChartRegistry } from '@/lib/chart/turnChartRegistry';
import { createChartTool } from './createChartTool';
import { showChartTool } from './showChartTool';
import {
  getCoreTools,
  getLocalResearchTools,
  getWebSearchTools,
} from './index';

type InvokableTool = {
  invoke(input: unknown, config: unknown): Promise<unknown>;
};

const input = (title = 'Revenue') => ({
  type: 'line' as const,
  title,
  labels: ['Q1', 'Q2'],
  series: [{ label: 'Sales', values: [10, 20] }],
});

const runtime = (
  chartRegistry: TurnChartRegistry,
  emitter: EventEmitter,
  toolCallId: string,
) => ({
  context: { chartRegistry, emitter },
  state: {},
  toolCallId,
  config: {},
  store: null,
  writer: null,
});

const invoke = async (
  tool: unknown,
  args: unknown,
  chartRegistry: TurnChartRegistry,
  emitter: EventEmitter,
  toolCallId: string,
): Promise<unknown> =>
  (tool as InvokableTool).invoke(
    {
      type: 'tool_call',
      name: tool === createChartTool ? 'create_chart' : 'show_chart',
      id: toolCallId,
      args,
    },
    runtime(chartRegistry, emitter, toolCallId),
  );

const toolResultText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'content' in value) {
    const content = (value as { content?: unknown }).content;
    if (typeof content === 'string') return content;
  }
  throw new Error('expected textual tool output');
};

const parseResult = (value: unknown): Record<string, unknown> =>
  JSON.parse(toolResultText(value)) as Record<string, unknown>;

const collectEvents = (emitter: EventEmitter): AgentEmitEvent[] => {
  const events: AgentEmitEvent[] = [];
  emitter.on(STREAM_EVENT_CHANNEL, (event: AgentEmitEvent) => {
    events.push(event);
  });
  return events;
};

const registry = () =>
  new TurnChartRegistry({
    idFactory: (() => {
      let index = 0;
      return () => `private-${++index}`;
    })(),
  });

describe('chart lifecycle tools', () => {
  it('registers a simplified chart without placing it or exposing tool chrome', async () => {
    const chartRegistry = registry();
    const emitter = new EventEmitter();
    const events = collectEvents(emitter);

    const result = parseResult(
      await invoke(
        createChartTool,
        input('Quarterly revenue'),
        chartRegistry,
        emitter,
        'create-1',
      ),
    );

    expect(result).toEqual({ handle: 'chart_1', title: 'Quarterly revenue' });
    expect(chartRegistry.registrationCount).toBe(1);
    expect(chartRegistry.placementCount).toBe(0);
    expect(chartRegistry.resolve('chart_1')?.chartId).toBe('private-1');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'chart_spec',
      data: {
        chartId: 'private-1',
        handle: 'chart_1',
        source: 'create_chart',
        toolCallId: 'create-1',
        spec: {
          type: 'line',
          title: 'Quarterly revenue',
          xKey: 'label',
        },
      },
    });
    expect(events.some((event) => event.type === 'tool_call_started')).toBe(
      false,
    );
    expect(events.some((event) => event.type === 'tool_call_success')).toBe(
      false,
    );
  });

  it('shows a current-turn handle with a chart-only placement event', async () => {
    const chartRegistry = registry();
    const emitter = new EventEmitter();
    const events = collectEvents(emitter);

    const created = parseResult(
      await invoke(
        createChartTool,
        input('Trend'),
        chartRegistry,
        emitter,
        'create-1',
      ),
    );
    events.length = 0;

    const shown = parseResult(
      await invoke(
        showChartTool,
        { handle: created.handle },
        chartRegistry,
        emitter,
        'show-1',
      ),
    );

    expect(shown).toEqual({ handle: 'chart_1', title: 'Trend' });
    expect(chartRegistry.placementCount).toBe(1);
    expect(events).toEqual([
      {
        type: 'chart_placement',
        data: {
          placementId: 'placement_1',
          chartId: 'private-1',
          handle: 'chart_1',
          placementNumber: 1,
        },
      },
    ]);
    expect(events.some((event) => event.type === 'tool_call_started')).toBe(
      false,
    );
    expect(events.some((event) => event.type === 'tool_call_success')).toBe(
      false,
    );
  });

  it('returns actionable feedback for an unknown handle without rendering a widget', async () => {
    const chartRegistry = registry();
    const emitter = new EventEmitter();
    const events = collectEvents(emitter);

    await invoke(
      createChartTool,
      input('Available chart'),
      chartRegistry,
      emitter,
      'create-1',
    );
    events.length = 0;

    const result = await invoke(
      showChartTool,
      { handle: 'chart_99' },
      chartRegistry,
      emitter,
      'show-unknown',
    );

    const feedback = toolResultText(result);
    expect(feedback).toContain('Unknown chart handle "chart_99"');
    expect(feedback).toContain('chart_1 (Available chart)');
    expect(feedback).toContain('Choose a chart from this turn');
    expect(chartRegistry.placementCount).toBe(0);
    expect(events).toEqual([]);
  });

  it('does not render malformed or invalid chart input', async () => {
    const chartRegistry = registry();
    const emitter = new EventEmitter();
    const events = collectEvents(emitter);

    await expect(
      invoke(
        createChartTool,
        {
          type: 'bar',
          title: 'Bad chart',
          labels: ['A', 'B'],
          series: [{ label: 'Value', values: [1] }],
        },
        chartRegistry,
        emitter,
        'create-invalid',
      ),
    ).rejects.toThrow('series values must align');
    expect(chartRegistry.registrationCount).toBe(0);
    expect(events).toEqual([]);
  });

  it('allows repeated placement of the same registration with distinct writer IDs', async () => {
    const chartRegistry = registry();
    const emitter = new EventEmitter();
    const events = collectEvents(emitter);

    await invoke(
      createChartTool,
      input('Repeatable'),
      chartRegistry,
      emitter,
      'create-1',
    );
    events.length = 0;

    await invoke(
      showChartTool,
      { handle: 'chart_1' },
      chartRegistry,
      emitter,
      'show-1',
    );
    await invoke(
      showChartTool,
      { handle: 'chart_1' },
      chartRegistry,
      emitter,
      'show-2',
    );

    expect(chartRegistry.registrationCount).toBe(1);
    expect(chartRegistry.placementCount).toBe(2);
    expect(events.map((event) => event.type)).toEqual([
      'chart_placement',
      'chart_placement',
    ]);
    expect(
      events.map((event) =>
        event.type === 'chart_placement' ? event.data.placementId : '',
      ),
    ).toEqual(['placement_1', 'placement_2']);
  });

  it('rolls back registration when its writer emitter fails', async () => {
    const chartRegistry = registry();
    const emitter = new EventEmitter();
    emitter.on(STREAM_EVENT_CHANNEL, () => {
      throw new Error('writer unavailable');
    });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const result = await invoke(
        createChartTool,
        input('Should not survive'),
        chartRegistry,
        emitter,
        'create-failed',
      );

      const feedback = toolResultText(result);
      expect(feedback).toContain('Could not create chart');
      expect(feedback).toContain('writer unavailable');
      expect(chartRegistry.registrationCount).toBe(0);
      expect(chartRegistry.placementCount).toBe(0);
      expect(chartRegistry.resolve('chart_1')).toBeUndefined();
    } finally {
      warning.mockRestore();
    }
  });

  it('rolls back placement when the placement emitter fails', async () => {
    const chartRegistry = registry();
    const emitter = new EventEmitter();
    await invoke(
      createChartTool,
      input('Placement failure'),
      chartRegistry,
      emitter,
      'create-1',
    );

    emitter.on(STREAM_EVENT_CHANNEL, () => {
      throw new Error('placement writer unavailable');
    });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const result = await invoke(
        showChartTool,
        { handle: 'chart_1' },
        chartRegistry,
        emitter,
        'show-failed',
      );

      expect(toolResultText(result)).toContain(
        'Failed to emit chart placement event',
      );
      expect(chartRegistry.registrationCount).toBe(1);
      expect(chartRegistry.placementCount).toBe(0);
    } finally {
      warning.mockRestore();
    }
  });
});

describe('chart tool availability', () => {
  it('exposes both lifecycle tools in Chat and other chart-capable top-level modes', () => {
    const required = ['create_chart', 'show_chart'];
    for (const tools of [
      getCoreTools(),
      getWebSearchTools(),
      getLocalResearchTools(),
    ]) {
      expect(tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(required),
      );
    }
  });

  it('keeps lifecycle tools out of the deep-research subagent whitelist', () => {
    const definition = getSubagentDefinition('deep_research');
    expect(definition).toBeTruthy();
    expect(definition?.allowedTools).not.toContain('create_chart');
    expect(definition?.allowedTools).not.toContain('show_chart');
  });
});
