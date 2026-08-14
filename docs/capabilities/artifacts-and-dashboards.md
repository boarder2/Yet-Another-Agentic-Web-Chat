# Artifacts and dashboards

YAAWC has two ways to keep useful output beside a conversation: agent-authored Artifacts and configurable dashboard or home widgets. Generated images also appear in the shared History view.

## Create and use artifacts

Ask an eligible chat to create a self-contained HTML document such as a report, dashboard, mini application, or visualization. The agent can create a document, read its current content, and apply an exact edit to a selected string. Each successful write creates a complete immutable version anchored to the assistant message that made the write.

Artifacts are reachable from the chat side panel, the workspace Artifacts area, and `/workspaces/<workspace-id>/artifacts/<artifact-id>` when they belong to a workspace. Use the composer `@` mention picker or the workspace artifact list to mention an existing document in another workspace chat.

Ownership is determined by the chat:

- In an unscoped chat, the artifact belongs to that chat and is removed with it.
- In a workspace chat, the workspace owns the artifact. Other chats in that workspace can read and edit it, and deleting the originating chat does not delete it.
- Private chats do not expose artifact tools, so they do not create durable artifacts.

The viewer can switch between rendered preview and source, browse versions, download HTML, and open a version in a new tab. Artifact HTML is served with a restrictive policy: no network connections or forms, an opaque sandbox origin, and only data/blob media. Inline code still comes from the agent, so review generated content before treating it as trusted.

## Generated images

When Image Generation is enabled, the agent can create a PNG, JPEG, GIF, or WebP image from a prompt through the configured OpenRouter image model. The image is attached to the assistant turn and stored as a durable generated-image record for the chat or workspace. Images are listed in History and are removed with the owning chat or workspace according to their scope. See [Models and providers](./models-and-providers.md).

## Add a dashboard widget

Open `/dashboard` or use the widget controls on the home page. Widgets can be shown on the Dashboard, the home page, both, or neither; each surface has its own responsive layout. In edit mode you can add, move, resize, refresh, edit, hide, convert, export, import, or delete widgets. View mode shows their content without management controls.

### AI widgets

An AI widget fetches one or more **Web Page** or **HTTP Data** sources, substitutes source content and date variables into a prompt, and processes the result with a selected Chat model and provider. You can choose the available helper tools for the widget and set a refresh interval in minutes or hours. A preview runs before the widget is saved.

A widget accepts at most 8 sources. Each source is bounded to 300,000 characters. Source URLs are fetched by the server, and HTTP data is fetched as raw response text; use only URLs you trust. The widget cache is used until its refresh interval expires, while **Refresh All Widgets** bypasses the cache.

### Code widgets

A code widget runs an authored JavaScript `render` function in the Docker sandbox on each refresh. It receives fetched sources, current time, optional location, and resolved theme colors, and returns Markdown. It can register validated charts with `chart(spec)` and embed the resulting chart tags in its output.

Code widgets require code execution to be enabled and Docker to be reachable. They allow up to 8 sources, a bounded source/input budget, and a bounded result; the default sandbox is about 30 seconds and 128 MB. The widget runtime has no network or host filesystem access and does not provide application imports, timers, or provider credentials. Source fetching happens before the sandbox, so source URLs still receive requests from the server.

The code editor shows a safety warning before first use. The assistant tab can propose changes to the title, sources, and code. Proposals require acceptance by default; auto-apply can apply and preview them automatically, but you still review and save the widget. Manual edits make an in-flight proposal stale, and repeated failed auto-repairs stop after a bounded number of attempts.

## Persistence and privacy

Widget definitions, layouts, settings, and cache entries are saved in YAAWC's settings store and synchronized with the deployment's other settings. The cache can contain fetched source-derived output. LLM widgets send prompts and source content to the selected model provider. Code widgets send fetched source content into the local Docker sandbox, not to the sandbox network.

Source fetching is server-side and can reach operator-authorized internal or external URLs. Do not import a widget configuration or accept generated code without reviewing its sources and behavior. Dashboard output is sanitized before rendering; code widget output fails closed when its result envelope, charts, or size limits are invalid.

## If an artifact or widget fails

- **Artifact edit rejected:** read the latest version and use an exact string that occurs once. Concurrent edits are intentionally not silently merged.
- **Artifact unavailable:** the chat may be private, outside the owning workspace, or no longer associated with a reachable chat/workspace.
- **Widget source error:** inspect the source list and the per-widget error; a failed source can leave an AI widget without enough input, while a code widget receives an error record for that source.
- **AI widget model error:** refresh provider models, choose an available model, and check the provider credential.
- **Code widget disabled:** enable code execution and make Docker reachable. A disabled code widget can display its last saved result but cannot refresh.
- **Runtime failure:** check the preview's error and logs. Timeouts, memory exhaustion, malformed output, too many charts, and oversized output are reported without rendering unvalidated output.

For Docker configuration, see the [configuration guide](../installation/configuration.md). For storage and deletion scope, see [Privacy and data](./privacy-and-data.md).
