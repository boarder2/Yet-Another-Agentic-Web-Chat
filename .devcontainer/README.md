# Dev Container

A single-container VS Code Dev Container (image built from `Dockerfile`). SearXNG is not run locally; the container points at `https://searxng.int.bit-shift.com` unless you export `SEARXNG_API_HOST` (and optionally `SEARXNG_API_SCHEME`) on the host before opening the container — e.g. `SEARXNG_API_SCHEME=http SEARXNG_API_HOST=localhost:4000`.

## How to use

1. Install **Docker Desktop**.
2. In VS Code, run **Dev Containers: Reopen in Container** (a local clone) or **Dev Containers: Clone Repository in Container Volume** (no host clone). Both work.
3. Once the container is ready: `npm run dev` → http://localhost:5005

## Notes

- The workspace lives at `/workspaces/YAAWC` — bind-mounted from the host, or from the clone volume in volume mode.
- SQLite + uploads + deep research artifacts persist in the `yaawc-data`, `yaawc-uploads`, and `yaawc-deep-research` volumes (not written into your git workspace).
- Claude Code (`~/.claude`, `~/.claude.json`), opencode, herdr, and Zsh history persist in `yaawc-user-state`.
- `config.toml` is read from the workspace root (it is gitignored).
