---
name: design-system
description: YAAWC design system rules and tokens. MUST be used whenever editing or creating UI — any .tsx component, Tailwind class change, styling work, color/spacing/radius/shadow/typography decision, or globals.css edit. Activates on terms like "component", "style", "UI", "button", "card", "modal", "color", "theme", "dark mode", "Tailwind", "CSS", "layout", "padding", "spacing", "rounded", "shadow", "hover", "focus", "MessageBox", "Sidebar", "Navbar", "ChatWindow", or any work under src/components or src/app.
---

# YAAWC Design System

Tokens live in `src/app/globals.css` under `@theme` (Tailwind v4 CSS-first). Tailwind auto-generates utilities from these tokens. Theming is driven by `src/components/theme/Controller.tsx` which writes CSS variables onto `:root` for light/dark/custom modes — **anything that doesn't read from a token will not theme correctly.**

## Available tokens (semantic — use these names)

**Surface**: `bg-bg`, `bg-surface`, `bg-surface-2`, `text-fg`, `border-surface-2`, `border-border-strong`, `bg-overlay`, `bg-overlay-strong`

**Brand**: `bg-accent`, `bg-accent-500`, `bg-accent-600`, `bg-accent-700`, `text-accent`, `text-accent-fg`, `border-accent`

**Status**: `bg-danger`, `bg-danger-soft`, `text-danger`, `text-danger-fg`, `bg-success`, `bg-success-soft`, `text-success`, `bg-warning`, `bg-warning-soft`, `text-warning`, `bg-info`, `bg-info-soft`

**Radius**: `rounded-control` (inputs/chips/small buttons), `rounded-surface` (default cards/panels), `rounded-floating` (modals/popovers/raised cards), `rounded-pill` (avatars/badges)

**Shadow**: `shadow-resting`, `shadow-raised`, `shadow-floating` — use sparingly; this UI prefers borders + surface contrast over elevation.

**Motion**: `duration-100` (fast), `duration-150` (base), `duration-200` (slow). Pair with `transition-colors` for hover/focus.

**Typography**: body defaults to `text-sm` + `font-medium`. Headings use `font-semibold` with `text-lg` / `text-xl` / `text-2xl` / `text-3xl`. Captions use `text-xs`.

**Spacing**: standard Tailwind 4px scale. Half-steps (`gap-1.5`, `py-0.5`, `p-1.5`) are intentional for dense UI — not outliers.

## Loading indicators

- Use `<LoaderCircle className="animate-spin ..." />` from `lucide-react` for all loading spinners.
- Use `text-accent` on `LoaderCircle` unless the spinner sits inside a colored surface (e.g. a `bg-accent` or `bg-danger` button), in which case it inherits the button's foreground and needs no explicit text color.
- Size guide: `size={14}` for inline icon-button spinners, `size={16}` for small inline/search spinners, `size={20}` for mid-size list/panel spinners, `size={24}` for section loading states, `size={32}` for full-page loading states.

## ALWAYS

- **ALWAYS** use surface tokens: `bg-bg`, `bg-surface`, `bg-surface-2`, `text-fg`, `border-surface-2`.
- **ALWAYS** use accent tokens for brand fill/action: `bg-accent` with `text-accent-fg`, hover to `bg-accent-700`.
- **ALWAYS** use semantic status tokens (`bg-danger-soft`, `text-danger`, `bg-success-soft`, `bg-warning-soft`, `bg-info-soft`) for errors/success/warnings/info.
- **ALWAYS** use semantic radii (`rounded-control` / `rounded-surface` / `rounded-floating` / `rounded-pill`).
- **ALWAYS** use the 4px Tailwind spacing scale; the most common values in this codebase are `py-2 px-3`, `gap-2`, `p-2`, `p-4`. Match neighbors.
- **ALWAYS** default body text to `text-sm`; use `font-medium` for emphasis and `font-semibold` for headings.
- **ALWAYS** pair `transition-colors` with `duration-150` (or `100`/`200`) for hover/focus states.
- **ALWAYS** add new tokens to `@theme` in `src/app/globals.css` if a needed semantic doesn't yet exist — extend the system rather than reach for a raw value.

## NEVER

- **NEVER** hardcode hex codes, `rgb(...)`, or `oklch(...)` literals inside components. If the system doesn't have a token for it, add one to `@theme`.
- **NEVER** use raw Tailwind palette colors (`bg-red-500`, `text-green-400`, `border-amber-500/30`, `text-gray-700`, etc.) in app code. Map to semantic status / surface tokens.
- **NEVER** use `text-white`, `bg-white`, `text-black`, `bg-black` directly — they don't flip with theme. Use `text-fg` / `bg-bg`, or `text-accent-fg` on accent fills, or `bg-overlay` for scrims.
- **NEVER** introduce new shadow utilities outside `shadow-resting` / `shadow-raised` / `shadow-floating`.
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
- `src/components/ui/card.tsx` — canonical example of a token-correct component.
