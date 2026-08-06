# /build — phase-gated build workflow

A pi extension that turns "triage → grill → plan → tasks → execute → close" from prose the model
is asked to follow into a state machine the harness enforces. Self-contained: its own
`package.json`, `tsconfig.json`, and `vitest.config.ts`; the root project is untouched.

## Commands

| Command | Effect |
|---|---|
| `/build <ask>` | Start a workflow in this session. Refuses if one is already active here. |
| `/build:pause` | Restore normal tools, keep state. |
| `/build:resume <slug>` | Re-attach a paused workflow and re-gate tools. |
| `/build:abort` | Discard phase state. Plan and task files are kept. |
| `/build:list` | Every workflow in the project with phase, status, and last attachment. |
| `/build:attach [coder\|tester]` | Print the `pi --session …` command for an agent's own session. |

## Phases and their tools

| Phase | Advances via | Gate |
|---|---|---|
| triage | `workflow_triage` | You pick simple/complex; dismissal means complex |
| grill | `workflow_end_grilling` | You confirm the restatement of the ask |
| plan | `workflow_write_plan` | Structural validation, then your approval |
| tasks | `workflow_write_tasks` | Parse validation, then your approval |
| execute | `workflow_run_chunk` | No arguments — the harness picks the chunk |
| close | `workflow_close` | Runs configured checks, reports real exit codes |

A tool called in the wrong phase throws; the model cannot advance by asserting that it has.

## How enforcement works

1. **Tool gating.** `edit` and `write` are withheld for the whole workflow — all mutation goes
   through subagents. Re-applied on attach, `session_start`, `resources_discover`, and every
   `before_agent_start`, because `session_start` fires *before* the tool set is rebuilt.
2. **Per-turn prompt injection.** The active phase's rules replace the system prompt every turn,
   so adherence does not decay over a long run.
3. **Gated tools.** Each transition validates in TypeScript and then asks you. You answer the
   dialog; the model cannot forge the answer.
4. **Code-driven loop.** `workflow_run_chunk` takes no arguments. Reordering, skipping, batching,
   and self-marking a chunk done are not expressible.

## The chunk loop

Per chunk: coder → tester → reviewer, up to `maxRounds` rounds. A chunk completes only when the
tester reports **zero failures with at least one pass** *and* the reviewer reports `pass`. Both
arrive as typed arguments to `submit_test_result` / `submit_verdict`, injected into each subagent
via `pi -e`. A missing or unreadable signal is a failure, never a pass.

After the last round you get: stop, or override with a reason that is written into the task file
as `(override: …)`.

Coder and tester have long-lived sessions (`wf-<slug>-coder`) so they accumulate context; the
reviewer is spawned fresh each chunk and pinned to a different model, so it cannot anchor on work
it already approved. When a long-lived agent passes `contextBudget` of the window, its session is
retired and reseeded — every task restates the plan and chunk, so a reseed costs continuity, not
the brief.

## Files

- `.ai/builds/<date>-<slug>.json` — machine-owned state. Do not hand-edit.
- `.ai/plans/<date>-<slug>.md` — the plan.
- `.ai/task/<date>-<slug>.md` — chunks and progress. **Authoritative** for both; the extension is
  the only writer of `[x]`, and hash-checks it before each chunk.

## Config — `.pi/build.json`

```json
{
  "reviewerModel": "~anthropic/claude-sonnet-latest",
  "checks": ["npm run lint", "npx tsc --noEmit", "npm run test:unit"],
  "maxRounds": 2,
  "contextBudget": 0.6
}
```

Invalid values fall back to defaults rather than leaving a workflow unrunnable.

## Agents

`.pi/agents/{coder,tester,reviewer}.md` — frontmatter `name`, `description`, optional `model` and
`tools`. An agent's tool allowlist is always extended with the submit tools, so it can never be
configured such that it cannot report.

## Known weaknesses, accepted deliberately

- **The bash allowlist is a speed bump, not a sandbox.** `python3 -c`, `node -e`, and
  `find … -delete` all pass it. So the read-only property is "the model will not drift into
  editing", not "the model cannot edit". Asserted in `bash-allowlist.test.ts` so it cannot quietly
  become assumed safety.
- **No locking.** Two sessions driving one slug will interleave writes into the shared agent
  sessions. Chosen so a crash never leaves a workflow unresumable; `/build:list` shows an advisory
  last-attached stamp only.
- **`.ai/` is gitignored**, so plans, task lists, and override annotations are local to whoever ran
  the workflow. They are durable and greppable, but not an audit trail for review.

## Development

From the repo root:

```bash
npx vitest run --config .pi/extensions/build/vitest.config.ts
npx tsc -p .pi/extensions/build/tsconfig.json
```
