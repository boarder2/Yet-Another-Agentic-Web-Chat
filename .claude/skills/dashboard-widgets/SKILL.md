---
name: dashboard-widgets
description: Use when working on dashboard widgets — LLM-transformed widgets, user-JS code widgets, the Docker sandbox runner, source fetching/sanitization, charts, the in-editor widget-builder agent, theme-aware rendering, or the /dashboard and home-page boards.
---

# Dashboard Widgets

Two widget kinds, a discriminated union in `src/lib/types/widget.ts`:

- **`LlmWidgetConfig`** (`widgetType: 'llm'`) — `prompt` + `provider`/`model` + optional `tool_names`. Output is produced per-refresh by an LLM transforming fetched sources.
- **`CodeWidgetConfig`** (`widgetType: 'code'`) — user-authored JS run **deterministically** in the Docker sandbox (gated on code execution being enabled). Replaces per-refresh LLM calls.

Both extend `WidgetConfigBase` (sources, refresh cadence, per-surface placement). `Widget` adds runtime fields (`content`, `error`, `charts`, layouts). Placement is per-surface: `showOnHome` / `showOnDashboard` are independent, with independent `homeLayout` / `layout` grids. `showOnDashboard === undefined` ⇒ treated as `true` (back-compat).

## Two surfaces, shared hook

Rendered on `/dashboard` (`src/app/dashboard/page.tsx`) and the home/new-chat page (`EmptyChat` via `HomeWidgetBoard`). Both share `useWidgetBoard` (`src/lib/hooks/`); board UI in `src/components/dashboard/`. Widget content is rendered by `WidgetContent.tsx` (chart provider + sanitize); `useDashboard.ts` manages load/import/cache (replace-not-merge `updateWidget`; `widgetType` branch + migration in load+import; `invalidateWidgetCache`).

## Processing routes (`src/app/api/dashboard/*`)

- `process-widget/route.ts` — LLM widgets. Theme appended to the prompt; sources fetched server-side.
- `process-code-widget/route.ts` — runs code widgets via `codeWidgetRunner`.
- `widget-builder/route.ts` — SSE stream for the Phase-2 builder agent; **server-enforced 4-tool allowlist**.

Sources are always fetched server-side via `src/lib/dashboard/sources.ts` (`fetchSourceContent`, `MAX_SOURCES_PER_WIDGET`).

## Sandbox & runner

`src/lib/dashboard/codeWidgetRunner.ts` — nonce harness, fail-closed parse, semaphore (N=3), line-mapped categorized errors. Runs via `src/lib/sandbox/dockerExecutor.ts` `executeCode(code, { stdin })`. Code-widget contract: `render({ sources, now, location, theme })` — the single source of truth is `WIDGET_THEME_CONTRACT` in `src/lib/widgets/widgetTheme.ts`, reused by `codeWidgetTemplate.ts`, the modal RuntimeHelp, and the builder prompt.

## Output sanitization

`src/lib/dashboard/sanitizeWidgetOutput.ts` (DOMPurify). Output is markdown (markdown-to-jsx) and may carry `<Chart id="c0"/>`. Policy (owner-approved-code trust model): images ALLOWED incl. remote http(s) + raster `data:`; **SVG blocked** in every form; script/iframe/object/embed/base/link/style blocked; inline `style` allowed (CSS still sanitized); `<Chart>` preserved.

## Charts

`src/lib/chart/chartSpec.ts` — `ChartSpec` (Zod-validated), `CHART_MAX_PER_WIDGET`, size caps. Series accept a `color` field (validated by `isCssColor`). Specs cached alongside widget content.

## Theme-aware rendering

`src/lib/widgets/widgetTheme.ts` is the hub. `resolveWidgetTheme()` resolves live CSS tokens to concrete `rgb()` (client-only, via a throwaway probe element); `DEFAULT_WIDGET_THEME` is the server/fallback; `themePromptBlock()` builds the LLM prompt section. The client sends `theme` on every refresh and preview. LLM widgets get it in the prompt; code widgets get it as the 4th `render()` arg (injected via stdin); the builder threads it through to its previews too.

## Phase-2 widget-builder agent

In-editor agent proposing incremental widget edits. Prompt: `src/lib/prompts/simplifiedAgent/widgetBuilder.ts`. Tools: `src/lib/tools/agents/widgetBuilderTools.ts` — one factory (per-turn closure) = `read_current_widget`, `sample_source`, `preview_widget_output` (≤5/turn), `propose_widget_changes` (emits `widget_proposal`). Reuses `SimplifiedAgent.searchAndAnswer(customTools, customSystemPrompt)` — no class change. UI: `WidgetChatPanel` + `WidgetProposalCard` (delta + Accept/Reject, base-revision stamp).

### Mode-dependent within-turn state (IMPORTANT)

Tools close over a per-turn `ctx.state` rebuilt from `body.widget`. `propose_widget_changes` advances `ctx.state` to the proposed code **only when `ctx.autoAccept` is ON** (auto-apply ⇒ proposal is truly applied client-side, so the agent can preview→fix→re-propose in a loop). In **manual** mode advancing is a bug (the agent previews unapproved code, thinks it's applied, and runs past the approval gate): leave `ctx.state` untouched, return a hard STOP ("not applied, end your turn"), exactly ONE proposal/turn. Client `handleAcceptProposal` must **not** bump the revision (only user manual edits bump) — bumping makes later same-turn proposals go stale in auto-accept.

## Gotchas

- **Sandbox stdin needs `hijack: true`** on dockerode `container.attach` — without it `stream.end()` never half-closes the socket and the container's `readFileSync(0)` blocks until timeout ("preview does nothing"/hangs). The post-wait drain is bounded by a 2s race + `destroy()` so a stuck drain can't hang the request or leak a semaphore slot.
- **No SSRF guard in `sources.ts` — deliberate.** Self-hosted single-user; sources are operator-authored/approved/visible; internal/LAN/localhost sources are a wanted feature. Plain fetch, any scheme/host, follows redirects. Reinstate only if the app ever goes multi-tenant (comment in-file explains the choice).
- Dashboard localStorage keys (`yaawc_dashboard_*`) are DB-synced — see `settings-persistence`.

Related: `streaming-events` (`widget_proposal`, widget-builder stream), `settings-persistence`, `design-system`, `prompt-system`.
