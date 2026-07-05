import { describe, it, expect } from 'vitest';
import { formatMemoriesList, type MemoryListItem } from './memoryFormatting';

function makeMemory(overrides: Partial<MemoryListItem> = {}): MemoryListItem {
  return {
    id: 'mem-1',
    content: 'Likes dark mode',
    category: 'Preference',
    accessCount: 0,
    lastAccessedAt: null,
    ...overrides,
  };
}

describe('formatMemoriesList', () => {
  it('reports no memories when the list is empty', () => {
    expect(formatMemoriesList([])).toBe('No memories stored yet.');
  });

  it('marks an unused memory as never used', () => {
    const result = formatMemoriesList([makeMemory()]);
    expect(result).toContain('[id: mem-1] Likes dark mode, never used');
  });

  it('includes access count and relative last-used time for used memories', () => {
    const now = new Date('2026-01-10T00:00:00Z');
    const lastAccessedAt = new Date('2026-01-08T00:00:00Z');
    const result = formatMemoriesList(
      [makeMemory({ accessCount: 3, lastAccessedAt })],
      now,
    );
    expect(result).toContain(
      '[id: mem-1] Likes dark mode, used 3x, last used 2 days ago',
    );
  });

  it('treats a memory with an access count but no timestamp as never used', () => {
    const result = formatMemoriesList([
      makeMemory({ accessCount: 2, lastAccessedAt: null }),
    ]);
    expect(result).toContain('[id: mem-1] Likes dark mode, never used');
  });

  it('groups memories by category and falls back to Uncategorized', () => {
    const result = formatMemoriesList([
      makeMemory({ id: 'a', category: 'Preference', content: 'A' }),
      makeMemory({ id: 'b', category: null, content: 'B' }),
    ]);
    expect(result).toContain('**Preference**:');
    expect(result).toContain('**Uncategorized**:');
    expect(result.indexOf('[id: a]')).toBeLessThan(result.indexOf('[id: b]'));
  });

  it('reports the total memory count', () => {
    const result = formatMemoriesList([
      makeMemory({ id: 'a' }),
      makeMemory({ id: 'b' }),
    ]);
    expect(result).toContain('You have 2 stored memories:');
  });
});
