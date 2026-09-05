import { describe, expect, it } from 'vitest';
import { phasePrompt } from './prompts.ts';
import { createState, returnToPlanning, type Phase } from './state.ts';

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
  it('loads and follows the grilling skill before questioning', () => {
    const prompt = promptFor('grill');
    expect(prompt).toContain('use `read` to load the complete `grilling` SKILL.md');
    expect(prompt).toContain('Work the full design tree in frontier rounds');
    expect(prompt).toContain('No UI means no approval');
  });

  it('makes the plan the implementation contract rather than coder design work', () => {
    const prompt = promptFor('plan');
    expect(prompt).toContain('canonical design specification');
    expect(prompt).toContain('not design key components');
    expect(prompt).toContain('exact proposed files, functions, types, fields, routes, and components');
    expect(prompt).toContain('No unresolved design question');
    expect(prompt).toContain('material scope change is a new /build');
  });

  it('requires every agreed architecture domain', () => {
    const prompt = promptFor('plan');
    for (const heading of [
      'Database Schema & Migrations',
      'Data Model & Persistence',
      'Domain / Class / Entity Model',
      'API & Wire Contracts',
      'Runtime & Service Flow',
      'Client State & Integration',
      'Compatibility, Security & Operations',
    ]) {
      expect(prompt).toContain(`\`### ${heading}\``);
    }
    expect(prompt).toContain('`Not applicable — <reason>`');
    expect(prompt).toContain('tables, columns, types');
    expect(prompt).toContain('request and response types');
  });

  it('requires concrete UI, task, verification, and approval contracts', () => {
    const prompt = promptFor('plan');
    expect(prompt).toContain('`## UI/UX Specification`');
    expect(prompt).toContain('shared primitives, tokens');
    expect(prompt).toContain('narrow/wide, both-theme');
    expect(prompt).toContain('`### Implementation Contract`');
    expect(prompt).toContain('`### Verification`');
    expect(prompt).toContain('required designSummary');
    expect(prompt).toContain('freezes the design and chunk contracts');
  });

  it('injects targeted evidence and current-tree instructions during re-planning', () => {
    const execute = {
      ...createState('add a retry guard', 'retry-guard', '2026-08-09', new Date()),
      phase: 'execute' as const,
      revision: 1,
      planPath: '.ai/plans/retry-r1.md',
      taskPath: '.ai/task/retry-r1.md',
    };
    const replanning = returnToPlanning(
      execute,
      'reviewer',
      'migration loses existing rows',
      new Date('2026-08-10T10:00:00.000Z'),
    );
    const prompt = phasePrompt(replanning);
    expect(prompt).toContain('Revision 1 was invalidated by reviewer');
    expect(prompt).toContain('migration loses existing rows');
    expect(prompt).toContain('Inspect the current repository and diff');
    expect(prompt).toContain('Every revised task starts unchecked');
  });
});
