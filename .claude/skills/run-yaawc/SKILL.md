---
name: run-yaawc
description: Build, run, and drive YAAWC (the Next.js AI search app in this repo). Use when asked to start YAAWC, launch the dev server, build it, smoke-test it, screenshot or inspect the home/dashboard UI, or interact with the running app in a browser.
---

YAAWC is a Next.js (App Router) web app: start `yarn dev`, then drive headless Chromium with `playwright-cli`. The harness `.claude/skills/run-yaawc/smoke.sh` wraps the whole loop. Paths are relative to repo root.

**Observe with `snapshot` (DOM/a11y tree as text — diffable, greppable), not screenshots.** Screenshots are opt-in (`SHOT=1`), only worth it for visual bugs (layout, image-heavy widgets).

**Port is not fixed:** `next dev` prefers 3000 but auto-bumps to 3001+ when taken (common in the Linux devcontainer). The harness parses the bound port from the dev log and validates each candidate is really YAAWC (`/api/config` body contains `chatModelProviders`, not just any 200); override candidates with `PORTS="3000 3001 8080"`.

## Prerequisites

For a fresh clone: Node ≥ 24, yarn 1.x, `playwright-cli` on PATH (else `npx playwright-cli`), `config.toml` at repo root (if absent, `cp sample.config.toml config.toml` — never overwrite an existing one; secrets/infra only — models are DB-backed in `db.sqlite`), and `yarn install`. macOS has no GNU `timeout`; the harness polls with a `seq`/`sleep` loop.

## Run (agent path) — the harness

```bash
bash .claude/skills/run-yaawc/smoke.sh          # snapshot-only (default)
SHOT=1 bash .claude/skills/run-yaawc/smoke.sh   # also save PNGs
```

It: reuses or starts `yarn dev` (logs → `/tmp/yaawc-dev.log`, up to 90s for first compile); captures home → `/tmp/yaawc-smoke/home.yaml` and `/settings` → `settings.yaml` (`.png` too with `SHOT=1`); fills the chat input and reads it back to prove React's controlled input took the keystrokes; prints console errors.

**Verify by grepping the YAML, not the exit code.** Home has a textbox `"What would you like to learn today?"`; settings has `heading "Settings"`. Use `SHOT=1` + `Read` the PNG only when the bug is visual.

### Driving it yourself

`playwright-cli` keeps a stateful named session; one command per call. Swap `:3000` for the actual port.

**Headed for large changes:** when testing a large/substantial change, open in headed mode (`--headed`) so the user can watch the run. Simple tests (including smoke) can stay headless.

```bash
playwright-cli -s=yaawc open --headed http://localhost:3000   # --headed for large changes; omit for simple/smoke
playwright-cli -s=yaawc open http://localhost:3000
playwright-cli -s=yaawc snapshot                 # DOM/a11y tree + element refs (e96, …) — your main view
playwright-cli -s=yaawc fill e96 "your query"    # use fill/type, NOT eval — React onChange
playwright-cli -s=yaawc goto http://localhost:3000/dashboard
playwright-cli -s=yaawc console error
playwright-cli -s=yaawc screenshot --filename=/tmp/shot.png   # visual bugs only
playwright-cli -s=yaawc close
```

Refs (`e96`) change on reload — re-snapshot before acting. Full command set: `playwright-cli` skill.

## API smoke (no browser)

```bash
curl -s -m 10 http://localhost:3000/api/config | head -c 200   # model providers JSON
curl -s http://localhost:3000/api/models                        # available model ids
```

LLM endpoints (`/api/chat`, `/api/search`) need a chat+system model (DB-backed, set in Settings) and a provider key in `config.toml`; the `test-automation` skill has the `/api/chat` payload shape and test model.

## Run (human path)

```bash
yarn dev      # → localhost:3000, hot reload, Ctrl-C to stop (fastest for just viewing)
yarn build    # db:push (drizzle migrate+push) then next build — needs working db.sqlite
yarn start    # serve the production build
```

## Gotchas

- **Port:** `config.toml` `PORT` is ignored; `next dev` picks 3000 or next free — read it from the log, never assume.
- **No two dev servers from one dir:** the second bumps to 3001, prints "Ready", then exits _"Another next dev server is already running."_ So 3001 means one server pushed off 3000 by a non-Next process, not two YAAWCs.
- **A 200 ≠ YAAWC:** another app on the port also answers curl — grep `/api/config` for `chatModelProviders` before trusting it.
- **One benign console error per page:** `RangeError: invalid language tag: "undefined"` from `ReactQueryDevtools` (dev only) — ignore; a _second_ error is real.
- **React inputs:** `eval el.value=…` won't fire onChange — use `fill`/`type`; you can still `eval` to _read_ the value.
- **First `goto` is slow** (turbopack compiles routes on demand); the harness reuses the session so later navs are fast.
- **Widgets/LLM need config:** dashboard renders widgets from `db.sqlite`, chat needs a model+key; a bare boot still renders the shell.

## Troubleshooting

- **`command not found: timeout`** — macOS lacks GNU `timeout`; poll with `seq`/`sleep` (harness does) or install coreutils for `gtimeout`.
- **Landed on an unexpected port** — 3000 was taken; normal. Read the port from `/tmp/yaawc-dev.log`, or `kill $(lsof -ti:3000)` to force 3000.
- **Server never comes up** — `tail -20 /tmp/yaawc-dev.log`; usually missing `config.toml` or a drizzle/`db.sqlite` error.
- **`playwright-cli` not found** — use `npx playwright-cli`.
