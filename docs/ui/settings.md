# Settings

The Settings page is the central configuration hub for YAAWC. It is organized into collapsible sections, each managing a specific category of preferences.

**Route:** `/settings`

---

## Navigation

- Accessed via the sidebar Settings icon (desktop) or the gear icon on the empty chat screen (mobile).
- A back arrow at the top links to `/` (Home).

---

## Loading State

While configuration loads from `/api/config`, a full-page spinner is displayed.

---

## Sections

### 1. Preferences

**Content**: Theme switcher dropdown.

- **Options**: Light, Dark, Custom.
- When **Custom** is selected, two color picker inputs appear:
  - **Background**: Sets the base background color. Foreground, surface, and surface-2 colors are auto-derived from luminance analysis.
  - **Accent**: Sets the accent/brand color. Lighter and darker variants are auto-derived.
- Theme changes apply immediately to the entire application.
- **Persistence**: `appTheme`, `userBg`, `userAccent` in localStorage.

### 2. Automatic Search

A single toggle switch.

- **On**: The AI automatically generates follow-up suggestion queries after each response.
- **Off**: Users must manually click "Load suggestions" to see related queries.
- **Persistence**: `autoSuggestions` in localStorage. Also saved to server config.

### 3. Personalization

Two fields for providing personal context to the AI:

| Field        | Type       | Description                                                           |
| ------------ | ---------- | --------------------------------------------------------------------- |
| **Location** | Text input | User's location (city, country, etc.) sent with messages when enabled |
| **About Me** | Textarea   | Personal profile/preferences sent with messages when enabled          |

- Changes save immediately on input and dispatch a `personalization-update` custom event for real-time sync with the chat input's PersonalizationPicker.
- **Persistence**: `personalization.location`, `personalization.about` in localStorage.

### 4. Persona Prompts

A CRUD interface for custom persona prompts that guide the AI's behavior and formatting.

#### Viewing Prompts

- Each prompt is a card showing its name and a truncated content preview.
- **Edit button** (pencil icon): Transforms the card into inline editable fields (name input + content textarea) with Save and Cancel buttons.
- **Delete button** (trash icon): Shows a browser `confirm()` dialog, then calls `DELETE /api/system-prompts/:id`.

#### Adding Prompts

- **"Add Persona Prompt" button**: Reveals an inline form with name input, content textarea, and Save/Cancel buttons.
- Saving calls `POST /api/system-prompts` and adds the new prompt to the list.
- Both name and content must be non-empty.

#### Copy Template Picker

A dropdown selector offering pre-built formatting templates:

| Template      | Description                                                 |
| ------------- | ----------------------------------------------------------- |
| **Web**       | Citation and formatting instructions for web search results |
| **Local**     | Instructions for local file research with citations         |
| **Chat**      | Instructions for creative conversation mode                 |
| **Scholarly** | Academic citation formatting                                |

Selecting a template and clicking "Copy" copies its content to the clipboard for pasting into a prompt.

### 5. Default Search Settings

Override the model used for direct search queries (e.g., OpenSearch/address bar integration).

- **Model selector**: Embedded ModelSelector component for choosing a provider and model.
- **Reset button** (RotateCcw icon): Clears the override, reverting to the default chat model.
- **Persistence**: `searchChatModelProvider`, `searchChatModel` in localStorage.

### 6. Model Settings

Configuration for the three model roles used by the application:

#### Chat Model

- **Provider dropdown**: Lists all available LLM providers with their models.
- **Model dropdown**: Lists models for the selected provider.
- Changing the provider auto-selects the first available model.
- When "Link System to Chat" is enabled, changes here also update the system model.
- **Custom OpenAI**: When `custom_openai` is the provider, three additional fields appear:
  - Model Name (text)
  - Custom OpenAI API Key (password)
  - Custom OpenAI Base URL (text)
- **Persistence**: `chatModelProvider`, `chatModel` in localStorage.

#### System Model

- **Provider and Model dropdowns**: Same as Chat Model.
- **Disabled when linked**: If "Link System to Chat" is on, these controls are disabled and mirror the chat model.
- **Client-only**: System model selection is stored only in localStorage (not sent to the server).
- **Persistence**: `systemModelProvider`, `systemModel` in localStorage.

#### Link System to Chat Toggle

A switch that, when enabled, forces the system model to match the chat model selection. Defaults to ON for new users.

#### Ollama Context Window

Visible only when the chat model provider is `ollama`.

- **Predefined sizes**: Dropdown with options: 1024, 2048 (default), 4096, 8192, 16384, 32768, 65536, 131072, and Custom.
- **Custom input**: When "Custom..." is selected, a number input appears (minimum 512). Validated on blur.
- **Persistence**: `ollamaContextWindow` in localStorage.

#### Embedding Model

- **Provider and Model dropdowns**: For selecting the embedding model used during file upload processing.
- **Persistence**: `embeddingModelProvider`, `embeddingModel` in localStorage.

### 7. Model Visibility

Control which models appear in selection dropdowns throughout the application.

- **Expandable provider sections**: Each provider can be expanded to show its individual models.
- **Per-model toggle switches**: Show or hide individual models.
- **Bulk actions**: "Show All" and "Hide All" buttons per provider section.
- Hidden models are persisted via `POST /api/config` (server-side).
- Models hidden here will not appear in the ModelSelector popovers.

### 8. API Keys & Server URLs

Input fields for configuring external service connections. Each field saves on blur.

| Field                  | Type     | Description                              |
| ---------------------- | -------- | ---------------------------------------- |
| **OpenAI API Key**     | Password | API key for OpenAI models                |
| **Ollama API URL**     | Text     | Base URL for self-hosted Ollama instance |
| **GROQ API Key**       | Password | API key for Groq models                  |
| **OpenRouter API Key** | Password | API key for OpenRouter                   |
| **Anthropic API Key**  | Password | API key for Anthropic (Claude) models    |
| **Gemini API Key**     | Password | API key for Google Gemini models         |
| **Deepseek API Key**   | Password | API key for Deepseek models              |
| **AI/ML API Key**      | Password | API key for AI/ML platform               |
| **LM Studio API URL**  | Text     | Base URL for LM Studio instance          |

- After saving an API key or URL, the page re-fetches `/api/config` to update available model lists.
- A spinning indicator appears briefly beside the field during save.

---

## Collapsible Sections

Each settings section is wrapped in a collapsible component:

- **Title**: Clickable to expand/collapse.
- **Info tooltip** (optional): Some sections have an info icon that opens a click-to-toggle explanation popup.
- Sections are collapsed by default and expand when clicked.

---

## Save Behavior

- **API key and URL fields**: Save on blur via `POST /api/config`.
- **Model selections (chat, embedding)**: Save to both localStorage and server config.
- **Model selections (system)**: Save to localStorage only.
- **Toggle switches**: Save immediately on change.
- **Personalization fields**: Save immediately on input change to localStorage.
- **Persona prompts**: Save via dedicated API endpoints (`POST`, `PUT`, `DELETE /api/system-prompts`).
- **Saving feedback**: A spinning indicator appears next to the field being saved, lasting approximately 500ms.
