import { describe, it, expect } from 'vitest';
import { computeSanitizedContent } from './sanitizedContent';
import { appendWidget, type ToolCallPayload } from '@/lib/widgets/envelope';

describe('computeSanitizedContent', () => {
  it('strips widget markup and keeps prose, matching removeToolCallMarkup', () => {
    const payload: ToolCallPayload = {
      id: 'call_1',
      type: 'file_search',
      status: 'success',
    };
    const content = `Visible answer.\n\n${appendWidget('', 'tool_call', payload)}`;
    expect(computeSanitizedContent(content)).toBe('Visible answer.\n\n\n');
  });

  it('is a no-op on prose with no execution markup', () => {
    expect(computeSanitizedContent('just prose')).toBe('just prose');
  });
});
