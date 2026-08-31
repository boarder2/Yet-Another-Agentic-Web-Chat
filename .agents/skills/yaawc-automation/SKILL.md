---
name: yaawc-automation
description: 'Workflows and schedules: templates, manual/headless runs, cron lifecycle, persistence, failures, and unavailable interactions.'
---

# Workflows and Schedules

Automations are reusable parameterized workflows plus DB-backed cron schedules. Every run uses the workflow's saved focus mode, Chat/System model references (including optional native reasoning effort), personas, and methodology. It does not inherit a launching chat's workspace, MCP tools, memory, panel, or personalization.

## Template contract

`src/lib/workflows/template.ts` is the prompt/input grammar:

- An optional leading `---` block declares ordered `text`, `longtext`, `select`, or `multi` fields.
- Fields support `optional`, `label=`, `desc=`, `options=`, and `default=`. Names follow the identifier grammar; `step*_output` is reserved.
- The body references `{{name}}`. Built-ins `{{@today}}` and `{{@now}}` support offsets and `:long`/`:short`; escaped braces remain literal.
- Reject malformed, duplicate, undefined, unclosed, invalid-option, and invalid-default tokens. Preserve unused-field warnings.
- Substitution strips frontmatter, applies defaults, joins `multi` values with `, `, and accepts an explicit clock for deterministic dates.

`resolveWorkflowRun.ts` is the shared run-time resolver. Create/edit routes reject parser errors and malformed model references; schedule create/edit validates the stored fill-set against the current prompt. Workflow edits that invalidate child schedules must disable and unregister them with a repair reason. Saved model effort is resolved at run time without rewriting the workflow or schedule definition.

## Manual runs

`src/lib/workflows/runManual.ts` starts a normal, background-capable chat from substituted input. It inserts the chat and verbatim user message with `workflowId`, starts the run host/hub, and returns the chat without awaiting completion. Manual runs are live and continuable, but retain the workflow's non-workspace configuration and the effective effort captured in their v2 run snapshot.

`POST /api/workflows/[id]/run` returns missing required names as 400 or a new chat as 201. Manual run requests are not idempotent: a retry creates another chat/run. Keep persisted provenance aligned with ordinary chat runs.

## Scheduled runs

`src/lib/scheduledTasks/runner.ts` powers cron and Run now. It resolves saved values at fire time, creates a schedule-linked chat plus running assistant row, then folds stream events into one persisted answer.

Scheduled runs must preserve final sources, writer-owned tool widgets, model stats, effective Chat/System effort metadata, and chart specs/placements. Mark the chat and schedule successful only after `agent_end`. On any model/provider/prompt/agent failure, best-effort persist a failure answer, clear active markers, mark the chat errored, and record `lastRunStatus=error` and the error text.

Scheduled execution is headless: it cannot wait for ask-user, code execution, workspace edits, or other approval-gated interactions, and it does not perform automatic memory extraction. Charts are supported. Deep-research nested activity is not fully represented in persisted scheduled output; do not claim otherwise.

## Cron lifecycle

`src/lib/scheduledTasks/scheduler.ts` owns in-process jobs:

- `initScheduler()` clears HMR leftovers, runs the boot sweep, loads enabled schedules, and registers timezone-aware cron jobs with `waitForCompletion`. Validate cron and timezone before persisting/enabling; do not assume the underlying library enforces a five-field-only grammar.
- Updates/toggles unregister then register; deletion unregisters.
- Jobs run only while the application process runs.
- Startup preserves `awaiting_user` runs but interrupts other stale active runs and clears checkpoint/approval state.
- Periodic maintenance performs retention cleanup and run GC.

`migrateScheduledTasks.ts` idempotently maps legacy scheduled-task rows to workflows/schedules and remaps run chats. Preserve legacy data on migration failure.

## Persistence and retention

Deleting a workflow or schedule stops its jobs and nulls provenance links but keeps historical run chats. Generated chats/messages retain workflow/schedule provenance.

Retention can inherit the global policy or use a per-schedule days/count/disabled override. Pinned chats survive regular retention. Keep schedule last-run status, error, timestamp, and latest chat consistent on every terminal path.

## API and UI

Workflow CRUD/run and child schedules live under `src/app/api/workflows/`; schedule list/CRUD/run lives under `src/app/api/schedules/`. UI routes are under `src/app/automations/` for workflow browse/build/edit/launch and schedule browse/toggle/run-now/delete.

Use `src/lib/hooks/api/`, `apiFetch`, and `qk` for UI server state. Route changes also use `yaawc-api-endpoints`; visual changes require `yaawc-design-system`.

## Verification

`src/lib/workflows/template.test.ts` owns fast grammar/resolution coverage. Add isolated tests for changed resolver clocks/errors, preset conversion, scheduler registration/boot cleanup, or runner event folding. Use API/e2e only for integration boundaries and the mocked test provider—never a real LLM.

Update `docs/capabilities/automation.md` whenever behavior, prerequisites, limits, availability, or failures change.

Related skills: `yaawc-agent-runtime` for run/checkpoint behavior; `yaawc-streaming-events` for event folding; `yaawc-database` for persistence; `yaawc-testing` for test placement.
