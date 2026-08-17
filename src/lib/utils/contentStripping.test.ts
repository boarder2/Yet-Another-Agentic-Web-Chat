import { describe, it, expect } from 'vitest';
import {
  removeToolCallMarkup,
  stripStreamedChartTags,
} from './contentStripping';
import {
  appendWidget,
  appendChartWidget,
  findWidget,
  startPanelColumn,
  appendPanelColumnToken,
  stripPanelColumnModelTags,
  type ToolCallPayload,
  type SubagentPayload,
  type PanelPayload,
} from '@/lib/widgets/envelope';

const toolCall = (over: Partial<ToolCallPayload> = {}): ToolCallPayload => ({
  id: 'call_1',
  type: 'file_search',
  status: 'success',
  ...over,
});

describe('streamed chart tag stripping', () => {
  it('removes complete model-authored self-closing and paired tags', () => {
    expect(
      stripStreamedChartTags(
        'Before <Chart id="one"/> middle <Chart id="two">loading</Chart> after',
      ),
    ).toBe('Before  middle  after');
  });

  it('removes a chart tag only after its split chunks complete', () => {
    let content = '';
    for (const chunk of ['Before ', '<Chart id="split"', '/>', ' after']) {
      content = stripStreamedChartTags(content + chunk);
    }

    expect(content).toBe('Before  after');
    expect(content).not.toContain('<Chart');
  });

  it('does not rewrite chart-like text inside writer-owned envelopes', () => {
    const writerContent = appendChartWidget('Before\n\n', {
      id: 'placement_1',
      chartId: '<Chart id="inside-payload"/>',
    });

    expect(stripStreamedChartTags(writerContent)).toBe(writerContent);
  });

  it('strips split model tags in panel response text without removing structured placements', () => {
    let content = startPanelColumn('', 0, 'executor-a');
    for (const chunk of [
      'Before ',
      '<Chart id="panel-split"',
      '/>',
      ' after',
    ]) {
      content = appendPanelColumnToken(content, 0, chunk);
      content = stripPanelColumnModelTags(content, 0);
    }

    const withoutPlacement = findWidget<PanelPayload>(
      content,
      'panel',
      'panel',
    );
    expect(withoutPlacement?.columns[0].responseText).toBe('Before  after');

    content = appendChartWidget(content, {
      id: 'placement_1',
      chartId: 'private-chart-1',
    });
    expect(stripStreamedChartTags(content)).toContain('yaawc:chart');
  });
});

describe('removeToolCallMarkup', () => {
  it('removes a direct tool_call widget envelope and keeps surrounding prose', () => {
    const content = `Before.\n\n${appendWidget('', 'tool_call', toolCall())}After.`;
    expect(removeToolCallMarkup(content)).toBe('Before.\n\n\nAfter.');
  });

  it('removes a subagent widget with nested tool-call activity', () => {
    const nested: SubagentPayload = {
      id: 'sub_1',
      name: 'Deep Research',
      task: 'investigate',
      status: 'success',
      toolCalls: [toolCall({ type: 'web_search' })],
    };
    const content = `Intro.\n\n${appendWidget('', 'subagent', nested)}Outro.`;
    expect(removeToolCallMarkup(content)).toBe('Intro.\n\n\nOutro.');
  });

  it('removes a panel widget with streamed column tokens', () => {
    let content = startPanelColumn('Lead-in.\n\n', 0, 'gpt-4');
    content = appendPanelColumnToken(content, 0, 'secret column answer');
    content += '\nTrailing.';
    expect(removeToolCallMarkup(content)).toBe('Lead-in.\n\n\n\nTrailing.');
  });

  it('removes legacy self-closing ToolCall/SubagentExecution/PanelColumns tags', () => {
    const content =
      'Start.\n<ToolCall type="file_search" query="q"/>\n<SubagentExecution name="x"/>\n<PanelColumns/>\nEnd.';
    expect(removeToolCallMarkup(content)).toBe('Start.\n\n\n\nEnd.');
  });

  it('removes legacy paired ToolCall/SubagentExecution/PanelColumns tags, including nested content', () => {
    const content =
      'Start.\n<SubagentExecution name="x">\n<ToolCall type="file_search">secret arg</ToolCall>\n</SubagentExecution>\n<PanelColumns>secret column</PanelColumns>\nEnd.';
    expect(removeToolCallMarkup(content)).toBe('Start.\n\n\nEnd.');
  });

  it('leaves ordinary prose mentioning a tool name by name untouched', () => {
    const content =
      'Can you explain how file_search works and when web_search is used?';
    expect(removeToolCallMarkup(content)).toBe(content);
  });

  it('is a no-op on content with no markup', () => {
    expect(removeToolCallMarkup('just plain prose')).toBe('just plain prose');
  });
});
