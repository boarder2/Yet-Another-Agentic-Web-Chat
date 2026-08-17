import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeCode: vi.fn(),
  ensureImage: vi.fn(),
  checkDockerAvailable: vi.fn(),
  fetchSourceContent: vi.fn(),
}));

vi.mock('@/lib/config', () => ({
  getCodeExecutionConfig: () => ({
    enabled: true,
    dockerImage: 'node:24-alpine',
  }),
}));

vi.mock('@/lib/sandbox/dockerExecutor', () => ({
  executeCode: mocks.executeCode,
  ensureImage: mocks.ensureImage,
  checkDockerAvailable: mocks.checkDockerAvailable,
}));

vi.mock('./sources', () => ({
  MAX_SOURCES_PER_WIDGET: 8,
  fetchSourceContent: mocks.fetchSourceContent,
}));

import { runCodeWidget } from './codeWidgetRunner';
import { CODE_WIDGET_TEMPLATE } from '@/lib/widgets/codeWidgetTemplate';

const chart = (title = 'Revenue') => ({
  type: 'bar',
  title,
  labels: ['Q1', 'Q2'],
  series: [{ label: 'Total', values: [1, 2] }],
});

function executionOutput(charts: unknown[], output = '<Chart id="c0"/>') {
  mocks.executeCode.mockImplementationOnce(async (code: string) => {
    const nonce = code.match(/__WIDGET__([a-f0-9]+)/)?.[1];
    if (!nonce) throw new Error('test harness marker missing');
    return {
      stdout: `__WIDGET__${nonce}${JSON.stringify({
        output,
        outputWasString: true,
        charts,
      })}`,
      stderr: '',
      exitCode: 0,
      timedOut: false,
      oomKilled: false,
    };
  });
}

describe('code widget chart contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkDockerAvailable.mockResolvedValue(true);
    mocks.ensureImage.mockResolvedValue(undefined);
    mocks.fetchSourceContent.mockResolvedValue({
      url: 'https://example.com',
      type: 'Web Page',
      content: 'source',
      ok: true,
      truncated: false,
    });
  });

  it('keeps helper-generated cN placement and caches normalized canonical specs', async () => {
    executionOutput([{ id: 'c0', spec: chart('  Revenue  ') }]);

    const result = await runCodeWidget({
      code: 'async function render(){ return chart({}); }',
      sources: [],
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe('<Chart id="c0"/>');
    expect(result.charts).toEqual({
      c0: {
        type: 'bar',
        title: 'Revenue',
        data: [
          { label: 'Q1', series_1: 1 },
          { label: 'Q2', series_1: 2 },
        ],
        series: [{ key: 'series_1', label: 'Total' }],
        xKey: 'label',
      },
    });
  });

  it('rejects canonical chart source instead of adapting it', async () => {
    executionOutput([
      {
        id: 'c0',
        spec: {
          type: 'bar',
          title: 'Canonical input',
          data: [{ x: 'Q1', value: 1 }],
          series: [{ key: 'value', label: 'Value' }],
          xKey: 'x',
        },
      },
    ]);

    const result = await runCodeWidget({
      code: 'async function render(){ return chart({}); }',
      sources: [],
    });

    expect(result.success).toBe(false);
    expect(result.charts).toEqual({});
    expect(result.error).toMatch(/Invalid simplified chart "c0"/);
    expect(result.error).toMatch(/labels/);
  });

  it('normalizes each simplified helper emission while preserving cN placement', async () => {
    executionOutput(
      [
        {
          id: 'c0',
          spec: {
            type: 'area',
            title: '  Bounded area  ',
            labels: [' Jan '],
            series: [{ label: 'Value', values: [4] }],
            options: { yMin: 0, yMax: 10 },
          },
        },
        {
          id: 'c1',
          spec: {
            type: 'pie',
            title: '  Share  ',
            slices: [
              { label: 'First', value: 1, color: ' #123456 ' },
              { label: 'Second', value: 2, color: 'rgb(1, 2, 3)' },
            ],
          },
        },
      ],
      '<Chart id="c0"/>\n\n<Chart id="c1"/>',
    );

    const result = await runCodeWidget({
      code: 'async function render(){ return "charts"; }',
      sources: [],
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe('<Chart id="c0"/>\n\n<Chart id="c1"/>');
    expect(result.charts.c0).toMatchObject({
      type: 'area',
      title: 'Bounded area',
      xKey: 'label',
      options: { yMin: 0, yMax: 10 },
    });
    expect(result.charts.c1).toMatchObject({
      type: 'pie',
      title: 'Share',
      data: [
        { name: 'First', value: 1, color: '#123456' },
        { name: 'Second', value: 2, color: 'rgb(1, 2, 3)' },
      ],
    });
  });

  it('retains the ten-chart widget cap', async () => {
    executionOutput(
      Array.from({ length: 11 }, (_, index) => ({
        id: `c${index}`,
        spec: chart(`Chart ${index}`),
      })),
    );

    const result = await runCodeWidget({
      code: 'async function render(){ return "charts"; }',
      sources: [],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('at most 10');
    expect(result.charts).toEqual({});
  });

  it('documents the simplified helper contract in the default template', () => {
    expect(CODE_WIDGET_TEMPLATE).toContain('labels: sources.map');
    expect(CODE_WIDGET_TEMPLATE).toContain('values: sources.map');
    expect(CODE_WIDGET_TEMPLATE).not.toContain("xKey: 'name'");
    expect(CODE_WIDGET_TEMPLATE).not.toContain('data: sources.map');
  });
});
