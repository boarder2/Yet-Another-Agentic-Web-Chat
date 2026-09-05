import { describe, expect, it } from 'vitest';
import {
  completeChunk,
  hashContent,
  nextChunk,
  parseTasks,
  validateTasks,
} from './tasks.ts';

const submitted = `# Retry Guard — Tasks

## Chunk 1 — Add the guard
### Implementation Contract
- [ ] \`src/lib/runner.ts\` — wrap the call
### Verification
- [ ] \`src/lib/runner.test.ts\` — retries then gives up

## Chunk 2 — Surface the failure
### Implementation Contract
- [ ] \`src/lib/events.ts\` — emit the existing error shape
### Verification
- [ ] \`src/lib/events.test.ts\` — assert the event shape
`;

const doc = completeChunk(submitted, 'chunk-1');

describe('parseTasks', () => {
  it('finds chunks, contracts, and completion state', () => {
    const { chunks } = parseTasks(doc);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({
      id: 'chunk-1',
      number: 1,
      title: 'Add the guard',
      complete: true,
      overridden: false,
    });
    expect(chunks[0].implementationContract.join('\n')).toContain('runner.ts');
    expect(chunks[0].verification.join('\n')).toContain('runner.test.ts');
    expect(chunks[1]).toMatchObject({ id: 'chunk-2', complete: false });
  });

  it('accepts em dash, hyphen, and colon separators', () => {
    const { chunks } = parseTasks(
      '## Chunk 1 — a\n- [ ] x\n## Chunk 2 - b\n- [ ] x\n## Chunk 3: c\n- [ ] x',
    );
    expect(chunks.map((chunk) => chunk.title)).toEqual(['a', 'b', 'c']);
  });

  it('treats a chunk with no items as incomplete', () => {
    expect(parseTasks('## Chunk 1 — empty\nprose only').chunks[0].complete).toBe(false);
  });
});

describe('nextChunk', () => {
  it('returns the first incomplete chunk', () => {
    expect(nextChunk(parseTasks(doc))?.id).toBe('chunk-2');
  });

  it('returns null when every chunk is complete', () => {
    expect(nextChunk(parseTasks(completeChunk(doc, 'chunk-2')))).toBeNull();
  });
});

describe('validateTasks', () => {
  it('accepts unchecked chunks with implementation and verification contracts', () => {
    expect(validateTasks(submitted)).toEqual([]);
  });

  it('rejects a document with no chunks', () => {
    expect(validateTasks('# Tasks\n\nSome prose.')).toEqual([
      'No chunks found. Each chunk needs a `## Chunk <n> — <name>` heading.',
    ]);
  });

  it('rejects empty, pre-checked, or vague chunk contracts', () => {
    expect(validateTasks('## Chunk 1 — empty\nprose only')).toEqual(expect.arrayContaining([
      'Chunk 1 has no checklist items. Add at least one `- [ ]` line.',
      'Chunk 1 needs a non-empty `### Implementation Contract` subsection.',
      'Chunk 1 needs a non-empty `### Verification` subsection.',
    ]));
    expect(validateTasks(submitted.replace('- [ ] `src/lib/runner.ts`', '- [x] `src/lib/runner.ts`')))
      .toContain('Chunk 1 contains pre-checked work. Every submitted item must start as `- [ ]`.');
    expect(validateTasks(submitted.replace('`src/lib/runner.ts` — wrap the call', 'change the runner')))
      .toContain('Chunk 1 implementation contract must name at least one file path.');
  });

  it('rejects nameless chunks and pre-approved override markers', () => {
    expect(validateTasks(submitted.replace('## Chunk 1 — Add the guard', '## Chunk 1 —')))
      .toContain('Chunk 1 needs a non-empty title after its separator.');
    expect(validateTasks(submitted.replace('## Chunk 1 — Add the guard', '## Chunk 1 — Add the guard (override: skip)')))
      .toContain('Chunk 1 contains an override marker. Overrides are recorded only by the harness.');
  });

  it('requires a checkable verification item', () => {
    expect(
      validateTasks(
        submitted.replace('- [ ] `src/lib/runner.test.ts` — retries then gives up', 'Run tests.'),
      ),
    ).toContain('Chunk 1 verification must contain at least one `- [ ]` check.');
  });

  it('rejects gapped or out-of-order numbering', () => {
    const gapped = submitted.replace('## Chunk 2', '## Chunk 3');
    expect(validateTasks(gapped)).toContain(
      'Chunks must be numbered consecutively in order; found 1, 3.',
    );
  });

  it('allows a list that starts at chunk 0', () => {
    expect(validateTasks(submitted.replace('Chunk 1', 'Chunk 0').replace('Chunk 2', 'Chunk 1'))).toEqual([]);
  });
});

describe('completeChunk', () => {
  it('ticks only the named chunk', () => {
    const after = completeChunk(submitted, 'chunk-2');
    expect(parseTasks(after).chunks[0].complete).toBe(false);
    expect(parseTasks(after).chunks[1].complete).toBe(true);
  });

  it('records and replaces a normalized override', () => {
    const once = completeChunk(submitted, 'chunk-2', {
      override: '  flaky suite\n unrelated  ',
    });
    const twice = completeChunk(once, 'chunk-2', { override: 'second' });
    expect(twice).toContain('(override: second)');
    expect(twice).not.toContain('flaky suite');
  });

  it('throws on an unknown chunk', () => {
    expect(() => completeChunk(doc, 'chunk-9')).toThrow('Unknown chunk');
  });
});

describe('hashContent', () => {
  it('is stable and detects any edit', () => {
    expect(hashContent(doc)).toBe(hashContent(doc));
    expect(hashContent(doc)).not.toBe(hashContent(`${doc} `));
  });
});
