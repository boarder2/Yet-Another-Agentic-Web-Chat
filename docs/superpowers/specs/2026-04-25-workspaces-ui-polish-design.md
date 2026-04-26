# Workspaces UI Polish — Design

**Date:** 2026-04-25
**Status:** Approved (ready for plan)

## Problem

Workspaces shipped in commit `a2e5b39`, but the UI has gaps that make the
feature feel half-finished:

1. `color` and `icon` are in the schema but unset and unused in the UI.
2. There's no way to start a workspace-scoped chat from the workspace's
   chats list.
3. The new-chat workspace dropdown uses a native `<select>` and clashes
   with the surrounding aesthetic.
4. The Library page can't filter by workspace.
5. A chat thread doesn't show which workspace it belongs to.
6. The workspace's chats list (`ChatsTab`) is hand-rolled and missing
   features the Library has (search, filters, delete, infinite scroll).

## Goals

- Make `color` and `icon` first-class, set via UI, and visible everywhere
  workspaces appear.
- Unify chat browsing UX so workspace-scoped browsing inherits all Library
  features.
- Make workspace context obvious from inside a chat thread.
- Refresh the new-chat workspace picker so it matches the chip aesthetic.

## Non-Goals

- Reworking workspace creation flow beyond adding color/icon.
- Changing the workspace data model (no new columns).
- Per-workspace theming of the chat thread itself (only an indicator chip).
- Reworking the search API beyond what's needed to support workspace
  filtering server-side.

---

## Unit A — Workspace identity (color + icon)

### Curated palette

A constant defines ~10 theme-friendly color tokens (e.g. `slate`, `sky`,
`emerald`, `amber`, `rose`, `violet`, `teal`, `orange`, `pink`, `lime`).
Stored as the token name, not a raw hex.

A central util (`src/lib/workspaces/appearance.ts`) maps a token to
fully-spelled-out Tailwind class strings (Tailwind can't see dynamic
class names, so each token's classes must be literal in the file):

```ts
type WorkspaceColor = 'slate' | 'sky' | ...;
type ColorClasses = { bg: string; bgMuted: string; text: string; border: string; dot: string; };
function workspaceColorClasses(color: string | null): ColorClasses;

// e.g. for 'sky':
// { bg: 'bg-sky-500', bgMuted: 'bg-sky-500/15', text: 'text-sky-600 dark:text-sky-300',
//   border: 'border-sky-500/40', dot: 'bg-sky-500' }
```

The util tolerates unknown / null values and returns a neutral default
(slate) so the UI never breaks on legacy workspaces.

### Curated Lucide icons + manual override

Curated grid of ~20 Lucide icons covering common workspace metaphors
(FolderOpen, Briefcase, BookOpen, Code, Beaker, Compass, Lightbulb,
Target, Rocket, Heart, Music, Palette, Camera, Globe, GraduationCap,
Hammer, Leaf, ShoppingCart, Coffee, Star).

Stored as the icon name string. A small input below the grid lets the
user type any Lucide icon name; if it doesn't resolve, the UI falls
back to `FolderOpen` silently (no validation error).

`<WorkspaceIcon name color size />` resolves the name → Lucide
component and applies color classes from the appearance util.

### Picker UI

Two compact rows in:

- `CreateModal` inline in `src/app/workspaces/page.tsx`
- `SettingsTab` (`src/components/Workspaces/SettingsTab.tsx`)

Layout:

- Color row: 10 small swatches, click to select; selected gets a ring.
- Icon row: 4×5 grid of icon buttons, click to select; selected gets the
  current color tint. Below the grid: a small text input
  ("Or enter a Lucide icon name...") that, when non-empty, overrides the
  grid selection. Typing into it clears the grid selection visually.

### Where color + icon are surfaced

| Surface                 | Today                   | After                             |
| ----------------------- | ----------------------- | --------------------------------- |
| Workspaces list cards   | Plain                   | Colored card border / icon tint   |
| Workspace detail header | Plain emoji             | `WorkspaceIcon` + colored tint    |
| `WorkspaceChip`         | Emoji or generic folder | `WorkspaceIcon` + color-tinted bg |
| New-chat picker chip    | Native select           | `WorkspaceIcon` + color tint      |
| Library filter chips    | n/a                     | Color-tinted when active          |
| Chat thread header chip | n/a                     | `WorkspaceChip` reused            |

`WorkspaceChip` gets a small extension: it accepts `color` and reads the
icon as a Lucide name (not emoji). Existing call sites updated.

---

## Unit B — Shared `ChatBrowser` component

### New module

`src/components/Chats/ChatBrowser.tsx` owns the entire chat-browsing UX:

- Search bar (text + LLM modes, debounced fetch)
- Filter row (pinned, scheduled, plus the workspace filter chips from
  Unit D when not in scoped mode)
- Infinite scroll via IntersectionObserver
- Chat row rendering (title, badges, workspace chip, excerpt highlighting,
  timestamps, delete)
- Empty / loading / error states

Sub-component `ChatRow` exported separately for testability.

### Scope prop

```ts
type Props = {
  workspaceId?: string; // when set: scoped mode
};
```

In scoped mode:

- The workspace filter chip row is hidden (would be redundant).
- Per-row workspace chips are hidden (every chat has the same workspace).
- A "+ New chat" button appears in the header (Unit C handles this).
- All fetches include `workspaceId=<id>` in the query string.

### Consumer refactors

- `src/app/library/page.tsx` shrinks dramatically — becomes a thin page
  wrapper that renders `<ChatBrowser />`.
- `src/components/Workspaces/ChatsTab.tsx` similarly shrinks to
  `<ChatBrowser workspaceId={workspaceId} />`.

### API extensions

- `/api/chats` already supports `workspaceId` (single). Extend to accept
  `workspaceIds=a,b,c` for multi-select, plus the special value `none`
  to mean "chats without a workspace". The single-value form continues
  to work.
- `/api/chats/search` (LLM search) extended to accept the same
  `workspaceId` / `workspaceIds` filter, applied server-side before the
  LLM ranking step.

---

## Unit C — New-chat entry points

### (a) New-chat picker chip (issue #3)

Replace the native `<select>` in `EmptyChat.tsx`'s inline
`WorkspacePicker` with a chip-style button + popover.

New module: `src/components/Workspaces/WorkspacePicker.tsx`

- **Button:** rounded chip showing the current workspace's
  `<WorkspaceIcon>` + name, tinted with the workspace color. Empty state
  shows a generic `FolderOpen` + "Workspace".
- **Popover:** opens on click. Contains a search input and a vertically
  scrolling list of workspaces (icon + name + color dot). "No workspace"
  pinned at top. Keyboard navigable (↑/↓/Enter/Esc). Closes on outside
  click.

`EmptyChat.tsx` updated to import from the new module.

### (b) "+ New chat" from a workspace (issue #2)

`ChatBrowser` (in scoped mode) renders a "+ New chat" button in its
header. The button navigates to `/?workspace=<id>`.

`ChatWindow.tsx` line ~439: initialize `selectedWorkspaceId` from
`searchParams.get('workspace')` rather than `null`. The picker chip
reflects the pre-selected workspace immediately. Once the first message
is sent and the chat persists, the URL changes to `/c/<chatId>` and the
workspace is bound through `chats.workspaceId`.

---

## Unit D — Library filter chips + chat thread indicator

### (a) Library filter chips (issue #4)

`ChatBrowser` (unscoped mode) renders a horizontal, scrollable chip row
above the search input:

- Chips: "All" (default selected), one per active workspace (with color
  - icon), and "No workspace" at the end.
- Multi-select. Selecting "All" clears the others. Selecting any
  workspace clears "All".
- Selected workspace chips use the workspace's color tint via the
  appearance util's `bgMuted` + `text` class strings.
  Unselected are muted surface chips.
- Selection state passed into chat fetches as `workspaceIds=a,b,c`
  (or `workspaceId=none` for the "No workspace" pseudo-chip when it's
  the only selection).

State is local component state (not URL — keep things simple; can be
revisited if deep linking is requested).

### (b) Chat thread workspace indicator (issue #5)

In `ChatWindow.tsx`, render a `<WorkspaceChip>` near the chat title at
the top of the thread whenever the loaded chat has a `workspaceId`. The
chip uses the workspace's color tint and is clickable, navigating to
`/workspaces/<id>`. Hidden during private sessions.

The chip needs the workspace's name/icon/color — fetched once when the
chat loads (already we know the `workspaceId`, just need to fetch
`/api/workspaces/<id>` once and cache in component state).

---

## Component / file inventory

### New files

- `src/lib/workspaces/appearance.ts` — color tokens + class util
- `src/components/Workspaces/WorkspaceIcon.tsx` — name+color → Lucide
- `src/components/Workspaces/WorkspacePicker.tsx` — chip + popover
- `src/components/Chats/ChatBrowser.tsx` — shared chat browsing UX
- `src/components/Chats/ChatRow.tsx` — single row, exported

### Modified files

- `src/app/workspaces/page.tsx` — add color/icon to CreateModal
- `src/app/workspaces/[id]/page.tsx` — header uses WorkspaceIcon + color
- `src/components/Workspaces/SettingsTab.tsx` — color + icon pickers
- `src/components/Workspaces/WorkspaceChip.tsx` — color prop, Lucide icons
- `src/components/Workspaces/ChatsTab.tsx` — replaced with ChatBrowser wrapper
- `src/app/library/page.tsx` — replaced with ChatBrowser wrapper
- `src/components/EmptyChat.tsx` — use new WorkspacePicker
- `src/components/ChatWindow.tsx` — init from `?workspace=`, render header chip
- `src/app/api/chats/route.ts` — accept `workspaceIds`, `workspaceId=none`
- `src/app/api/chats/search/route.ts` — same workspace filtering

### Schema

No changes. `color` and `icon` fields already exist as nullable text.

---

## Risks & mitigations

- **WorkspaceChip API change:** existing call sites (Library row) need
  updating to pass `color`. Mitigated by the appearance util defaulting
  to a neutral palette when color is null/unknown — won't break legacy
  workspaces created before the picker existed.
- **Library refactor blast radius:** `library/page.tsx` is ~640 lines
  with search, filters, fetch, and rendering interleaved. The
  refactor must preserve all current behavior (text search, LLM search,
  pinned/scheduled filters, infinite scroll, delete). Plan should call
  for spot-testing each before declaring done.
- **API contract:** comma-separated `workspaceIds` and the magic value
  `none` need careful URL encoding; the implementation plan must
  specify exact query string handling.

## Testing approach

- Unit: appearance util (token → classes mapping, fallback behavior).
- Unit: `WorkspaceIcon` resolves valid names, falls back on invalid.
- Manual via dev server (per project test-automation skill):
  - Create workspace with each color in the palette; verify visible.
  - Set custom Lucide icon name (valid + invalid); verify fallback.
  - Library filter chips: All / single / multiple / "No workspace".
  - Workspace ChatsTab: search, filter, delete, "+ New chat" flow.
  - Chat thread: workspace chip appears, links to workspace.
  - New-chat picker popover: keyboard nav, search, selection.
