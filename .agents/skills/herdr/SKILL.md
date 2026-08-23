---
name: herdr
description: Control Herdr only when explicitly requested; autonomous Pi worker delegation belongs exclusively to luna-delegation. Requires HERDR_ENV=1.
---

# Herdr

Herdr organizes terminals into workspaces, tabs, and panes and recognizes coding agents running inside them. This skill authorizes user-directed Herdr topology, terminal, and agent control.

Use it only when the user explicitly requests Herdr. `luna-delegation` is the sole automatic exception and authorizes only bounded Pi worker management. A delegated worker (`HERDR_DELEGATE=1`) must never use Herdr.

Before any control command, read [references/safe-operations.md](references/safe-operations.md) completely and follow its preconditions, targeting, status, wait, and cleanup rules.

## Match the requested primitive

- **Inspect/focus/resize/move/split/close terminals**: pane/tab/workspace commands.
- **Run or inspect an ordinary shell command**: pane commands.
- **Start, prompt, wait for, inspect, or take over a recognized coding agent**: agent commands.
- **Create/open/remove an isolated checkout**: worktree commands, only when the user explicitly requests that topology.

Do not create layout merely because background work would be convenient; that belongs to `luna-delegation` when its bounded-delegation rubric is met.

## Inspect first

Use caller context rather than the user's current UI focus:

```bash
herdr pane current --current
herdr pane layout --pane "$HERDR_PANE_ID"
herdr tab list --workspace "$HERDR_WORKSPACE_ID"
herdr pane list --workspace "$HERDR_WORKSPACE_ID"
herdr agent list
```

Read IDs and state from JSON. When the user names a direction or target, honor it. Otherwise ask before any destructive or materially disruptive topology change.

## Control agents

An available shell pane must be at its interactive prompt. `agent start` never creates layout. Use a unique lowercase agent name and pass native arguments after `--`:

```bash
herdr agent start <name> --kind <kind> --pane <pane-id> -- <agent-args...>
herdr agent prompt <name> "<task>" --wait --timeout 600000
```

A timeout means inspect and continue waiting when the agent is still working. If blocked, read the agent before sending input. Use logical keys for intentional UI control:

```bash
herdr agent send-keys <name> esc
herdr agent send-keys <name> ctrl+c
```

## Control ordinary processes

Create layout only as requested, preserve the intended cwd, and keep focus unchanged unless the user asks otherwise. Then use pane commands:

```bash
herdr pane run <pane-id> "<command>"
herdr pane wait-output <pane-id> --match "<text>" --timeout 120000
herdr pane read <pane-id> --source recent-unwrapped --lines 160
```

Never close or repurpose a pane, tab, workspace, agent, or process you did not create unless the user explicitly directs it.
