import { describe, expect, it } from 'vitest';
import { getSubagentDefinition } from './definitions';

const deepResearchTools = [
  'web_search',
  'url_fetch',
  'image_search',
  'image_analysis',
  'pdf_loader',
];

describe('deep-research subagent tool restrictions', () => {
  it('keeps capability lookup out of the unchanged research whitelist', () => {
    const definition = getSubagentDefinition('deep_research');
    expect(definition).toBeTruthy();
    expect(definition!.allowedTools).toEqual(deepResearchTools);
    expect(definition!.allowedTools).not.toContain('search_yaawc_docs');
    expect(definition!.allowedTools).not.toContain('deep_research');
  });
});
