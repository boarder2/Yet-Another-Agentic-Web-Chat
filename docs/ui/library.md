# Library

The Library is a searchable archive of all past conversations, providing both text-based and AI-powered search capabilities.

**Route:** `/library`

---

## Layout

The Library page is wrapped in the standard app shell layout with the sidebar visible. Content is centered with a maximum width constraint.

### Header

- **BookOpenText icon** with the title "Library" in large text.
- A horizontal divider separates the header from the search and results area.

---

## Search System

The search bar sits below the header and provides two search modes:

### Text Search (Automatic)

- **Search input**: A text field with a search icon, placeholder "Search conversations...", and a clear button (X icon) that appears when text is entered.
- **Debounced**: The search triggers automatically after a 500ms pause in typing.
- **API call**: `GET /api/chats?q=<query>&limit=200` with text-matching.
- **Results**: Conversations with matching content, including match excerpt highlights.

### AI Search (Manual)

- **AI button**: A button with a Sparkles icon and "AI" label (label hidden on mobile) that triggers LLM-powered semantic search.
- **Keyboard shortcut**: Pressing `Enter` in the search input also triggers AI search.
- **API call**: `POST /api/chats/search` with the query and the user's selected chat model from localStorage.
- **Results**: Conversations found through AI understanding, with search terms shown.
- **Search terms display**: When AI search completes, the terms the LLM used are shown below the search bar (e.g., `searched for "term1", "term2"`).

### Search Status Indicators

| State          | Display                                                          |
| -------------- | ---------------------------------------------------------------- |
| Text searching | Spinner with "Searching..."                                      |
| AI searching   | Spinner with "Searching with AI..."                              |
| Results found  | "N conversation(s) found" with optional "(AI search)" label      |
| No results     | "No matching conversations" or "No matching conversations found" |

---

## Chat List

### Normal Mode (No Search)

Conversations are loaded in pages of 50, fetched from `GET /api/chats?limit=50&offset=N`.

- **Infinite scroll**: Additional pages load automatically as the user scrolls near the bottom. Uses `IntersectionObserver` (with a scroll-event fallback for older browsers).
- **Loading indicator**: A spinner appears at the bottom while the next page loads.

### Search Mode

All matching results (up to 200 for text search) are displayed at once without pagination.

### Chat Entry

Each conversation displays:

- **Title**: Clickable link navigating to `/c/:chatId`. Text is truncated on overflow.
- **Match excerpt** (search mode only): A preview snippet of where the match occurred, with matching terms highlighted in accent color.
- **Timestamp**: Clock icon with relative time (e.g., "5 Minutes Ago").
- **Delete button**: Trash icon that opens a deletion confirmation dialog.

Entries are separated by horizontal borders except for the last item.

---

## Empty States

| Condition                    | Display                                             |
| ---------------------------- | --------------------------------------------------- |
| No chats exist (normal mode) | Centered "No chats found." message                  |
| No search results            | Centered "No matching conversations found." message |

---

## Deletion Behavior

When a chat is deleted from the Library:

- In **normal mode**: The chat is removed from the list and the pagination offset adjusts downward.
- In **search mode**: The chat is removed from the search results.
- No redirect occurs (the user stays on the Library page).
