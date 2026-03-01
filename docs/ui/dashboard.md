# Dashboard

The Dashboard provides a configurable grid of AI-powered information widgets. Users can create widgets that periodically fetch web content, process it through an LLM, and display the results.

**Route:** `/dashboard`

---

## Layout

The Dashboard uses a full-width layout (no max-width constraint, unlike other pages) with horizontal margins. The sidebar remains visible.

### Top Bar

| Control             | Icon        | Behavior                                                                    |
| ------------------- | ----------- | --------------------------------------------------------------------------- |
| **Refresh All**     | RefreshCw   | Force-refreshes all widgets, bypassing cache                                |
| **Processing Mode** | Layers/List | Toggles between parallel and sequential widget loading                      |
| **Export**          | Download    | Copies the full dashboard configuration as JSON to the clipboard            |
| **Import**          | Upload      | Reads JSON from the clipboard and imports it as the dashboard configuration |
| **Add Widget**      | Plus        | Opens the widget configuration modal in "create" mode                       |

---

## Widget Grid

Widgets are arranged in a responsive drag-and-drop grid powered by `react-grid-layout`.

### Grid Behavior

- **Draggable**: Widgets can be repositioned by dragging the grip handle (vertical dots icon) at the top of each widget card.
- **Resizable**: Widgets can be resized by dragging their edges/corners. Min/max dimensions are enforced per breakpoint.
- **Responsive**: The grid adapts across five breakpoints (`lg`, `md`, `sm`, `xs`, `xxs`) with column counts and min widths adjusting automatically.
- **Layout persistence**: Grid positions are stored as part of each widget's data in localStorage.

### Auto-Refresh

On first page load, all widgets are refreshed (respecting cache). Cached content is restored instantly if still valid; expired content triggers a fresh API call.

---

## Widget Card

Each widget card displays:

### Header Row

- **Drag handle**: Vertical grip icon for repositioning.
- **Title**: The widget's user-defined title.
- **Last updated**: Relative timestamp ("Just now", "5m ago", "2h ago", "3d ago", or "Never") with a tooltip showing the refresh frequency (e.g., "Every 60 minutes").
- **Refresh button**: Spinning when loading; click to force-refresh this widget.

### Content Area

| State       | Display                                                                         |
| ----------- | ------------------------------------------------------------------------------- |
| **Loading** | Centered spinner with "Loading content..."                                      |
| **Error**   | Red alert box with error icon, "Error Loading Content" title, and error message |
| **Content** | Markdown-rendered response from the LLM (without reasoning blocks)              |
| **Empty**   | "No content yet" with instruction to click refresh                              |

### Collapsible Footer

A toggle button reveals:

- **Sources list**: Each source's URL (truncated), type indicator dot, and type label.
- **Edit button**: Opens the widget configuration modal in "edit" mode.
- **Delete button** (red): Removes the widget permanently.

---

## Widget Configuration Modal

A full dialog for creating or editing a widget.

### Form Fields

| Field                 | Type              | Description                                                                                                                              |
| --------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Widget Title**      | Text input        | The display title for the widget card                                                                                                    |
| **Source URLs**       | Dynamic list      | One or more URLs to fetch content from. Each has a URL input and a type dropdown (Web Page / HTTP Data). Sources can be added or removed |
| **LLM Prompt**        | Textarea (8 rows) | Instructions for the LLM describing how to process the fetched content                                                                   |
| **Model & Provider**  | ModelSelector     | Choose the AI model to use for processing                                                                                                |
| **Available Tools**   | ToolSelector      | Choose which tools the AI can use during processing                                                                                      |
| **Refresh Frequency** | Number + dropdown | How often the widget auto-refreshes (minutes or hours)                                                                                   |

### Template Variables

The prompt supports these template variables (listed in a reference legend):

| Variable                                            | Replaced With                                                                                                                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{{current_utc_datetime}}`                          | Current UTC timestamp                                                                                                                                                           |
| `{{current_local_datetime}}`                        | Current local timestamp                                                                                                                                                         |
| `{{source_content_1}}`, `{{source_content_2}}`, ... | Content fetched from each source URL                                                                                                                                            |
| `{{location}}`                                      | User's geolocation (triggers a browser permission prompt for `navigator.geolocation`; returns "latitude, longitude" or is omitted if denied; 10-second timeout, 5-minute cache) |

### Preview

- **Run Preview button**: Processes the prompt with the selected model and displays a live preview (rendered as markdown) within the modal.
- **Show Reasoning toggle**: Controls whether LLM reasoning blocks are visible in the preview.
- **Default state**: Italic placeholder "Click 'Run Preview' to see how your widget will look".

### Modal Flow

- **Create**: All fields start with defaults. Saving adds the widget to the grid at the next available position.
- **Edit**: Fields are pre-populated with the existing widget's configuration. Saving updates the widget in place.
- **Close**: Clearing the preview and dismissing the modal. No data is saved.

---

## Data Persistence

All dashboard data is stored in **localStorage**:

| Key                        | Content                                                     |
| -------------------------- | ----------------------------------------------------------- |
| `yaawc_dashboard_widgets`  | Full widgets array with configuration, layout, and metadata |
| `yaawc_dashboard_settings` | Settings (parallel loading, auto-refresh, theme)            |
| `yaawc_dashboard_cache`    | Per-widget content cache with expiration timestamps         |

Legacy keys with the `perplexica_` prefix are automatically migrated on first load.

---

## Caching

- Each widget's content is cached with an expiration time based on its refresh frequency.
- `refreshWidget` checks the cache first; if valid, restores content without an API call.
- `refreshAllWidgets` with `force=true` bypasses all caches.
- `deleteWidget` also removes its cache entry.
- Clearing all cache is available through the `clearCache` function.

---

## Empty State

When no widgets exist, a welcome card is displayed:

- Title and description explaining the dashboard functionality.
- A "Create Your First Widget" button that opens the configuration modal.

---

## Import / Export

- **Export**: Serializes `{ widgets, settings, lastExport, version }` to JSON. Copies to clipboard via `navigator.clipboard.writeText()`. Toast notification on success or failure.
- **Import**: Reads JSON from clipboard via `navigator.clipboard.readText()`. Validates the structure (widgets must be an array), assigns IDs to any widgets missing them, deserializes dates, and merges settings. Toast notification on success or failure.
