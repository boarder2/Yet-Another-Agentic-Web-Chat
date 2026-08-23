---
name: yaawc-artifacts
description: 'Agent-authored artifacts: ownership, immutable versions, tool flow, viewer, raw-route CSP, and rewind semantics.'
---

# Artifacts

Artifacts are agent-authored, self-contained HTML documents stored beside a chat. A chat-scoped artifact belongs to one chat; an artifact created in a workspace chat is workspace-owned and shared across that workspace's chats. Every successful write is a complete immutable version anchored to the assistant message that produced it.

## Persistence and ownership

`src/lib/artifacts/service.ts` owns artifact reachability and lifecycle:

- The creating chat always reaches its chat-scoped artifacts. A workspace chat also reaches artifacts with its `workspaceId`.
- `createArtifact()` inserts the artifact and version 1 transactionally.
- `editArtifact()` reads the scoped latest version, applies one exact edit, and inserts a full successor snapshot in the same transaction.
- `readArtifact()` hides inaccessible artifacts as missing. Explicit invalid versions report the latest version.
- Chat deletion removes chat-scoped artifacts but only clears chat provenance from workspace artifacts. Workspace deletion removes its artifacts.
- Rewind cleanup removes versions anchored to rewound messages only for chat-scoped artifacts; one workspace chat must not roll back shared history.

Agent edits always target the latest version. Concurrent edits serialize, and each `oldStr` is matched against the latest content inside the transaction. There is no expected-version CAS: a stale edit can still succeed when its exact match remains unique. On no-match or ambiguity, reread instead of replacing blindly. `applyExactEdit.ts` rejects an empty `oldStr`, identical strings, no match, and ambiguous matches; an empty `newStr` is deletion.

## Agent tools

`src/lib/tools/agents/artifactTools.ts` defines `create_artifact`, `edit_artifact`, and `read_artifact`.

- Artifacts require interactive top-level chat context; private, subagent, and background runs are rejected.
- The assistant message ID—not the user message ID—anchors a version.
- Create/edit persist first, then emit `artifact_saved`; streaming owns the message card and viewer-open effect.
- HTML must be self-contained: inline CSS/JS/assets and no network dependency.
- After resume, compaction, a failed match, or workspace collaboration, reread before editing.

Prompt roster construction is transcript-derived. `src/lib/artifacts/mention.ts` parses canonical `@[title](artifact:<uuid>)` mentions; `roster.ts` combines persisted user mentions with chat-created artifacts and applies reachability. Do not add a separate reference cache/table.

## HTTP and security boundary

Routes live under `src/app/api/artifacts/`:

- Collection GET supports chat, workspace, and all-history filters.
- `[id]` returns metadata/versions; standalone deletion is workspace-only.
- `[id]/raw` is the only route serving artifact HTML. It validates versions, uses `no-store`, and applies `src/lib/artifacts/csp.ts`.

The raw response must retain an opaque-origin sandbox and block subresource/form/connect access: `default-src 'none'`, no `allow-same-origin`, and no popup escape. `allow-popups` still permits sandboxed navigation to external URLs, so do not describe it as blocking every possible navigation. Downloads inject the restrictive meta policy before agent-authored markup. Treat CSP or injection changes as security-boundary changes and test hostile markup.

## UI

`ArtifactViewer.tsx` is shared by the docked `ArtifactPanel` and standalone `ArtifactPage`. It owns preview/source, immutable version selection, download, and iframe rendering. Keep iframe sandbox permissions aligned with the response CSP. If a selected version disappears after rewind, fall back to latest.

`ArtifactCard` reopens the saved version; `ArtifactMention` renders stale/deleted references inert. `ArtifactBridgeContext` connects workspace navigation to a mounted chat panel/composer and unregisters handlers by identity.

## Verification

Use focused tests first:

- `src/lib/artifacts/applyExactEdit.test.ts`
- `src/lib/artifacts/mention.test.ts`
- `src/lib/artifacts/csp.test.ts`

Add service/API/UI coverage at the changed boundary. Verify scope isolation, workspace cross-chat access, stale edit handling, rewind semantics, raw and download CSP headers, version fallback, and workspace-only deletion.

Related skills: `yaawc-streaming-events` for `artifact_saved` and envelopes; `yaawc-database` for schema/lifecycle changes; `yaawc-workspace-files` for workspace ownership/navigation; `yaawc-api-endpoints` for shared route conventions; `yaawc-design-system` and `yaawc-frontend-architecture` for viewer UI.
