# Files and workspaces

YAAWC has two related file workflows: temporary documents attached to a chat for research, and durable files stored inside a workspace. A workspace also groups chats, instructions, memories, artifacts, and model settings for a project.

## Research attached documents

The composer accepts `.pdf`, `.docx`, and `.txt` documents. Upload processing extracts text, splits it into searchable sections, creates semantic topics, and indexes the sections with the embedding model selected in **Settings → Model Settings**. The agent can then use `file_search` in Local Research, or alongside Web Search when files are attached.

Attached documents remain associated with the chat. File-search results include the filename and relevant excerpts so the answer can cite the document rather than only relying on the model.

## Attach images

PNG, JPEG, GIF, and WebP images can be attached when the selected Chat model is marked as vision-capable. Images can be selected through the attach control or pasted from the clipboard. Each uploaded image is limited to 10 MB. Image analysis can also inspect a direct image URL when the active agent has that tool.

A vision-capable selection is a model capability flag; it does not make a non-vision provider accept image input. A workspace model override controls this flag for workspace chats.

## Create a workspace

Open `/workspaces` and choose **New Workspace**. A workspace can have:

- A name, description, color, and icon.
- Chats created at `/workspaces/<workspace-id>/c/new`.
- Uploaded files and empty text or Markdown notes.
- Free-text instructions and linked persona or system prompts applied to every workspace chat.
- Workspace-scoped memories, separate from global memories.
- A workspace-specific Chat and System model override, including context window and vision settings.
- Auto-memory and auto-accept file-edit controls.
- Workspace-owned artifacts and generated images.

The workspace sidebar exposes Files, Artifacts, Instructions, and Memory beside a workspace chat. The workspace detail page exposes the same areas as tabs on smaller screens.

## Work with workspace files

Workspace uploads are limited to 10 MB per file. Text files can be viewed and edited in the app; Markdown is rendered as Markdown and common source/config files use syntax highlighting. PDF and DOCX files can be text-extracted for text operations and search. Images and unsupported binary files can be stored and viewed when supported, but are not editable or searchable as text.

The agent can list, read, grep, create, and edit workspace files in an interactive workspace chat. File edits and creates normally pause for approval. Auto-accept can be enabled at the workspace level, with a per-file override; use it only when the workspace's instructions and files are trusted.

Every file replacement uses the version the editor read. If another write wins first, the save fails with a conflict instead of silently overwriting it. Refresh the file, compare the versions, and save against the current content when you intend to replace it.

## Workspace availability and boundaries

- Workspace memory retrieval includes global memories and memories belonging to that workspace. An unscoped chat retrieves global memories only.
- A workspace-pinned model is enforced by the server. If either pinned model is unavailable, the composer reports that the workspace model is unavailable until the pin is changed or the provider is restored.
- Workspace tools are scoped to the active workspace. A workspace file or memory is not exposed to another workspace through normal agent lookup.
- Workflows and scheduled tasks use their saved configuration rather than the current workspace. See [Automation](./automation.md).

## Privacy and storage

Chat attachments, workspace files, extracted text, and embeddings are stored in the YAAWC data directory used by the deployment. Sending a file to a model or retrieval provider sends the content needed for that operation to the configured endpoint. Workspace instructions and memories are also model context when their features are enabled.

Deleting a workspace removes its files, workspace-owned artifacts, and workspace-owned generated images. Its chats and memories are detached from the workspace rather than deleted. Archiving only hides a workspace from the active list. See [Privacy and data](./privacy-and-data.md) for deletion and retention controls.

## If file research does not work

- **Upload rejected:** use PDF, DOCX, or TXT for chat attachments, or stay within the 10 MB workspace-file limit.
- **No searchable content:** the file may be binary, empty, encrypted, malformed, or a format without text extraction support.
- **No relevant sections:** lower similarity does not produce a citation; rephrase the query or check the document content.
- **Embedding mismatch:** attached documents indexed with a different embedding model can be skipped. Select the intended model and re-upload the affected chat documents so they are indexed with it.
- **Save conflict:** another agent or editor changed the file. Reload before saving, or explicitly choose the current version when overwriting.
- **Model unavailable:** check the workspace model override and the provider configuration.

See [Models and providers](./models-and-providers.md) for embedding prerequisites and [Agent capabilities](./agent-capabilities.md) for workspace-tool approvals.
