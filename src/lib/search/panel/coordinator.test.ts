import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import type { CachedEmbeddings } from '@/lib/utils/cachedEmbeddings';
import type { TokenTracker } from '@/lib/tokens/tracker';

vi.mock('@/lib/search/simplifiedAgent', () => ({
  SimplifiedAgent: class FakeSimplifiedAgent {
    private readonly emitter: {
      emit: (channel: string, event: unknown) => void;
    };

    constructor(...args: unknown[]) {
      this.emitter = args[3] as {
        emit: (channel: string, event: unknown) => void;
      };
    }

    async searchAndAnswer(): Promise<void> {
      const spec = {
        type: 'line',
        title: 'Executor trend',
        data: [{ label: 'A', series_1: 1 }],
        series: [{ key: 'series_1', label: 'Value' }],
        xKey: 'label',
      };
      this.emitter.emit('stream_event', {
        type: 'chart_spec',
        data: {
          chartId: 'same-private-id',
          handle: 'chart_1',
          spec,
        },
      });
      this.emitter.emit('stream_event', {
        type: 'chart_placement',
        data: {
          placementId: 'placement_1',
          chartId: 'same-private-id',
          handle: 'chart_1',
        },
      });
      this.emitter.emit('stream_event', {
        type: 'response',
        data: 'Answer <Chart id="same-private-id"/>',
      });
      this.emitter.emit('stream_event', {
        type: 'sources',
        data: [],
        searchQuery: 'query',
        searchUrl: '',
      });
    }
  },
}));

vi.mock('@/lib/tools/agents', () => ({
  getAllAgentTools: () => [],
  getWebSearchTools: () => [],
  getLocalResearchTools: () => [],
  fileSearchTools: [],
}));
vi.mock('@/lib/tools/panel/restrictedToolset', () => ({
  filterExecutorTools: (tools: unknown[]) => tools,
}));
vi.mock('@/lib/utils/modelUtils', () => ({
  getModelName: () => 'fake-model',
}));
vi.mock('@/lib/utils/contentUtils', () => ({
  removeThinkingBlocks: (text: string) => text,
}));

import { PanelCoordinator } from './coordinator';

const fakeModel = {} as never;
const fakeTracker = {
  register: vi.fn(() => ({})),
  scopeUsage: vi.fn(() => undefined),
} as unknown as TokenTracker;

function eventsFor(
  events: Array<{ executorIdx?: number; type: string; data?: unknown }>,
  type: string,
  executorIdx: number,
): Array<{ executorIdx?: number; type: string; data?: unknown }> {
  return events.filter((event) => {
    const dataExecutorIdx =
      event.data && typeof event.data === 'object'
        ? (event.data as { executorIdx?: unknown }).executorIdx
        : undefined;
    return (
      event.type === type &&
      (event.executorIdx ?? dataExecutorIdx) === executorIdx
    );
  });
}

describe('PanelCoordinator structured chart bridge', () => {
  it('namespaces overlapping executor chart handles and forwards placements to columns', async () => {
    const parentEmitter = new EventEmitter();
    const events: Array<{
      executorIdx?: number;
      type: string;
      data?: unknown;
    }> = [];
    parentEmitter.on('stream_event', (event) => events.push(event));

    const coordinator = new PanelCoordinator({
      executors: [
        {
          ref: { provider: 'test', name: 'executor-a' },
          llm: fakeModel,
        },
        {
          ref: { provider: 'test', name: 'executor-b' },
          llm: fakeModel,
        },
      ],
      systemLlm: fakeModel,
      embeddings: {} as CachedEmbeddings,
      parentEmitter,
      signal: new AbortController().signal,
      messageId: 'message-1',
      tracker: fakeTracker,
      systemModelRef: { provider: 'test', name: 'system' },
    });

    const result = await coordinator.run('query', [], [], 'webSearch');

    expect(
      result.executorResults.every((executor) => executor.status === 'success'),
    ).toBe(true);
    for (const idx of [0, 1]) {
      const registrations = eventsFor(events, 'chart_spec', idx);
      const placements = eventsFor(events, 'panel_executor_chart', idx);
      expect(registrations).toHaveLength(1);
      expect(placements).toHaveLength(1);
      expect(registrations[0].data).toMatchObject({
        chartId: `panel_${idx}_same-private-id`,
        handle: 'chart_1',
        executorIdx: idx,
      });
      expect(placements[0].data).toMatchObject({
        chartId: `panel_${idx}_same-private-id`,
        placementId: `panel_${idx}_placement_1`,
        handle: 'chart_1',
      });
    }

    expect(
      events.filter((event) => event.type === 'chart_placement'),
    ).toHaveLength(0);
    expect(result.executorResults.map((executor) => executor.text)).toEqual([
      'Answer',
      'Answer',
    ]);
  });
});
