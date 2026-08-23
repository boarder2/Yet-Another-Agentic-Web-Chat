---
name: yaawc-workspace-files
description: 'Workspace files: content-addressed blobs, CAS conflicts, agent tools, routes/UI, path safety, and cleanup.'
---

# Workspace Files

Workspace files are durable, workspace-scoped metadata rows plus bytes under `WORKSPACE_FILES_ROOT`. They are distinct from temporary chat attachments and artifact HTML. `src/lib/workspaces/files.ts` is the storage façade; `service.ts` owns workspace CRUD/archive.

## Storage and path invariants

Every blob path is `<root>/<workspace UUID>/<file UUID>/<64-char lowercase sha256>`. Use `src/lib/workspaces/paths.ts` for every derived path:

- `validateFilename()` permits one safe path component and rejects empty/overlong names, `.`, `..`, separators, NUL, and traversal forms.
- Containment guards apply even to derived UUID/SHA segments.
- SHA is a version stamp/content address within one file, not global deduplication; identical bytes in different files retain separate blobs.
- `stageBlob()` hashes and writes a temporary blob before the DB mutation. The row insertion/update is the publish point.

`replaceFile()` is mandatory compare-and-swap. It updates only when workspace ID, file ID, and current SHA match `expectedSha`; a miss throws `ConflictError(currentSha)`. Remove a losing staged blob and remove the replaced blob after a successful version change. A crash may leave an unreferenced staged blob, which workspace deletion cleans up.

Every writer—human or agent—must send the SHA it actually read. Never silently overwrite or invent last-write-wins behavior.

## Reading and limits

Reads and listings are workspace-scoped and derive blob locations from the row. Text extraction is cached by SHA; NUL-free bytes are UTF-8, while PDF/DOCX use the extraction adapter. Binary sniffing checks the initial bytes.

Preserve current limits unless explicitly changing the capability contract:

- API upload/replace: 10 MiB.
- Agent create/edit: 350 changed or created lines.
- `workspace_read`: explicit range required above 500 lines.
- `workspace_grep`: 64 KiB output, 200 matches, regex work isolated behind a timeout.

## Agent tools and approvals

`src/lib/tools/workspace/` owns `workspace_ls`, `workspace_read`, `workspace_grep`, `workspace_create_file`, and `workspace_edit`. `composeSystemPrompt.ts` advertises this exact set for an active `workspaceId`.

Create/edit require an interactive session and emitter. Mutations pause for approval unless workspace/file policy auto-accepts. File-level policy overrides workspace defaults. Edit uses an exact match, requires uniqueness unless `replaceAll`, caps replacements, snapshots freshness around approval, and finally calls CAS. Cancellation, rejection, stale state, and conflicts return structured errors. Successful mutations emit `workspace_file_changed`.

Workspace reads must never cross workspace boundaries. Image reads inject image content only for a vision-capable model; grep skips images.

## API and UI

Routes under `src/app/api/workspaces/` provide workspace CRUD/archive and file list/create/read/raw/replace/delete/policy updates. A missing `expectedSha` is a bad request; stale SHA returns 409 with `currentSha`.

`FilesTab` handles upload, note creation, deletion confirmation, and per-file approval mode. `FileViewer` keeps the loaded SHA/content as the draft base:

- Adopt remote content only when the local draft is disposable.
- Preserve dirty drafts and show conflict state.
- Save against the draft's base SHA.
- On 409, refetch the winner; an explicit overwrite retries against that newly observed SHA.

The UI treats detected binary files as read/download-only. Preserve that boundary; agent/API replacement paths require extra care because extraction and the current NUL sniff do not by themselves prove bytes are safely editable text. The raw route serves the stored MIME inline today, so HTML/SVG handling is an active-content security boundary. Keep UI data access in TanStack Query hooks via `apiFetch` and `qk`.

## Lifecycle

Archive changes listing visibility only. Workspace deletion removes file rows and the complete per-workspace tree, including crash orphans; related chats/memories follow their own detach semantics.

`migrateWorkspaceBlobs()` is the idempotent boot migration from the legacy shared-blob layout. Copy/link placement failures retain the legacy tree for retry. Rows whose legacy source is already missing are reported as orphaned but cannot be recovered and do not currently block legacy-tree removal.

## Verification

Start with `src/lib/workspaces/paths.test.ts`. Add focused tests for changed CAS/cleanup, extraction, grep, approval, or stale-state behavior. Verify invalid/duplicate/oversize names, cross-workspace isolation, concurrent 200-versus-409 saves, dirty-draft preservation, raw bytes, policy precedence, archive, migration, and deletion.

Related skills: `yaawc-database` for metadata/schema; `yaawc-streaming-events` for approvals and `workspace_file_changed`; `yaawc-api-endpoints` for route conventions; `yaawc-artifacts` for workspace-owned artifact lifecycle; `yaawc-design-system` and `yaawc-frontend-architecture` for workspace UI.
