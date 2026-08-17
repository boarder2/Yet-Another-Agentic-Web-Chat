import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/config', () => ({
  getCodeExecutionConfig: vi.fn(() => ({ enabled: true })),
}));

import { buildChartCreationSkill } from './chart-creation';

describe('chart-creation system skill', () => {
  it('is optional reference for the simplified create/show lifecycle', () => {
    const skill = buildChartCreationSkill();

    expect(skill.description).toContain('turn-local');
    expect(skill.content).toContain('create_chart');
    expect(skill.content).toContain('show_chart');
    expect(skill.content).toContain('labels');
    expect(skill.content).toContain('slices');
    expect(skill.content).toContain('chart(spec)');
    expect(skill.content).toContain('optional');
    expect(skill.content).not.toContain('__CHART__');
    expect(skill.content).not.toContain('<Chart id=');
  });
});
