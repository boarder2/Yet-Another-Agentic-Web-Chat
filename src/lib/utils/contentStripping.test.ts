import { describe, it, expect } from 'vitest';
import { removeToolCallMarkup } from './contentStripping';
import {
  appendWidget,
  startPanelColumn,
  appendPanelColumnToken,
  type ToolCallPayload,
  type SubagentPayload,
} from '@/lib/widgets/envelope';

const toolCall = (over: Partial<ToolCallPayload> = {}): ToolCallPayload => ({
  id: 'call_1',
  type: 'file_search',
  status: 'success',
  ...over,
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
