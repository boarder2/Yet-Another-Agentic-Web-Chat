# Configuration

YAAWC reads deployment settings from a TOML file and selected environment variables. The file contains infrastructure settings and the encryption passphrase; model and search credentials, provider URLs, model choices, retention, visibility, and other application settings are managed in the web UI.

## Configuration file and precedence

Create `config.toml` from `sample.config.toml` in the server's working directory. By default YAAWC reads `config.toml` from `process.cwd()`. Set `CONFIG_PATH` to use a different file. The file must be readable and valid TOML wherever the server loads configuration.

Environment variables are process inputs, not additional TOML sections. The supported overrides are:

| Environment input       | Precedence and default                                                                                                                                    | Scope                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `CONFIG_PATH`           | Uses the supplied path; otherwise `config.toml` in the working directory.                                                                                 | Selects the TOML file.                                                              |
| `BASE_URL`              | A non-empty value overrides `[GENERAL].BASE_URL`; otherwise the file value is used.                                                                       | Public URL construction, including OpenSearch and MCP OAuth callbacks.              |
| `ENCRYPTION_PASSPHRASE` | An explicitly present value overrides `[SECURITY].ENCRYPTION_PASSPHRASE`, including an empty value.                                                       | Credential encryption and the encryption gate.                                      |
| `SEARXNG_API_URL`       | A non-empty value overrides the SearXNG URL stored in Settings. Docker Compose sets `http://searxng:8080`. There is no other application default.         | Server-side SearXNG requests.                                                       |
| `DATA_DIR`              | The application runtime defaults to `<working directory>/data`; Docker Compose sets `/home/yaawc/data`.                                                   | SQLite, uploads, and workspace-file storage. See [Data directory](#data-directory). |
| `PORT`                  | The Docker image and the repository's `dev`/`start` scripts use port `5005`. Those scripts pass `-p 5005`, so changing `PORT` alone does not change them. | HTTP listener and the matching container/host port mapping.                         |
| `DOCKER_GID`            | Not read by YAAWC. When the commented Compose `group_add` entry is enabled, its interpolation fallback is `999`.                                          | Adds the app container to the host Docker socket's group.                           |

For `BASE_URL` and `SEARXNG_API_URL`, an empty environment value falls back to the file or database value because the runtime uses a non-empty override. An explicitly empty `ENCRYPTION_PASSPHRASE` environment value instead forces the unconfigured state.

## TOML fields

### `[GENERAL]`

`BASE_URL` is an optional string and defaults to an empty string. When it is empty, OpenSearch URL generation detects the request origin and honors reverse-proxy headers. When it is set, YAAWC uses the configured value after removing trailing slashes where an origin is generated.

### `[SECURITY]`

`ENCRYPTION_PASSPHRASE` is required for normal use. It is never generated automatically. YAAWC derives an AES-256-GCM key from it to encrypt provider and search API keys and MCP authentication values in the database. Without a non-empty passphrase, the encryption gate blocks normal use and credential writes return an error.

Keep the passphrase stable and back it up separately from the database. Changing it creates a different key: existing encrypted values cannot be decrypted and are treated as unavailable until the credentials are entered again.

### `[TOOLS.CODE_EXECUTION]`

Code execution is disabled by default and requires a reachable Docker daemon. The fields in `sample.config.toml` are:

| Field              | Default                       | Behavior and validation                                                                                                                                                        |
| ------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ENABLED`          | `false`                       | Enables the code-execution tool when the rest of the configuration is valid.                                                                                                   |
| `DOCKER_IMAGE`     | `node:24-alpine`              | Must match the official `node` image form `node[:tag][@sha256:digest]`. An invalid value disables code execution and exposes a validation error.                               |
| `DOCKER_HOST`      | `unix:///var/run/docker.sock` | Must be the default Unix socket or an explicit `http(s)` proxy URL with a hostname and optional port. An invalid value disables code execution and exposes a validation error. |
| `TIMEOUT_SECONDS`  | `30`                          | Per-container execution timeout.                                                                                                                                               |
| `MEMORY_MB`        | `128`                         | Per-container memory and swap limit in megabytes.                                                                                                                              |
| `MAX_OUTPUT_CHARS` | `50000`                       | Default stdout and stderr cap for code execution.                                                                                                                              |

The loader supplies the defaults above when fields are omitted. It validates the image and Docker host but does not range-check the numeric limits. Docker-backed code execution also fails closed when the daemon cannot be reached. Code widgets use the same timeout and memory settings while applying their own output limit.

## Database-backed settings and credentials

The database is the runtime source of truth for settings that used to live in `config.toml`:

- Model and search provider API keys are encrypted rows in the `credentials` table.
- Provider and search endpoint URLs, provider selection, locale, model visibility, retention, image generation, embedding selection, memory-model selection, mapping settings, and other Settings values are rows in `app_settings`.
- The active Chat and System model choices are selected by the composer or saved workflow, schedule, workspace, and preset settings.

Manage these values in Settings rather than adding new TOML fields. Legacy provider, search, and migrated setting fields may still be read once during boot migration for existing installations, but they are not the runtime source of those values. Device-local appearance preferences remain local to the browser.

## Mapping services

Mapping is disabled by default and is configured under **Settings → Mapping**, not in `config.toml`. The shipped OpenStreetMap-compatible geocoder, places, routing, and tile defaults are visible there but cannot be contacted until mapping is enabled and the public-service acknowledgement is accepted. Operators may replace the endpoints with self-hosted services; explicit mapping enablement is still required. Routing profiles and tile attribution are validated before a provider call. The Mapping section also controls the separate saved-location provider opt-in and clears the durable coarse-locality/public-business cache.

## Data directory

At runtime, `DATA_DIR` contains:

- `db.sqlite` — chats, runs, settings, encrypted credentials, memories, workspaces, workflows, schedules, artifacts, narration cache, and other database records.
- `uploads/` — uploaded and generated image files plus extracted upload data.
- `workspace-files/` — content-addressed workspace-file blobs.

YAAWC creates `uploads/` and `workspace-files/` when the data-directory module loads. `config.toml` is separate from this directory. In the Docker Compose setup, the `app-data` volume is mounted at `/home/yaawc/data`, while `config.toml` is mounted separately.

There is an intentional default mismatch in the current implementation: the application reads the database from `<working directory>/data/db.sqlite` when `DATA_DIR` is unset, while `drizzle.config.ts` gives `drizzle-kit` `<working directory>/db.sqlite` when it is unset. This has not been changed. For manual database, build, and runtime commands, always use one explicit value:

```bash
export DATA_DIR="$PWD/data"
npm run db:push       # optional; npm run build runs this step too
npm run build
npm start
```

Use the same exported `DATA_DIR` for `npm run dev`, `npm run db:push`, and any other command that reads or writes the database. Otherwise Drizzle commands and the running application can operate on different SQLite files.

## Docker setup and trust boundary

The Compose file starts the app and SearXNG on the `yaawc-network`, publishes the app on host port `5005`, sets `DATA_DIR=/home/yaawc/data`, and supplies `SEARXNG_API_URL=http://searxng:8080`. The app image runs as the unprivileged `node` user. `SYS_ADMIN` is present for the Playwright browser sandbox and is separate from code-execution access.

To enable Docker-backed code execution in Compose:

1. Uncomment `/var/run/docker.sock:/var/run/docker.sock` under the app volumes.
2. Find the socket's group ID with `stat -c '%g' /var/run/docker.sock`.
3. Uncomment `group_add` and start Compose with `DOCKER_GID` set to that value.
4. Set `TOOLS.CODE_EXECUTION.ENABLED = true` in `config.toml` and restart the app.

The code-execution runner creates sibling containers through the mounted host daemon. The sandbox drops capabilities, disables networking, uses a read-only root filesystem, and applies resource limits, but access to the Docker socket is still a host-level trust boundary. Only enable it for a deployment whose app, configuration, and users are trusted; Docker socket access must not be treated as a complete host-isolation guarantee.

## TTS worker controls

Neural voice uses the local Kokoro model on CPU. Synthesis normally runs in one lazy, serialized worker process so it does not compete with the web server; the worker is stopped after an idle period and starts again on demand. The model is downloaded into the Transformers cache on first use.

| Environment input     | Default                                               | Effect                                                                                                                                                                     |
| --------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TTS_WORKER_DISABLED` | unset (`false`)                                       | `1`, `true`, or `yes` (case-insensitive) skips the worker and synthesizes in-process. If the worker cannot start before producing audio, YAAWC also falls back in-process. |
| `TTS_WORKER_CPUS`     | unset                                                 | On Linux, supplies the `taskset` CPU list. It overrides `TTS_RESERVED_CORES`.                                                                                              |
| `TTS_RESERVED_CORES`  | approximately 25% of CPUs, at least one when possible | On Linux, reserves this many cores for the server and assigns the remaining cores to the worker. Systems with two or fewer CPUs do not carve out a set.                    |
| `TTS_WORKER_NICE`     | `15`                                                  | On Linux, the `nice` increment for the worker when `nice` is available. Values from `0` to `19` are intended; `0` leaves the priority unchanged.                           |
| `TTS_WORKER_IDLE_MS`  | `600000` (10 minutes)                                 | Stops the idle worker after this many milliseconds to reclaim model memory. `0` or a negative value keeps it alive.                                                        |
| `TTS_DTYPE`           | `q4`                                                  | Dtype passed to the worker's Kokoro model loader. The in-process implementation uses `q4` directly.                                                                        |
| `TTS_DEBUG`           | disabled                                              | `1`, `true`, or `yes` enables per-chunk Kokoro debug logging when synthesis runs in-process. Warnings are logged regardless.                                               |

CPU affinity and niceness are Linux optimizations; if the required host utilities are unavailable, synthesis can fall back to the in-process path. `TTS_WORKER_CPUS` is a CPU-list string, and the source does not validate it before passing it to `taskset`. The worker serializes its own jobs; the in-process fallback does not use that worker isolation.

## Validation and recovery

- A missing, unreadable, or invalid TOML file prevents configuration reads; check `CONFIG_PATH`, file permissions, and TOML syntax first.
- A missing passphrase leaves the encryption gate active. Set a non-empty passphrase and restart before saving credentials.
- A changed passphrase makes previously encrypted credentials unreadable. Restore the original passphrase or re-enter those credentials.
- An invalid code-execution image or Docker host disables code execution instead of accepting the unsafe value; inspect the server log and the configuration error.
- A stopped Docker daemon, missing socket, incorrect `DOCKER_GID`, or unreachable SearXNG endpoint makes only the dependent feature unavailable; verify the service and the corresponding environment/Settings value.
- If data appears empty after a manual command, stop and check that every Drizzle, build, and runtime command used the same explicit `DATA_DIR` before creating or migrating another database.
