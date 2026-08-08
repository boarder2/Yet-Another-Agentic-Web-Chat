# /build — phase-gated build workflow

A pi extension that turns "triage → grill → plan → tasks → execute → close" from prose the model
is asked to follow into a state machine the harness enforces. Self-contained: its own
`package.json`, `tsconfig.json`, and `vitest.config.ts`; the root project is untouched.

**Requires herdr.** The coder, tester and reviewer run as live interactive pi agents in their own
herdr panes, so you watch them work rather than reading a summary afterwards. `/build` refuses to
start outside a herdr session — there is nowhere to put them.

## Commands

| Command | Effect |
|---|---|
| `/build <ask>` | Start a workflow in this session. Refuses if one is already active here. |
| `/build:pause` | Restore normal tools, keep state. |
| `/build:resume <slug>` | Re-attach a paused workflow and re-gate tools. |
| `/build:abort` | Discard phase state. Plan and task files are kept. |
| `/build:list` | Every workflow in the project with phase, status, and last attachment. |

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
coder reports `completed`, the tester reports **zero failures with at least one pass**, *and* the
reviewer reports `pass`. All three arrive as typed arguments to `submit_completion` /
`submit_test_result` / `submit_verdict`, from an extension injected into each agent via `pi -e`. A
missing or unreadable signal is a failure, never a pass.

A coder that reports `blocked` ends the round immediately: there is no point testing and reviewing
work that was not done, so the loop stops and tells you what it needs decided.

After the last round you get: stop, or override with a reason that is written into the task file
as `(override: …)`.

**Every chunk gets a clean crew.** All three agents are retired and restarted when a new chunk
starts: coder and tester move to a per-chunk session (`wf-<slug>-coder-chunk-3`) and the reviewer to
a fresh one. Context earned on an earlier chunk is a liability on the next — it is where stale
assumptions about code that has since changed come from — and every task restates the plan, the
chunk, and what is already merged, so a fresh agent loses continuity, not the brief.

The reset is keyed on the chunk, so re-running a chunk that failed reattaches to the sessions already
working on it instead of throwing their work away. Within a chunk, an agent that passes
`contextBudget` of its window — read from the session file pi writes — is still retired and reseeded,
which is the backstop for a chunk that takes many rounds.

## The panes

`workflow_run_chunk` lays the crew out on first use: the driver session keeps the left third, and
coder, tester and reviewer are stacked in equal thirds down the remaining two. Each is a real interactive
`pi`, started with `herdr agent start --kind pi` and named for its role, so the herdr sidebar reads
as the crew and shows which one is `working`, `idle`, or `blocked`.

The loop drives them with `herdr agent prompt --wait`. Agents run with `--approve`, so `blocked`
means a genuine question rather than a tool approval: you get a notification, the workflow waits
`blockedTimeoutMs` for you to answer it in the pane, and a timeout fails the round. The loop never
answers for you.

Each agent is found by its name — `<role>-<slug>`, derived from the workflow — looked up in herdr on
every pass. herdr is the authority on what is running and where, so the workflow stores no layout of
its own that could fall out of step with the screen: a half-built crew, a crashed driver, or a
resumed session all reattach to the agents that are already live instead of starting a second one.

Panes are yours once created. They stay open at close and abort, and a pane you close is rebuilt
next chunk — costing that agent's context, not the layout. Because the agents own their terminals,
their results come back through a file named by `YAAWC_BUILD_RESULT` rather than through stdout.

A freshly split pane is not immediately usable: `agent start` needs the shell at its prompt, so the
loop waits for the pane's foreground process group to *be* the shell before starting anything there.

## Files

- `.ai/builds/<date>-<slug>.json` — machine-owned state. Do not hand-edit.
- `.ai/plans/<date>-<slug>.md` — the plan.
- `.ai/task/<date>-<slug>.md` — chunks and progress. **Authoritative** for both; the extension is
  the only writer of `[x]`, and hash-checks it before each chunk.
- `.ai/builds/<date>-<slug>-<role>.{system.md,result.json}` — each agent's system prompt and its
  last typed result. Machine-owned scratch.

## Config — `.pi/build.json`

```json
{
  "models": {
    "plan": "openai-codex/gpt-5.6-sol:high",
    "coder": "~anthropic/claude-sonnet-latest",
    "tester": "~anthropic/claude-sonnet-latest",
    "reviewer": "openai-codex/gpt-5.6-sol:medium"
  },
  "checks": ["npm run lint", "npx tsc --noEmit", "npm run test:unit"],
  "maxRounds": 2,
  "contextBudget": 0.6
}
```

**All four models are required**, and `/build` refuses to start until every one of them resolves
against the model catalogue. Which model plans and which one grinds chunks is a cost/quality
decision, and a harness that guessed at it would quietly plan on the cheap model. Specs are
`provider/id`, `provider/id:thinking`, or a bare `id`.

`models.plan` is applied to *your* session for triage, grilling, planning and chunking; entering
execution restores whatever model you were on, as do pause, abort and close. It is set only when the
phase changes, so a manual `/model` inside a phase stands.

Everything else falls back to a default rather than leaving a workflow unrunnable: `maxRounds` (2),
`contextBudget` (0.6, applied within a chunk), `turnTimeoutMs` (30m), `blockedTimeoutMs` (15m),
`checks` (none).

## Agents

`.pi/agents/{coder,tester,reviewer}.md` — frontmatter `name`, `description`, and optional `tools`.
An agent's tool allowlist is always extended with the submit tools, so it can never be configured
such that it cannot report. A leftover `model:` field is a hard error: models live in
`.pi/build.json`, and silently ignoring the field would let you change it and change nothing.

## Known weaknesses, accepted deliberately

- **The bash allowlist is a speed bump, not a sandbox.** `python3 -c`, `node -e`, and
  `find … -delete` all pass it. So the read-only property is "the model will not drift into
  editing", not "the model cannot edit". Asserted in `bash-allowlist.test.ts` so it cannot quietly
  become assumed safety.
- **No locking.** Two sessions driving one slug will interleave writes into the shared agent
  sessions. Chosen so a crash never leaves a workflow unresumable; `/build:list` shows an advisory
  last-attached stamp only.
- **The panes are visible, not authoritative.** What the parent believes comes from the result
  file, not from the transcript you are reading. An agent whose terminal shows a finished review but
  that never called `submit_verdict` is a failed round, by design.
- **Pane geometry is best-effort.** Splits are placed for equal thirds, but a pane you close and
  the workflow rebuilds is split off whichever sibling survived, so the layout drifts. Resize it
  yourself; nothing in the loop depends on the geometry. The one invariant is that your own pane is
  split at most once, keeping the left third — only to open the crew column, and never again while
  any crew pane lives.
- **Agent names are the identity, so they collide.** Two workflows whose slugs truncate to the same
  32 characters would adopt each other's agents. Slugs are unique per day, so this needs two
  same-day workflows with near-identical names to bite.
- **`.ai/` is gitignored**, so plans, task lists, and override annotations are local to whoever ran
  the workflow. They are durable and greppable, but not an audit trail for review.

## Development

From the repo root:

```bash
npx vitest run --config .pi/extensions/build/vitest.config.ts
npx tsc -p .pi/extensions/build/tsconfig.json
```
