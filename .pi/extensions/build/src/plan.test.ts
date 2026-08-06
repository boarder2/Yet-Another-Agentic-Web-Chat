import { describe, it, expect } from 'vitest';
import { validatePlan } from './plan.ts';

const plan = `# Retry Guard

## Problem
Transient failures abort the run.

## Scope
In scope: the runner. Out of scope: the UI.

## Approach
Wrap the call in a bounded retry.

## Changes
- \`src/lib/runner.ts\` — add the guard

## Risks & Open Questions
Retry storms.

## Acceptance Criteria
- A transient failure retries twice, then surfaces.
`;

describe('validatePlan', () => {
  it('accepts a complete plan', () => {
    expect(validatePlan(plan)).toEqual([]);
  });

  it('reports each missing section distinctly', () => {
    const failures = validatePlan('# Title\n\n## Approach\nSomething.');

    expect(failures).toContain('Missing required section: ## Problem');
    expect(failures).toContain('Missing required section: ## Scope');
    expect(failures).toContain('Missing required section: ## Changes');
    expect(failures).toContain(
      'Missing required section: ## Acceptance Criteria',
    );
    expect(failures).not.toContain('Missing required section: ## Approach');
  });

  it('reports a present-but-empty section separately from a missing one', () => {
    const failures = validatePlan(plan.replace('Transient failures abort the run.', ''));

    expect(failures).toEqual(['Section is empty: ## Problem']);
  });

  it('requires Changes to name at least one file', () => {
    const failures = validatePlan(
      plan.replace('- `src/lib/runner.ts` — add the guard', '- tidy things up'),
    );

    expect(failures).toEqual([
      '## Changes must list at least one file, as a bullet naming a path.',
    ]);
  });

  it('accepts an unbackticked path in Changes', () => {
    const failures = validatePlan(
      plan.replace(
        '- `src/lib/runner.ts` — add the guard',
        '- src/lib/runner.ts gets the guard',
      ),
    );

    expect(failures).toEqual([]);
  });

  it('requires Acceptance Criteria to be a list, not prose', () => {
    const failures = validatePlan(
      plan.replace(
        '- A transient failure retries twice, then surfaces.',
        'It should basically work.',
      ),
    );

    expect(failures).toEqual([
      '## Acceptance Criteria must list at least one checkable bullet.',
    ]);
  });

  it('matches headings case-insensitively and ignores decoration', () => {
    const failures = validatePlan(
      plan.replace('## Acceptance Criteria', '## acceptance criteria!'),
    );

    expect(failures).toEqual([]);
  });

  it('does not let a nested heading satisfy a required section', () => {
    const failures = validatePlan(plan.replace('## Problem', '### Problem'));

    expect(failures).toContain('Missing required section: ## Problem');
  });
});
