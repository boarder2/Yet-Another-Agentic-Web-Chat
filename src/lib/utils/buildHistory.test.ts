import { describe, it, expect } from 'vitest';
import { buildHistoryFromDb } from './buildHistory';
import { appendWidget } from '@/lib/widgets/envelope';
import type { messages } from '@/lib/db/schema';

type Row = typeof messages.$inferSelect;

let nextId = 1;
const row = (
  role: Row['role'],
  content: string,
  metadata: Record<string, unknown> = {},
): Row => ({
  id: nextId++,
  chatId: 'c1',
  messageId: `m${nextId}`,
  role,
  content,
  sanitizedContent: null,
  metadata: JSON.stringify(metadata),
});

const shape = (rows: Row[]) =>
  buildHistoryFromDb(rows).map((m) => [m.getType(), m.content]);

describe('buildHistoryFromDb steers', () => {
  const tool = appendWidget('', 'tool_call', {
    id: 't1',
    type: 'web_search',
    status: 'success',
  });

  it('replays a steer as a user turn where the agent received it', () => {
    const content =
      appendWidget('Searching.' + tool, 'steer', {
        id: 's1',
        content: 'only 2024',
      }) + 'Here is 2024.';
    const history = shape([
      row('user', 'Find news'),
      row('assistant', content),
    ]);
    expect(history.map(([type]) => type)).toEqual([
      'human',
      'ai',
      'human',
      'ai',
    ]);
    expect(history[2]).toEqual(['human', 'only 2024']);
  });

  it('merges a steer into the query when the segment before it was only widgets', () => {
    const content =
      appendWidget(tool, 'steer', { id: 's1', content: 'only 2024' }) +
      'Here is 2024.';
    expect(
      shape([row('user', 'Find news'), row('assistant', content)]),
    ).toEqual([
      ['human', 'Find news\nonly 2024'],
      ['ai', '\n\nHere is 2024.'],
    ]);
  });

  it('leaves an assistant turn without steers intact', () => {
    expect(shape([row('user', 'Hi'), row('assistant', 'Hello')])).toEqual([
      ['human', 'Hi'],
      ['ai', 'Hello'],
    ]);
  });
});
