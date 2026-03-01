# Navigation

YAAWC uses a persistent sidebar for primary navigation, a contextual top navbar for chat pages, and a mobile-specific bottom navigation bar.

---

## Sidebar (Desktop)

A fixed vertical bar on the left side of the screen, 80px wide, visible on all pages at the `lg` breakpoint and above.

### Elements (Top to Bottom)

| Element       | Icon            | Action                                                 |
| ------------- | --------------- | ------------------------------------------------------ |
| **New Chat**  | SquarePen       | Navigates to `/` (Home)                                |
| **Home**      | Home            | Navigates to `/`; active when on Home or any Chat page |
| **Dashboard** | LayoutDashboard | Navigates to `/dashboard`                              |
| **Library**   | BookOpenText    | Navigates to `/library`                                |
| _(spacer)_    |                 |                                                        |
| **Settings**  | Settings        | Navigates to `/settings`                               |

### Active Indicator

The currently active navigation item displays a small vertical accent-colored bar on its right edge.

---

## Bottom Navigation Bar (Mobile)

A fixed horizontal bar at the bottom of the screen, visible below the `lg` breakpoint, replacing the sidebar.

### Elements (Left to Right)

| Element       | Icon            | Label       |
| ------------- | --------------- | ----------- |
| **Home**      | Home            | "Home"      |
| **Dashboard** | LayoutDashboard | "Dashboard" |
| **Library**   | BookOpenText    | "Library"   |

### Differences from Desktop

- No "New Chat" button (users navigate to Home instead).
- No "Settings" link (accessible only via the gear icon on the empty chat screen).
- Each icon has a text label below it.
- Active indicator is a small horizontal accent bar above the icon.

---

## Top Navbar (Chat Pages)

Appears at the top of the screen during active chat conversations.

### Desktop Layout

| Position   | Content                                               |
| ---------- | ----------------------------------------------------- |
| **Left**   | Clock icon + elapsed time since chat started          |
| **Center** | Chat title (first 20 characters of the first message) |
| **Right**  | Share/export button + Delete button                   |

The navbar is offset from the left by 104px to account for the sidebar.

### Mobile Layout

| Position  | Content                               |
| --------- | ------------------------------------- |
| **Left**  | Edit icon (links to `/` for new chat) |
| **Right** | Share/export button + Delete button   |

No title or elapsed time is shown on mobile.

### Share / Export Menu

The share button opens a Headless UI popover with two options:

| Option                 | Behavior                                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Export as Markdown** | Generates a `.md` file with all messages (roles, timestamps, content, citations) and triggers a browser download                    |
| **Export as PDF**      | Generates a multi-page PDF using jsPDF with formatted headers, message content, timestamps, and citations, then triggers a download |

### Delete Button

Renders the `DeleteChat` component with redirect enabled. After successful deletion, the user is redirected to `/`.

---

## Settings Page Navigation

The Settings page has a back arrow in its header that links to `/` (Home).

The personalization section can be deep-linked via `/settings#personalization` from the PersonalizationPicker in the chat input.

---

## OpenSearch Integration

The application provides an OpenSearch descriptor at `/api/opensearch`. Browsers can register YAAWC as a search provider. When a search query is submitted through the browser address bar, it arrives as `/?q=<query>` and is automatically submitted as a new chat message.

---

## Page Layout Structure

### App Shell (used by Library, Dashboard)

```
+------+----------------------------------+
|      |                                  |
| Side |          Main Content            |
| bar  |     (max-width: screen-lg)       |
|      |     (centered on desktop)        |
|      |                                  |
+------+----------------------------------+
```

- Library content is width-constrained and centered.
- Dashboard content uses full width (no max-width constraint).

### Chat Pages (Home, /c/:chatId)

Chat pages render without the Layout wrapper. The sidebar appears via the operating system route structure, and the ChatWindow fills the viewport.

```
+--------------------------------------------------+
|  Navbar (chat title, export, delete)             |
+--------------------------------------------------+
|                                                  |
|  Message List (scrollable)                       |
|      User message                                |
|      Assistant message (tabbed)                  |
|      User message                                |
|      Assistant message (tabbed)                  |
|                                                  |
+--------------------------------------------------+
|  [TodoWidget]                                    |
|  [MessageInput - fixed bottom]                   |
+--------------------------------------------------+
```
