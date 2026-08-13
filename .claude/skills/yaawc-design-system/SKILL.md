---
name: yaawc-design-system
description: MUST be used for any UI work — components, Tailwind/CSS, styling, color/spacing/radius/shadow/typography decisions, globals.css, or anything under src/components or src/app.
---

# YAAWC Design System

Tokens live in `src/app/globals.css` under `@theme` (Tailwind v4 CSS-first). **Anything that doesn't read from a token will not theme correctly.**

## Theming

A theme is **seven seeds** (`bg`, `fg`, `surface`, `accent`, `danger`, `success`, `warning`) + mode. `src/lib/theme/` owns it: `themes.ts` (built-in catalogue), `derive.ts` (pure colour maths — only the contrast-picked foregrounds are computed in TS), `apply.ts` (writes seeds onto `:root`; render-blocking boot script in `layout.tsx`). Everything else derives in `globals.css` via `color-mix` toward `var(--color-fg)`, so derivations are mode-agnostic and a theme switch needs no re-render.

- Built-ins are immutable; the one custom slot is written only by explicit, overwrite-confirmed copy/paste, and seed pickers are enabled only while it's active.
- A theme names a `syntax` style bound to both code renderers from one key (`syntax/` → Prism for fences; `codemirror.ts` derives the editor theme from the same style — kept out of `syntax/index.ts` so CodeMirror stays out of the chat bundle). Fences/editors paint the style's _own_ background, not `--color-surface`. Themes carry `family`/`variant` metadata: pickers show one tile per family per mode with a variant dropdown. Catppuccin (4 flavours × 14 accents) is generated from one shared table (`catppuccinPalette.ts`). Palette details: `docs/THEMES.md`.
- **Adding a token**: derive it with `color-mix` in `@theme`; only add a seed if it genuinely can't be derived (every seed is another picker + another value on every theme).
- **Reading the theme in a component**: `useActiveTheme()` — never read `document.documentElement` during render.
- Mode-specific CSS goes in the `[data-theme='light']` block, only for things that can't derive from a seed. `data-theme` is `light`/`dark` only.

## Tokens

- **Surface**: `bg-bg`, `bg-surface`, `bg-surface-2`, `bg-well`, `text-fg`, `border-surface-2` (alias `border-border`), `border-border-strong`, `bg-overlay`, `bg-overlay-strong`
- **Brand**: `bg-accent`, `bg-accent-500/600/700`, `text-accent`, `text-accent-fg`, `border-accent`
- **Status**: `danger`/`success`/`warning`/`info` each as `bg-*`, `bg-*-soft`, `text-*`, `text-*-fg`, `border-*`; `bg-danger-700` for hover
- **Radius**: `rounded-control` (inputs/chips/small buttons) · `rounded-surface` (cards/panels) · `rounded-floating` (modals/popovers) · `rounded-pill`. Concentric: outer larger, inner smaller.
- **Shadow**: `shadow-resting/raised/floating` only — sparingly; this UI reads elevation from borders + surface contrast.
- **Motion**: `transition-colors` + `duration-100/150/200`; CSS props `--duration-fast/base/slow`, `--ease-standard`. Extra classes: `animate-badge-pop` (one-shot spring entrance), `animate-indeterminate` (progress slide); `animate-spin` for spinners.
- **Typography**: body `text-sm` weight 400; `font-medium` emphasis; `font-semibold` headings (`text-lg/xl/2xl/3xl`); captions `text-xs`.
- **Spacing**: Tailwind 4px scale; half-steps (`gap-1.5`, `p-1.5`) are intentional for dense UI. Common: `py-2 px-3`, `gap-2`, `p-2`, `p-4` — match neighbors.

## Primitives (`src/components/ui/`) — use them, never hand-roll the role

Hand-rolling is what produced 46 button spellings, 21 card spellings, four list-row title sizes. If a needed semantic doesn't exist, extend the system (add a token to `@theme`) rather than reach for a raw value.

- **`Button`** — every labeled action button. `variant` (`primary` accent fill · `secondary` default · `ghost` · `danger`), `size` (`sm/md/lg`), `icon`, `loading` (spinner + disable + `aria-busy`). Owns focus ring, disabled, hover — `className` is layout only. Link-as-button: `buttonClasses(variant, size)`. Out of scope: bare icon buttons, tab strips, chips.
- **`Card`** — every bordered content surface. Flat (no shadow); `radius` `surface` (default) or `floating` (outer wrapper). `className` for padding/layout only; optional `CardHeader/Title/Description/Content/Footer` slots.
- **`ApprovalPanel`** — shell for every in-message approval/prompt: header bar, `shadow-raised` floating card, capped scrolling body, `justify-end` footer. Props: `icon`, `title`, `chips`, `queuePosition/Total`, `onDismiss`, `footer`.
- **`Modal`** — the ONLY dialog shell; never hand-roll a `fixed inset-0` scrim or use headlessui `Dialog` directly. `size` `sm/md/lg/xl/full` (never pass a width class); `title` renders header + close; `footer` holds the `Button`s (body `<form>` submits via `form={id}`); body scrolls at `p-5` (`bodyClassName` to override). Scrims outside Modal use `bg-overlay(-strong)`.
- **`Input` / `Textarea` / `Field` / `Select`** — every text form control and `<select>`. Shared `controlClasses`: `bg-well px-3 py-2 border border-surface-2 rounded-control text-sm …`. Focus is a **1px accent border flip in place** (`focus-visible:outline-none focus-visible:border-accent` + `transition-colors`) — no rings, nothing reflows. `Field` renders a wrapping `<label>` (implicit association); `hint`/`error` render outside the label, wired to `aria-describedby`/`aria-invalid` via `FieldContext` — don't also set `aria-label` when Field supplies the visible label. Textarea adds `resize-y`. Only raw inputs left: file/color/checkbox/radio; the chat composer reuses `controlClasses` on `react-textarea-autosize`. `className` for layout/density/deliberate overrides only.
- **`List`** (`ListRow`, `ListRowAction`, `ListLoading`, `ListEmptyState`, `ListCount`) — every page-level browse list. `ListRow` slots: `leading`/`title`/`body`/`meta`/`actions`; `py-3`, `border-b border-surface-2`, title `text-base font-medium truncate`. **Navigation is a real `<a>`**: pass `href` (stretched link overlay) — never `router.push` on a `role="link"` div; nested clickables lift above via `listRowInteractive`. Chips are meta segments (`gap-x-3`, no interpuncts). Actions always visible (hover-reveal fails on touch), hover fill `bg-surface`. Destructive actions open a `Modal`, never inline Confirm/Cancel. Rows never stack responsively — meta wraps. e2e hooks: `data-list-row`, `data-list-row-title`.
- **`Tabs`** — every tab strip. `items: TabItem[]` (`key`, `label`, `icon?`, `href?` for link tabs — `replace?` avoids history stacking — or `onClick`) + `activeKey`; pass `aria-label`.
- **`AppSwitch`** — every boolean toggle (headlessui `Switch` styled to tokens): `checked`, `onChange`, `disabled?`, `aria-label`.
- **Composer-local controls** — `ComposerActionButton` centralizes compact-square/content-width utility-trigger states and focus treatment; `ComposerPopover` centralizes composer floating-shell appearance. Popover callers retain Headless UI behavior, positioning, and nesting.
- **Spinners** — `<LoaderCircle className="animate-spin" />`, `text-accent` unless inside a colored fill. Sizes: 14 inline-icon · 16 small · 20 list/panel · 24 section · 32 full-page.

## Rules

- **ALWAYS** semantic tokens for every color, radius, shadow, spacing decision — surface tokens for surfaces, `bg-accent`+`text-accent-fg` (hover `bg-accent-700`) for brand actions, `*-soft`/`text-*` status tokens for errors/success/warnings.
- **NEVER** hardcode hex/`rgb()`/`oklch()` literals, raw Tailwind palette colors (`bg-red-500`, `text-gray-700`), or `text-white`/`bg-black` — they don't flip with theme.
- **NEVER** `bg-fg/*` for scrims (`fg` is light on dark themes) — use `bg-overlay`.
- **NEVER** arbitrary radii (`rounded-[10px]`) or new shadow utilities.
- **NEVER** strip a focus ring with bare `outline-none`.
- **NEVER** legacy aliases (`bg-light-primary`, `bg-dark-100`, …) in new code, or shadcn-style tokens that don't exist here (`bg-card`, `text-muted-foreground`, `bg-primary`, …). Don't invent names (`bg-surface-3`) — check `globals.css` first.

## Verifying

Themes can be light, dark, or fully custom (user-chosen bg + accent) — check legibility of any new surface/text combo across all three; non-token colors won't respond. The `ThemeController` overrides `--color-blue-*` with the user's accent, so `bg-blue-600` silently picks up the accent — don't rely on it.

Files of record: `src/app/globals.css` (tokens), `src/components/theme/Controller.tsx` (runtime theming), `src/components/ui/*` (primitives listed above).
