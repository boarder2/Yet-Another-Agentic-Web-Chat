---
name: yaawc-prompt-system
description: Use when modifying agent prompts, focus-mode prompts, citations, personalization/memory context injection, personas, or debugging agent responses.
---

# Prompt System

Layered system prompt, assembled in `createEnhancedSystemPrompt()` in `src/lib/search/simplifiedAgent.ts`:

```
Persona prompts (DB systemPrompts type='persona', resolved by ID via getPersonaInstructionsOnly())
  → focus-mode prompt (src/lib/prompts/simplifiedAgent/*.ts) — non-empty personaInstructions
    REPLACES the default formatting template block
  + personalization section (appended inside the focus-mode builder)
  + memory section + memory-tools instructions (when memoryEnabled)
  + workspace suffix
  + skills section (only model-visible, non-invoked skills)
  + capability-grounding guidance (final for user-originated runs)
```

## Focus-mode prompts (`src/lib/prompts/simplifiedAgent/`)

`webSearch.ts` (all tools, iterative research + citations) · `chat.ts` (conversational, no tools) · `localResearch.ts` (file_search, file citations) · `firefoxAI.ts` (auto-detected, no tools) · `chartingGuidance.ts` (shared `buildChartingGuidance(codeExecutionEnabled)` injected into webSearch/localResearch). Unknown modes fall through to `webSearch` with a console warning.

## Formatting & citation templates (`src/lib/prompts/templates.ts`)

Read-only `Prompt` objects, selectable as personas by `id` (resolved in-memory, not DB): `formattingAndCitationsWeb` (`[N]`, `[AI]`/`[Hist]`/`[Mem]` markers), `formattingAndCitationsLocal`, `formattingChat`, `formattingAndCitationsScholarly`. New citation style: add a `Prompt` in `templates.ts`, register it in the base-prompts list in `src/lib/utils/prompts.ts`, import in the focus-mode file.

## Injected sections

- **Personalization** — `buildPersonalizationSection({ location, profile })` (`src/lib/utils/personalization.ts`; single object arg). Emits a `## Personalization` block with privacy/relevance/safety/authority directives (keep private, use only when it helps, never in tool calls or citations, latest user message wins). Values are server-authoritative (`app_settings`); subagents get location/profile but empty `personaInstructions`.
- **Memory** — `buildMemorySection(scoredMemories)` (`src/lib/prompts/memory/memoryContext.ts`, ~800-token cap) + inline tool instructions (call `save_memory`/`delete_memory`/`list_memories` only on explicit request). Classification/extraction prompts in `src/lib/prompts/memory/`.
- **Artifacts** (`artifactGuidance.ts`) — gated on `artifactsEnabled` (`!isPrivate`; never in `chat`/`firefoxAI`): static `## Artifacts` guidance + `buildArtifactRoster(artifacts, now)` — one entry per artifact (id, title, version, relative time; workspace-owned entries carry a read-before-edit warning). The agent self-fetches the roster via `listChatRoster(scope)` at prompt-build time (chat-created ∪ user-mentioned, scanned from persisted messages — can't drift from the transcript). `now` is a parameter for unit-testability.
- **Skills** — `buildSkillsPromptSection(modelVisibleSkills)` (`src/lib/skills/promptSection.ts`): `## Available Skills` with `read_skill` instructions; excludes `disableModelInvocation` and already-invoked skills.
- **Capability grounding** — `buildCapabilityDocsGuidance()` (`src/lib/prompts/simplifiedAgent/capabilityDocsGuidance.ts`) is appended after persona, memory, workspace, and skills. It requires `search_yaawc_docs` for YAAWC claims, exact section citations, concise broad answers, fail-closed uncertainty, and safe coarse status. It is not appended to custom deep-research prompts.
- **Methodology** — `methodologyInstructions` (resolved from `selectedMethodologyId` via `getMethodologyInstructions()`) overrides the Research Strategy section in webSearch/localResearch. Built-ins in `methodologyTemplates.ts`; custom in DB (`type='methodology'`).

## Personas

`systemPrompts` table (`type: 'system' | 'persona' | 'methodology'`; `'system'` is legacy). Selected IDs arrive as `selectedSystemPromptIds` (legacy name), resolved by `getPersonaInstructionsOnly()` (built-ins by `id` first, then DB `type='persona'`), concatenated into `personaInstructions`. CRUD: `/api/system-prompts(/[id])`.

## Where to change what

- Agent behavior → focus-mode prompt file
- Citation format → `templates.ts` (+ register in `utils/prompts.ts`)
- Personalization/memory context → their builders above
- New focus mode → see `yaawc-adding-features`

Specs assert prompt composition through the `test-prompt-echo` model, which answers with the system prompt it was given. The capability variants in `e2e/CLAUDE.md` exercise the real docs-tool loop and source/citation path.
