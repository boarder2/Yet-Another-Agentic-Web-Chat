# Coverage Matrix

Route/page → spec mapping for the e2e suite. Kept in sync with `e2e/api/*.spec.ts` and `e2e/tests/*.spec.ts` as specs are added — when you add or rename a spec that changes what's covered, update this file in the same change.

## API routes → specs

| Route group                                                                                       | Spec                          | Notes                                                                                                                      |
| ------------------------------------------------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `chat`, `chat/cancel`, `chat/compact`, `chat/runs/*`                                              | `api/chat.spec.ts`            | happy path, tool loop (single + multi-step), cancel/compact/resume/replay, incl. the `test-ask-user` interrupt/resume flow |
| `chats` (+`[id]`, `[id]/seen`, `search`)                                                          | `api/chats.spec.ts`           |                                                                                                                            |
| `approvals/pending`                                                                               | `api/approvals.spec.ts`       | empty/filter branch + a real pending approval scoped by chatId                                                             |
| `respond-now`                                                                                     | `api/respond-now.spec.ts`     |                                                                                                                            |
| `autocomplete`                                                                                    | `api/autocomplete.spec.ts`    |                                                                                                                            |
| `suggestions`                                                                                     | `api/suggestions.spec.ts`     |                                                                                                                            |
| `config`, `models`                                                                                | `api/config.spec.ts`          |                                                                                                                            |
| `opensearch`                                                                                      | `api/opensearch.spec.ts`      |                                                                                                                            |
| `settings`                                                                                        | `api/settings.spec.ts`        |                                                                                                                            |
| `tools`                                                                                           | `api/tools.spec.ts`           |                                                                                                                            |
| `memories` (+`[id]`, `reindex`)                                                                   | `api/memories.spec.ts`        |                                                                                                                            |
| `skills` (+`[id]`)                                                                                | `api/skills.spec.ts`          |                                                                                                                            |
| `system-prompts` (+`[id]`)                                                                        | `api/system-prompts.spec.ts`  |                                                                                                                            |
| `workspaces` (+`[id]`, `files`, `urls`, `archive`/`unarchive`, `system-prompts`)                  | `api/workspaces.spec.ts`      |                                                                                                                            |
| `scheduled-tasks` (+`[id]`, `[id]/run`, `[id]/runs`, `runs`, `runs/unread`, `runs/[chatId]/view`) | `api/scheduled-tasks.spec.ts` | `run` uses the mocked model; cron scheduling itself is not exercised                                                       |
| `dashboard/process-widget`                                                                        | `api/dashboard.spec.ts`       | LLM path mocked                                                                                                            |
| `dashboard/process-code-widget`                                                                   | `api/dashboard.spec.ts`       | validation only — needs Docker (out of scope)                                                                              |
| `mcp/servers` (+`[id]`, `[id]/test`)                                                              | `api/mcp-servers.spec.ts`     | CRUD + validation; `test` route asserts unreachable-server error shape                                                     |
| `mcp/servers/[id]/tools`, `[id]/authorize`, `mcp/oauth/callback`                                  | —                             | not covered — live/OAuth connect (out of scope)                                                                            |
| `tts`, `tts/stream`                                                                               | `api/tts.spec.ts`             | validation + prep-id issuance only — no real synthesis                                                                     |
| `uploads`                                                                                         | `api/uploads.spec.ts`         | validation + one real `.txt` happy path + structured-output topic generation (`test-structured`)                           |
| `images`                                                                                          | `api/images.spec.ts`          | validation only — no real generation                                                                                       |
| `videos`                                                                                          | `api/videos.spec.ts`          | validation only — no real generation                                                                                       |
| `messages/[messageId]`                                                                            | —                             | **gap** — no spec                                                                                                          |

## Pages → specs

| Page                                                       | Spec                                                                                                                     | Notes                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `/` (Home), `/c/[chatId]`                                  | `tests/chat.spec.ts`, `tests/navigation.spec.ts`, `smoke/home.spec.ts`                                                   |                                                              |
| `/dashboard`                                               | `tests/dashboard.spec.ts`, `tests/navigation.spec.ts`                                                                    |                                                              |
| `/workspaces`, `/workspaces/[id]`                          | `tests/workspaces.spec.ts`, `tests/navigation.spec.ts`, `smoke/home.spec.ts`                                             |                                                              |
| `/workspaces/[id]/c/[chatId]`, `/c/new`, `/files/[fileId]` | —                                                                                                                        | **gap** — reached only indirectly, not driven directly       |
| `/history`                                                 | `tests/library-history.spec.ts`, `tests/navigation.spec.ts`, `smoke/home.spec.ts`                                        |                                                              |
| `/scheduled-tasks`                                         | `tests/navigation.spec.ts`                                                                                               | list route only — nav smoke, not the create/edit/manage flow |
| `/scheduled-tasks/manage`, `/new`, `/manage/[id]/edit`     | —                                                                                                                        | **gap** — no dedicated spec                                  |
| Settings (page + modal)                                    | `tests/navigation.spec.ts`, `tests/settings-depth.spec.ts`, `tests/settings-persistence.spec.ts`, `tests/memory.spec.ts` |                                                              |
| Agent Panel composer                                       | `tests/agent-panel.spec.ts`                                                                                              |                                                              |
| Model picker                                               | `tests/model-picker.spec.ts`                                                                                             |                                                              |

## Out of scope (and why)

| Subsystem                                                    | Why skipped                  | Still covered                                       |
| ------------------------------------------------------------ | ---------------------------- | --------------------------------------------------- |
| Dashboard code-widget (`/api/dashboard/process-code-widget`) | needs Docker sandbox         | LLM-widget path (mocked), input validation          |
| MCP remote servers + OAuth (`/api/mcp/*`)                    | needs live remote server     | CRUD/validation on `/api/mcp/servers` only          |
| TTS audio (`/api/tts*`)                                      | external synth + audio bytes | request validation / error shape                    |
| Images / videos / `uploads/images`                           | external gen / binary        | request validation only                             |
| SearXNG-backed tools (`web_search`, image/video search)      | needs a live/stubbed SearXNG | not covered — see `.ai/plan/test.md` Segment 8 note |

## Known gaps (not out-of-scope, just not yet written)

- `GET /api/messages/[messageId]` has no spec.
- `mcp/servers/[id]/tools` (list live tools) has no spec.
- `/scheduled-tasks/manage`, `/scheduled-tasks/new`, `/scheduled-tasks/manage/[id]/edit` have no dedicated UI spec (only reached via nav smoke to the list page).
