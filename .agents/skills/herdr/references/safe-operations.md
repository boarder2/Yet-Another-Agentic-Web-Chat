# Safe Herdr Operations

Read the installed CLI as the authority. Begin with the relevant non-mutating help group; never run bare `herdr`, which opens the TUI, and never probe a mutating nested command by omitting arguments.

```bash
herdr --help
herdr agent
herdr pane
herdr tab
herdr workspace
herdr worktree
```

## Preconditions and targeting

Only control the current session from a Herdr-managed parent:

```bash
test "${HERDR_ENV:-}" = 1 && test "${HERDR_DELEGATE:-}" != 1 || {
  echo "Herdr control is unavailable from this process" >&2
  exit 1
}
printf '%s\n' "$HERDR_WORKSPACE_ID" "$HERDR_TAB_ID" "$HERDR_PANE_ID"
```

A delegated worker must never control Herdr or spawn another agent.

Public IDs are opaque: workspace `w1`, tab `w1:t1`, pane `w1:p1`. Parse IDs from JSON responses; do not infer them from examples or sidebar order. Agent targets accept a unique live name or the pane hosting that agent—not terminal IDs or bare agent kinds.

Use `--current`, an explicit pane ID, or a unique agent name. Never rely on another client's focused pane. Use `--no-focus` for background work.

Discover state with:

```bash
herdr pane current --current
herdr pane layout --pane "$HERDR_PANE_ID"
herdr pane list --workspace "$HERDR_WORKSPACE_ID"
herdr agent list
```

## Layout and processes

Choose the primitive that owns the task:

- Workspace/tab/pane commands manage terminal topology.
- Pane commands manage shells and ordinary processes.
- Agent commands manage a recognized coding agent's lifecycle.

Default worker/command topology is one sibling pane in the current tab and `$PWD`. Split a wide pane right and a narrow or tall pane down. Avoid repeated splits that make panes unusable.

```bash
herdr pane split --current --direction right --cwd "$PWD" --no-focus
```

Read the new pane ID from `.result.pane.pane_id`. An agent can start only in an available interactive shell pane.

## Agent lifecycle

Statuses:

- `working`: processing a turn.
- `idle`: settled and already seen in the focused Herdr UI.
- `done`: settled background work not yet seen.
- `blocked`: approval or question UI detected; inspect before responding.
- `unknown`: detection is uncertain; it does not prove completion.

Start native agent arguments after `--`:

```bash
herdr agent start <name> --kind <kind> --pane <pane-id> -- <agent-args...>
```

Submit normal work through the agent surface:

```bash
herdr agent prompt <name> "<prompt>" --wait --timeout 600000
```

If the wait times out, inspect status. A timeout does not mean the turn failed; keep waiting when the agent is still working.

```bash
herdr agent get <name>
herdr agent wait <name> --timeout 600000
herdr agent read <name> --source recent-unwrapped --lines 160
```

Use `esc` to cancel an active Pi turn only when cancellation is intentional. If `recent-unwrapped` cannot recover a settled alternate-screen response, ask the agent to write its complete response under `/tmp` and reply with the path, then read the file.

## Ordinary commands

Run non-agent work through an available shell pane only for the exact command/task the governing user request or skill authorizes. Never broaden it into destructive or unrelated shell work:

```bash
herdr pane run <pane-id> "<command>"
herdr pane wait-output <pane-id> --match "<text>" --timeout 120000
herdr pane read <pane-id> --source recent-unwrapped --lines 160
```

`wait-output` searches immediately, including output already present.

## Safety

- Do not close, move, or repurpose panes/workspaces you did not create without explicit user instruction.
- Never stop the Herdr server or kill the main Herdr process from an active session unless explicitly requested.
- Do not create workspaces, tabs, or worktrees unless the governing skill/user request authorizes that topology.
- After `pane move`, continue with the returned new pane ID or the live agent name; old IDs are not general aliases.
- Inspect blocked/unknown agents before sending keys or prompts.
- Validate logical keys before sending them; prefer `herdr agent send-keys` for agent UI controls.
