import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { afterEach, describe, expect, it } from 'vitest';
import { registerGates, type Controller } from './gates.ts';
import {
  advance,
  buildPaths,
  createState,
  returnToPlanning,
  type BuildState,
} from './state.ts';
import { hashContent } from './tasks.ts';

const NOW = new Date('2026-08-09T12:00:00.000Z');
const roots: string[] = [];

const plan = `# Build
## Problem
The runner fails.
## Scope
Runner only.
## Approach
Use the existing helper.
## Design Decisions
Repository precedent is authoritative; no material alternative.
## Changes
- \`src/runner.ts\` — update run
## Code Structure
### Database Schema & Migrations
Not applicable — no database changes.
### Data Model & Persistence
Not applicable — no persistence changes.
### Domain / Class / Entity Model
Not applicable — no entity changes.
### API & Wire Contracts
Not applicable — no API changes.
### Runtime & Service Flow
\`run()\` calls the existing helper and preserves errors.
### Client State & Integration
Not applicable — no client changes.
### Compatibility, Security & Operations
No compatibility path or new trust boundary.
## UI/UX Specification
Not applicable — no user-visible change.
## Risks & Failure Modes
The bounded helper prevents retry storms.
## Verification Plan
- Run \`npm test\`.
## Acceptance Criteria
- The runner retries once.
`;

const tasks = `## Chunk 1 — runner
### Implementation Contract
- [ ] \`src/runner.ts\` — update \`run()\`
### Verification
- [ ] \`src/runner.test.ts\` — verify retry and final error
`;

interface Tool {
  execute: (
    id: string,
    params: never,
    signal: undefined,
    onUpdate: undefined,
    ctx: ExtensionContext,
  ) => Promise<unknown>;
}

function setup(initial: BuildState) {
  let state = initial;
  const tools = new Map<string, Tool>();
  const pi = {
    registerTool(tool: Tool & { name: string }) {
      tools.set(tool.name, tool);
    },
  } as unknown as ExtensionAPI;
  const controller: Controller = {
    current: () => state,
    update: (next) => { state = next; },
    detach: () => {},
  };
  registerGates(pi, controller);
  return {
    get state() { return state; },
    run(name: string, params: unknown, ctx: ExtensionContext) {
      return tools.get(name)!.execute('id', params as never, undefined, undefined, ctx);
    },
  };
}

function context(cwd: string, interactive: boolean, approvalText: string[] = []) {
  return {
    cwd,
    hasUI: interactive,
    ui: {
      confirm: async (_title: string, text: string) => {
        approvalText.push(text);
        return true;
      },
      select: async () => 'Simple — go straight to planning',
    },
  } as unknown as ExtensionContext;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('workflow_write_plan', () => {
  it('promotes validated candidates into an immutable approved revision', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'build-gate-'));
    roots.push(cwd);
    const workflow = setup(advance(createState('build it', 'build-it', '2026-08-09', NOW), 'plan', NOW));
    const approvalText: string[] = [];

    await workflow.run('workflow_write_plan', {
      plan,
      tasks,
      designSummary: '- Runtime: reuse retry helper\n- UI: none\n- Chunk: runner',
    }, context(cwd, true, approvalText));

    expect(workflow.state).toMatchObject({ phase: 'execute', revision: 1 });
    expect(workflow.state.revisions).toHaveLength(1);
    expect(readFileSync(join(cwd, workflow.state.planPath!), 'utf-8')).toBe(plan);
    expect(workflow.state.planHash).toBe(hashContent(plan));
    expect(approvalText[0]).toContain('Plan SHA-256');
    const candidates = buildPaths(workflow.state.date, workflow.state.slug);
    expect(existsSync(join(cwd, candidates.planCandidate))).toBe(false);
  });

  it('never overwrites a conflicting approved snapshot after an interrupted promotion', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'build-gate-'));
    roots.push(cwd);
    const workflow = setup(advance(createState('build it', 'build-it', '2026-08-09', NOW), 'plan', NOW));
    const approvedPath = join(cwd, '.ai/plans/2026-08-09-build-it-r1.md');
    mkdirSync(join(approvedPath, '..'), { recursive: true });
    writeFileSync(approvedPath, 'different approved design\n');

    await expect(workflow.run('workflow_write_plan', {
      plan,
      tasks,
      designSummary: '- Runtime: retry',
    }, context(cwd, true))).rejects.toThrow('Refusing to overwrite immutable approved snapshot');
    expect(readFileSync(approvedPath, 'utf-8')).toBe('different approved design\n');
    expect(workflow.state.revision).toBe(0);
  });

  it('writes a candidate but never approves without a human UI', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'build-gate-'));
    roots.push(cwd);
    const workflow = setup(advance(createState('build it', 'build-it', '2026-08-09', NOW), 'plan', NOW));

    await workflow.run('workflow_write_plan', {
      plan,
      tasks,
      designSummary: '- Runtime: retry\n- UI: none',
    }, context(cwd, false));

    expect(workflow.state).toMatchObject({ phase: 'plan', revision: 0 });
    expect(existsSync(join(cwd, buildPaths('2026-08-09', 'build-it').planCandidate))).toBe(true);
  });

  it('records the design blocker that triggered a revised approval', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'build-gate-'));
    roots.push(cwd);
    const first = setup(advance(createState('build it', 'build-it', '2026-08-09', NOW), 'plan', NOW));
    await first.run('workflow_write_plan', {
      plan,
      tasks,
      designSummary: '- Revision one',
    }, context(cwd, true));
    const replanning = returnToPlanning(first.state, 'reviewer', 'migration loses rows', NOW);
    const revised = setup(replanning);

    await revised.run('workflow_write_plan', {
      plan,
      tasks,
      designSummary: '- Revision two preserves rows',
    }, context(cwd, true));

    expect(revised.state.revision).toBe(2);
    expect(revised.state.revisions[1].trigger).toMatchObject({
      role: 'reviewer',
      rationale: 'migration loses rows',
      supersededRevision: 1,
    });
  });
});
