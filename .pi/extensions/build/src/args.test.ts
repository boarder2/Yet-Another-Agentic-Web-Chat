import { describe, expect, it } from 'vitest';
import { parseStartArgs } from './args.ts';

describe('parseStartArgs', () => {
  it('keeps the automatic slug form backward-compatible', () => {
    expect(parseStartArgs('  add a retry guard  ')).toEqual({
      ask: 'add a retry guard',
      requestedSlug: null,
    });
  });

  it('accepts an explicit slug before the separator', () => {
    expect(parseStartArgs('retry-guard -- add a retry guard')).toEqual({
      ask: 'add a retry guard',
      requestedSlug: 'retry-guard',
    });
  });

  it('does not treat a prompt with no separator as a pinned slug', () => {
    expect(parseStartArgs('retry guard for the runner')).toEqual({
      ask: 'retry guard for the runner',
      requestedSlug: null,
    });
  });

  it('allows the prompt itself to contain a separator', () => {
    expect(parseStartArgs('retry-guard -- handle retries -- without hiding errors')).toEqual({
      ask: 'handle retries -- without hiding errors',
      requestedSlug: 'retry-guard',
    });
  });

  it('rejects an explicit slug with no prompt', () => {
    expect(parseStartArgs('retry-guard --')).toBeNull();
  });

  it('rejects empty input', () => {
    expect(parseStartArgs('   ')).toBeNull();
  });
});
