---
name: claude-alt
description: Runs claude cli with alternate models as named, resumable sessions tracked in a registry file.
user-invocable: true
disable-model-invocation: true
---

# claude-alt — Lower-Cost CLI Subprocesses, Run as a Team

`claude-alt` is a shell command that runs Claude Code with a lower-cost model. Use it instead of spawning internal subagents when delegating discrete, well-scoped tasks that don't require your full model.

Treat each `claude-alt` run as a **teammate** — like Claude Code's agent teams. Every delegated task gets a stable, **named session** you can **resume** later to give follow-up instructions with its full context intact. A small registry file keeps the names and IDs durable, so you never lose a teammate to context compaction.

## When to use claude-alt instead of an internal subagent

Prefer `claude-alt` over the `Agent` tool when:

- The task is self-contained and can be expressed in a single prompt
- You need output from a cheaper model to feed back into this session
- You want explicit shell-level composition (pipe output, save to file, etc.)
- You'll likely need to **iterate** on the same task — a resumable session keeps the teammate's context instead of re-explaining each time

Keep using internal subagents (`Agent` tool) when the task requires access to this session's state or complex back-and-forth that `claude-alt` can't handle in one shot.

## Session tracking (the team registry)

Maintain one registry at **`.claude/claude-alt/sessions.json`** (project-relative; gitignore it — IDs are ephemeral). It is a JSON array of teammate records:

```json
[
  {
    "name": "schema-refactor",
    "session_id": "92162549-d642-4cd9-9a40-3f59170ed0c8",
    "cwd": "/workspaces/YAAWC",
    "purpose": "Migrate app_settings reads to the new helper",
    "status": "active",
    "created": "2026-06-28T15:00:00Z",
    "updated": "2026-06-28T15:00:00Z"
  }
]
```

- **`name`** — short kebab-case slug, unique within the registry; this is how you and the user refer to the teammate.
- **`status`** — `active` while you may still resume it; `done` once the task is finished. Prune `done` records when the registry gets noisy.
- Always read the registry before delegating: reuse/resume an existing teammate for related work rather than starting a fresh one.

The native agent view also lists sessions — `claude agents --json` (active) or `claude agents --json --all` (include completed) — but the registry is the source of truth here because it records intent (name, purpose, status) and survives across your turns.

## Workflow

### 1. Start a named teammate (new session)

Generate a UUID, pass it as `--session-id`, name the session with `-n`, then record it.

```bash
sid=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen | tr 'A-Z' 'a-z')
claude-alt -p "Migrate app_settings reads in src/lib/settings to the new helper" \
  --session-id "$sid" -n "schema-refactor"

# record it (create the file as [] first if missing)
mkdir -p .claude/claude-alt
[ -f .claude/claude-alt/sessions.json ] || echo '[]' > .claude/claude-alt/sessions.json
now=$(date -u +%FT%TZ)
jq --arg n schema-refactor --arg s "$sid" --arg c "$PWD" \
   --arg p "Migrate app_settings reads to the new helper" --arg t "$now" \
   '. += [{name:$n,session_id:$s,cwd:$c,purpose:$p,status:"active",created:$t,updated:$t}]' \
   .claude/claude-alt/sessions.json > .claude/claude-alt/sessions.json.tmp \
   && mv .claude/claude-alt/sessions.json.tmp .claude/claude-alt/sessions.json
```

### 2. Resume a teammate (continue the same session)

Look the name up in the registry, then `--resume` by ID — the teammate keeps its prior context, so give only the follow-up:

```bash
sid=$(jq -r '.[] | select(.name=="schema-refactor") | .session_id' .claude/claude-alt/sessions.json)
claude-alt -p "Now update the callers in src/app/settings and report what changed" --resume "$sid"
# bump updated; flip status to "done" when the task is complete
```

- `-c` / `--continue` resumes the **most recent** session in the cwd — handy for a quick immediate follow-up without a lookup.
- `--fork-session` (with `--resume`) branches into a new session ID instead of mutating the original — use it to try a variation while preserving the teammate's original thread (record the fork as its own teammate).

### 3. Check on the team

```bash
jq -r '.[] | "\(.status)\t\(.name)\t\(.purpose)"' .claude/claude-alt/sessions.json   # your registry
claude agents --json --all                                                            # native agent view
```

When the user asks "what's <name> doing" or "continue <name>", resolve the name via the registry and resume.

## CLI reference

`claude-alt` accepts the same flags as the `claude` CLI:

```
claude-alt [flags] [prompt]
```

### Core flags

| Flag                               | Purpose                                                                                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-p "PROMPT"` / `--print "PROMPT"` | Non-interactive mode — print response and exit. Required for scripted use.                                                                           |
| `--session-id UUID`                | Assign a chosen UUID to a **new** session (must be a valid, unused UUID). Use on start.                                                              |
| `-n` / `--name NAME`               | Display name for the session (shown in `/resume` picker, `claude agents`, title).                                                                    |
| `-r` / `--resume [ID]`             | Resume a conversation by session ID (context intact). No ID opens a picker.                                                                          |
| `-c` / `--continue`                | Resume the most recent conversation in the current directory.                                                                                        |
| `--fork-session`                   | With `--resume`/`--continue`, branch into a new session ID instead of reusing the old.                                                               |
| `--model MODEL`                    | Override the model (default is the lower-cost model set by the wrapper).                                                                             |
| `--system-prompt "TEXT"`           | Set a system prompt.                                                                                                                                 |
| `--output-format FORMAT`           | `text` (default), `json`, or `stream-json`. `json` includes `session_id` in the envelope.                                                            |
| `--max-turns N`                    | Limit agentic turns (default: unlimited).                                                                                                            |
| `--allowedTools TOOLS`             | Comma-separated list of tools to permit (e.g. `Bash,Read`). Restricts tool use.                                                                      |
| `--disallowedTools TOOLS`          | Comma-separated list of tools to deny.                                                                                                               |
| `--permission-mode MODE`           | Permission mode: `default`, `acceptEdits`, `auto`, `plan`, `bypassPermissions`. Use `auto` for delegated file-editing runs (see harness note below). |
| `--dangerously-skip-permissions`   | Skip all permission prompts. **Blocked by this harness's auto-approval classifier** — use `--permission-mode auto` instead.                          |
| `--cwd PATH`                       | Set the working directory for the subprocess.                                                                                                        |
| `--verbose`                        | Emit detailed logs (useful for debugging).                                                                                                           |
| `--no-cache`                       | Disable prompt caching.                                                                                                                              |

### Common patterns

**Non-interactive one-shot (most common):**

```bash
claude-alt -p "Summarize the key changes in $(git diff HEAD~1 HEAD -- src/lib/foo.ts)"
```

**Structured JSON output (also surfaces `session_id`):**

```bash
result=$(claude-alt -p "Extract the function names from this file" --output-format json < src/lib/foo.ts)
sid=$(jq -r '.session_id' <<< "$result")
```

**Restricted tool set:**

```bash
claude-alt -p "Read src/lib/bar.ts and list all exported types" --allowedTools Read
```

**With a system prompt:**

```bash
claude-alt -p "Review this code for security issues" --system-prompt "You are a security auditor. Be terse." < src/api/route.ts
```

## Running from inside Claude Code (this harness)

Lessons from delegating real work here — follow these to avoid the failures hit last time:

- **It's a shell function, not a binary.** `claude-alt` is defined in the user's zsh profile (it wraps `claude` with alternate-model env vars). The Bash tool may not have it loaded, so invoke through an interactive zsh: `zsh -ic 'claude-alt -p "..." ...'`. The `(eval):1: can't change option: zle` noise on the first line is harmless.
- **Permissions: use `--permission-mode auto`.** `--dangerously-skip-permissions` and `--permission-mode bypassPermissions` are **rejected by the harness auto-approval classifier** ("Create Unsafe Agents") and the call is denied. `--permission-mode auto` lets the teammate read/edit files non-interactively and is accepted. Don't reach for the bypass flags first.
- **Run long delegations in the background and capture output.** Redirect to a log and use the Bash tool's `run_in_background`: `zsh -ic 'claude-alt -p "$(cat /tmp/task.txt)" --permission-mode auto --output-format text' > /tmp/task.log 2>&1`. You get notified on completion; tail the log for the teammate's report.
- **Pass big/multiline prompts from a file**, not inline: write the prompt with the Write tool, then `-p "$(cat /tmp/task.txt)"`. Avoids shell-quoting breakage.

### Parallel fan-out (multiple teammates at once)

For a large task that splits into independent pieces (e.g. one spec/file per route group), launch several teammates in parallel — it's effective and was the right call last time. Guardrails learned the hard way:

- **Give each teammate a disjoint set of files to own.** Tell them explicitly which files to create/edit and to touch nothing else — parallel writers to the same file collide. Verify scope afterward with `git status`.
- **Have them author/read only; verify centrally.** Tasks that need a shared singleton (one dev server, port 5005, one test DB) can't all run it at once. Instruct teammates **not** to start the server / test runner, then you run the suite once after they finish and fix fallout yourself.
- **Make each teammate read the real source it's testing/changing** to derive exact contracts (status codes, field names, `message` vs `error`) rather than guessing — their reported "contract surprises" are a useful signal to spot-check.
- **Don't trust green-by-rebuild.** After teammates change `src/`, run `npm run build` before e2e — the Playwright webServer runs the standalone build, not `src/`. A stale build caused phantom failures last time.

## Tips

- Always use `-p`/`--print` for non-interactive use — without it, `claude-alt` opens an interactive session.
- Generate the `--session-id` yourself on the first call so you control the ID and can record it immediately — don't scrape it back from output.
- One teammate per coherent task. Resume it for follow-ups; spin up a new named session for a genuinely different task.
- For large inputs (files, diffs), pipe via stdin rather than embedding in the prompt string.
- Limit `--max-turns` when you want a single-pass answer and don't want the subprocess to keep looping.
