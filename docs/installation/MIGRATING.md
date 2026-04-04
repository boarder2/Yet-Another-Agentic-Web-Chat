# Migrating from Perplexica to YAAWC

This guide helps existing Perplexica users transition to YAAWC (Yet Another Agentic Web Chat, pronounced "yawck").

## What Changed?

YAAWC is a direct continuation of the Perplexica codebase under new branding. **All functionality, API endpoints, and configuration options remain the same.** The core changes are cosmetic and infrastructure-level:

| Area                        | Perplexica                                          | YAAWC                                     |
| --------------------------- | --------------------------------------------------- | ----------------------------------------- |
| Project name                | Perplexica                                          | YAAWC (Yet Another Agentic Web Chat)      |
| Repository                  | `ItzCrazyKns/Perplexica`                            | `boarder2/Yet-Another-Agentic-Web-Chat`   |
| Docker image name           | `perplexica`                                        | `yaawc`                                   |
| Docker network              | `perplexica-network`                                | `yaawc-network`                           |
| Docker container path       | `/home/perplexica`                                  | `/home/yaawc`                             |
| npm package name            | `perplexica-frontend`                               | `yaawc`                                   |
| Cache directories           | `perplexica-webcache`, `perplexica-embedding-cache` | `yaawc-webcache`, `yaawc-embedding-cache` |
| Dashboard localStorage keys | `perplexica_dashboard_*`                            | `yaawc_dashboard_*`                       |
| Browser page titles         | "Perplexica"                                        | "YAAWC"                                   |
| Agent identity in prompts   | "You are Perplexica..."                             | "You are YAAWC..."                        |
| User-Agent header           | `Perplexica/1.0`                                    | `YAAWC/1.0`                               |

## API Endpoints

**No API endpoints have changed.** All routes (`/api/chat`, `/api/models`, etc.) remain identical in path, method, and payload format.

## Configuration

**`config.toml` format is largely unchanged.** Your existing `config.toml` works as-is. New optional sections have been added (`[MODELS.AIMLAPI]`, `[MODELS.OPENROUTER]`) and a `HIDDEN_MODELS` field under `[GENERAL]`, but these are not required and default to empty values.

## Migration Steps

### Docker Users

1. **Stop the old stack:**

   ```bash
   docker compose down
   ```

2. **Clone the new repository:**

   ```bash
   git clone https://github.com/boarder2/Yet-Another-Agentic-Web-Chat.git
   cd Yet-Another-Agentic-Web-Chat
   ```

3. **Copy your config:**

   ```bash
   cp /path/to/old/perplexica/config.toml ./config.toml
   ```

4. **Migrate Docker volumes** (to preserve your data):

   The Docker volume names in `docker-compose.yaml` use generic names (`backend-dbstore`, `uploads`, `deep_research`), so if you were using the default names, your data is already compatible. If you had custom volume names prefixed with `perplexica_`, you can either:
   - **Option A**: Update `docker-compose.yaml` to reference your old volume names
   - **Option B**: Copy data to new volumes:

     ```bash
     # Create new volumes and copy data
     docker volume create yaawc_backend-dbstore
     docker volume create yaawc_uploads
     docker volume create yaawc_deep_research

     docker run --rm \
       -v perplexica_backend-dbstore:/source:ro \
       -v yaawc_backend-dbstore:/dest \
       busybox sh -c 'cp -a /source/. /dest/'

     docker run --rm \
       -v perplexica_uploads:/source:ro \
       -v yaawc_uploads:/dest \
       busybox sh -c 'cp -a /source/. /dest/'

     docker run --rm \
       -v perplexica_deep_research:/source:ro \
       -v yaawc_deep_research:/dest \
       busybox sh -c 'cp -a /source/. /dest/'
     ```

5. **Start the new stack:**

   ```bash
   docker compose up -d
   ```

### Non-Docker Users

1. **Clone the new repository:**

   ```bash
   git clone https://github.com/boarder2/Yet-Another-Agentic-Web-Chat.git
   cd Yet-Another-Agentic-Web-Chat
   ```

2. **Copy your config and data:**

   ```bash
   cp /path/to/old/perplexica/config.toml ./config.toml
   cp /path/to/old/perplexica/data/db.sqlite ./data/
   cp -r /path/to/old/perplexica/uploads/ ./uploads/
   ```

3. **Install and build:**

   ```bash
   npm install
   npm run build
   npm run start
   ```

### Dashboard Settings

Dashboard widget configurations are stored in browser localStorage. The key names changed from `perplexica_dashboard_*` to `yaawc_dashboard_*`. **YAAWC automatically migrates these keys** the first time the dashboard loads — no manual action is needed. The old keys are removed after migration.

### Browser Search Engine

If you added Perplexica as a browser search engine, update the URL from your old instance to the new one. The URL format remains `http://your-host:3000/?q=%s`.

## Breaking Changes

**None.** YAAWC is fully backward-compatible with Perplexica at the data and API level. The SQLite database schema is unchanged, uploaded files are compatible, and all API request/response formats are identical. New optional config sections (`[MODELS.AIMLAPI]`, `[MODELS.OPENROUTER]`) and the `HIDDEN_MODELS` setting were added but do not break existing configurations.
