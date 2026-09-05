import { describe, expect, it } from 'vitest';
import { validatePlan } from './plan.ts';

const plan = `# Retry Guard

## Problem
Transient failures abort the run.

## Scope
In scope: the runner. Out of scope: visual changes.

## Approach
Wrap the call in a bounded retry.

## Design Decisions
Repository precedent uses the existing retry helper; no material alternative remains.

## Changes
- \`src/lib/runner.ts\` — add the guard
- \`src/lib/runner.test.ts\` — cover retries

## Code Structure

### Database Schema & Migrations
Not applicable — no database state changes.

### Data Model & Persistence
Not applicable — no persisted or serialized model changes.

### Domain / Class / Entity Model
Not applicable — no domain entity changes.

### API & Wire Contracts
Not applicable — no wire contract changes.

### Runtime & Service Flow
\`runRequest()\` calls the existing retry helper twice before surfacing its error.

### Client State & Integration
Not applicable — no client state changes.

### Compatibility, Security & Operations
The existing error remains authoritative and no compatibility path is needed.

## UI/UX Specification
Not applicable — no user-visible change.

## Risks & Failure Modes
Bounded retries avoid retry storms; the final error is preserved.

## Verification Plan
- Extend \`src/lib/runner.test.ts\` for success and exhaustion.

## Acceptance Criteria
- A transient failure retries twice, then surfaces.
`;

describe('validatePlan', () => {
  it('accepts a complete implementation-ready plan', () => {
    expect(validatePlan(plan)).toEqual([]);
  });

  it('reports each missing top-level section distinctly', () => {
    const failures = validatePlan('# Title\n\n## Approach\nSomething.');
    expect(failures).toContain('Missing required section: ## Problem');
    expect(failures).toContain('Missing required section: ## Design Decisions');
    expect(failures).toContain('Missing required section: ## Code Structure');
    expect(failures).not.toContain('Missing required section: ## Approach');
  });

  it('reports a present-but-empty section separately', () => {
    expect(
      validatePlan(plan.replace('Transient failures abort the run.', '')),
    ).toContain('Section is empty: ## Problem');
  });

  it('requires Changes to name at least one file', () => {
    expect(
      validatePlan(
        plan
          .replace('- `src/lib/runner.ts` — add the guard\n', '')
          .replace('- `src/lib/runner.test.ts` — cover retries', '- tidy things up'),
      ),
    ).toContain('## Changes must list at least one file, as a bullet naming a path.');
  });

  it('requires every code-structure domain subsection', () => {
    const failures = validatePlan(
      plan.replace('### API & Wire Contracts', '### API Design'),
    );
    expect(failures).toContain('Missing required subsection: ### API & Wire Contracts');
  });

  it('requires a reason after Not applicable', () => {
    const failures = validatePlan(
      plan.replace(
        'Not applicable — no database state changes.',
        'Not applicable',
      ),
    );
    expect(failures).toContain(
      '### Database Schema & Migrations must use `Not applicable — <reason>` when it does not apply.',
    );
  });

  it('requires checkable verification and acceptance bullets', () => {
    expect(
      validatePlan(
        plan.replace(
          '- Extend `src/lib/runner.test.ts` for success and exhaustion.',
          'Run some tests.',
        ),
      ),
    ).toContain('## Verification Plan must list at least one checkable bullet.');
    expect(
      validatePlan(
        plan.replace(
          '- A transient failure retries twice, then surfaces.',
          'It should work.',
        ),
      ),
    ).toContain('## Acceptance Criteria must list at least one checkable bullet.');
  });

  it('matches headings case-insensitively and ignores decoration', () => {
    expect(
      validatePlan(plan.replace('## Acceptance Criteria', '## acceptance criteria!')),
    ).toEqual([]);
  });

  it('does not let a nested heading satisfy a required section', () => {
    expect(validatePlan(plan.replace('## Problem', '### Problem'))).toContain(
      'Missing required section: ## Problem',
    );
  });
});
