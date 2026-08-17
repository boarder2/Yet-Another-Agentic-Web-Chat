import { describe, it, expect } from 'vitest';
import {
  ChartMentionTracker,
  findChartHandleMentions,
  stripChartHandleMentions,
} from './handleMentions';

describe('findChartHandleMentions', () => {
  it('reads handles from braced and bracketed mentions in order', () => {
    expect(
      findChartHandleMentions('See {chart_4} then [chart_2] and {{chart_11}}'),
    ).toEqual(['chart_4', 'chart_2', 'chart_11']);
  });

  it('ignores prose that merely names a handle', () => {
    expect(
      findChartHandleMentions('I registered chart_4 for the trend'),
    ).toEqual([]);
  });

  it('ignores an unclosed mention', () => {
    expect(findChartHandleMentions('almost {chart_4')).toEqual([]);
  });
});

describe('stripChartHandleMentions', () => {
  it('drops a mention that is the whole line, newline included', () => {
    expect(
      stripChartHandleMentions('Before\n\nshow_chart\n\n{chart_4}\n\nAfter'),
    ).toBe('Before\n\n\n\nAfter');
  });

  it('drops an inline mention but keeps the surrounding sentence', () => {
    expect(stripChartHandleMentions('Growth {chart_4} is steep.')).toBe(
      'Growth  is steep.',
    );
  });

  it('drops a bare handle line without touching prose that names one', () => {
    expect(stripChartHandleMentions('chart_4\nUse chart_4 later')).toBe(
      'Use chart_4 later',
    );
  });

  it('leaves text with no mentions untouched', () => {
    expect(stripChartHandleMentions('A normal { object } line')).toBe(
      'A normal { object } line',
    );
  });
});

describe('ChartMentionTracker', () => {
  it('reports a handle once, only after its chunks complete the mention', () => {
    const tracker = new ChartMentionTracker();

    expect(tracker.push('Here is {chart')).toEqual([]);
    expect(tracker.push('_4} and more')).toEqual(['chart_4']);
    expect(tracker.push(' text')).toEqual([]);
    expect(tracker.push(' also {chart_5}')).toEqual(['chart_5']);
  });

  it('reports a repeated mention each time it is written', () => {
    const tracker = new ChartMentionTracker();

    expect(tracker.push('{chart_1} and {chart_1}')).toEqual([
      'chart_1',
      'chart_1',
    ]);
  });
});
