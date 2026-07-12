import { describe, it, expect } from 'vitest';
import { compiler } from 'markdown-to-jsx';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  appendWidget,
  updateWidget,
  findWidget,
  parseWidgetFence,
  stripWidgets,
  maskWidgets,
  unmaskWidgets,
  neutralizeSpoofedFences,
  balanceDanglingFence,
  upsertNestedToolCall,
  patchNestedToolCall,
  startPanelColumn,
  appendPanelColumnToken,
  setPanelColumnStatus,
  PANEL_WIDGET_ID,
  type ToolCallPayload,
  type SubagentPayload,
  type PanelPayload,
} from './envelope';

const toolCall = (over: Partial<ToolCallPayload> = {}): ToolCallPayload => ({
  id: 'call_1',
  type: 'web_search',
  status: 'running',
  ...over,
});

describe('appendWidget / findWidget', () => {
  it('appends a widget envelope and it can be found by id', () => {
    const content = appendWidget('Hello\n\n', 'tool_call', toolCall());
    expect(content).toContain('```yaawc:tool_call');
    expect(findWidget<ToolCallPayload>(content, 'tool_call', 'call_1')).toEqual(
      toolCall(),
    );
  });

  it('is idempotent on id — appending twice does not duplicate', () => {
    let content = appendWidget('', 'tool_call', toolCall());
    content = appendWidget(
      content,
      'tool_call',
      toolCall({ status: 'success' }),
    );
    expect(content.match(/```yaawc:tool_call/g)).toHaveLength(1);
    // Idempotent append does not overwrite — first write wins.
    expect(
      findWidget<ToolCallPayload>(content, 'tool_call', 'call_1')?.status,
    ).toBe('running');
  });

  it('returns undefined for a widget that does not exist', () => {
    expect(findWidget('no widgets here', 'tool_call', 'x')).toBeUndefined();
  });

  it('round-trips a payload containing a literal ``` sequence and newlines', () => {
    const payload = toolCall({
      stdout: 'line1\nline2\n```not a real fence```',
    });
    const content = appendWidget('', 'tool_call', payload);
    // The payload is JSON-escaped onto a single physical line.
    const fenceBody = content.split('\n')[1];
    expect(fenceBody.includes('\n')).toBe(false);
    expect(findWidget<ToolCallPayload>(content, 'tool_call', 'call_1')).toEqual(
      payload,
    );
  });

  it('does not clobber prose that happens to contain a widget-shaped substring', () => {
    const content = appendWidget(
      'prose mentioning yaawc:tool_call as plain text\n\n',
      'tool_call',
      toolCall(),
    );
    expect(findWidget<ToolCallPayload>(content, 'tool_call', 'call_1')).toEqual(
      toolCall(),
    );
  });
});

describe('updateWidget', () => {
  it('patches an existing widget by id (partial merge)', () => {
    let content = appendWidget('', 'tool_call', toolCall());
    content = updateWidget<ToolCallPayload>(content, 'tool_call', 'call_1', {
      status: 'success',
    });
    expect(findWidget<ToolCallPayload>(content, 'tool_call', 'call_1')).toEqual(
      toolCall({ status: 'success' }),
    );
  });

  it('patches via an updater function', () => {
    const seed: SubagentPayload = {
      id: 'sub_1',
      name: 'Deep Research',
      task: 'investigate',
      status: 'running',
      toolCalls: [],
    };
    let content = appendWidget('', 'subagent', seed);
    content = updateWidget<SubagentPayload>(
      content,
      'subagent',
      'sub_1',
      (current) => ({
        ...current,
        toolCalls: [...current.toolCalls, toolCall()],
      }),
    );
    const updated = findWidget<SubagentPayload>(content, 'subagent', 'sub_1');
    expect(updated?.toolCalls).toEqual([toolCall()]);
  });

  it('returns content unchanged when the id is not found', () => {
    const content = appendWidget('', 'tool_call', toolCall());
    const result = updateWidget<ToolCallPayload>(
      content,
      'tool_call',
      'missing',
      { status: 'success' },
    );
    expect(result).toBe(content);
  });

  it('only patches the matching kind + id among multiple widgets', () => {
    let content = appendWidget('', 'tool_call', toolCall({ id: 'a' }));
    content = appendWidget(content, 'tool_call', toolCall({ id: 'b' }));
    content = updateWidget<ToolCallPayload>(content, 'tool_call', 'a', {
      status: 'error',
      error: 'boom',
    });
    expect(findWidget<ToolCallPayload>(content, 'tool_call', 'a')?.status).toBe(
      'error',
    );
    expect(findWidget<ToolCallPayload>(content, 'tool_call', 'b')?.status).toBe(
      'running',
    );
  });
});

describe('balanceDanglingFence', () => {
  it('leaves balanced content unchanged', () => {
    const content = 'text\n```js\ncode\n```\nmore';
    expect(balanceDanglingFence(content)).toBe(content);
  });

  it('appends a closing fence for a dangling (odd-count) fence', () => {
    const content = 'text\n```js\nunterminated code';
    const balanced = balanceDanglingFence(content);
    expect((balanced.match(/```/g) ?? []).length % 2).toBe(0);
    expect(balanced.endsWith('```\n')).toBe(true);
  });

  it('appendWidget balances a dangling fence before appending', () => {
    const content = appendWidget(
      '```js\nunterminated',
      'tool_call',
      toolCall(),
    );
    const fenceCount = (content.match(/```/g) ?? []).length;
    // 2 for the balancing close + 2 for the widget fence = 4, all paired.
    expect(fenceCount % 2).toBe(0);
    expect(findWidget<ToolCallPayload>(content, 'tool_call', 'call_1')).toEqual(
      toolCall(),
    );
  });
});

describe('parseWidgetFence', () => {
  it('parses a known kind with a valid payload', () => {
    const parsed = parseWidgetFence(
      'yaawc:tool_call',
      JSON.stringify(toolCall()),
    );
    expect(parsed).toEqual({ kind: 'tool_call', payload: toolCall() });
  });

  it('returns null for an unknown yaawc: suffix', () => {
    expect(parseWidgetFence('yaawc:mystery', '{"id":"x"}')).toBeNull();
  });

  it('returns null for a non-yaawc info string', () => {
    expect(parseWidgetFence('javascript', 'const x = 1;')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseWidgetFence('yaawc:tool_call', '{not json')).toBeNull();
  });

  it('returns null when the payload has no string id', () => {
    expect(
      parseWidgetFence('yaawc:tool_call', '{"type":"web_search"}'),
    ).toBeNull();
  });
});

describe('nested tool-call helpers', () => {
  it('upsertNestedToolCall adds an entry once and is idempotent by id', () => {
    let calls = upsertNestedToolCall([], toolCall());
    calls = upsertNestedToolCall(calls, toolCall({ status: 'success' }));
    expect(calls).toHaveLength(1);
    expect(calls[0].status).toBe('running');
  });

  it('patchNestedToolCall patches only the matching entry', () => {
    const calls = [toolCall({ id: 'a' }), toolCall({ id: 'b' })];
    const patched = patchNestedToolCall(calls, 'a', {
      status: 'error',
      error: 'boom',
    });
    expect(patched.find((t) => t.id === 'a')).toEqual(
      toolCall({ id: 'a', status: 'error', error: 'boom' }),
    );
    expect(patched.find((t) => t.id === 'b')).toEqual(toolCall({ id: 'b' }));
  });
});

describe('panel column helpers', () => {
  it('startPanelColumn creates the panel envelope and is idempotent on idx', () => {
    let content = startPanelColumn('', 0, 'gpt-4');
    content = startPanelColumn(content, 0, 'ignored-on-replay');
    const panel = findWidget<PanelPayload>(content, 'panel', PANEL_WIDGET_ID);
    expect(panel?.columns).toEqual([
      { idx: 0, model: 'gpt-4', status: 'running', responseText: '' },
    ]);
  });

  it('appendPanelColumnToken accumulates streamed text for the right column', () => {
    let content = startPanelColumn('', 0, 'a');
    content = startPanelColumn(content, 1, 'b');
    content = appendPanelColumnToken(content, 1, 'hello ');
    content = appendPanelColumnToken(content, 1, 'world');
    const panel = findWidget<PanelPayload>(content, 'panel', PANEL_WIDGET_ID);
    expect(panel?.columns.find((c) => c.idx === 1)?.responseText).toBe(
      'hello world',
    );
    expect(panel?.columns.find((c) => c.idx === 0)?.responseText).toBe('');
  });

  it('setPanelColumnStatus creates the column if completion races the start event', () => {
    const content = setPanelColumnStatus('', 0, 'success', {
      sourceCount: 3,
      tokens: 120,
      model: 'gpt-4',
    });
    const panel = findWidget<PanelPayload>(content, 'panel', PANEL_WIDGET_ID);
    expect(panel?.columns).toEqual([
      {
        idx: 0,
        model: 'gpt-4',
        status: 'success',
        responseText: '',
        sourceCount: 3,
        tokens: 120,
      },
    ]);
  });

  it('setPanelColumnStatus patches an existing column without dropping responseText', () => {
    let content = startPanelColumn('', 0, 'gpt-4');
    content = appendPanelColumnToken(content, 0, 'answer');
    content = setPanelColumnStatus(content, 0, 'error', { error: 'failed' });
    const panel = findWidget<PanelPayload>(content, 'panel', PANEL_WIDGET_ID);
    expect(panel?.columns[0]).toEqual({
      idx: 0,
      model: 'gpt-4',
      status: 'error',
      responseText: 'answer',
      error: 'failed',
    });
  });
});

describe('stripWidgets', () => {
  it('removes widget fences but leaves surrounding prose', () => {
    const content = `Before\n\n${appendWidget('', 'tool_call', toolCall())}After`;
    const stripped = stripWidgets(content);
    expect(stripped).not.toContain('yaawc:tool_call');
    expect(stripped).toContain('Before');
    expect(stripped).toContain('After');
  });

  it('is a no-op on content with no widgets', () => {
    expect(stripWidgets('just prose')).toBe('just prose');
  });
});

describe('maskWidgets / unmaskWidgets', () => {
  it('round-trips content containing widgets', () => {
    const content = `Before\n\n${appendWidget('', 'tool_call', toolCall())}After`;
    const { text, fences } = maskWidgets(content);
    expect(text).not.toContain('yaawc:tool_call');
    expect(fences).toHaveLength(1);
    expect(unmaskWidgets(text, fences)).toBe(content);
  });

  it('hides payload text from preprocessing that rewrites markup', () => {
    // A panel executor that emits a chart puts `<Chart id="…"/>` in its answer,
    // which lands verbatim in the panel payload's one JSON line. Preprocessing
    // that block-spaces chart tags would split that line and destroy the fence.
    const spaceCharts = (s: string) =>
      s.replace(/(<Chart\b[^>]*\/>)/g, '\n\n$1\n\n');
    const withChart = appendPanelColumnToken(
      startPanelColumn('', 0, 'gpt-5'),
      0,
      'Scores:\n\n<Chart id="c1"/>\n\nAs shown.',
    );

    expect(spaceCharts(withChart)).not.toBe(withChart); // naive pass corrupts it

    const { text, fences } = maskWidgets(withChart);
    const processed = unmaskWidgets(spaceCharts(text), fences);
    expect(processed).toBe(withChart);
    const panel = findWidget<PanelPayload>(processed, 'panel', PANEL_WIDGET_ID);
    expect(panel?.columns[0].responseText).toContain('<Chart id="c1"/>');
  });

  it('leaves widget-free content untouched', () => {
    const { text, fences } = maskWidgets('just prose');
    expect(text).toBe('just prose');
    expect(unmaskWidgets(text, fences)).toBe('just prose');
  });
});

describe('neutralizeSpoofedFences', () => {
  it('downgrades a spoofed yaawc: fence to a bare fence', () => {
    const spoofed =
      '```yaawc:tool_call\n{"id":"x","type":"y","status":"success"}\n```';
    const neutralized = neutralizeSpoofedFences(spoofed);
    expect(neutralized).not.toContain('yaawc:');
    expect(neutralized.startsWith('```\n')).toBe(true);
  });

  it('leaves ordinary fences untouched', () => {
    const normal = '```js\nconst x = 1;\n```';
    expect(neutralizeSpoofedFences(normal)).toBe(normal);
  });
});

describe('markdown-to-jsx parse-shape (regression net for nested-widget spillage)', () => {
  const capturedCodeProps: Array<{ className?: string; children: string }> = [];

  const compile = (markdown: string) => {
    capturedCodeProps.length = 0;
    const tree = compiler(markdown, {
      overrides: {
        code: {
          component: (props: { className?: string; children: string }) => {
            capturedCodeProps.push(props);
            return null;
          },
        },
      },
    });
    renderToStaticMarkup(tree);
    return tree;
  };

  it('keeps a widget fence atomic next to surrounding prose', () => {
    const content = `Before text.\n\n${appendWidget('', 'tool_call', toolCall())}After text.`;
    compile(content);
    expect(capturedCodeProps).toHaveLength(1);
    expect(capturedCodeProps[0].className).toContain('yaawc:tool_call');
    expect(() => JSON.parse(capturedCodeProps[0].children)).not.toThrow();
  });

  it('keeps nested tool-call data (as a JSON array field) atomic inside a subagent widget', () => {
    const nested: SubagentPayload = {
      id: 'sub_1',
      name: 'Deep Research',
      task: 'investigate',
      status: 'error',
      toolCalls: [toolCall({ status: 'error', error: 'boom\n\nmulti-line' })],
      error: 'boom',
    };
    const content = appendWidget('', 'subagent', nested);
    compile(content);
    expect(capturedCodeProps).toHaveLength(1);
    const parsed = JSON.parse(capturedCodeProps[0].children) as SubagentPayload;
    expect(parsed.toolCalls).toHaveLength(1);
    expect(parsed.toolCalls[0].error).toContain('multi-line');
  });

  it('does not spill into a sibling top-level block (the original bug class)', () => {
    const content = `${appendWidget('', 'subagent', {
      id: 'sub_1',
      name: 'Deep Research',
      task: 't',
      status: 'running',
      toolCalls: [toolCall()],
    } as SubagentPayload)}Trailing prose.`;
    const tree = compile(content) as {
      props: { children: unknown[] };
    };
    // Exactly one fenced code block (the subagent envelope) plus prose — no
    // orphaned duplicate/second top-level widget node.
    expect(capturedCodeProps).toHaveLength(1);
    const topLevelPreCount = tree.props.children.filter(
      (c) => (c as { type?: string }).type === 'pre',
    ).length;
    expect(topLevelPreCount).toBe(1);
  });
});
