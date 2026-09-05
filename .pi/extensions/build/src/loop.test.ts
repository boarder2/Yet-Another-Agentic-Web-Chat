import { describe, expect, it } from 'vitest';
import { approvedDocumentProblem } from './loop.ts';
import { hashContent } from './tasks.ts';

describe('approvedDocumentProblem', () => {
  const plan = 'approved plan\n';
  const tasks = 'approved tasks\n';
  const state = {
    planHash: hashContent(plan),
    taskHash: hashContent(tasks),
  };

  it('accepts the exact approved artifacts', () => {
    expect(approvedDocumentProblem(state, plan, tasks)).toBeNull();
  });

  it('names every artifact changed after approval', () => {
    expect(approvedDocumentProblem(state, `${plan}edit`, tasks)).toBe(
      'Approved plan changed or disappeared after approval.',
    );
    expect(approvedDocumentProblem(state, '', '')).toBe(
      'Approved plan and task list changed or disappeared after approval.',
    );
  });
});
