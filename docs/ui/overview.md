# YAAWC UI Architecture Overview

**YAAWC** (Yet Another AI Web Chat) is a Next.js application providing an AI-powered conversational search interface. Users interact with multiple LLM providers through a chat-based UI that supports web search, file analysis, image/video search, and customizable dashboards.

---

## Application Map

```
Home (/)
 |
 |-- [Submit query] ---------> Chat View (/c/:chatId)
 |                              Streaming AI responses, citations, tool calls, subagents
 |
Sidebar (persistent, all pages)
 |-- New Chat ----------------> Home (/)
 |-- Chat History Items ------> Chat View (/c/:chatId)
 |-- Library -----------------> Library (/library)
 |-- Dashboard ---------------> Dashboard (/dashboard)
 |-- Settings ----------------> Settings (/settings)
 |
Library (/library)
 |-- Chat Items --------------> Chat View (/c/:chatId)
 |-- Text Search / AI Search
 |
Dashboard (/dashboard)
 |-- Widget Grid (drag, resize, configure)
 |-- Add/Edit/Delete Widgets
 |-- Import/Export Configuration
 |
Settings (/settings)
 |-- Theme, Models, API Keys, Personalization, Prompts, Visibility
```

---

## Primary Views

| View                | Route        | Purpose                                             | Documentation                            |
| ------------------- | ------------ | --------------------------------------------------- | ---------------------------------------- |
| **Home / New Chat** | `/`          | Landing page and new conversation entry point       | [chat-interface.md](./chat-interface.md) |
| **Chat**            | `/c/:chatId` | Active conversation with streaming AI responses     | [chat-interface.md](./chat-interface.md) |
| **Library**         | `/library`   | Searchable history of all past conversations        | [library.md](./library.md)               |
| **Dashboard**       | `/dashboard` | Configurable widget grid with AI-powered data cards | [dashboard.md](./dashboard.md)           |
| **Settings**        | `/settings`  | Application configuration hub                       | [settings.md](./settings.md)             |

---

## Cross-Cutting Systems

| System                | Scope                                             | Documentation                                  |
| --------------------- | ------------------------------------------------- | ---------------------------------------------- |
| **Navigation**        | Sidebar, navbar, routing, responsive layout       | [navigation.md](./navigation.md)               |
| **Message Rendering** | Markdown, citations, tool calls, subagents, media | [message-rendering.md](./message-rendering.md) |
| **Theming**           | Light, dark, and custom color themes              | [theming.md](./theming.md)                     |

---

## State Architecture

YAAWC uses **React local state** with **localStorage** for persistence. There is no global state management library. Key patterns:

- **ChatWindow** is the central orchestrator for all chat state (messages, streaming, models, attachments, personalization).
- **useDashboard** hook encapsulates all dashboard state (widgets, layout, caching, settings).
- **localStorage** persists model preferences, theme, personalization, system prompts, and dashboard data.
- **API endpoints** (21 routes under `/api/`) provide chat streaming, model listing, configuration, file uploads, search, and dashboard processing.
- **Custom DOM events** (`personalization-update`, `storage`) enable cross-component synchronization.

---

## Responsive Design

The application adapts across two primary breakpoints:

- **Desktop** (`lg:` and above): Fixed left sidebar (icons only), full navbar with title/time, centered content with max-width constraints.
- **Mobile** (below `lg:`): Bottom navigation bar with labeled icons, simplified navbar (no title), full-width content, slide-over interactions.

Settings is accessible from the sidebar icon on desktop; on mobile, it is accessed via a gear icon on the empty chat screen.

---

## Technology Stack (UI Layer)

- **Framework**: Next.js App Router (React 18+, TypeScript)
- **Styling**: Tailwind CSS with CSS custom properties for theming
- **Component Library**: Headless UI (`@headlessui/react`) for dialogs, popovers, switches, transitions
- **Icons**: Lucide React
- **Markdown**: `react-markdown` with `remark-gfm`, `react-syntax-highlighter` (Prism)
- **Layout**: `react-grid-layout` (dashboard), `react-layout-masonry` (image search)
- **Media**: `react-player` (videos), `yet-another-react-lightbox` (image lightbox)
- **Notifications**: `sonner` (toast)
- **PDF**: `jsPDF` (export)
- **Fonts**: Montserrat (via `next/font`)
