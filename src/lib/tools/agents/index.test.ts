import { describe, expect, it } from 'vitest';
import {
  allAgentTools,
  coreTools,
  fileSearchTools,
  getAllAgentTools,
  getCoreTools,
  getLocalResearchTools,
  getWebSearchTools,
  webSearchTools,
} from './index';
import { yaawcDocsTool } from './yaawcDocsTool';
import { allTools } from '@/lib/tools';

const names = (tools: readonly { name: string }[]) =>
  tools.map((tool) => tool.name);

describe('YAAWC capability tool registration', () => {
  it('keeps the capability lookup out of static subagent arrays and the user picker', () => {
    for (const tools of [
      allAgentTools,
      webSearchTools,
      fileSearchTools,
      coreTools,
      allTools,
    ]) {
      expect(names(tools)).not.toContain(yaawcDocsTool.name);
    }
  });

  it('adds exactly one invariant capability lookup to every top-level getter', () => {
    for (const tools of [
      getAllAgentTools(),
      getWebSearchTools(),
      getCoreTools(),
      getLocalResearchTools(),
    ]) {
      expect(
        names(tools).filter((name) => name === yaawcDocsTool.name),
      ).toEqual([yaawcDocsTool.name]);
    }
  });
});
