import { describe, expect, it } from 'vitest';
import { getMappingTools } from '@/lib/tools/agents';
import {
  filterExecutorTools,
  PANEL_EXECUTOR_EXCLUDED_TOOLS,
} from './restrictedToolset';

describe('panel executor mapping restrictions', () => {
  it('keeps every mapping tool out of the isolated executor toolset', () => {
    const mappingTools = getMappingTools();
    const filtered = filterExecutorTools([
      ...mappingTools,
      { name: 'web_search' },
    ]);

    expect(PANEL_EXECUTOR_EXCLUDED_TOOLS).toEqual(
      expect.arrayContaining(mappingTools.map((tool) => tool.name)),
    );
    expect(filtered.map((tool) => tool.name)).toEqual(['web_search']);
  });
});
