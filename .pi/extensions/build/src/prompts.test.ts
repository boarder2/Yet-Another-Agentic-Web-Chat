import { describe, expect, it } from 'vitest';
import { phasePrompt } from './prompts.ts';
import { createState, type Phase } from './state.ts';

function promptFor(phase: Phase): string {
  return phasePrompt({
    ...createState(
      'add a retry guard',
      'retry-guard',
      '2026-08-09',
      new Date('2026-08-09T12:00:00.000Z'),
    ),
    phase,
  }).replace(/\s+/g, ' ');
}

describe('phasePrompt', () => {
  it('hands settled grilling decisions into planning and task creation', () => {
    const prompt = promptFor('grill');

    expect(prompt).toContain(
      'switch immediately to planning and task creation',
    );
    expect(prompt).toContain(
      'Treat the whole grilling discussion as binding design input',
    );
    expect(prompt).toContain('materially rejected alternatives');
    expect(prompt).toContain('Do not silently drop, weaken, or reverse a decision');
  });

  it('requires detailed artifacts that preserve the shared understanding', () => {
    const prompt = promptFor('plan');

    expect(prompt).toContain(
      'Write a very detailed plan and an equally detailed task list',
    );
    expect(prompt).toContain('preserve the full shared understanding');
    expect(prompt).toContain('actual files, functions, and types');
    expect(prompt).toContain(
      'every settled decision must map to a task where work or proof is required',
    );
    expect(prompt).toContain(
      'ask the user instead of inferring an answer',
    );
  });
});
