# Message Rendering

This document describes how AI assistant messages are processed and rendered, including markdown, citations, tool calls, subagent executions, media results, and reasoning blocks.

---

## Rendering Pipeline

Raw response content flows through this pipeline:

1. **Reasoning block separation**: Reasoning content is identified and separated from the main response content.
2. **Markdown rendering**: Each content segment is rendered via `react-markdown` with `remark-gfm` plugin support.
3. **Citation injection**: Inline citation references like `[1]` are transformed into anchor tags with `data-citation` attributes.
4. **Custom element handling**: HTML-like elements (`<ToolCall>`, `<SubagentExecution>`) embedded in the content are rendered as React components.
5. **Security filtering**: `<iframe>`, `<script>`, `<object>`, and `<style>` elements are suppressed.

---

## Markdown

Standard markdown is rendered with these features:

- **Headings, paragraphs, lists, blockquotes**: Styled via Tailwind Typography (`prose` classes).
- **Tables**: Rendered with standard GFM table syntax.
- **Links**: External links open in new tabs. Citation-annotated links render as CitationLink components.
- **Code blocks**: Syntax-highlighted via `react-syntax-highlighter` (Prism engine). Language is auto-detected from the fenced code block info string. Color theme adapts to light/dark mode.
  - Each code block has a **copy button** in its header. Clicking copies the code, shows a checkmark for 2 seconds, then reverts to the copy icon.
- **Inline code**: Styled differently from block code.

---

## Citations

Citations appear as inline reference badges within the response text (e.g., superscript "[1]").

### Citation Badge

- A small inline badge with a number, styled with background, border, and rounded corners.
- Clicking opens the source URL in a new tab.

### Citation Tooltip

When a source document is associated with the citation:

- **Hovering** over the badge shows a floating tooltip card positioned above the badge.
- The tooltip contains a `MessageSource` component showing the source's favicon, title, URL, and content preview.
- The tooltip is rendered via a React portal to `document.body` to prevent clipping.
- A downward-pointing arrow connects the tooltip to the badge.

---

## Tool Calls

Tool calls are rendered inline within the response as status indicators showing what the AI is doing.

### Tool Types and Display

| Tool Type                | Icon        | Display                             |
| ------------------------ | ----------- | ----------------------------------- |
| `search` / `web_search`  | Globe       | Search query text                   |
| `file` / `file_search`   | File        | Search query text                   |
| `url` / `url_fetch`      | Link        | "Reading N pages" or "Reading page" |
| `image` / `image_search` | Image       | Search query text                   |
| `image_analysis`         | ScanEye     | URL being analyzed                  |
| `firefoxAI`              | Bot         | "Using Firefox AI"                  |
| `youtube_transcript`     | YoutubeIcon | Embedded YouTube player iframe      |
| `pdf_loader`             | FileText    | Clickable URL link                  |

### Status Indicators

| Status    | Visual                                                   |
| --------- | -------------------------------------------------------- |
| `running` | Spinning loader icon (accent color)                      |
| `success` | Green double-checkmark icon                              |
| `error`   | Red X icon with optional error message in monospace text |

### Layout

- Each tool call is a rounded container with icon, type label, query/detail text, and status indicator in a single row.
- Error messages appear below the tool call in a red-tinted monospace block.

---

## Subagent Executions

Subagent executions represent delegated AI tasks and are displayed as expandable cards.

### Header (Always Visible)

- **Status icon**: Spinning loader (running), green checkmark (success), or red X (error).
- **Subagent icon**: Search (Deep Research), FileText (File Analyzer), Globe (Content Synthesizer), or Bot (unknown).
- **Task description**: Truncated text of the assigned task.
- **Chevron**: Indicates expandability.

### Expanded Content (Click to Toggle)

| Section      | Content                                                                      |
| ------------ | ---------------------------------------------------------------------------- |
| **Activity** | Nested tool call indicators (same rendering as top-level tool calls)         |
| **Response** | Markdown-rendered response from the subagent (reasoning blocks are stripped) |
| **Error**    | Red error message (when status is `error`)                                   |
| **Starting** | Italic "Starting..." text (when running with no activity yet)                |

The expanded area has a max height of 33% viewport height with vertical scrolling.

---

## Reasoning Blocks

When an LLM response contains reasoning content, it is rendered as a collapsible panel.

### Reasoning Panel

- **Header**: A clickable bar with a purple brain icon and "Thinking Process" label. Chevron indicates expanded/collapsed state.
- **Content**: The reasoning text rendered as markdown.
- **Controlled mode**: Panel expansion state is managed by the parent ChatWindow and persisted per-message. Toggle state survives re-renders and page refreshes for existing chats.
- **Empty state**: If the reasoning content is empty, the panel is not rendered.

### Visibility Control

- In the chat view, reasoning blocks are shown by default.
- In dashboard widgets and subagent responses, reasoning blocks are stripped.

---

## Sources

Sources appear in two contexts: the **gathering phase** during streaming and the **Sources tab** after completion.

### Gathering Phase (During Streaming)

As the AI searches, source pills accumulate in real time:

- Sources are grouped by search query.
- Each group shows the query text and a horizontal row of source pills.
- Each pill shows a favicon and source title, clickable to open in a new tab.

### Sources Tab (After Completion)

A full list of all sources found during the search.

When the message has a `searchQuery` and `searchUrl`, the tab header displays a clickable link showing the search query text that opens the external search engine results page.

### Source Card (Full Mode)

Each source is a clickable card with:

| Element                  | Description                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| **Favicon**              | Loaded from Google's favicon service; file icon for local files                               |
| **Source number**        | 1-based index                                                                                 |
| **Processing type icon** | Zap (partial), Microscope (full), FileText (direct URL), Sparkles (summarized)                |
| **Title**                | Source page title                                                                             |
| **Domain**               | Extracted from the URL                                                                        |
| **Content preview**      | Truncated to 3 lines; shows snippet for partial sources, first 250 chars of content otherwise |

### Source Card (Compact Mode)

Used in citation tooltips: a single-line card with favicon and truncated title/URL.

---

## Image Search Results

When the Images tab is active, image search results are displayed:

- **Grid layout**: 2-column grid of image thumbnails.
- **Hover effect**: Slight scale enlargement.
- **Click behavior**: Opens a fullscreen lightbox starting at the clicked image.
- **"Show More Images" button**: Loads 10 more images at a time with a progress indicator (e.g., "10 of 30").
- **Loading state**: 2-column grid of 4 pulsing placeholder rectangles.

---

## Video Search Results

When the Videos tab is active:

- **Grid layout**: 2-column grid of video thumbnails with a "Video" badge overlay (PlayCircle icon).
- **Hover/click effects**: Same as images.
- **Click behavior**: Opens a fullscreen lightbox with embedded video iframes.
- **Playback management**: When navigating between videos in the lightbox, the previously playing video is automatically paused via YouTube iframe API messages.
- **"Show More Videos" button**: Same pagination pattern as images.
- **Loading state**: 2-column grid of 4 pulsing placeholders.

---

## Task Progress (Todo Widget)

During complex multi-step operations, the AI reports task progress:

### Collapsed View

- ListTodo icon, "Tasks" label, progress counter (e.g., "2/5"), current task description, and a chevron.

### Expanded View

Each task item shows:

| Status        | Icon                      | Text Style               |
| ------------- | ------------------------- | ------------------------ |
| `completed`   | Green CheckCircle2        | Dimmed with line-through |
| `in_progress` | Spinning Loader2 (accent) | Normal                   |
| `pending`     | Gray Circle               | Normal                   |

The widget appears above the message input and is only visible when a response is actively streaming.

---

## Model Info Popover

Available from the answer tab toolbar after a response completes:

| Field                    | Content                                |
| ------------------------ | -------------------------------------- |
| **Chat model**           | Model name (truncated with tooltip)    |
| **System model**         | Model name (truncated with tooltip)    |
| **Token usage (Chat)**   | Input, output, and total token pills   |
| **Token usage (System)** | Input, output, and total token pills   |
| **Response time**        | Duration in seconds (2 decimal places) |
| **Used location**        | Yes / No                               |
| **Used personalization** | Yes / No                               |

Token pills use a `TokenPill` component: a small badge with a label (e.g., "In") and a locale-formatted number. The "Total" pill is highlighted with accent-colored border and text.
