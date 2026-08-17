import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  TURN_CHART_MAX_REGISTRATIONS,
  TurnChartRegistry,
} from '@/lib/chart/turnChartRegistry';
import {
  STREAM_EVENT_CHANNEL,
  type AgentEmitEvent,
} from '@/lib/streaming/events';
import {
  CODE_CHART_MAX_RECORD_BYTES,
  CODE_CHART_MAX_RECORDS,
  CODE_CHART_RECORD_VERSION,
  PrivateRecordCollector,
  createCodeChartChannel,
  decodeCodeChartRecord,
  decodeCodeChartRecords,
  injectChartHelper,
  registerCodeExecutionCharts,
} from './codeExecutionCharts';

const spec = (title: string) => ({
  type: 'line' as const,
  title,
  labels: ['A', 'B'],
  series: [{ label: 'Value', values: [1, 2] }],
});

const record = (value: unknown) =>
  JSON.stringify({ version: CODE_CHART_RECORD_VERSION, spec: value });

const registry = () =>
  new TurnChartRegistry({
    idFactory: (() => {
      let index = 0;
      return () => `private-${++index}`;
    })(),
  });

const capturedEvents = (emitter: EventEmitter): AgentEmitEvent[] => {
  const events: AgentEmitEvent[] = [];
  emitter.on(STREAM_EVENT_CHANNEL, (event: AgentEmitEvent) => {
    events.push(event);
  });
  return events;
};

describe('code execution chart private protocol', () => {
  it('injects a global chart(spec) helper that writes versioned private records', () => {
    const channel = createCodeChartChannel(() => 'deterministic-token');
    const writes: string[] = [];

    runInNewContext(
      injectChartHelper(`chart(${JSON.stringify(spec('Computed'))});`, channel),
      {
        process: { stdout: { write: (value: string) => writes.push(value) } },
      },
    );

    expect(writes).toEqual([`${channel.prefix}${record(spec('Computed'))}\n`]);
    expect(
      decodeCodeChartRecord(writes[0].slice(channel.prefix.length, -1)),
    ).toEqual({
      index: 0,
      spec: spec('Computed'),
    });
  });

  it('uses a randomized prefix so ordinary output cannot address the private channel', () => {
    const first = createCodeChartChannel();
    const second = createCodeChartChannel();

    expect(first.prefix).not.toBe(second.prefix);
    expect(first.prefix).toMatch(/^__YAAWC_CHART_RECORD_[0-9a-f]+__$/);
    expect(first.prelude).toContain(JSON.stringify(first.prefix));
  });

  it('captures private records after visible stdout reaches its cap and enforces bounds', () => {
    const prefix = '__YAAWC_CHART_RECORD_test__';
    const collector = new PrivateRecordCollector(prefix, {
      maxRecords: 2,
      maxRecordBytes: CODE_CHART_MAX_RECORD_BYTES,
    });
    const visibleCap = 12;
    let visible = '';
    const appendVisible = (chunk: string) => {
      visible += chunk.slice(0, Math.max(0, visibleCap - visible.length));
    };

    appendVisible(collector.push('ordinary output that is truncated\n'));
    appendVisible(collector.push(`${prefix}${record(spec('First'))}\n`));
    appendVisible(collector.push(`${prefix}${record(spec('Second'))}\n`));
    appendVisible(collector.push(`${prefix}${record(spec('Ignored'))}\n`));
    appendVisible(collector.finish());

    expect(visible).toBe('ordinary out');
    expect(collector.records).toEqual([
      record(spec('First')),
      record(spec('Second')),
    ]);
    expect(collector.errors).toEqual([
      `Only the first 2 private chart records are accepted.`,
    ]);
    expect(visible).not.toContain(prefix);

    const oversized = new PrivateRecordCollector(prefix, {
      maxRecords: 1,
      maxRecordBytes: 8,
    });
    expect(oversized.push(`${prefix}${'x'.repeat(9)}\n`)).toBe('');
    expect(oversized.finish()).toBe('');
    expect(oversized.records).toEqual([]);
    expect(oversized.errors[0]).toContain(
      'exceeded the 8-byte transport limit',
    );
  });

  it('handles a marker split across stdout chunks without leaking it to visible output', () => {
    const prefix = '__YAAWC_CHART_RECORD_split__';
    const collector = new PrivateRecordCollector(prefix);
    const line = `${prefix}${record(spec('Split'))}\n`;
    let visible = '';
    for (const chunk of [
      'before ',
      line.slice(0, 9),
      line.slice(9, prefix.length + 4),
      line.slice(prefix.length + 4),
    ]) {
      visible += collector.push(chunk);
    }
    visible += collector.finish();

    expect(visible).toBe('before ');
    expect(collector.records).toEqual([record(spec('Split'))]);
  });

  it('preserves text around a split private record exactly once', () => {
    const prefix = '__YAAWC_CHART_RECORD_around__';
    const payload = record(spec('Around'));
    const collector = new PrivateRecordCollector(prefix);
    const chunks = [
      `before ${prefix.slice(0, 5)}`,
      `${prefix.slice(5)}${payload.slice(0, 7)}`,
      `${payload.slice(7)}\nafter`,
    ];

    const visible =
      chunks.map((chunk) => collector.push(chunk)).join('') +
      collector.finish();

    expect(visible).toBe('before after');
    expect(collector.records).toEqual([payload]);
  });

  it('decodes records in emission order and rejects public __CHART__ lines', () => {
    const validFirst = record(spec('First'));
    const validSecond = record(spec('Second'));
    const decoded = decodeCodeChartRecords([validFirst, validSecond]);

    expect(decoded).toEqual([
      { index: 0, spec: spec('First') },
      { index: 1, spec: spec('Second') },
    ]);
    expect(
      decodeCodeChartRecord(`__CHART__${JSON.stringify(spec('Legacy'))}`),
    ).toEqual({
      index: 0,
      error: 'chart(spec) emitted malformed machine data.',
    });

    const chartRegistry = registry();
    const outcome = registerCodeExecutionCharts({
      records: [`__CHART__${JSON.stringify(spec('Legacy'))}`],
      executionSucceeded: true,
      registry: chartRegistry,
      emitter: new EventEmitter(),
    });
    expect(outcome.handles).toEqual([]);
    expect(chartRegistry.registrationCount).toBe(0);
  });

  it('validates each emission independently and preserves ordered accepted results', () => {
    const chartRegistry = registry();
    const emitter = new EventEmitter();
    const events = capturedEvents(emitter);
    const invalid = {
      type: 'line',
      title: 'Misaligned',
      labels: ['A', 'B'],
      series: [{ label: 'Value', values: [1] }],
    };

    const outcome = registerCodeExecutionCharts({
      records: [record(spec('First')), record(invalid), record(spec('Second'))],
      executionSucceeded: true,
      registry: chartRegistry,
      emitter,
      toolCallId: 'code-1',
    });

    expect(outcome.results).toHaveLength(3);
    expect(outcome.results[0]).toMatchObject({
      index: 0,
      handle: 'chart_1',
      title: 'First',
    });
    expect(outcome.results[1]).toMatchObject({
      index: 1,
      error: expect.stringContaining('series values must align'),
    });
    expect(outcome.results[2]).toMatchObject({
      index: 2,
      handle: 'chart_2',
      title: 'Second',
    });
    expect(outcome.handles).toEqual(['chart_1', 'chart_2']);
    expect(outcome.titles).toEqual(['First', 'Second']);
    expect(outcome.errors).toHaveLength(1);
    expect(chartRegistry.availableCharts()).toEqual([
      { handle: 'chart_1', title: 'First' },
      { handle: 'chart_2', title: 'Second' },
    ]);
    expect(
      events
        .filter((event) => event.type === 'chart_spec')
        .map((event) =>
          event.type === 'chart_spec' ? event.data.handle : undefined,
        ),
    ).toEqual(['chart_1', 'chart_2']);
  });

  it.each([
    { name: 'nonzero exit', executionSucceeded: false },
    { name: 'timeout', executionSucceeded: false },
    { name: 'out of memory', executionSucceeded: false },
  ])(
    'discards every chart after a $name execution',
    ({ executionSucceeded }) => {
      const chartRegistry = registry();
      const emitter = new EventEmitter();
      const events = capturedEvents(emitter);

      const outcome = registerCodeExecutionCharts({
        records: [record(spec('Must be discarded'))],
        executionSucceeded,
        registry: chartRegistry,
        emitter,
      });

      expect(outcome.handles).toEqual([]);
      expect(outcome.titles).toEqual([]);
      expect(outcome.errors).toEqual([
        expect.stringContaining('registrations were discarded'),
      ]);
      expect(chartRegistry.registrationCount).toBe(0);
      expect(events).toEqual([]);
    },
  );

  it(`registers only the first ${TURN_CHART_MAX_REGISTRATIONS} records at the turn cap`, () => {
    const chartRegistry = registry();
    const emitter = new EventEmitter();

    const outcome = registerCodeExecutionCharts({
      records: Array.from(
        { length: TURN_CHART_MAX_REGISTRATIONS + 1 },
        (_, i) => record(spec(`Chart ${i + 1}`)),
      ),
      executionSucceeded: true,
      registry: chartRegistry,
      emitter,
    });

    expect(outcome.handles).toEqual(
      Array.from(
        { length: TURN_CHART_MAX_REGISTRATIONS },
        (_, i) => `chart_${i + 1}`,
      ),
    );
    expect(outcome.titles).toEqual(
      Array.from(
        { length: TURN_CHART_MAX_REGISTRATIONS },
        (_, i) => `Chart ${i + 1}`,
      ),
    );
    expect(outcome.errors).toEqual([
      expect.stringContaining('at most 10 charts'),
    ]);
    expect(chartRegistry.registrationCount).toBe(TURN_CHART_MAX_REGISTRATIONS);
  });

  it('does not leak a chart when a registration event sink fails', () => {
    const chartRegistry = registry();
    const emitter = new EventEmitter();
    emitter.on(STREAM_EVENT_CHANNEL, () => {
      throw new Error('event sink failed');
    });

    const outcome = registerCodeExecutionCharts({
      records: [record(spec('Sink failure'))],
      executionSucceeded: true,
      registry: chartRegistry,
      emitter,
    });

    expect(outcome.handles).toEqual([]);
    expect(outcome.errors).toEqual([
      expect.stringContaining('event sink failed'),
    ]);
    expect(chartRegistry.registrationCount).toBe(0);
  });

  it('returns transport errors without registering any corresponding chart', () => {
    const chartRegistry = registry();
    const emitter = new EventEmitter();

    const outcome = registerCodeExecutionCharts({
      records: [record(spec('Valid'))],
      recordErrors: ['private transport overflow'],
      executionSucceeded: true,
      registry: chartRegistry,
      emitter,
    });

    expect(outcome.handles).toEqual(['chart_1']);
    expect(outcome.errors).toEqual([
      expect.stringContaining('private transport overflow'),
    ]);
    expect(chartRegistry.registrationCount).toBe(1);
  });

  it('uses the documented bounded defaults for the private channel', () => {
    expect(CODE_CHART_MAX_RECORDS).toBeGreaterThan(0);
    expect(CODE_CHART_MAX_RECORD_BYTES).toBeGreaterThan(0);
  });
});
