---
name: prompt-system
description: Use when modifying agent prompts, focus-mode prompts, citation formatting, personalization context injection, system prompts, or debugging how the agent responds.
---

# Prompt System

YAAWC uses a layered prompt architecture for the `SimplifiedAgent`, assembled in `createEnhancedSystemPrompt()` inside `src/lib/search/simplifiedAgent.ts`.

## Architecture Overview

```
User-managed system prompts (DB: systemPrompts table, type='persona')
    ↓ resolved by ID via getPersonaInstructionsOnly() → personaInstructions
Focus mode prompt (src/lib/prompts/simplifiedAgent/*.ts)
    ↓ receives personaInstructions + personalizationSection
Personalization section (src/lib/utils/personalization.ts → buildPersonalizationSection())
    ↓ appended inside focus-mode prompt builder
Memory section (src/lib/prompts/memory/memoryContext.ts → buildMemorySection())
    ↓ appended after base prompt when memories retrieved
Memory tools instructions
    ↓ appended inline when memoryEnabled=true
Workspace suffix
    ↓ appended if workspaceSuffix present
Skills section (src/lib/skills/promptSection.ts → buildSkillsPromptSection())
    ↓ appended last; only model-visible, non-invoked skills
Final system prompt → SimplifiedAgent
```

## Focus Mode Prompts

Located in `src/lib/prompts/simplifiedAgent/`:

| File                  | Mode            | Has Tools          | Key Behavior                                                                            |
| --------------------- | --------------- | ------------------ | --------------------------------------------------------------------------------------- |
| `webSearch.ts`        | `webSearch`     | Yes (all tools)    | Research assistant, iterative strategy, citation instructions                           |
| `chat.ts`             | `chat`          | No                 | Conversational AI, no tool access, direct response                                      |
| `localResearch.ts`    | `localResearch` | Yes (file_search)  | Document analysis with file citation style                                              |
| `firefoxAI.ts`        | Firefox AI      | No (auto-detected) | Tools disabled, conversational response                                                 |
| `chartingGuidance.ts` | (shared helper) | —                  | `buildChartingGuidance(codeExecutionEnabled)` injected into webSearch and localResearch |

Each focus-mode builder takes `(personaInstructions, personalizationSection, ...)`. When `personaInstructions` is non-empty it replaces the default formatting template block; otherwise the template block is included directly.

Unknown focus modes fall through to `webSearch` with a console warning.

## Formatting & Citation Templates

Located in `src/lib/prompts/templates.ts`. These are `Prompt` objects with `id`, `name`, `content`, `type='persona'`, `readOnly: true`:

| Template                          | Used By                   | Citation Style                                              |
| --------------------------------- | ------------------------- | ----------------------------------------------------------- |
| `formattingAndCitationsWeb`       | `webSearch` (default)     | `[N]` notation, `[AI]`/`[Hist]`/`[Mem]` markers, deep links |
| `formattingAndCitationsLocal`     | `localResearch` (default) | Local document citations with file references               |
| `formattingChat`                  | `chat` (default)          | Minimal — no citations, conversational                      |
| `formattingAndCitationsScholarly` | selectable via persona ID | Academic format with abstract/intro/methodology sections    |

These four are also recognized by `getPersonaInstructionsOnly()` and can be selected as persona prompts by their `id` value (resolved in-memory, not from DB).

To add a new citation style: create a new `Prompt` in `templates.ts`, add it to the base-prompts list in `src/lib/utils/prompts.ts`, and import it in the relevant focus mode prompt file.

## Personalization Context

When personalization toggles are enabled in the UI, context is injected into the system prompt via `buildPersonalizationSection({ location, profile })` from `src/lib/utils/personalization.ts`. The function takes a single object (not positional args).

### Section structure

Generates a `## Personalization` block appended **inside** the focus-mode prompt builder (passed as `personalizationSection`) with:

- **Privacy directive**: Keep details as private internal context; share back only when explicitly asked
- **Relevance directive**: Use only when it clearly improves answer quality, relevance, or tone
- **Safety directive**: Keep out of tool calls, web requests, and citations
- **Authority directive**: If user's latest message conflicts, follow the latest user message

### Data flow

1. User toggles location/about-me in `PersonalizationPicker` component
2. Preferences stored in localStorage (`sendLocation`, `sendProfile`)
3. `ChatWindow.sendMessage()` reads toggles and includes `userLocation`/`userProfile` in payload
4. API route passes them directly to `SimplifiedAgent`
5. `SimplifiedAgent.createEnhancedSystemPrompt()` calls `buildPersonalizationSection({ location: this.userLocation, profile: this.userProfile })` and passes result to the focus-mode builder
6. Subagents receive `userLocation`/`userProfile` for search context but get empty `personaInstructions`

## Memory Context

When `memoryEnabled=true` and relevant memories are found, two additions are made to the prompt:

1. **Memory section** (from `src/lib/prompts/memory/memoryContext.ts`, `buildMemorySection(scoredMemories)`): A `## Memories from Your Past Interactions` block appended after the base prompt. Capped at ~800 tokens.
2. **Memory tools instructions**: Inline block appended when `memoryEnabled=true` governing when to call `save_memory`, `delete_memory`, `list_memories` — only on explicit user request.

Memory classification and extraction prompts live in `src/lib/prompts/memory/classification.ts` and `src/lib/prompts/memory/extraction.ts`.

## Skills Section

After workspace suffix, `buildSkillsPromptSection(modelVisibleSkills)` from `src/lib/skills/promptSection.ts` appends a `## Available Skills` block listing skills with `read_skill` instructions. Only skills where `!s.disableModelInvocation && !invokedSkillNames.has(s.name)` are included.

## Methodology Instructions

`methodologyInstructions` (resolved from `selectedMethodologyId` in API route via `getMethodologyInstructions()`) overrides the default Research Strategy section in `webSearch` and `localResearch` prompts. Built-in methodology templates live in `src/lib/prompts/methodologyTemplates.ts`; custom ones are stored in DB with `type='methodology'`.

## User-Managed System Prompts (Personas)

Stored in the `systemPrompts` database table:

```typescript
// Schema: src/lib/db/schema.ts
{
  id: string; // UUID
  name: string; // Display name
  content: string; // Prompt text
  type: 'system' | 'persona' | 'methodology'; // 'system' is legacy; use 'persona' for formatting/persona prompts
  createdAt: Date;
  updatedAt: Date;
}
```

### How they're applied

1. User selects prompts via `SystemPromptSelector` component
2. Selected IDs sent as `selectedSystemPromptIds` in chat payload (legacy name; treated as persona prompt IDs)
3. API route calls `getPersonaInstructionsOnly(selectedSystemPromptIds)` from `src/lib/utils/prompts.ts`
   - Checks built-in base prompts first (by `id`), then queries DB for `type='persona'` records
4. Content concatenated and passed as `personaInstructions` to `SimplifiedAgent`
5. `SimplifiedAgent.createEnhancedSystemPrompt()` passes `personaInstructions` to the focus-mode builder
6. Non-empty `personaInstructions` replaces the default formatting template block in the prompt

### API endpoints

- `GET /api/system-prompts` — List all system prompts
- `POST /api/system-prompts` — Create a new prompt
- `PUT /api/system-prompts/[id]` — Update a prompt
- `DELETE /api/system-prompts/[id]` — Delete a prompt

## Modifying Prompts

When changing agent behavior:

1. **Change what the agent says/does**: Edit the focus mode prompt in `src/lib/prompts/simplifiedAgent/`
2. **Change citation format**: Edit or add templates in `src/lib/prompts/templates.ts`; also register new templates in `getPersonaInstructionsOnly()` in `src/lib/utils/prompts.ts`
3. **Change personalization behavior**: Edit `src/lib/utils/personalization.ts`; function signature is `buildPersonalizationSection({ location?, profile? })`
4. **Change memory context behavior**: Edit `src/lib/prompts/memory/memoryContext.ts`
5. **Add a new focus mode prompt**: Create a new file in `simplifiedAgent/`, register the `case` in `createEnhancedSystemPrompt()` in `SimplifiedAgent`
6. **Add/modify methodology templates**: Edit `src/lib/prompts/methodologyTemplates.ts` for built-ins, or add DB records with `type='methodology'`
