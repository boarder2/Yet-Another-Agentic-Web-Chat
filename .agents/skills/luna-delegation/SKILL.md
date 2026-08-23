---
name: luna-delegation
description: Use for bounded independent repository investigation, review, or implementation via Pi GPT-5.6-Luna Herdr workers; multiple readers, one writer maximum. Requires HERDR_ENV=1.
---

# Luna Delegation

Delegate only when an independent context materially improves investigation, review, verification, or implementation. Do not delegate trivial work, inherently serial work, or the entire user request. The parent remains responsible for decisions, integration, and validation.

This skill is the sole exception to the `herdr` skill's explicit-user-request rule. It authorizes worker management only, not unrelated terminal topology changes. Never invoke this skill from a delegated worker: `HERDR_DELEGATE=1` is a hard stop.

Before controlling Herdr, read [../herdr/references/safe-operations.md](../herdr/references/safe-operations.md) completely. Its targeting, status, wait, and cleanup rules apply here.

## Preconditions

```bash
test "${HERDR_ENV:-}" = 1 && test "${HERDR_DELEGATE:-}" != 1 || {
  echo "Luna delegation is unavailable from this process" >&2
  exit 1
}
herdr agent
herdr pane layout --pane "$HERDR_PANE_ID"
herdr agent list
pi --list-models gpt-5.6-luna
```

If Herdr, the Pi integration, or `openai-codex/gpt-5.6-luna` with `max` thinking is unavailable, do not substitute another model. Continue locally and disclose the missing independent review when it affects confidence.

## Choose the team

Use the smallest useful team:

- **Ephemeral reader**: default for one bounded investigation or review.
- **Ephemeral writer**: one self-contained implementation where delegation is worthwhile.
- **Persistent team**: only when role-specific context and several feedback rounds are valuable, such as one coder and one reviewer.

Multiple readers may run concurrently. There may be only one writer across the parent and all workers: while a write worker is active, the parent and every other worker must not edit repository files. Never launch multiple write workers. Do not create worktrees.

Give every worker a narrow role, one explicit deliverable, relevant starting paths, constraints, and file ownership. A reviewer is always a reader. Retire a persistent worker when its goal is complete, its context is stale, or its responsibilities materially change.

## Keep tasks small

A worker task must fit comfortably in one context window. Delegate one subsystem, one review axis, or one implementation slice at a time—not a repository-wide audit with several deliverables.

Before prompting, split work further when it has more than one independent deliverable, spans unrelated subsystems, or asks the worker to discover its own unbounded scope. Name the initial files or directories and explicit exclusions. Tell the worker to stop and report the missing prerequisite instead of widening the task on its own.

Prefer several fresh, focused readers over one reader asked to inventory the whole codebase. Do not ask a worker both to explore broadly and produce implementation-ready output in the same turn.

## Create a worker

Default to an unfocused sibling pane in the current tab and `$PWD`. Inspect the layout first; split a wide pane right and a narrow or tall pane down. Parse the returned pane ID instead of predicting it.

```bash
herdr pane split --current --direction right --cwd "$PWD" --env HERDR_DELEGATE=1 --no-focus
```

Choose a unique lowercase name after reading `herdr agent list`, then start the exact worker profile.

Reader:

```bash
herdr agent start <name> --kind pi --pane <pane-id> -- \
  --model openai-codex/gpt-5.6-luna --thinking max --approve --no-skills \
  --tools read,bash,grep,find,ls
```

Writer:

```bash
herdr agent start <name> --kind pi --pane <pane-id> -- \
  --model openai-codex/gpt-5.6-luna --thinking max --approve --no-skills \
  --tools read,bash,edit,write,grep,find,ls
```

`--no-skills` and `HERDR_DELEGATE=1` prevent recursive skill-driven delegation. Every prompt must also say: **Never invoke Herdr, start another agent, or delegate work.** A worker with `bash` is not technically sandboxed; role instructions remain mandatory.

## Prompt contracts

Reader prompts must include:

- `You are a read-only worker.`
- `Do not modify files, install packages, mutate databases, run Git-changing commands, or start/stop persistent processes.`
- `Never invoke Herdr, start another agent, or delegate work.`
- One exact question, evidence expected, output shape, starting paths, and explicit exclusions.
- A request to cite file paths and line numbers, identify uncertainty, and stop rather than expand beyond the boundary.

After a reader settles, the parent must inspect `git status --short`. Treat unexpected changes as a coordination failure; do not discard them without checking whether they predated the worker.

Writer prompts must include:

- `You hold the sole writer lease for this repository.`
- Exact file/domain ownership and acceptance criteria.
- `Never invoke Herdr, start another agent, or delegate work.`
- `Do not commit, merge, rebase, push, or alter unrelated user changes.`
- Required focused validation and a final changed-files/test summary.

The parent must stop editing before granting the writer lease and review the resulting diff before resuming edits.

## Manage context and sessions

Inspect the worker's visible footer before each follow-up and while a long turn is running:

```bash
herdr agent read <name> --source visible --lines 12
```

The Pi footer reports context use as a percentage and token window. Treat rapid growth as evidence that the task is too broad.

- **New instruction**: same bounded goal, prior context is useful, and context use remains comfortably below roughly 60%.
- **Compact**: same persistent goal genuinely needs prior decisions, but context is around 60–80%. Run `/compact` with instructions naming the role, current goal, decisions, owned files, and next step before sending more work.
- **Fresh session**: a different goal, an ephemeral task is complete, context exceeds roughly 80%, auto-compaction has already lost useful detail, or most accumulated context is irrelevant. Close the created pane and start a new worker rather than carrying stale context forward.

While a worker is running, inspect the footer periodically. If context approaches 80% before it begins producing the requested deliverable, cancel with `esc`, split the task, and restart in a fresh session. Never let one oversized task churn through repeated automatic compactions.

A persistent agent is not a default task queue. Reuse it only for back-and-forth on the same goal; otherwise start fresh. Record the context decision after every settled turn.

## Coordinate and wait

Submit through the agent surface:

```bash
herdr agent prompt <name> "<bounded prompt>" --wait --timeout 600000
```

A timeout means the worker may still be running. Inspect it and keep waiting; do not treat timeout as failure or send the prompt again.

```bash
herdr agent get <name>
herdr agent wait <name> --timeout 600000
herdr agent read <name> --source recent-unwrapped --lines 160
```

If blocked, inspect output before responding. Do not guess through an approval or question UI. If terminal scrollback truncates a settled response, ask the worker to write the complete report under `/tmp` and reply only with the path, then read that file directly.

For a persistent team, send follow-up prompts to the same named workers. Keep role and writer-lease boundaries explicit in every handoff; do not let a reviewer silently become a writer.

## Finish

Capture the result and verify it independently. For an ephemeral worker, close only the pane this skill created and only after the worker settles:

```bash
herdr pane close <pane-id>
```

Do not close pre-existing panes. Leave persistent teams running only while the ongoing goal benefits from their retained context.
