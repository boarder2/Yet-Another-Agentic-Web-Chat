import { describe, expect, it } from 'vitest';
import { getSubagentDefinition } from './definitions';
import { MAPPING_TOOL_NAMES } from '@/lib/tools/agents';
import { filterSubagentTools } from './executor';

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

  it('withholds chart and artifact tools even from an empty allowlist', () => {
    const names = filterSubagentTools([]).map((tool) => tool.name);

    expect(names).not.toContain('create_chart');
    expect(names).not.toContain('show_chart');
    expect(names).not.toContain('create_artifact');
    expect(names).toContain('web_search');
    for (const mappingTool of MAPPING_TOOL_NAMES) {
      expect(names).not.toContain(mappingTool);
    }
  });
});
