import { describe, it, expect } from 'vitest';
import {
  completeChunk,
  hashContent,
  nextChunk,
  parseTasks,
  validateTasks,
} from './tasks.ts';

const doc = `# Retry Guard — Tasks

Plan: \`.ai/plans/2026-08-06-retry-guard.md\`

## Chunk 1 — Add the guard
- [x] Implement: wrap the call
- [x] Test: retries then gives up
- Done when: the suite is green

## Chunk 2 — Surface the failure
- [ ] Implement: emit an event
- [ ] Test: event shape
- Done when: the UI shows it
`;

describe('parseTasks', () => {
  it('finds chunks with their items and completion state', () => {
    const { chunks } = parseTasks(doc);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({
      id: 'chunk-1',
      number: 1,
      title: 'Add the guard',
      complete: true,
      overridden: false,
    });
    expect(chunks[1]).toMatchObject({ id: 'chunk-2', complete: false });
    expect(chunks[0].items.map((item) => item.text)).toEqual([
      'Implement: wrap the call',
      'Test: retries then gives up',
    ]);
  });

  it('accepts em dash, hyphen, and colon heading separators', () => {
    const { chunks } = parseTasks(
      '## Chunk 1 — a\n- [ ] x\n## Chunk 2 - b\n- [ ] x\n## Chunk 3: c\n- [ ] x',
    );
    expect(chunks.map((chunk) => chunk.title)).toEqual(['a', 'b', 'c']);
  });

  it('ignores non-chunk sections and nested headings', () => {
    const { chunks } = parseTasks(
      '## Notes\n- [ ] not a chunk item\n## Chunk 1 — real\n- [ ] item\n### Detail\n- [ ] nested item',
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0].items).toHaveLength(2);
  });

  it('treats a chunk with no items as incomplete rather than complete', () => {
    const { chunks } = parseTasks('## Chunk 1 — empty\nprose only');
    expect(chunks[0].complete).toBe(false);
  });
});

describe('nextChunk', () => {
  it('returns the first incomplete chunk in file order', () => {
    expect(nextChunk(parseTasks(doc))?.id).toBe('chunk-2');
  });

  it('returns null when every chunk is complete', () => {
    const done = completeChunk(doc, 'chunk-2');
    expect(nextChunk(parseTasks(done))).toBeNull();
  });
});

describe('validateTasks', () => {
  it('accepts a well-formed document', () => {
    expect(validateTasks(doc)).toEqual([]);
  });

  it('rejects a document with no chunks', () => {
    expect(validateTasks('# Tasks\n\nSome prose.')).toEqual([
      'No chunks found. Each chunk needs a `## Chunk <n> — <name>` heading.',
    ]);
  });

  it('rejects a chunk with no checklist items', () => {
    const failures = validateTasks('## Chunk 1 — empty\nprose only');
    expect(failures).toContain(
      'Chunk 1 has no checklist items. Add at least one `- [ ]` line.',
    );
  });

  it('rejects gapped or out-of-order numbering', () => {
    expect(validateTasks('## Chunk 1 — a\n- [ ] x\n## Chunk 3 — c\n- [ ] x')).toContain(
      'Chunks must be numbered consecutively in order; found 1, 3.',
    );
    expect(validateTasks('## Chunk 2 — a\n- [ ] x\n## Chunk 1 — b\n- [ ] x')).toContain(
      'Chunks must be numbered consecutively in order; found 2, 1.',
    );
  });

  it('allows a list that starts at chunk 0, for a spike', () => {
    expect(
      validateTasks('## Chunk 0 — spike\n- [x] probe\n## Chunk 1 — build\n- [ ] x'),
    ).toEqual([]);
  });
});

describe('completeChunk', () => {
  it('ticks only the named chunk and leaves every other line untouched', () => {
    const before = doc.split('\n');
    const after = completeChunk(doc, 'chunk-2').split('\n');

    expect(after).toHaveLength(before.length);
    expect(after.filter((line, index) => line !== before[index])).toEqual([
      '- [x] Implement: emit an event',
      '- [x] Test: event shape',
    ]);
  });

  it('records an override on the heading and normalizes the reason', () => {
    const after = completeChunk(doc, 'chunk-2', {
      override: '  flaky suite\n  unrelated to this chunk  ',
    });

    expect(after).toContain(
      '## Chunk 2 — Surface the failure (override: flaky suite unrelated to this chunk)',
    );
    expect(parseTasks(after).chunks[1]).toMatchObject({
      overridden: true,
      complete: true,
      title: 'Surface the failure',
    });
  });

  it('replaces rather than stacks a second override', () => {
    const once = completeChunk(doc, 'chunk-2', { override: 'first' });
    const twice = completeChunk(once, 'chunk-2', { override: 'second' });

    expect(twice).toContain('(override: second)');
    expect(twice).not.toContain('first');
  });

  it('throws on an unknown chunk', () => {
    expect(() => completeChunk(doc, 'chunk-9')).toThrow('Unknown chunk');
  });
});

describe('hashContent', () => {
  it('is stable for identical content and differs on any edit', () => {
    expect(hashContent(doc)).toBe(hashContent(doc));
    expect(hashContent(doc)).not.toBe(hashContent(`${doc} `));
  });
});
