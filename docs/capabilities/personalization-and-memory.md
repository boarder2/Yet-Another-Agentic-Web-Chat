# Personalization and memory

Personalization changes how a response is written for the current user. Memory stores selected facts across conversations so later responses can use them. They are separate controls with separate privacy behavior.

## Personalize a response

Open **Settings → Personalization** to save an optional location and an **About Me** profile. The composer can enable or disable sending each saved value for a message. Location can improve regional relevance; profile text can influence explanations, examples, or tone.

The prompt layer tells the agent to treat personalization as private internal context and to keep it out of tool calls, web requests, and citations. The latest user message takes precedence when it conflicts with saved context. A private session strips both values even if they are enabled in Settings.

## Enable memory

Open **Settings → Memory** and enable the feature. The controls are independent:

- **Memory** enables the memory system.
- **Use saved memories in chats** retrieves semantically relevant saved facts for a response.
- **Automatic memory detection** asks the memory-processing model to identify facts worth saving after a response. It uses additional model calls and tokens.
- **Memory Processing Model** chooses the model used for extraction, categorization, deduplication, and conflict handling. It is independent of the Chat and System model picker.

Retrieved memory is limited to a small bounded context and is selected by embedding similarity. The agent can also save, delete, and list memories during a top-level chat when memory is enabled.

## Manage saved memories

Settings provides search, category filtering, sorting by creation date, last use, or use count, manual add, edit, delete, delete all, and re-index. Memories are categorized as Preference, Profile, Professional, Project, or Instruction. Automatic memories link to their source conversation when it still exists.

Changing the embedding model requires re-indexing memories. Memories whose vectors were created by another model are skipped until they are re-indexed. Re-indexing can use the selected embedding provider and may take time for a large memory store.

## Workspace memory

A workspace has its own Memory tab. Workspace memories are retrieved only in chats in that workspace, together with global memories. Non-workspace chats retrieve global memories only. Workspace auto-memory must be enabled separately in workspace settings; the instance memory controls still need to allow memory and automatic detection.

Deleting a workspace detaches its memories into the global scope instead of deleting them. Use the Memory settings or workspace Memory tab to remove them explicitly.

## Sensitive information and limits

Automatic extraction blocks content that matches common credit-card, Social Security number, API-key/token, or password patterns. Automatic detection can also skip, update, deduplicate, or remove conflicting facts. A user who manually adds a memory is responsible for deciding whether its content is appropriate; do not store secrets in memory.

Memory retrieval needs a configured embedding model and can fail independently of the main answer. When retrieval fails, the chat continues without the memory context. Memory is not used in private sessions or in the headless workflow and scheduled-run paths.

## Privacy and storage

Memories are stored separately from chat messages in the local YAAWC database. When retrieval or automatic detection is enabled, selected memory content is placed in model context for the configured model operation. Personalization and memory are not automatically sent to web, URL, image, or other retrieval tools. Private sessions do not retrieve, create, or expose memory content.

For provider data handling and private-session deletion, see [Privacy and data](./privacy-and-data.md). For the memory and embedding model choices, see [Models and providers](./models-and-providers.md).
