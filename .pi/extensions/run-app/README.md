# /app — explicit YAAWC dev server control

A project-local Pi extension for starting, stopping, inspecting, and viewing the local
YAAWC development server. It never starts the app automatically.

## Commands

- `/app:start` — validate the project, attach to a healthy YAAWC already on localhost:5005–5015, or start `npm run dev` with an explicit `DATA_DIR`.
- `/app:stop` — stop only a server owned by this extension and close its validated logs pane.
- `/app:status` — report lifecycle, ownership, process, URL/port, health, `DATA_DIR`, log, and tail-pane metadata.
- `/app:logs` — in the Pi TUI, open the complete latest `/tmp/yaawc-dev.log` in `less +G`.
- `/app:logs-tail` — in an ordinary Herdr session, split a right-hand pane and follow the owned log.

The extension requires Linux or macOS to start a server. `package.json`, `node_modules`,
and `config.toml` must already exist; it does not install packages, create config, or run
migrations. A child inherits `DATA_DIR` when set, otherwise it receives `<project>/data`.
Owned starts use a detached POSIX process group and truncate the user-only log on each run.
State is atomic, user-only `.state.json` in this directory. The log can contain application
output and is never sent to the model or Pi transcript.

Healthy existing servers are external and are never stopped. Their output is not the
extension log; `/app:logs` labels any displayed extension output as stale when attached to
one. Ownership survives `/new`, `/resume`, `/reload`, and `/fork`; a normal `quit` stops
the controlling Pi's owned group with bounded escalation. A later Pi may adopt only after
the recorded controller is dead and the process identity is validated.

`/app:logs-tail` requires `HERDR_ENV=1`, `HERDR_DELEGATE` other than `1`, and
`HERDR_PANE_ID`. It creates only an ordinary shell pane titled `YAAWC logs`, never an agent,
and validates the recorded pane and tail command before focusing or closing it.

## Development

From the repository root:

```bash
npx vitest run --config .pi/extensions/run-app/vitest.config.ts
npx tsc -p .pi/extensions/run-app/tsconfig.json
```
