---
name: design-system
description: YAAWC design system rules and tokens. MUST be used whenever editing or creating UI — any .tsx component, Tailwind class change, styling work, color/spacing/radius/shadow/typography decision, or globals.css edit. Activates on terms like "component", "style", "UI", "button", "card", "modal", "color", "theme", "dark mode", "Tailwind", "CSS", "layout", "padding", "spacing", "rounded", "shadow", "hover", "focus", "MessageBox", "Sidebar", "Navbar", "ChatWindow", or any work under src/components or src/app.
---

# YAAWC Design System

Tokens live in `src/app/globals.css` under `@theme` (Tailwind v4 CSS-first). Tailwind auto-generates utilities from these tokens. **Anything that doesn't read from a token will not theme correctly.**

## Theming

A theme is **seven seeds** — `bg`, `fg`, `surface`, `accent`, `danger`, `success`, `warning` — plus a mode (`light` | `dark`). `src/lib/theme/` owns it: `themes.ts` is the built-in catalogue (single source of truth), `derive.ts` is the pure colour maths, `apply.ts` writes the seeds onto `:root` and exports the render-blocking boot script used by `layout.tsx`. Built-in and custom themes are the same shape, but built-ins are immutable: the one custom slot is written only by an explicit, overwrite-confirmed action (Edit in the Customize header, which copies the theme being previewed, or Paste), and the seed pickers are disabled unless the custom theme is active. A theme also carries a `syntax` key naming its code style, bound to two renderers so an editor and a fence painted from one key look alike: `syntax/` maps it to a Prism style for `CodeBlock` and `FileViewer`, and `codemirror.ts` derives a CodeMirror theme from that same Prism style for the editors. Only the two stock themes fall back to One Dark / One Light by mode; every other theme names its own. `syntax/index.ts` registers two sources — the styles bundled with `react-syntax-highlighter`, and the families with no Prism port, authored per-family from each project's own spec through `syntax/build.ts` (see `docs/THEMES.md`). No style names a font, so code renders in the app's mono everywhere. A fence and an editor are painted with the style's _own_ background, not `--color-surface`, so a code theme reads as itself; styles with no solid fill fall back to the surface token. `codemirror.ts` is kept out of `syntax/index.ts` deliberately — that module reaches the chat bundle via `CodeBlock`, and CodeMirror must not. Themes also carry optional `family`/`variant` metadata: the Appearance picker shows one tile per family per mode with a variant dropdown, not one tile per theme. The syntax picker is the same two axes as two dropdowns — style family, then variant. Catppuccin is generated rather than listed, four flavours × fourteen palette accents, in both the theme catalogue and the syntax styles from one shared table (`catppuccinPalette.ts`); its variant lists group accents under their flavour.

Everything else **derives from the seeds in `globals.css`** via `color-mix`, so a theme switch needs no re-render. Derivations mix toward `var(--color-fg)` rather than black/white, which makes them mode-agnostic — one expression lightens on a dark theme and darkens on a light one. Only the contrast-dependent foregrounds (`accent-fg`, `danger-fg`, `success-fg`, `warning-fg`) are computed in TS.

- **Adding a token**: if it derives proportionally from a seed, add it as `color-mix` in `@theme`. Only add a seed if it genuinely can't be derived — every seed is another picker in the UI and another value on every built-in theme.
- **Reading the active theme in a component**: `useActiveTheme()` (`src/lib/theme/useActiveTheme.ts`). Never read `document.documentElement` during render — it won't update when the theme changes.
- **Mode-specific CSS** belongs in the `[data-theme='light']` block, and only for things that can't derive from a seed. `data-theme` is `light`/`dark` only — there is no `custom` mode.
- Adding or changing a built-in palette: see `docs/THEMES.md`.

## Available tokens (semantic — use these names)

**Surface**: `bg-bg`, `bg-surface`, `bg-surface-2`, `text-fg`, `border-surface-2`, `border-border` (alias for `border-surface-2`), `border-border-strong`, `bg-overlay`, `bg-overlay-strong`

**Brand**: `bg-accent`, `bg-accent-500`, `bg-accent-600`, `bg-accent-700`, `text-accent`, `text-accent-fg`, `border-accent`

**Status**: `bg-danger`, `bg-danger-700` (hover), `bg-danger-soft`, `text-danger`, `text-danger-fg`, `border-danger`, `bg-success`, `bg-success-soft`, `text-success`, `text-success-fg`, `bg-warning`, `bg-warning-soft`, `text-warning`, `text-warning-fg`, `border-warning`, `bg-info`, `bg-info-soft`, `text-info`, `border-info`

**Radius**: `rounded-control` (inputs/chips/small buttons), `rounded-surface` (default cards/panels), `rounded-floating` (modals/popovers/raised cards), `rounded-pill` (avatars/badges)

**Shadow**: `shadow-resting`, `shadow-raised`, `shadow-floating` — use sparingly; this UI prefers borders + surface contrast over elevation.

**Motion**: `duration-100` (fast), `duration-150` (base), `duration-200` (slow). Pair with `transition-colors` for hover/focus. The codebase also defines named CSS custom properties `--duration-fast` (100ms), `--duration-base` (150ms), `--duration-slow` (200ms), and `--ease-standard: cubic-bezier(0.2,0,0,1)` — use these when writing custom CSS rather than hardcoding ms values.

**Typography**: body defaults to `text-sm` weight `400` (normal). Use `font-medium` (500) for emphasis and `font-semibold` (600) for headings. Named CSS props: `--weight-body: 400`, `--weight-emphasis: 500`, `--weight-strong: 600`. Heading scale: `text-lg` / `text-xl` / `text-2xl` / `text-3xl`. Captions use `text-xs`.

**Spacing**: standard Tailwind 4px scale. Half-steps (`gap-1.5`, `py-0.5`, `p-1.5`) are intentional for dense UI — not outliers.

## Animation utilities

Globals.css defines two additional animation classes beyond standard Tailwind:

- `animate-badge-pop` — one-shot spring-scale entrance (e.g. sidebar in-progress badge). Uses `cubic-bezier(0.34, 1.56, 0.64, 1)` over 0.4s.
- `animate-indeterminate` — infinite indeterminate progress bar slide (40% width, 1.4s ease-in-out).

Use `animate-spin` from Tailwind for continuous rotation (spinners).

## Buttons

`src/components/ui/Button.tsx` is the shared primitive — **use it for every labeled action button**; don't hand-roll `<button className="bg-accent …">`.

- `variant`: `primary` (accent fill) · `secondary` (default, `bg-surface-2`) · `ghost` (transparent) · `danger` (danger fill)
- `size`: `sm` · `md` (default) · `lg`
- `icon={LucideIcon}` renders a leading icon at the size tier's scale; `loading` swaps it for a spinner, disables the button and sets `aria-busy`
- It owns the focus ring, disabled treatment, transition and hover — pass `className` only for layout (`w-full`, `self-start`) or a deliberate shape override (`rounded-pill`)
- Non-`<button>` triggers (a `<Link>` styled as a button) use the exported `buttonClasses(variant, size)`
- Out of scope: bare icon-only buttons, tab strips, sidebar links and chips still style themselves

## Cards

`src/components/ui/Card.tsx` is the shared surface primitive — **use it for every bordered content surface**; don't retype `bg-surface border border-surface-2 rounded-*`. It is flat by design (no shadow): this UI reads elevation from borders and surface contrast.

- `radius`: `surface` (default) · `floating` for an outer container that wraps nested `rounded-surface` cards. Concentric radii — outer larger, inner smaller.
- Pass `className` for padding and layout only (`p-4`, `flex flex-col`); it spreads the rest, so `onClick`/`data-*` work.
- `CardHeader` / `CardTitle` / `CardDescription` / `CardContent` / `CardFooter` are optional slots at `p-4`; most cards supply their own header instead.
- Out of scope: form controls, popovers/dropdowns (they own elevation + focus behavior) and hover chips. They share the recipe but not the role.

`src/components/ui/ApprovalPanel.tsx` is the shell for every in-message approval/prompt (code execution, MCP tool, workspace + skill edits, agent questions). It owns the header bar, the `shadow-raised` floating card, the height cap with a scrolling body, and the `justify-end` footer — pass `icon`, `title`, optional `chips` (`ApprovalChip` for a monospace identifier), `queuePosition`/`queueTotal`, `onDismiss`, `footer` and the body as children.

## Lists

`src/components/ui/List.tsx` is the shared browse-list vocabulary — **use it for every page-level list of records** (History conversations, History artifacts, Scheduled Tasks). It exists because three lists had grown four title sizes, four row paddings, three hover idioms and three empty-state spellings for one role.

- `ListRow` slots: `leading` (unread dot, pin) · `title` · `body` (a search excerpt) · `meta` · `actions`. Row is `py-3` with `border-b border-surface-2` between rows; title is `text-base font-medium truncate` and owns its line; meta is `text-xs text-fg/60`.
- **Navigation is a real `<a>`**: pass `href` and the title link stretches over the row via `after:absolute after:inset-0`, so cmd/middle-click and open-in-new-tab work. Never navigate a row with `router.push` on a `role="link"` div. A row with no `href` gets no overlay and no hover fill.
- Anything else clickable inside the row — a nested chip `<Link>`, the action cluster — must lift above that overlay with the exported `listRowInteractive` class.
- Chips (workspace, private, scheduled) are **meta segments**, not title-line decorations. Meta segments are separated by `gap-x-3`, never by interpuncts, and carry an icon only when it means something (status, not decoration).
- `ListRowAction` is the icon-button in the trailing cluster (`listRowActionClasses()` for a `<Link>` trigger). Actions stay **always visible** — hover-reveal is unreachable on touch. Its hover fill is `bg-surface`, the inverse of the row's `bg-surface-2`, so it stays visible on a hovered row.
- Destructive actions open a `Modal`; never swap the cluster for inline Confirm/Cancel buttons, which makes the row reflow.
- Rows never stack responsively — the meta row wraps instead.
- `ListLoading` (`min-h-[30vh]`, spinner 32), `ListEmptyState` (one centred `text-sm text-fg/70` line, may contain an inline accent link) and `ListCount` (`text-xs text-fg/50` above the list) are the chrome. Card grids (Workflows, Workspaces) keep their richer icon + CTA empty states.
- Rows expose `data-list-row` and titles `data-list-row-title` as e2e hooks; `data-*` props pass through.

## Modals

`src/components/ui/Modal.tsx` is the **only** dialog shell — never hand-roll a `fixed inset-0` scrim, and never reach for headlessui's `Dialog`/`DialogPanel` directly. It supplies the focus trap, `role="dialog"`, Escape, background inerting and the fade/scale transition.

- `size`: `sm` (`max-w-md`) · `md` (default, `max-w-2xl`) · `lg` (`max-w-4xl`) · `xl` (`max-w-5xl`) · `full` (`w-[95vw] h-[92vh]`). Never pass a width class — pick a size. Non-`full` sizes cap at `max-h-[85vh]`; `xl`/`full` go edge-to-edge below `lg`.
- `title` renders the header bar and its close `X`; omit it for a panel with no chrome (a warning band, a consent gate).
- `footer` renders the `justify-end` action row — put the `Button`s there, not in the body. A footer submit for a body `<form>` uses `form={id}`.
- The body scrolls and is padded (`p-5`); override via `bodyClassName` (e.g. `overflow-hidden p-0` when the content manages its own scroll).

## Form controls

`src/components/ui/Field.tsx`, `Input.tsx` and `Textarea.tsx` are the shared form-control primitives — **use them for every `<input>` and `<textarea>`** (search/rename inputs and approval forms included, with density via `className`); don't hand-roll the recipe. The only raw inputs left in the codebase are non-text controls: `type=file`, `type=color`, checkbox/radio. The chat composer is the one text exception: it's a `react-textarea-autosize`, which can't swap in the `Textarea` component — it reuses `controlClasses` directly.

- Canonical recipe (Input, Textarea, and Select all share `controlClasses` in `Input.tsx`): `bg-well px-3 py-2 border border-surface-2 rounded-control text-sm text-fg placeholder:text-fg/40 disabled:opacity-50 disabled:cursor-not-allowed` — `bg-well` is the derived midpoint of `bg` and `surface` (auto-adapts to dark/custom themes), so a control reads as a gentle recess on both `bg-surface` cards and bare `bg-bg` pages without the contrast swing of either endpoint
- Focus: **1px accent border, in place** — `focus-visible:outline-none focus-visible:border-accent` (with `transition-colors`). Nothing reflows and no ring is drawn; the border flip is the indicator. Do not add `focus:ring-*`, a bare `focus:border-accent`, or `outline-none` without the flip
- Textarea adds `resize-y`; compact/approval sites pass `resize-none`
- `Field` renders a real `<label>` that wraps the control — association is implicit and works for any child (Input, Select, ModelField, AppSwitch). The label is `text-sm font-medium text-fg`; the optional `hint` (`text-xs text-fg/60`) and `error` (replaces the hint, `text-danger`, and marks the control `aria-invalid`) render **outside** the label so they stay out of the accessible name. Input/Textarea/Select read the caption back through `FieldContext` and wire `aria-describedby`/`aria-invalid` themselves. Composite controls that can't be wrapped (SourceListEditor, CronPicker, ModelPicker, a chip group) keep their raw label
- Where a Field supplies the visible label, don't also set `aria-label` on the control — the visible text _is_ the accessible name
- Pass `className` only for layout (`w-full`, `flex-1`), density (`px-2 py-1 text-xs`), or a deliberate shape/fill override (`bg-surface-2`, `rounded-surface`, `bg-transparent`) — `cn` merges with twMerge

## Selects

`src/components/ui/Select.tsx` is the shared select primitive — **use it for every `<select>`**; don't hand-roll the recipe.

- Canonical recipe: shares `controlClasses` with Input/Textarea (same fill, border and 1px accent focus flip), minus `w-full` — Selects are often inline
- API: `options` (array of `{ value, label, disabled? }`) or `children` — children win when both are present, which covers `<option>` shapes the prop can't express (numeric values, conditional options)
- Pass `className` only for layout (`w-full`) or a deliberate override (`bg-bg`, a compact pill); `cn` merges with twMerge

## Loading indicators

- Use `<LoaderCircle className="animate-spin ..." />` from `lucide-react` for all loading spinners.
- Use `text-accent` on `LoaderCircle` unless the spinner sits inside a colored surface (e.g. a `bg-accent` or `bg-danger` button), in which case it inherits the button's foreground and needs no explicit text color.
- Size guide: `size={14}` for inline icon-button spinners, `size={16}` for small inline/search spinners, `size={20}` for mid-size list/panel spinners, `size={24}` for section loading states, `size={32}` for full-page loading states.

## ALWAYS

- **ALWAYS** use surface tokens: `bg-bg`, `bg-surface`, `bg-surface-2`, `bg-well`, `text-fg`, `border-surface-2`.
- **ALWAYS** use the `Button` primitive (`src/components/ui/Button.tsx`) for labeled action buttons — it already encodes the accent/danger fills, focus ring, disabled and hover rules below.
- **ALWAYS** use accent tokens for brand fill/action: `bg-accent` with `text-accent-fg`, hover to `bg-accent-700` — via `<Button variant="primary">` unless the element can't be a button.
- **ALWAYS** use semantic status tokens (`bg-danger-soft`, `text-danger`, `bg-success-soft`, `bg-warning-soft`, `bg-info-soft`) for errors/success/warnings/info.
- **ALWAYS** use semantic radii (`rounded-control` / `rounded-surface` / `rounded-floating` / `rounded-pill`).
- **ALWAYS** use the 4px Tailwind spacing scale; the most common values in this codebase are `py-2 px-3`, `gap-2`, `p-2`, `p-4`. Match neighbors.
- **ALWAYS** default body text to `text-sm` at normal weight (`400`); use `font-medium` (`500`) for emphasis and `font-semibold` (`600`) for headings.
- **ALWAYS** pair `transition-colors` with `duration-150` (or `100`/`200`) for hover/focus states.
- **ALWAYS** use the `Card` primitive (`src/components/ui/Card.tsx`) for a bordered content surface, and `ApprovalPanel` for an in-message approval — never retype the `bg-surface border border-surface-2 rounded-*` recipe.
- **ALWAYS** use `ListRow` and its chrome (`src/components/ui/List.tsx`) for a page-level browse list.
- **ALWAYS** use the `Modal` primitive (`src/components/ui/Modal.tsx`) for any dialog — it already owns the `bg-overlay` scrim, panel chrome, sizing and accessibility.
- **ALWAYS** use `bg-overlay` (or `bg-overlay-strong`) for popover scrims and backdrops outside `Modal` — it's a theme-aware dark scrim.
- **ALWAYS** add new tokens to `@theme` in `src/app/globals.css` if a needed semantic doesn't yet exist — extend the system rather than reach for a raw value.

## NEVER

- **NEVER** hardcode hex codes, `rgb(...)`, or `oklch(...)` literals inside components. If the system doesn't have a token for it, add one to `@theme`.
- **NEVER** use raw Tailwind palette colors (`bg-red-500`, `text-green-400`, `border-amber-500/30`, `text-gray-700`, etc.) in app code. Map to semantic status / surface tokens.
- **NEVER** use `text-white`, `bg-white`, `text-black`, `bg-black` directly — they don't flip with theme. Use `text-fg` / `bg-bg`, or `text-accent-fg` on accent fills, or `bg-overlay` for scrims.
- **NEVER** use `bg-fg/30` (or any `bg-fg/*`) for a modal scrim — `fg` is light on dark themes, so the backdrop reads bright. Use `bg-overlay` instead.
- **NEVER** hand-roll a card surface (`<div className="bg-surface border border-surface-2 rounded-surface …">`) — that is what produced 21 spellings of one role, drifting on radius and shadow. Use `Card`.
- **NEVER** hand-roll a browse-list row (`py-6` + `border-b` + `router.push` on a `role="link"` div) — that is what produced four title sizes and three hover idioms for one role, and it breaks cmd-click. Use `ListRow`.
- **NEVER** introduce new shadow utilities outside `shadow-resting` / `shadow-raised` / `shadow-floating`.
- **NEVER** hand-roll a labeled action button (`<button className="px-3 py-2 rounded-control bg-accent …">`) — that is what produced 46 spellings of one role. Use `Button`, or `buttonClasses()` for a non-`<button>` trigger.
- **NEVER** hand-roll a form control (`<input className="px-3 py-2 rounded-control bg-surface …">`) — that is what produced four fills, two radii, and two focus idioms for one role. Use `Input` / `Textarea` / `Field` / `Select`.
- **NEVER** strip a button's focus ring with `outline-none` — `Button` provides a `focus-visible` outline that works on every surface.
- **NEVER** use arbitrary radius values (`rounded-[10px]`, `rounded-[14px]`). Pick a semantic radius.
- **NEVER** use legacy aliases (`bg-light-primary`, `bg-dark-primary`, `bg-light-secondary`, `bg-dark-100`, `border-light-200`, etc.) in new code. They exist only for backwards compat.
- **NEVER** reference shadcn-style tokens that don't exist here: `bg-card`, `text-card-foreground`, `text-muted-foreground`, `bg-popover`, `bg-muted`, `bg-primary`, `bg-secondary`, `bg-destructive`. They are not defined in this project.
- **NEVER** invent token names like `bg-surface-3` — check what exists in `globals.css` first.

## Verifying changes

- The user's theme can be light, dark, or a fully custom user-chosen background + accent. Test that any new surface/text combination is legible across all three. If a color does not come from a token, it will not respond to a custom theme.
- The accent color is user-configurable (the `ThemeController` overrides `--color-blue-*` with the user's accent). Code that reads `bg-blue-600` will accidentally pick up the accent — do not rely on this.

## Files of record

- `src/app/globals.css` — token definitions (`@theme` block + `[data-theme='dark']` overrides).
- `src/components/theme/Controller.tsx` — runtime theming logic; mutates CSS variables on `:root`.
- `src/components/ui/Button.tsx` — the shared button primitive (variants, sizes, focus ring).
- `src/components/ui/Card.tsx` — the shared card/surface primitive (flat, `radius` prop).
- `src/components/ui/ApprovalPanel.tsx` — the in-message approval shell (header + scrolling body + footer).
- `src/components/ui/Select.tsx` — the shared select primitive (canonical recipe, `options`/`children` API, 1px accent border flip).
- `src/components/ui/Input.tsx` — the shared text input primitive (canonical recipe + `controlClasses`, 1px accent border flip).
- `src/components/ui/Textarea.tsx` — the shared textarea primitive (canonical recipe + `resize-y`).
- `src/components/ui/List.tsx` — the browse-list primitives (`ListRow`, `ListRowAction`, `ListLoading`, `ListEmptyState`, `ListCount`, `listRowInteractive`).
- `src/components/ui/Field.tsx` — the label/control wrapper (wrapping `<label>`, `hint`/`error`, `FieldContext` aria wiring).
