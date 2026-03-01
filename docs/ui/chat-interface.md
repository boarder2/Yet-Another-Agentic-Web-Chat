# Chat Interface

The chat interface is the core experience of YAAWC. It handles new conversation creation, message streaming, tool call visualization, source citations, and multi-modal attachments.

**Routes:** `/` (new chat), `/c/:chatId` (existing chat)

---

## View States

### 1. Empty Chat (New Conversation)

When no messages exist, the user sees a centered landing screen:

- **"YAAWC" branding** with a subtitle description.
- **Message input** field centered in the viewport (see [Message Input](#message-input) below).
- **Settings gear icon** (mobile only) linking to `/settings`.

The user begins a conversation by typing a query and pressing Enter or clicking the submit button.

### 2. Active Chat (Conversation in Progress)

Once messages exist, the view transitions to:

- **Top navbar** showing chat title, elapsed time, export menu, and delete button (see [navigation.md](./navigation.md)).
- **Message list** scrolling vertically with alternating user and assistant messages.
- **Fixed input bar** pinned to the bottom of the viewport.
- **Scroll-to-bottom button** appears when the user scrolls up manually; clicking it jumps back to the latest content.

### 3. Loading State

While the system validates model configuration on page load, a centered spinner is displayed.

### 4. Error State

If the server connection fails (no valid models), an error message is displayed with a link to Settings to correct the configuration.

### 5. Not Found

If the chat ID does not exist, a 404 error page is shown.

---

## Message Input

The message input is the primary interaction point, appearing both in the empty chat and active chat states.

### Text Area

- **Auto-resizing textarea** that grows with content up to a maximum height.
- **Placeholder text**: "What would you like to learn today?" for the first message; "Ask a follow-up" for subsequent messages.
- **Keyboard shortcuts**: `Enter` submits the message; `Shift+Enter` inserts a newline; `Escape` cancels an edit. Pressing `/` from anywhere in the page focuses the input.
- **Clipboard paste**: When the selected model supports images, pasting image data from the clipboard automatically uploads and attaches the image.

### Action Bar

Below the textarea, a row of action controls provides:

| Control                    | Description                        | Details                                         |
| -------------------------- | ---------------------------------- | ----------------------------------------------- |
| **Focus Mode**             | Toggle bar with three mode buttons | See [Focus Modes](#focus-modes)                 |
| **Attach**                 | File and image attachment          | See [Attachments](#attachments)                 |
| **Model Configurator**     | Model selection dialog             | See [Model Configuration](#model-configuration) |
| **System Prompt Selector** | Persona prompt picker              | See [System Prompts](#system-prompts)           |
| **Personalization Picker** | Location and profile toggles       | See [Personalization](#personalization)         |

### Submit / Cancel Buttons

- **Submit button**: Enabled when the input has text or pending images. Icon changes from `ArrowRight` (first message) to `ArrowUp` (follow-ups).
- **Cancel/Stop button**: Replaces the submit button during streaming. A red circle with a stop icon and a spinning border animation. Clicking it sends a cancel request to `/api/chat/cancel`.
- **Cancel Edit button**: When editing a previous message, an X button appears to discard the edit.

### Image Previews

When images are pending attachment, a row of thumbnails appears above the textarea. Each thumbnail has an X button to remove it. A spinning loader appears during upload.

---

## Focus Modes

The focus mode selector is a compact toggle bar with three icon buttons:

| Mode               | Icon          | Key             | Behavior                                                             |
| ------------------ | ------------- | --------------- | -------------------------------------------------------------------- |
| **Web Search**     | Globe         | `webSearch`     | Searches the internet for information and cites sources              |
| **Chat**           | MessageCircle | `chat`          | Creative conversation without search; direct LLM interaction         |
| **Local Research** | Pencil        | `localResearch` | Researches and interacts with locally uploaded files, with citations |

- The active mode is highlighted with accent color and slight scale enlargement.
- Hovering over any mode shows a tooltip card (above the button group) with the mode's name and description.

---

## Attachments

The attach button supports two categories of files:

### Document Attachments

- **Accepted formats**: `.pdf`, `.docx`, `.txt`
- Upload triggers a `POST /api/uploads` with embedding model configuration from localStorage.
- Attached files appear as a popover list with an "Add" button, "Clear" button, and individual file entries showing filenames.

### Image Attachments

- **Accepted formats**: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`
- Only available when the model is marked as vision-capable.
- Upload triggers a `POST /api/uploads/images`.
- Images can also be pasted from the clipboard.
- Attached images appear as thumbnail previews above the textarea.

When files are uploading, a spinning loader icon with "Uploading.." text replaces the attach button.

---

## Model Configuration

The model configurator opens a **full-screen modal dialog** with two model selectors and two toggles:

### Chat Model Selector

An accordion-style popover listing all available AI providers (alphabetically sorted). Each provider expands to show its available models. The currently active model shows an "Active" badge. Selecting a model immediately updates the selection.

### System Model Selector

Identical to the chat model selector but controls the system/internal model. Visually disabled (grayed out) when "Link System to Chat" is active.

### Toggles

- **Link System to Chat**: When enabled, the system model automatically mirrors the chat model. Defaults to ON for new users.
- **Vision Capable**: When enabled, allows image attachments in the chat input.

All selections persist to **localStorage** and take effect immediately.

---

## System Prompts

The system prompt selector is a popover that lets users choose persona instructions to guide the AI:

- **Default Prompts**: System-provided formatting prompts (read-only). These are auto-selected unless the user overrides them. An info button explains their purpose.
- **Persona Prompts**: User-created custom prompts (managed in Settings). Each prompt is a checkbox toggle.
- **Multiple selection**: Users can enable multiple prompts simultaneously.
- **Empty state**: If no prompts exist, a message directs users to Settings.
- **Badge**: When prompts are selected, the button icon shows a count and changes to accent color.

Data is fetched from `/api/system-prompts` only when the popover opens.

---

## Personalization

The personalization picker is a popover with two toggle switches:

| Toggle                   | Effect                                                  | Requirement                            |
| ------------------------ | ------------------------------------------------------- | -------------------------------------- |
| **Send location**        | Includes the user's saved location with the message     | Must have a location saved in Settings |
| **Send personalization** | Includes the user's "About Me" profile with the message | Must have a profile saved in Settings  |

- Toggles are disabled (dimmed, non-interactive) if the corresponding data has not been saved.
- A preview of the saved data is shown (truncated to 80 characters).
- A gear icon links to `/settings#personalization` for editing.
- When either toggle is active, the popover button icon turns accent-colored.

---

## Message Display

### User Messages

- Display the message text, optionally clamped to 3 lines with a "Show more" / "Show less" toggle (`aria-expanded`) for long content.
- The message text itself is **clickable** (`role="button"`, `tabIndex={0}`) to enter edit mode. An **edit button** (pencil icon) also appears on hover as an alternative trigger.
- Clicking either the text or the edit button replaces the message with a pre-populated MessageInput in edit mode.
- **Image thumbnails** are displayed below the text if images were attached.
- Editing a message re-sends it and regenerates the AI response from that point forward.

### Assistant Messages

Assistant messages are displayed through a tabbed interface (see [Message Tabs](#message-tabs)) and rendered via the markdown rendering pipeline (see [message-rendering.md](./message-rendering.md)).

---

## Message Tabs

Each assistant message provides a tabbed view:

| Tab         | Icon    | Content                                                                                   |
| ----------- | ------- | ----------------------------------------------------------------------------------------- |
| **Answer**  | Default | Rendered markdown response with citations, tool calls, and reasoning blocks               |
| **Sources** | List    | List of sources gathered during the search, with favicon, title, URL, and content preview |
| **Images**  | Image   | Image search results in a masonry grid with lightbox                                      |
| **Videos**  | Video   | Video search results with embedded playback                                               |

- The Sources tab only appears when sources were found. Images and Videos tabs show count badges.
- The active tab has an accent-colored bottom border.
- Tab content cross-fades on switch.

### Answer Tab Actions

Below the answer content, a toolbar provides:

| Action         | Description                                                                                                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Rewrite**    | Regenerates the assistant's response for this message                                                                                                                                         |
| **Copy**       | Copies the response text plus a "Citations" section listing source URLs                                                                                                                       |
| **Speech**     | Toggles text-to-speech playback using the browser's Web Speech API. Shows a `Volume2` icon when idle or a `StopCircle` icon when speaking. Three bouncing dots animate while speech is active |
| **Model Info** | Opens a popover showing model names, token usage (input/output/total), response time, and whether location/personalization were used                                                          |

### Suggestions

After a response completes:

- If **auto-suggestions** is enabled (Settings), related follow-up queries are automatically fetched and displayed.
- Otherwise, a **"Load suggestions"** button (with Sparkles icon) allows manual fetching.
- Suggestions appear as a "Related" section with clickable items. Clicking one sends it as a new message.

---

## Streaming Behavior

When the user sends a message, the following real-time streaming sequence occurs:

1. **User message appears** at the bottom of the chat.
2. **Loading skeleton** appears as the assistant message placeholder.
3. **Live token counters**: During processing, token usage pills (Input, Output, Total) appear for both Chat and System models, updating in real time.
4. **Gathering sources**: Sources accumulate in a collapsible panel titled "Relevant Sources Gathered (N)". The panel has a chevron toggle to expand/collapse the full list. Sources are grouped by search query, with each group showing the query text and compact source cards.
5. **"Answer now" button**: While sources are being gathered, an "Answer now" button appears alongside the sources panel. Clicking it sends a `POST /api/respond-now` request that forces the AI to stop gathering and immediately begin generating a response with whatever sources have been collected. The button shows a spinner after being clicked and is disabled to prevent double clicks.
6. **Tool calls**: Inline tool call indicators appear within the response showing the tool type, query, and status (spinning for running, checkmark for success, X for error).
7. **Subagent executions**: Expandable cards showing delegated deep research, file analysis, or content synthesis tasks with their own nested tool calls and streaming responses.
8. **Response tokens**: Text streams in with a buffering strategy (threshold of 5 tokens) to reduce visual jitter.
9. **Reasoning blocks**: Collapsible panels showing the LLM's reasoning process.
10. **Todo widget**: A collapsible task list appears above the input showing the AI agent's planned steps and completion progress.
11. **Completion**: Progress indicators and todos clear. Model stats become available. Suggestions load.

The entire streaming connection can be cancelled at any time via the stop button.

---

## URL and Browser Integration

- When the first message is sent in a new chat, the URL updates from `/` to `/c/:chatId` via `history.replaceState` (no page reload).
- The document title updates to the first message's content.
- **OpenSearch integration**: The application registers as a search provider. Browsers can add YAAWC to their address bar search. Queries arrive as `/?q=...` and are auto-submitted.
- **Export**: Chats can be exported as Markdown (`.md`) or PDF (`.pdf`) from the navbar share menu.

---

## Chat Deletion

Deleting a chat (from the navbar, library, or sidebar) triggers a confirmation dialog:

- Modal with "Cancel" and "Delete" buttons.
- Cancel is disabled during the deletion API call.
- On success, the chat is removed from the list and the user is optionally redirected to `/`.
- On failure, a toast notification appears.

---

## Accessibility

Key accessibility features in the chat interface:

- **Tab roles**: Message tabs use WAI-ARIA tab pattern (`role="tab"` with `aria-selected`, `role="tabpanel"` for content areas).
- **Keyboard navigation**: The `/` key focuses the input from anywhere. `Enter` submits, `Shift+Enter` for newlines, `Escape` cancels edits.
- **Button roles**: User message text uses `role="button"` and `tabIndex={0}` for keyboard-accessible edit triggering.
- **Expand/collapse**: User message overflow toggle uses `aria-expanded` and `aria-controls`.
- **ARIA labels**: Applied to the scroll-to-bottom button, image remove buttons, model configurator button, code block copy buttons, and search clear button.
- **Focus rings**: Interactive elements show `focus-visible:ring-2` styling for keyboard navigation visibility.

---

## Notifications

The application uses the **Sonner** toast library for ephemeral notifications. Toasts appear for:

- Settings save confirmations
- Error states (failed API calls, config errors, deletion failures)
- Dashboard export/import results
- Clipboard operations

Toasts auto-dismiss and stack vertically at the top of the viewport.

---

## Touch Interactions

On mobile/touch devices:

- **Touch scroll detection**: Touching the message list (`touchstart` event) immediately marks the user as having manually scrolled, disabling auto-scroll until the user taps the "Scroll to bottom" button.
- **Scroll behavior**: A `wheel` event listener detects upward scrolling (negative `deltaY`) to similarly disable auto-scroll on desktop.
