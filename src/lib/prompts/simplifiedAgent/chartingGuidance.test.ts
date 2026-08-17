import { describe, expect, it } from 'vitest';
import { buildChatPrompt } from './chat';
import { buildChartingGuidance } from './chartingGuidance';
import { buildLocalResearchPrompt } from './localResearch';
import { buildWebSearchPrompt } from './webSearch';

const DATE = new Date('2026-08-17T00:00:00Z');

const expectLifecycleGuidance = (prompt: string) => {
  expect(prompt).toContain('create_chart');
  expect(prompt).toContain('show_chart({ handle: "chart_1" })');
  expect(prompt).toContain('labels');
  expect(prompt).toContain('aligned labels and series');
  expect(prompt).toContain('100 labels');
  expect(prompt).toContain('15 Cartesian series');
  expect(prompt).toContain('20 pie slices');
  expect(prompt).toContain('chart is turn-local');
  expect(prompt).not.toContain('__CHART__');
  expect(prompt).not.toContain('<Chart id=');
};

describe('chart lifecycle prompt guidance', () => {
  it('teaches create then show without the legacy tag or manual protocol', () => {
    const guidance = buildChartingGuidance(false);

    expectLifecycleGuidance(guidance);
    expect(guidance).toContain('A chart that is never shown stays invisible');
    expect(guidance).toContain('A chart may be shown repeatedly');
    expect(guidance).toContain('optional reference material');
    expect(guidance).not.toContain('code_execution');
  });

  it('documents the private code chart helper and failed-run semantics when enabled', () => {
    const guidance = buildChartingGuidance(true);

    expectLifecycleGuidance(guidance);
    expect(guidance).toContain('global `chart(spec)` helper');
    expect(guidance).toContain(
      'failed, timed-out, or out-of-memory executions register none',
    );
    expect(guidance).toContain('Invalid emissions are reported independently');
  });

  it('composes the same lifecycle guidance into Chat, Web Search, and Local Research prompts', () => {
    const prompts = [
      buildChatPrompt('', '', DATE, true),
      buildWebSearchPrompt('', '', [], 0, 'make a chart', DATE, '', true),
      buildLocalResearchPrompt('', '', DATE, '', true),
    ];

    for (const prompt of prompts) expectLifecycleGuidance(prompt);
    expect(prompts[0]).toContain('# AI Chat Assistant');
  });
});
