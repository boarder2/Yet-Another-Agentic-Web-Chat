# Configuration Guide

This guide covers all the configuration options available in YAAWC's `config.toml` file.

## Configuration File Structure

YAAWC uses a TOML configuration file (`config.toml`) to manage settings. Create a `config.toml` file in the project root based on the example configuration below.

`config.toml` holds only infrastructure config (Docker/code-execution) plus the required encryption passphrase. Everything else — model/search provider API keys, provider/search endpoint URLs, model visibility, retention, image generation, and model selection — is managed from the Settings page in the web UI and stored in the database.

## Configuration Sections

### [GENERAL]

General application settings.

#### BASE_URL

- **Type**: String
- **Default**: `""` (empty)
- **Description**: Optional base URL override. When set, overrides the detected URL for OpenSearch and other public URLs.

### [SECURITY]

#### ENCRYPTION_PASSPHRASE

- **Type**: String
- **Required**: Yes — never auto-generated
- **Description**: Passphrase used to derive the key (AES-256-GCM) that encrypts provider/search API keys and MCP auth at rest in the database. Until this is set, the app blocks usage and the Settings UI shows an error. Changing it later re-derives a different key, so existing encrypted credentials become unreadable and must be re-entered via Settings.

### [TOOLS.CODE_EXECUTION]

Configuration for the sandboxed code execution tool (requires Docker).

- **ENABLED**: Boolean, default `false`
- **DOCKER_IMAGE**: String, default `"node:24-alpine"` — any tag or digest of the official `node` image (e.g. `node:24-alpine@sha256:...`)
- **DOCKER_HOST**: String, default `"unix:///var/run/docker.sock"`
- **TIMEOUT_SECONDS**: Number, default `30`
- **MEMORY_MB**: Number, default `128`
- **MAX_OUTPUT_CHARS**: Number, default `50000`

## Settings Managed in the Database

The following are no longer configured via `config.toml` — manage them from the Settings page in the web UI:

- **Model & search provider API keys** — Settings → API Keys / Search Providers (encrypted at rest)
- **Provider/search endpoint URLs** (LM Studio, Custom OpenAI, SearXNG) — Settings → API Keys / Model Settings / Search Providers
- **Model selection** (embedding + memory-processing models) — Settings UI
- **Model visibility** (`HIDDEN_MODELS`) — Settings → Model Visibility
- **Retention policy**, including private session duration — Settings → Retention
- **Image generation** — Settings → Image Generation (its OpenRouter API key is encrypted in the database)

## Example Configuration

```toml
[GENERAL]
BASE_URL = ""

[SECURITY]
ENCRYPTION_PASSPHRASE = ""

[TOOLS.CODE_EXECUTION]
ENABLED = false
DOCKER_IMAGE = "node:24-alpine"
DOCKER_HOST = "unix:///var/run/docker.sock"
TIMEOUT_SECONDS = 30
MEMORY_MB = 128
MAX_OUTPUT_CHARS = 50000
```
