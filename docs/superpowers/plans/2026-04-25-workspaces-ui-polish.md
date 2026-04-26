# Workspaces UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Perplexica workspaces look and feel finished — color/icon visible everywhere, chat browsing unified, workspace context obvious in threads.

**Architecture:** Centralize workspace appearance (color tokens + Lucide icons) in a small util + `WorkspaceIcon` component. Extract the entire Library chat-browsing experience into a shared `ChatBrowser` component, then mount it both in `/library` and inside the workspace `ChatsTab`. Replace the native `<select>` workspace picker with a chip + popover. Render a workspace chip in the chat thread header. Extend `/api/chats` and `/api/chats/search` to accept multi-workspace filters.

**Tech Stack:** Next.js 16 (app router), React, TypeScript, Tailwind CSS, Drizzle ORM (better-sqlite3), Lucide icons. Package manager: **yarn**. No unit test runner — verification is automated through the dev server using `playwright-cli` per the project's test-automation skill.

## Verification approach

Each task that touches UI ends with a verification block the agent runs **automatically** (not by asking the user). Use `playwright-cli` headed mode against `http://localhost:3000`. Conventions:

- Start the dev server once before Task 5 with `yarn dev` in the background and leave it running across tasks. Stop after Task 17.
- Use one named session for the whole plan: `playwright-cli -s=ws open --headed http://localhost:3000` (only once, at the start of Task 5; reuse it after).
- Drive every interaction through `playwright-cli` commands. After each significant action, run `playwright-cli -s=ws snapshot` and read the resulting `.playwright-cli/*.yml` file to confirm the expected state (presence/absence of elements, text, URL).
- For assertions about non-DOM state (e.g. that a workspace was persisted), use `playwright-cli -s=ws eval "..."` or call the JSON API with `curl`.
- After a feature is verified, take a final named snapshot per task: `playwright-cli -s=ws snapshot --filename=task-N-final.yml` so the next task starts from a known state.
- If a verification fails, **do not** mark the task complete — diagnose using `playwright-cli -s=ws console` and `playwright-cli -s=ws network`, fix, re-verify.
- At the end of Task 17, close the session: `playwright-cli -s=ws close`. Stop the dev server.

The `e<n>` element refs in commands below are placeholders — they come from the latest snapshot. Always run `snapshot` first and substitute the actual refs before clicking/filling.

**Spec:** `docs/superpowers/specs/2026-04-25-workspaces-ui-polish-design.md`

---

## File Inventory

### New files

- `src/lib/workspaces/appearance.ts` — palette + Tailwind class util
- `src/components/Workspaces/WorkspaceIcon.tsx` — Lucide-name → Icon
- `src/components/Workspaces/AppearancePicker.tsx` — color + icon picker UI
- `src/components/Workspaces/WorkspacePicker.tsx` — chip + popover (replaces inline select)
- `src/components/Workspaces/WorkspaceHeaderChip.tsx` — fetches + renders chip for a chat's workspace
- `src/components/Chats/ChatRow.tsx` — single row UI
- `src/components/Chats/ChatBrowser.tsx` — full chat-browsing experience

### Modified files

- `src/components/Workspaces/WorkspaceChip.tsx` — color prop, Lucide icons
- `src/app/workspaces/page.tsx` — appearance picker in CreateModal; cards use color/icon
- `src/app/workspaces/[id]/page.tsx` — header uses WorkspaceIcon + color tint
- `src/components/Workspaces/SettingsTab.tsx` — appearance picker; persist color/icon
- `src/components/Workspaces/ChatsTab.tsx` — replaced with ChatBrowser wrapper
- `src/app/library/page.tsx` — replaced with ChatBrowser wrapper
- `src/components/EmptyChat.tsx` — use new WorkspacePicker
- `src/components/ChatWindow.tsx` — init workspace from `?workspace=`; render header chip
- `src/app/api/chats/route.ts` — accept `workspaceIds`, `workspaceId=none`
- `src/app/api/chats/search/route.ts` — same workspace filtering

### Schema

No changes (color and icon fields already exist as nullable text on `workspaces`).

---

## Conventions

- **Indentation:** match existing files (2 spaces).
- **Imports:** absolute via `@/...` alias.
- **Style:** Tailwind utility classes; reuse existing tokens like `bg-surface`, `border-surface-2`, `text-fg`, `text-accent`. Never construct dynamic Tailwind class names — always literal strings.
- **Yarn:** all commands use `yarn`, never `npm`.
- **Commit messages:** lowercase imperative, scope `(workspaces)`, e.g. `feat(workspaces): add appearance util`.
- **No comments** on obvious code; comment only non-obvious WHY.

---

## Task 1: Create workspace appearance util

**Files:**

- Create: `src/lib/workspaces/appearance.ts`

- [ ] **Step 1: Write the file**

```ts
// src/lib/workspaces/appearance.ts

export const WORKSPACE_COLOR_TOKENS = [
  'slate',
  'sky',
  'emerald',
  'amber',
  'rose',
  'violet',
  'teal',
  'orange',
  'pink',
  'lime',
] as const;

export type WorkspaceColor = (typeof WORKSPACE_COLOR_TOKENS)[number];

export interface WorkspaceColorClasses {
  /** Solid swatch background (used for the color picker swatches and dots). */
  swatch: string;
  /** Tinted background for chips/cards. */
  bgTint: string;
  /** Subtle background border for cards. */
  border: string;
  /** Text color paired with the tint. */
  text: string;
  /** Solid icon-stroke color. */
  stroke: string;
}

const COLOR_CLASSES: Record<WorkspaceColor, WorkspaceColorClasses> = {
  slate: {
    swatch: 'bg-slate-500',
    bgTint: 'bg-slate-500/15',
    border: 'border-slate-500/30',
    text: 'text-slate-700 dark:text-slate-300',
    stroke: 'text-slate-600 dark:text-slate-300',
  },
  sky: {
    swatch: 'bg-sky-500',
    bgTint: 'bg-sky-500/15',
    border: 'border-sky-500/30',
    text: 'text-sky-700 dark:text-sky-300',
    stroke: 'text-sky-600 dark:text-sky-300',
  },
  emerald: {
    swatch: 'bg-emerald-500',
    bgTint: 'bg-emerald-500/15',
    border: 'border-emerald-500/30',
    text: 'text-emerald-700 dark:text-emerald-300',
    stroke: 'text-emerald-600 dark:text-emerald-300',
  },
  amber: {
    swatch: 'bg-amber-500',
    bgTint: 'bg-amber-500/15',
    border: 'border-amber-500/30',
    text: 'text-amber-700 dark:text-amber-300',
    stroke: 'text-amber-600 dark:text-amber-300',
  },
  rose: {
    swatch: 'bg-rose-500',
    bgTint: 'bg-rose-500/15',
    border: 'border-rose-500/30',
    text: 'text-rose-700 dark:text-rose-300',
    stroke: 'text-rose-600 dark:text-rose-300',
  },
  violet: {
    swatch: 'bg-violet-500',
    bgTint: 'bg-violet-500/15',
    border: 'border-violet-500/30',
    text: 'text-violet-700 dark:text-violet-300',
    stroke: 'text-violet-600 dark:text-violet-300',
  },
  teal: {
    swatch: 'bg-teal-500',
    bgTint: 'bg-teal-500/15',
    border: 'border-teal-500/30',
    text: 'text-teal-700 dark:text-teal-300',
    stroke: 'text-teal-600 dark:text-teal-300',
  },
  orange: {
    swatch: 'bg-orange-500',
    bgTint: 'bg-orange-500/15',
    border: 'border-orange-500/30',
    text: 'text-orange-700 dark:text-orange-300',
    stroke: 'text-orange-600 dark:text-orange-300',
  },
  pink: {
    swatch: 'bg-pink-500',
    bgTint: 'bg-pink-500/15',
    border: 'border-pink-500/30',
    text: 'text-pink-700 dark:text-pink-300',
    stroke: 'text-pink-600 dark:text-pink-300',
  },
  lime: {
    swatch: 'bg-lime-500',
    bgTint: 'bg-lime-500/15',
    border: 'border-lime-500/30',
    text: 'text-lime-700 dark:text-lime-300',
    stroke: 'text-lime-600 dark:text-lime-300',
  },
};

export function isWorkspaceColor(value: unknown): value is WorkspaceColor {
  return (
    typeof value === 'string' &&
    (WORKSPACE_COLOR_TOKENS as readonly string[]).includes(value)
  );
}

export function workspaceColorClasses(
  color: string | null | undefined,
): WorkspaceColorClasses {
  if (isWorkspaceColor(color)) return COLOR_CLASSES[color];
  return COLOR_CLASSES.slate;
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `yarn tsc --noEmit`
Expected: no new errors related to this file.

- [ ] **Step 3: Commit**

```bash
git add src/lib/workspaces/appearance.ts
git commit -m "feat(workspaces): add appearance util with color palette"
```

---

## Task 2: Create WorkspaceIcon component

**Files:**

- Create: `src/components/Workspaces/WorkspaceIcon.tsx`

- [ ] **Step 1: Write the file**

```tsx
// src/components/Workspaces/WorkspaceIcon.tsx
'use client';

import * as Icons from 'lucide-react';
import { FolderOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { workspaceColorClasses } from '@/lib/workspaces/appearance';

export const CURATED_WORKSPACE_ICONS = [
  'FolderOpen',
  'Briefcase',
  'BookOpen',
  'Code',
  'Beaker',
  'Compass',
  'Lightbulb',
  'Target',
  'Rocket',
  'Heart',
  'Music',
  'Palette',
  'Camera',
  'Globe',
  'GraduationCap',
  'Hammer',
  'Leaf',
  'ShoppingCart',
  'Coffee',
  'Star',
] as const;

interface Props {
  name: string | null | undefined;
  color?: string | null;
  size?: number;
  className?: string;
  /** When true, applies the color's stroke class; otherwise inherits text color. */
  applyColor?: boolean;
}

const WorkspaceIcon = ({
  name,
  color,
  size = 16,
  className,
  applyColor = true,
}: Props) => {
  const lookup = (name ?? '').trim();
  const Component =
    (lookup &&
      (
        Icons as unknown as Record<
          string,
          React.ComponentType<{ size?: number; className?: string }>
        >
      )[lookup]) ||
    FolderOpen;
  const colorClass = applyColor ? workspaceColorClasses(color).stroke : '';
  return <Component size={size} className={cn(colorClass, className)} />;
};

export default WorkspaceIcon;
```

- [ ] **Step 2: Verify it type-checks**

Run: `yarn tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/Workspaces/WorkspaceIcon.tsx
git commit -m "feat(workspaces): add WorkspaceIcon component"
```

---

## Task 3: Update WorkspaceChip to use color and WorkspaceIcon

**Files:**

- Modify: `src/components/Workspaces/WorkspaceChip.tsx`

- [ ] **Step 1: Replace the file**

```tsx
// src/components/Workspaces/WorkspaceChip.tsx
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { workspaceColorClasses } from '@/lib/workspaces/appearance';
import WorkspaceIcon from './WorkspaceIcon';

interface Props {
  id: string;
  name: string;
  icon: string | null;
  color?: string | null;
  muted?: boolean;
  /** When true, do not stop propagation on click — let parent handle. */
  inert?: boolean;
}

const WorkspaceChip = ({ id, name, icon, color, muted, inert }: Props) => {
  const c = workspaceColorClasses(color);
  return (
    <Link
      href={`/workspaces/${id}`}
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-colors',
        muted
          ? 'bg-surface text-fg/30 hover:text-fg/50'
          : cn(c.bgTint, c.text, 'hover:opacity-80'),
      )}
      onClick={inert ? undefined : (e) => e.stopPropagation()}
    >
      <WorkspaceIcon
        name={icon}
        color={color}
        size={11}
        applyColor={!muted}
        className={muted ? 'opacity-40' : ''}
      />
      <span>{name}</span>
    </Link>
  );
};

export default WorkspaceChip;
```

- [ ] **Step 2: Find existing call sites**

Run: `grep -rn "WorkspaceChip" src/ --include='*.tsx'`
Expected: at least `src/app/library/page.tsx`.

- [ ] **Step 3: Update existing call sites to pass `color`**

In `src/app/library/page.tsx`, locate the `workspaceMap` typing (around line 85) and the chip render (around line 550). Update the map type to include `color`:

```tsx
const [workspaceMap, setWorkspaceMap] = useState<
  Record<
    string,
    {
      name: string;
      icon: string | null;
      color: string | null;
      archived: boolean;
    }
  >
>({});
```

And the chip render:

```tsx
{
  chat.workspaceId && workspaceMap[chat.workspaceId] && (
    <WorkspaceChip
      id={chat.workspaceId}
      name={workspaceMap[chat.workspaceId].name}
      icon={workspaceMap[chat.workspaceId].icon}
      color={workspaceMap[chat.workspaceId].color}
      muted={workspaceMap[chat.workspaceId].archived}
    />
  );
}
```

(This file will be replaced wholesale in a later task — this interim change keeps the build green.)

- [ ] **Step 4: Verify type-check**

Run: `yarn tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/Workspaces/WorkspaceChip.tsx src/app/library/page.tsx
git commit -m "feat(workspaces): WorkspaceChip uses color and Lucide icon"
```

---

## Task 4: Create AppearancePicker component

**Files:**

- Create: `src/components/Workspaces/AppearancePicker.tsx`

- [ ] **Step 1: Write the file**

```tsx
// src/components/Workspaces/AppearancePicker.tsx
'use client';

import { cn } from '@/lib/utils';
import {
  WORKSPACE_COLOR_TOKENS,
  workspaceColorClasses,
} from '@/lib/workspaces/appearance';
import WorkspaceIcon, { CURATED_WORKSPACE_ICONS } from './WorkspaceIcon';

interface Props {
  color: string | null;
  icon: string | null;
  onChange: (next: { color: string | null; icon: string | null }) => void;
}

const AppearancePicker = ({ color, icon, onChange }: Props) => {
  const isCurated = icon
    ? (CURATED_WORKSPACE_ICONS as readonly string[]).includes(icon)
    : false;
  const customIconValue = !isCurated && icon ? icon : '';

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-xs text-fg/60">Color</label>
        <div className="flex flex-wrap gap-2">
          {WORKSPACE_COLOR_TOKENS.map((token) => {
            const c = workspaceColorClasses(token);
            const selected = color === token;
            return (
              <button
                key={token}
                type="button"
                aria-label={`Color ${token}`}
                onClick={() => onChange({ color: token, icon })}
                className={cn(
                  'h-6 w-6 rounded-full transition-transform',
                  c.swatch,
                  selected
                    ? 'ring-2 ring-offset-2 ring-offset-surface ring-fg/60 scale-110'
                    : 'hover:scale-105',
                )}
              />
            );
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-fg/60">Icon</label>
        <div className="grid grid-cols-10 gap-1.5">
          {CURATED_WORKSPACE_ICONS.map((name) => {
            const selected = icon === name;
            return (
              <button
                key={name}
                type="button"
                aria-label={`Icon ${name}`}
                onClick={() => onChange({ color, icon: name })}
                className={cn(
                  'flex items-center justify-center h-8 w-8 rounded-lg border transition-colors',
                  selected
                    ? cn(
                        workspaceColorClasses(color).bgTint,
                        workspaceColorClasses(color).border,
                      )
                    : 'border-surface-2 bg-surface hover:bg-surface-2',
                )}
              >
                <WorkspaceIcon name={name} color={color} size={16} />
              </button>
            );
          })}
        </div>
        <input
          type="text"
          value={customIconValue}
          onChange={(e) => {
            const v = e.target.value.trim();
            onChange({ color, icon: v || null });
          }}
          placeholder="Or enter a Lucide icon name…"
          className="w-full mt-1 px-2.5 py-1.5 text-xs bg-bg rounded-md border border-surface-2 focus:outline-none focus:border-accent"
        />
      </div>
    </div>
  );
};

export default AppearancePicker;
```

- [ ] **Step 2: Verify type-check**

Run: `yarn tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/Workspaces/AppearancePicker.tsx
git commit -m "feat(workspaces): add AppearancePicker (color + icon)"
```

---

## Task 5: Wire AppearancePicker into CreateModal

**Files:**

- Modify: `src/app/workspaces/page.tsx`

- [ ] **Step 1: Update CreateModal to track color/icon and post them**

In `CreateModal` (top of `src/app/workspaces/page.tsx`):

1. Add imports near the top of the file:

```tsx
import AppearancePicker from '@/components/Workspaces/AppearancePicker';
import WorkspaceIcon from '@/components/Workspaces/WorkspaceIcon';
import { workspaceColorClasses } from '@/lib/workspaces/appearance';
```

2. Inside `CreateModal`, add state and include color/icon in the request body:

```tsx
const [color, setColor] = useState<string | null>('sky');
const [icon, setIcon] = useState<string | null>('FolderOpen');
```

3. In the `body: JSON.stringify({ ... })` of the create request, add:

```tsx
color,
icon,
```

4. Insert the picker inside the `<form>` after the description textarea, before the error message:

```tsx
<AppearancePicker
  color={color}
  icon={icon}
  onChange={(next) => {
    setColor(next.color);
    setIcon(next.icon);
  }}
/>
```

- [ ] **Step 2: Update the workspaces grid to render WorkspaceIcon + color**

Replace the card render (around line 187 — the `workspaces.map((ws) => ...)`):

```tsx
{
  workspaces.map((ws) => {
    const c = workspaceColorClasses(ws.color);
    return (
      <Link
        key={ws.id}
        href={`/workspaces/${ws.id}`}
        className={cn(
          'flex flex-col gap-2 p-4 rounded-xl border transition cursor-pointer',
          'bg-surface hover:border-accent/50',
          c.border,
        )}
      >
        <div className="flex items-center gap-2">
          <span className={cn('p-1.5 rounded-md', c.bgTint)}>
            <WorkspaceIcon name={ws.icon} color={ws.color} size={18} />
          </span>
          <span className="font-medium truncate">{ws.name}</span>
        </div>
        {ws.description && (
          <p className="text-xs text-fg/50 line-clamp-2">{ws.description}</p>
        )}
      </Link>
    );
  });
}
```

- [ ] **Step 3: Verify the API accepts color and icon**

Read `src/app/api/workspaces/route.ts` lines 17-37 (the POST handler). It should already pass through `color` and `icon` since they're columns on the table.

If the POST handler explicitly whitelists fields and excludes color/icon, add them. Run:

```
grep -n "color\|icon" src/app/api/workspaces/route.ts
```

Expected: either the handler accepts the full body (passes through) OR you add `color, icon` to the insert payload.

- [ ] **Step 4: Verify type-check**

Run: `yarn tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Automated verification (playwright-cli)**

Start the dev server in the background and wait for "Ready":

```bash
yarn dev   # run_in_background=true; wait for "Ready in" in the output
```

Open the browser session (used for the rest of the plan):

```bash
playwright-cli -s=ws open --headed http://localhost:3000/workspaces
playwright-cli -s=ws snapshot
```

Read the snapshot YAML; locate the "New Workspace" button ref. Then:

```bash
playwright-cli -s=ws click <ref-of-new-workspace-button>
playwright-cli -s=ws snapshot
# Confirm modal contains: text input "Workspace name", color swatch buttons aria-label "Color slate"... "Color lime", icon buttons aria-label "Icon FolderOpen"... and the "Or enter a Lucide icon name…" input.

playwright-cli -s=ws fill <ref-of-name-input> "Plan Test WS"
playwright-cli -s=ws click <ref-of-color-emerald-button>
playwright-cli -s=ws click <ref-of-icon-Rocket-button>
playwright-cli -s=ws snapshot
# Confirm: emerald swatch shows ring, Rocket button shows tinted background.

# Try the manual icon override
playwright-cli -s=ws fill <ref-of-custom-icon-input> "Bookmark"
playwright-cli -s=ws snapshot
# Confirm Rocket no longer shows the tinted "selected" state.

# Submit
playwright-cli -s=ws click <ref-of-Create-button>
playwright-cli -s=ws snapshot
# Confirm URL navigated to /workspaces/<id> AND the header shows the icon (Bookmark) tinted with the chosen color.

# Go back to list and confirm card render
playwright-cli -s=ws goto http://localhost:3000/workspaces
playwright-cli -s=ws snapshot
# Confirm a card "Plan Test WS" is visible. Confirm via eval that it persisted:
playwright-cli -s=ws eval "() => fetch('/api/workspaces').then(r => r.json()).then(d => d.workspaces.find(w => w.name === 'Plan Test WS'))"
# Expect: object with color='emerald', icon='Bookmark'.

playwright-cli -s=ws snapshot --filename=task-5-final.yml
```

If any check fails, run `playwright-cli -s=ws console` to inspect errors before re-attempting.

- [ ] **Step 6: Commit**

```bash
git add src/app/workspaces/page.tsx src/app/api/workspaces/route.ts
git commit -m "feat(workspaces): pick color/icon in CreateModal; render on cards"
```

---

## Task 6: Wire AppearancePicker into SettingsTab

**Files:**

- Modify: `src/components/Workspaces/SettingsTab.tsx`

- [ ] **Step 1: Add color/icon state and picker**

At the top of the file, add the import:

```tsx
import AppearancePicker from './AppearancePicker';
```

Inside the component, after existing `useState` declarations:

```tsx
const [color, setColor] = useState<string | null>(workspace.color ?? null);
const [icon, setIcon] = useState<string | null>(workspace.icon ?? null);
```

Update `saveSettings` to include them:

```tsx
async function saveSettings() {
  setSaving(true);
  await fetch(`/api/workspaces/${workspace.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name,
      description,
      color,
      icon,
      autoMemoryEnabled: autoMemory ? 1 : 0,
    }),
  });
  setSaving(false);
  router.refresh();
}
```

Insert the picker inside the General `<section>`, after the description input and before the Auto-memory row:

```tsx
<div className="space-y-2">
  <label className="text-xs text-fg/60">Appearance</label>
  <AppearancePicker
    color={color}
    icon={icon}
    onChange={(next) => {
      setColor(next.color);
      setIcon(next.icon);
    }}
  />
</div>
```

- [ ] **Step 2: Verify the PATCH handler passes color/icon through**

Run: `grep -n "color\|icon" src/app/api/workspaces/\[id\]/route.ts`
Expected: PATCH should accept arbitrary fields. If it whitelists, add `color, icon` to the allowed list.

- [ ] **Step 3: Verify type-check**

Run: `yarn tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Automated verification (playwright-cli)**

Reuse the existing session. Use the workspace created in Task 5:

```bash
playwright-cli -s=ws goto http://localhost:3000/workspaces
playwright-cli -s=ws snapshot
playwright-cli -s=ws click <ref-of-Plan-Test-WS-card>
playwright-cli -s=ws snapshot
# Click the Settings tab
playwright-cli -s=ws click <ref-of-Settings-tab>
playwright-cli -s=ws snapshot
# Confirm AppearancePicker is rendered under "Appearance" with current selection (emerald + Bookmark)

# Change to violet + Compass
playwright-cli -s=ws click <ref-of-color-violet-button>
playwright-cli -s=ws click <ref-of-icon-Compass-button>
playwright-cli -s=ws click <ref-of-Save-button>
playwright-cli -s=ws snapshot

# Reload and confirm persistence
playwright-cli -s=ws reload
playwright-cli -s=ws snapshot
# Confirm: Settings tab still shows violet selected and Compass icon highlighted; header chip uses violet tint.

playwright-cli -s=ws eval "() => fetch('/api/workspaces').then(r => r.json()).then(d => d.workspaces.find(w => w.name === 'Plan Test WS'))"
# Expect: color='violet', icon='Compass'.

playwright-cli -s=ws snapshot --filename=task-6-final.yml
```

- [ ] **Step 5: Commit**

```bash
git add src/components/Workspaces/SettingsTab.tsx src/app/api/workspaces/\[id\]/route.ts
git commit -m "feat(workspaces): edit color/icon in SettingsTab"
```

---

## Task 7: Use WorkspaceIcon + color in detail page header

**Files:**

- Modify: `src/app/workspaces/[id]/page.tsx`

- [ ] **Step 1: Add imports**

```tsx
import WorkspaceIcon from '@/components/Workspaces/WorkspaceIcon';
import { workspaceColorClasses } from '@/lib/workspaces/appearance';
```

- [ ] **Step 2: Replace the header icon span**

Locate the header (around line 119). Replace:

```tsx
<span className="text-lg">{workspace.icon ?? '📁'}</span>
```

with:

```tsx
<span
  className={cn(
    'p-1.5 rounded-md',
    workspaceColorClasses(workspace.color).bgTint,
  )}
>
  <WorkspaceIcon name={workspace.icon} color={workspace.color} size={18} />
</span>
```

- [ ] **Step 3: Verify type-check**

Run: `yarn tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Automated verification (playwright-cli)**

```bash
playwright-cli -s=ws goto http://localhost:3000/workspaces
playwright-cli -s=ws snapshot
playwright-cli -s=ws click <ref-of-Plan-Test-WS-card>
playwright-cli -s=ws snapshot
# Confirm header has a tinted pill containing the WorkspaceIcon (Compass), not the previous emoji span.
playwright-cli -s=ws snapshot --filename=task-7-final.yml
```

- [ ] **Step 5: Commit**

```bash
git add src/app/workspaces/\[id\]/page.tsx
git commit -m "feat(workspaces): use WorkspaceIcon in detail header"
```

---

## Task 8: Extend `/api/chats` to accept multi-workspace filter

**Files:**

- Modify: `src/app/api/chats/route.ts`

- [ ] **Step 1: Update the filter parsing**

In `src/app/api/chats/route.ts`, locate the GET handler. Replace the existing `workspaceIdParam` block (around lines 69 + 140-143) so we accept either `workspaceId` (single, existing) or `workspaceIds` (comma-separated). Magic value `none` (in either field) means "no workspace assigned".

Replace lines 69 (after `const workspaceIdParam = ...`) with the addition of:

```ts
const workspaceIdsParam = searchParams.get('workspaceIds');
```

Then replace the workspace condition block (lines 140-143):

```ts
if (workspaceIdsParam) {
  const ids = workspaceIdsParam
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const realIds = ids.filter((id) => id !== 'none');
  const includeNone = ids.includes('none');
  if (realIds.length > 0 && includeNone) {
    conditions.push(
      or(
        inArray(chatsTable.workspaceId, realIds),
        isNull(chatsTable.workspaceId),
      )!,
    );
  } else if (realIds.length > 0) {
    conditions.push(inArray(chatsTable.workspaceId, realIds));
  } else if (includeNone) {
    conditions.push(isNull(chatsTable.workspaceId));
  }
} else if (workspaceIdParam === 'none' || workspaceIdParam === 'null') {
  conditions.push(isNull(chatsTable.workspaceId));
} else if (workspaceIdParam) {
  conditions.push(eq(chatsTable.workspaceId, workspaceIdParam));
}
```

- [ ] **Step 2: Apply the same filter to the search branch**

The search branch (lines 78-132) currently ignores workspace filtering entirely. Add it. Right after the `if (q) {` block opens, parse the same params (already done at top), and after building `whereCondition` (line 100-106), wrap it with the workspace filter:

Replace the block from line 100 through 112 with:

```ts
const baseTitleOrContent =
  matchingChatIds.length > 0
    ? or(
        like(chatsTable.title, searchPattern),
        inArray(chatsTable.id, matchingChatIds),
      )
    : like(chatsTable.title, searchPattern);

const wsConditions = [];
if (workspaceIdsParam) {
  const ids = workspaceIdsParam
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const realIds = ids.filter((id) => id !== 'none');
  const includeNone = ids.includes('none');
  if (realIds.length > 0 && includeNone) {
    wsConditions.push(
      or(
        inArray(chatsTable.workspaceId, realIds),
        isNull(chatsTable.workspaceId),
      )!,
    );
  } else if (realIds.length > 0) {
    wsConditions.push(inArray(chatsTable.workspaceId, realIds));
  } else if (includeNone) {
    wsConditions.push(isNull(chatsTable.workspaceId));
  }
} else if (workspaceIdParam === 'none' || workspaceIdParam === 'null') {
  wsConditions.push(isNull(chatsTable.workspaceId));
} else if (workspaceIdParam) {
  wsConditions.push(eq(chatsTable.workspaceId, workspaceIdParam));
}

const whereCondition =
  wsConditions.length > 0
    ? and(baseTitleOrContent, ...wsConditions)
    : baseTitleOrContent;

const rows = await db
  .select()
  .from(chatsTable)
  .where(whereCondition)
  .orderBy(desc(sql`rowid`));
```

- [ ] **Step 3: Verify type-check**

Run: `yarn tsc --noEmit`
Expected: no errors. (`Parameters<typeof and>[0]` resolves to a `SQLWrapper | undefined` union — fine for our use.)

- [ ] **Step 4: Automated verification (curl + playwright-cli)**

First ensure at least one chat is assigned to the test workspace. Use the existing native picker on `/` (the new picker arrives in Task 15):

```bash
playwright-cli -s=ws goto http://localhost:3000/
playwright-cli -s=ws snapshot
# Select "Plan Test WS" from the native <select> (still present pre-Task-15)
playwright-cli -s=ws select <ref-of-native-select> "<plan-test-ws-id>"
playwright-cli -s=ws fill <ref-of-message-input> "hello workspace"
playwright-cli -s=ws press Enter
playwright-cli -s=ws snapshot
# Wait for the URL to become /c/<chatId>; confirm via snapshot.
```

Get the workspace id once and reuse:

```bash
WS_ID=$(curl -s 'http://localhost:3000/api/workspaces' | jq -r '.workspaces[] | select(.name=="Plan Test WS") | .id')
echo "$WS_ID"
```

Then test the API:

```bash
curl -s "http://localhost:3000/api/chats?workspaceId=none&limit=5" | jq '.chats | length, (.chats[0] // null)'
curl -s "http://localhost:3000/api/chats?workspaceIds=$WS_ID&limit=5" | jq '.chats | length, .chats[0].workspaceId'
curl -s "http://localhost:3000/api/chats?workspaceIds=$WS_ID,none&limit=5" | jq '.chats | length'
```

Expected:

- `workspaceId=none` returns only chats with `workspaceId: null`.
- `workspaceIds=$WS_ID` returns only chats whose `workspaceId` matches.
- `workspaceIds=$WS_ID,none` returns the union.

If `jq` is unavailable, substitute `python -m json.tool` or just inspect the raw output.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/chats/route.ts
git commit -m "feat(chats): support multi-workspace filter on /api/chats"
```

---

## Task 9: Extend `/api/chats/search` to accept the same filter

**Files:**

- Modify: `src/app/api/chats/search/route.ts`

- [ ] **Step 1: Read the current search handler to understand its shape**

Run: `cat src/app/api/chats/search/route.ts`
You need to know how it filters/ranks chats. Note where the SQL pre-filter happens (before the LLM ranking).

- [ ] **Step 2: Add workspace filtering**

In the search route's POST handler, accept `workspaceId` (string, optional) and `workspaceIds` (string[], optional) from the JSON body. Apply them to the SQL pre-filter (the same Drizzle `inArray`/`eq`/`isNull` pattern as Task 8) before passing candidate chats to the LLM ranker.

Concretely: add to the body destructure:

```ts
const { query, chatModel, workspaceId, workspaceIds } = await req.json();
```

Where the route builds its initial chats query (look for a `db.select().from(chatsTable)` call), append the workspace condition exactly as in Task 8 (factor it into a small local helper if you find yourself duplicating > 10 lines):

```ts
function buildWorkspaceCondition(
  workspaceId: string | undefined,
  workspaceIds: string[] | undefined,
) {
  if (workspaceIds && workspaceIds.length > 0) {
    const realIds = workspaceIds.filter((id) => id !== 'none');
    const includeNone = workspaceIds.includes('none');
    if (realIds.length > 0 && includeNone) {
      return or(
        inArray(chatsTable.workspaceId, realIds),
        isNull(chatsTable.workspaceId),
      );
    }
    if (realIds.length > 0) return inArray(chatsTable.workspaceId, realIds);
    if (includeNone) return isNull(chatsTable.workspaceId);
  }
  if (workspaceId === 'none' || workspaceId === 'null') {
    return isNull(chatsTable.workspaceId);
  }
  if (workspaceId) return eq(chatsTable.workspaceId, workspaceId);
  return undefined;
}
```

Use the returned condition in the `where(...)` clause (combined with existing conditions via `and(...)` if any).

Make sure to add any missing imports from `drizzle-orm` (`inArray`, `isNull`, `or`, `eq`, `and`) and from `@/lib/db/schema` (`chats as chatsTable`).

- [ ] **Step 3: Verify type-check**

Run: `yarn tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Automated verification (curl)**

```bash
WS_ID=$(curl -s 'http://localhost:3000/api/workspaces' | jq -r '.workspaces[] | select(.name=="Plan Test WS") | .id')
curl -s -X POST http://localhost:3000/api/chats/search \
  -H 'Content-Type: application/json' \
  -d "{\"query\":\"hello\",\"workspaceIds\":[\"$WS_ID\"]}" | jq '.chats | map(.workspaceId) | unique'
```

Expected: the unique workspaceId list contains only `$WS_ID` (or is empty if the LLM returned no matches — that is acceptable; rerun with a broader query if needed).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/chats/search/route.ts
git commit -m "feat(chats): support workspace filter on /api/chats/search"
```

---

## Task 10: Extract ChatRow component

**Files:**

- Create: `src/components/Chats/ChatRow.tsx`

- [ ] **Step 1: Write the file**

```tsx
// src/components/Chats/ChatRow.tsx
'use client';

import DeleteChat from '@/components/DeleteChat';
import WorkspaceChip from '@/components/Workspaces/WorkspaceChip';
import { cn, formatTimeDifference } from '@/lib/utils';
import {
  CalendarClock,
  ClockIcon,
  EyeOff,
  MessageSquare,
  Pin,
} from 'lucide-react';
import Link from 'next/link';

export interface Chat {
  id: string;
  title: string;
  createdAt: number;
  focusMode: string;
  isPrivate?: number;
  pinned?: number;
  scheduledTaskId?: string | null;
  workspaceId?: string | null;
  matchExcerpt?: string | null;
  messageCount?: number;
}

export interface WorkspaceMeta {
  name: string;
  icon: string | null;
  color: string | null;
  archived: boolean;
}

const HighlightedExcerpt = ({
  text,
  terms,
}: {
  text: string;
  terms: string[];
}) => {
  for (const term of terms) {
    if (!term) continue;
    const idx = text.toLowerCase().indexOf(term.toLowerCase());
    if (idx !== -1) {
      return (
        <>
          {text.slice(0, idx)}
          <span className="font-medium text-accent">
            {text.slice(idx, idx + term.length)}
          </span>
          {text.slice(idx + term.length)}
        </>
      );
    }
  }
  return <>{text}</>;
};

interface ChatRowProps {
  chat: Chat;
  isLast: boolean;
  isSearchMode: boolean;
  searchTerms: string[];
  /** When set, hides the per-row workspace chip (we're already scoped). */
  hideWorkspaceChip?: boolean;
  workspace?: WorkspaceMeta | null;
  privateSessionDurationMs: number;
  onDelete: (chatId: string) => void;
}

function getPrivateExpiresIn(createdAt: number, durationMs: number): string {
  const expiresAt = createdAt + durationMs;
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) return 'expiring soon';
  return formatTimeDifference(new Date(), new Date(expiresAt));
}

const ChatRow = ({
  chat,
  isLast,
  isSearchMode,
  searchTerms,
  hideWorkspaceChip,
  workspace,
  privateSessionDurationMs,
  onDelete,
}: ChatRowProps) => {
  return (
    <div
      className={cn(
        'flex flex-col space-y-4 py-6',
        !isLast ? 'border-b border-surface-2' : '',
      )}
    >
      <div className="flex items-center gap-2">
        <Link
          href={`/c/${chat.id}`}
          className="lg:text-xl font-medium truncate transition duration-200 cursor-pointer"
        >
          {chat.title}
        </Link>
        {chat.pinned === 1 && (
          <Pin size={12} className="fill-current text-fg/50 shrink-0" />
        )}
        {chat.isPrivate === 1 && (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-medium whitespace-nowrap">
            <EyeOff size={11} />
            Private
          </span>
        )}
        {chat.scheduledTaskId && (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 text-xs font-medium whitespace-nowrap">
            <CalendarClock size={11} />
            Scheduled
          </span>
        )}
        {!hideWorkspaceChip && chat.workspaceId && workspace && (
          <WorkspaceChip
            id={chat.workspaceId}
            name={workspace.name}
            icon={workspace.icon}
            color={workspace.color}
            muted={workspace.archived}
          />
        )}
      </div>
      {isSearchMode && chat.matchExcerpt && (
        <p className="text-sm text-fg/60 line-clamp-2 -mt-1">
          <HighlightedExcerpt text={chat.matchExcerpt} terms={searchTerms} />
        </p>
      )}
      <div className="flex flex-row items-center justify-between w-full">
        <div className="flex flex-row items-center space-x-1 lg:space-x-1.5 opacity-70">
          {chat.isPrivate === 1 ? (
            <>
              <ClockIcon size={15} />
              <p className="text-xs">
                Expires in{' '}
                {getPrivateExpiresIn(chat.createdAt, privateSessionDurationMs)}
              </p>
            </>
          ) : (
            <>
              <ClockIcon size={15} />
              <p className="text-xs">
                {formatTimeDifference(new Date(), new Date(chat.createdAt))} Ago
              </p>
            </>
          )}
          {typeof chat.messageCount === 'number' && (
            <>
              <span className="mx-1.5 text-fg/30">·</span>
              <MessageSquare size={13} />
              <p className="text-xs">
                {chat.messageCount} message
                {chat.messageCount === 1 ? '' : 's'}
              </p>
            </>
          )}
        </div>
        <DeleteChat
          chatId={chat.id}
          chats={[chat] as Chat[]}
          setChats={() => onDelete(chat.id)}
          isPrivate={chat.isPrivate === 1}
          expiresIn={
            chat.isPrivate === 1
              ? getPrivateExpiresIn(chat.createdAt, privateSessionDurationMs)
              : undefined
          }
        />
      </div>
    </div>
  );
};

export default ChatRow;
```

Note: `DeleteChat` historically received the full chat list and a setter; here we pass a single-element list and translate the call into our `onDelete(chatId)` callback so the parent owns list mutation. Verify `DeleteChat`'s prop contract matches by reading `src/components/DeleteChat.tsx` — if it relies on the array contents, refactor to pass through the array unchanged from the parent. (See Task 11 for parent integration.)

- [ ] **Step 2: Verify DeleteChat contract**

Run: `cat src/components/DeleteChat.tsx`
If `DeleteChat` only uses `setChats` to remove the deleted item from a passed array, the wrapper above is fine. If it uses the array contents in any other way, change `ChatRow` to accept `chats` and `setChats` props and pass them straight through — the parent (`ChatBrowser`) already has the full list.

- [ ] **Step 3: Verify type-check**

Run: `yarn tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/Chats/ChatRow.tsx
git commit -m "feat(chats): extract ChatRow component"
```

---

## Task 11: Create ChatBrowser component

**Files:**

- Create: `src/components/Chats/ChatBrowser.tsx`

- [ ] **Step 1: Write the file**

```tsx
// src/components/Chats/ChatBrowser.tsx
'use client';

import ChatRow, { Chat, WorkspaceMeta } from './ChatRow';
import { cn } from '@/lib/utils';
import { workspaceColorClasses } from '@/lib/workspaces/appearance';
import WorkspaceIcon from '@/components/Workspaces/WorkspaceIcon';
import { CalendarClock, Pin, Plus, Search, Sparkles, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

interface Props {
  /** When set, scopes the browser to a single workspace; hides workspace UI. */
  workspaceId?: string;
}

const Spinner = ({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) => {
  const cls = size === 'sm' ? 'w-4 h-4' : size === 'lg' ? 'w-8 h-8' : 'w-6 h-6';
  return (
    <svg
      aria-hidden="true"
      className={cn(cls, 'text-fg/20 fill-fg/30 animate-spin')}
      viewBox="0 0 100 101"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M100 50.5908C100.003 78.2051 78.1951 100.003 50.5908 100C22.9765 99.9972 0.997224 78.018 1 50.4037C1.00281 22.7993 22.8108 0.997224 50.4251 1C78.0395 1.00281 100.018 22.8108 100 50.4251ZM9.08164 50.594C9.06312 73.3997 27.7909 92.1272 50.5966 92.1457C73.4023 92.1642 92.1298 73.4365 92.1483 50.6308C92.1669 27.8251 73.4392 9.0973 50.6335 9.07878C27.8278 9.06026 9.10003 27.787 9.08164 50.594Z"
        fill="currentColor"
      />
      <path
        d="M93.9676 39.0409C96.393 38.4037 97.8624 35.9116 96.9801 33.5533C95.1945 28.8227 92.871 24.3692 90.0681 20.348C85.6237 14.1775 79.4473 9.36872 72.0454 6.45794C64.6435 3.54717 56.3134 2.65431 48.3133 3.89319C45.869 4.27179 44.3768 6.77534 45.014 9.20079C45.6512 11.6262 48.1343 13.0956 50.5786 12.717C56.5073 11.8281 62.5542 12.5399 68.0406 14.7911C73.527 17.0422 78.2187 20.7487 81.5841 25.4923C83.7976 28.5886 85.4467 32.059 86.4416 35.7474C87.1273 38.1189 89.5423 39.6781 91.9676 39.0409Z"
        fill="currentFill"
      />
    </svg>
  );
};

const ChatBrowser = ({ workspaceId }: Props) => {
  const scoped = !!workspaceId;
  const limit = 50;

  const [privateSessionDurationMs, setPrivateSessionDurationMs] = useState(
    24 * 60 * 60 * 1000,
  );

  // Workspace map for chip rendering and filter chip row
  const [workspaceMap, setWorkspaceMap] = useState<
    Record<string, WorkspaceMeta>
  >({});
  const [workspaceList, setWorkspaceList] = useState<
    { id: string; name: string; icon: string | null; color: string | null }[]
  >([]);

  // Multi-select filter state (unscoped only). 'all' is implicit when empty.
  const [selectedWorkspaceFilters, setSelectedWorkspaceFilters] = useState<
    string[]
  >([]);

  // Browse pagination
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [browseTotal, setBrowseTotal] = useState(0);
  const [browseTotalMessages, setBrowseTotalMessages] = useState(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Chat[]>([]);
  const [searchTotalMessages, setSearchTotalMessages] = useState(0);
  const [isTextSearching, setIsTextSearching] = useState(false);
  const [isLlmSearching, setIsLlmSearching] = useState(false);
  const [searchTerms, setSearchTerms] = useState<string[]>([]);
  const [searchMode, setSearchMode] = useState<'text' | 'llm'>('text');

  // Filters
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [scheduledFilter, setScheduledFilter] = useState<
    'all' | 'scheduled' | 'unscheduled'
  >('all');

  const isSearchMode = debouncedQuery.trim().length > 0;
  const displayedChats = isSearchMode ? searchResults : chats;
  const isSearching = isTextSearching || isLlmSearching;
  const totalConversations = isSearchMode ? searchResults.length : browseTotal;
  const totalMessages = isSearchMode
    ? searchTotalMessages
    : browseTotalMessages;

  // Build the workspaceId query fragment given current scope or filter selection.
  const workspaceQueryFragment = useMemo(() => {
    if (scoped) return `&workspaceId=${encodeURIComponent(workspaceId!)}`;
    if (selectedWorkspaceFilters.length === 0) return '';
    return `&workspaceIds=${encodeURIComponent(selectedWorkspaceFilters.join(','))}`;
  }, [scoped, workspaceId, selectedWorkspaceFilters]);

  // Fetch workspace list once for filter chips + chip rendering.
  useEffect(() => {
    Promise.all([
      fetch('/api/workspaces').then((r) => r.json()),
      fetch('/api/workspaces?archived=true').then((r) => r.json()),
    ])
      .then(([active, archived]) => {
        const map: Record<string, WorkspaceMeta> = {};
        const list: typeof workspaceList = [];
        for (const ws of active.workspaces ?? []) {
          map[ws.id] = {
            name: ws.name,
            icon: ws.icon,
            color: ws.color,
            archived: false,
          };
          list.push({
            id: ws.id,
            name: ws.name,
            icon: ws.icon,
            color: ws.color,
          });
        }
        for (const ws of archived.workspaces ?? []) {
          map[ws.id] = {
            name: ws.name,
            icon: ws.icon,
            color: ws.color,
            archived: true,
          };
        }
        setWorkspaceMap(map);
        setWorkspaceList(list);
      })
      .catch(() => {});
  }, []);

  const fetchPage = async (
    nextOffset: number,
    pinFilter?: boolean,
    schedFilter?: 'all' | 'scheduled' | 'unscheduled',
  ) => {
    if (nextOffset === 0) setLoading(true);
    else setLoadingMore(true);

    const usePinFilter = pinFilter ?? pinnedOnly;
    const useSchedFilter = schedFilter ?? scheduledFilter;
    const pinnedQuery = usePinFilter ? '&pinned=1' : '';
    const scheduledQuery =
      useSchedFilter === 'scheduled'
        ? '&scheduled=1'
        : useSchedFilter === 'unscheduled'
          ? '&scheduled=0'
          : '';
    const res = await fetch(
      `/api/chats?limit=${limit}&offset=${nextOffset}${pinnedQuery}${scheduledQuery}${workspaceQueryFragment}`,
    );
    const data = await res.json();
    setChats((prev) =>
      nextOffset === 0 ? data.chats : [...prev, ...data.chats],
    );
    setHasMore(data.hasMore);
    setOffset(nextOffset + data.chats.length);
    if (typeof data.total === 'number') setBrowseTotal(data.total);
    if (typeof data.totalMessages === 'number')
      setBrowseTotalMessages(data.totalMessages);
    setLoading(false);
    setLoadingMore(false);
  };

  // Re-fetch from offset 0 whenever scope or workspace-filter selection changes
  useEffect(() => {
    setChats([]);
    setOffset(0);
    setHasMore(true);
    fetchPage(0);
    fetch('/api/config')
      .then((r) => r.json())
      .then((data) => {
        if (typeof data.privateSessionDurationMinutes === 'number') {
          setPrivateSessionDurationMs(
            data.privateSessionDurationMinutes * 60 * 1000,
          );
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceQueryFragment]);

  // Infinite scroll
  useEffect(() => {
    if (isSearchMode) return;
    let observer: IntersectionObserver | null = null;
    let cleanup: (() => void) | undefined;
    if (typeof window !== 'undefined' && 'IntersectionObserver' in window) {
      observer = new IntersectionObserver((entries) => {
        const first = entries[0];
        if (first.isIntersecting && hasMore && !loading && !loadingMore) {
          fetchPage(offset);
        }
      });
      if (sentinelRef.current) observer.observe(sentinelRef.current);
      cleanup = () => {
        if (observer && sentinelRef.current) {
          observer.unobserve(sentinelRef.current);
          observer.disconnect();
        }
      };
    }
    return () => {
      if (cleanup) cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, loading, loadingMore, offset, isSearchMode]);

  // Debounce
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Text search
  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setSearchResults([]);
      setSearchTerms([]);
      setSearchTotalMessages(0);
      return;
    }
    const doTextSearch = async () => {
      setIsTextSearching(true);
      setSearchMode('text');
      setSearchTerms([]);
      try {
        const res = await fetch(
          `/api/chats?q=${encodeURIComponent(debouncedQuery)}${workspaceQueryFragment}`,
        );
        const data = await res.json();
        setSearchResults(data.chats || []);
        setSearchTotalMessages(
          typeof data.totalMessages === 'number' ? data.totalMessages : 0,
        );
      } catch (err) {
        console.error('Text search error:', err);
        setSearchResults([]);
        setSearchTotalMessages(0);
      } finally {
        setIsTextSearching(false);
      }
    };
    doTextSearch();
  }, [debouncedQuery, workspaceQueryFragment]);

  const handleLlmSearch = async () => {
    if (!searchQuery.trim() || isLlmSearching) return;
    const provider =
      typeof window !== 'undefined'
        ? localStorage.getItem('chatModelProvider')
        : null;
    const model =
      typeof window !== 'undefined' ? localStorage.getItem('chatModel') : null;
    setIsLlmSearching(true);
    setSearchMode('llm');
    setSearchTerms([]);
    setDebouncedQuery(searchQuery);
    try {
      const body: Record<string, unknown> = {
        query: searchQuery,
        chatModel: provider && model ? { provider, model } : undefined,
      };
      if (scoped) body.workspaceId = workspaceId;
      else if (selectedWorkspaceFilters.length > 0)
        body.workspaceIds = selectedWorkspaceFilters;
      const res = await fetch('/api/chats/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setSearchResults(data.chats || []);
      setSearchTerms(data.terms || []);
      setSearchTotalMessages(
        typeof data.totalMessages === 'number' ? data.totalMessages : 0,
      );
    } catch (err) {
      console.error('LLM search error:', err);
      setSearchResults([]);
      setSearchTotalMessages(0);
    } finally {
      setIsLlmSearching(false);
    }
  };

  const clearSearch = () => {
    setSearchQuery('');
    setDebouncedQuery('');
    setSearchResults([]);
    setSearchTerms([]);
    setSearchTotalMessages(0);
    setSearchMode('text');
  };

  const handleDelete = (chatId: string) => {
    if (isSearchMode) {
      setSearchResults((prev) => prev.filter((c) => c.id !== chatId));
    } else {
      setChats((prev) => prev.filter((c) => c.id !== chatId));
      setOffset((prev) => Math.max(prev - 1, 0));
    }
  };

  const toggleWorkspaceFilter = (id: string) => {
    setSelectedWorkspaceFilters((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  return (
    <div>
      {/* Workspace filter chips (unscoped mode only) */}
      {!scoped && workspaceList.length > 0 && (
        <div className="flex items-center gap-2 mb-3 overflow-x-auto pb-1">
          <button
            onClick={() => setSelectedWorkspaceFilters([])}
            className={cn(
              'flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors whitespace-nowrap',
              selectedWorkspaceFilters.length === 0
                ? 'bg-accent/10 border-accent/30 text-accent'
                : 'bg-surface border-surface-2 text-fg/60 hover:text-fg hover:border-fg/30',
            )}
          >
            All
          </button>
          {workspaceList.map((ws) => {
            const c = workspaceColorClasses(ws.color);
            const selected = selectedWorkspaceFilters.includes(ws.id);
            return (
              <button
                key={ws.id}
                onClick={() => toggleWorkspaceFilter(ws.id)}
                className={cn(
                  'flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors whitespace-nowrap',
                  selected
                    ? cn(c.bgTint, c.border, c.text)
                    : 'bg-surface border-surface-2 text-fg/60 hover:text-fg hover:border-fg/30',
                )}
              >
                <WorkspaceIcon
                  name={ws.icon}
                  color={ws.color}
                  size={11}
                  applyColor={selected}
                />
                {ws.name}
              </button>
            );
          })}
          <button
            onClick={() => toggleWorkspaceFilter('none')}
            className={cn(
              'flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors whitespace-nowrap',
              selectedWorkspaceFilters.includes('none')
                ? 'bg-accent/10 border-accent/30 text-accent'
                : 'bg-surface border-surface-2 text-fg/60 hover:text-fg hover:border-fg/30',
            )}
          >
            No workspace
          </button>
        </div>
      )}

      {/* Header (search bar + scoped "+ New chat") */}
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-fg/40 pointer-events-none"
            size={15}
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleLlmSearch();
            }}
            placeholder="Search conversations..."
            className="w-full pl-9 pr-9 py-2 bg-surface border border-surface-2 rounded-lg text-sm focus:outline-none focus:border-fg/30 placeholder:text-fg/40"
          />
          {searchQuery && (
            <button
              onClick={clearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-fg/40 hover:text-fg transition-colors"
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <button
          onClick={handleLlmSearch}
          disabled={!searchQuery.trim() || isLlmSearching}
          title="Search with AI"
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border transition-colors',
            'border-surface-2 bg-surface text-fg/70 hover:text-fg hover:border-fg/30',
            'disabled:opacity-40 disabled:cursor-not-allowed',
          )}
        >
          {isLlmSearching ? <Spinner size="sm" /> : <Sparkles size={15} />}
          <span className="hidden sm:inline">AI</span>
        </button>
        {scoped && (
          <Link
            href={`/?workspace=${encodeURIComponent(workspaceId!)}`}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm bg-accent text-accent-fg hover:opacity-90 transition-opacity"
          >
            <Plus size={15} />
            <span className="hidden sm:inline">New chat</span>
          </Link>
        )}
      </div>

      {/* Pinned/scheduled chips */}
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={() => {
            const next = !pinnedOnly;
            setPinnedOnly(next);
            setChats([]);
            setOffset(0);
            setHasMore(true);
            fetchPage(0, next);
          }}
          className={cn(
            'flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
            pinnedOnly
              ? 'bg-accent/10 border-accent/30 text-accent'
              : 'bg-surface border-surface-2 text-fg/60 hover:text-fg hover:border-fg/30',
          )}
        >
          <Pin size={11} className={pinnedOnly ? 'fill-current' : ''} />
          Pinned
        </button>
        <button
          onClick={() => {
            const next: 'all' | 'scheduled' | 'unscheduled' =
              scheduledFilter === 'all'
                ? 'scheduled'
                : scheduledFilter === 'scheduled'
                  ? 'unscheduled'
                  : 'all';
            setScheduledFilter(next);
            setChats([]);
            setOffset(0);
            setHasMore(true);
            fetchPage(0, undefined, next);
          }}
          className={cn(
            'flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
            scheduledFilter !== 'all'
              ? 'bg-accent/10 border-accent/30 text-accent'
              : 'bg-surface border-surface-2 text-fg/60 hover:text-fg hover:border-fg/30',
          )}
        >
          <CalendarClock size={11} />
          {scheduledFilter === 'unscheduled' ? 'Unscheduled' : 'Scheduled'}
        </button>
        {!isSearchMode && totalConversations > 0 && (
          <span className="text-xs text-fg/50">
            {totalMessages} message{totalMessages === 1 ? '' : 's'} in{' '}
            {totalConversations} conversation
            {totalConversations === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {/* Search status */}
      {isSearchMode && (
        <div className="mb-3 text-xs text-fg/50">
          {isSearching ? (
            <span className="flex items-center gap-1.5">
              <Spinner size="sm" />
              {isLlmSearching ? 'Searching with AI...' : 'Searching...'}
            </span>
          ) : (
            <>
              <span>
                {searchResults.length === 0
                  ? 'No matching conversations'
                  : `${totalConversations} conversation${totalConversations === 1 ? '' : 's'} found (${totalMessages} message${totalMessages === 1 ? '' : 's'})`}
                {searchMode === 'llm' ? ' (AI search)' : ''}
              </span>
              {searchTerms.length > 0 && (
                <span className="ml-1 text-fg/40">
                  — searched for{' '}
                  {searchTerms.map((t, i) => (
                    <span key={i}>
                      {i > 0 && ', '}
                      &ldquo;{t}&rdquo;
                    </span>
                  ))}
                </span>
              )}
            </>
          )}
        </div>
      )}

      {loading && chats.length === 0 && (
        <div className="flex flex-row items-center justify-center min-h-[30vh]">
          <Spinner size="lg" />
        </div>
      )}

      {!loading && !isSearchMode && chats.length === 0 && (
        <div className="flex flex-row items-center justify-center min-h-[30vh]">
          <p className="text-fg/70 text-sm">
            {scoped ? 'No chats in this workspace yet.' : 'No chats found.'}
          </p>
        </div>
      )}

      {isSearchMode && !isSearching && searchResults.length === 0 && (
        <div className="flex flex-row items-center justify-center min-h-[30vh]">
          <p className="text-fg/70 text-sm">No matching conversations found.</p>
        </div>
      )}

      {displayedChats.length > 0 && (
        <div className="flex flex-col pb-20 lg:pb-2">
          {displayedChats.map((chat, i) => (
            <ChatRow
              key={chat.id}
              chat={chat}
              isLast={i === displayedChats.length - 1}
              isSearchMode={isSearchMode}
              searchTerms={
                searchTerms.length > 0 ? searchTerms : [debouncedQuery]
              }
              hideWorkspaceChip={scoped}
              workspace={
                chat.workspaceId
                  ? (workspaceMap[chat.workspaceId] ?? null)
                  : null
              }
              privateSessionDurationMs={privateSessionDurationMs}
              onDelete={handleDelete}
            />
          ))}
          {loadingMore && !isSearchMode && (
            <div className="flex flex-row items-center justify-center py-4">
              <Spinner />
            </div>
          )}
          {!isSearchMode && <div ref={sentinelRef} className="h-1" />}
        </div>
      )}
    </div>
  );
};

export default ChatBrowser;
```

- [ ] **Step 2: Verify type-check**

Run: `yarn tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/Chats/ChatBrowser.tsx
git commit -m "feat(chats): add ChatBrowser component"
```

---

## Task 12: Replace library/page.tsx with ChatBrowser wrapper

**Files:**

- Modify: `src/app/library/page.tsx`

- [ ] **Step 1: Replace the entire file**

```tsx
// src/app/library/page.tsx
'use client';

import ChatBrowser from '@/components/Chats/ChatBrowser';
import { BookOpenText } from 'lucide-react';

const Page = () => (
  <div>
    <div className="flex flex-col pt-4">
      <div className="flex items-center">
        <BookOpenText />
        <h1 className="text-3xl font-medium p-2">Library</h1>
      </div>
      <hr className="border-t border-surface-2 my-4 w-full" />
    </div>
    <ChatBrowser />
  </div>
);

export default Page;
```

- [ ] **Step 2: Verify type-check**

Run: `yarn tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Automated verification (playwright-cli)**

```bash
playwright-cli -s=ws goto http://localhost:3000/library
playwright-cli -s=ws snapshot
# Confirm: page renders the workspace filter chip row (with "All", "Plan Test WS", "No workspace"),
# the search bar, the Pinned/Scheduled chips, and at least one chat row.

# Pinned toggle
playwright-cli -s=ws click <ref-of-Pinned-chip>
playwright-cli -s=ws snapshot
playwright-cli -s=ws click <ref-of-Pinned-chip>
playwright-cli -s=ws snapshot

# Text search
playwright-cli -s=ws fill <ref-of-search-input> "hello"
# Wait for debounce (~600ms) before snapshotting
sleep 1
playwright-cli -s=ws snapshot
# Confirm: results show with highlighted excerpts where applicable.

# Clear search
playwright-cli -s=ws click <ref-of-clear-X-button>
playwright-cli -s=ws snapshot

# Workspace filter chip multi-select
playwright-cli -s=ws click <ref-of-Plan-Test-WS-chip>
playwright-cli -s=ws snapshot
# Confirm: list filters to that workspace's chats; selected chip uses the workspace color tint.
playwright-cli -s=ws click <ref-of-No-workspace-chip>
playwright-cli -s=ws snapshot
# Confirm: list now includes both the workspace chats and the unassigned chats.
playwright-cli -s=ws click <ref-of-All-chip>
playwright-cli -s=ws snapshot
# Confirm: returns to all-chats state.

playwright-cli -s=ws snapshot --filename=task-12-final.yml
```

- [ ] **Step 4: Commit**

```bash
git add src/app/library/page.tsx
git commit -m "refactor(library): use ChatBrowser component"
```

---

## Task 13: Replace ChatsTab with ChatBrowser wrapper

**Files:**

- Modify: `src/components/Workspaces/ChatsTab.tsx`

- [ ] **Step 1: Replace the file**

```tsx
// src/components/Workspaces/ChatsTab.tsx
'use client';

import ChatBrowser from '@/components/Chats/ChatBrowser';

const ChatsTab = ({ workspaceId }: { workspaceId: string }) => (
  <ChatBrowser workspaceId={workspaceId} />
);

export default ChatsTab;
```

- [ ] **Step 2: Verify type-check**

Run: `yarn tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Automated verification (playwright-cli)**

```bash
playwright-cli -s=ws goto http://localhost:3000/workspaces
playwright-cli -s=ws snapshot
playwright-cli -s=ws click <ref-of-Plan-Test-WS-card>
playwright-cli -s=ws snapshot
# Default tab is Chats — confirm the ChatBrowser UI renders WITHOUT the workspace filter chip row,
# WITHOUT per-row workspace chips, WITH a "+ New chat" button visible in the header.

# Search still works in scoped mode
playwright-cli -s=ws fill <ref-of-search-input> "hello"
sleep 1
playwright-cli -s=ws snapshot
playwright-cli -s=ws click <ref-of-clear-X-button>
playwright-cli -s=ws snapshot

# "+ New chat" navigation
playwright-cli -s=ws click <ref-of-New-chat-button>
playwright-cli -s=ws snapshot
# Confirm URL is /?workspace=<WS_ID>. The workspace picker on EmptyChat shows "Plan Test WS" pre-selected
# (still using the native <select> until Task 15 — confirm the select's value attribute via eval).
playwright-cli -s=ws eval "document.querySelector('select')?.value"
# Expect: the workspace id of Plan Test WS.

playwright-cli -s=ws snapshot --filename=task-13-final.yml
```

- [ ] **Step 4: Commit**

```bash
git add src/components/Workspaces/ChatsTab.tsx
git commit -m "refactor(workspaces): ChatsTab uses ChatBrowser"
```

---

## Task 14: Create new WorkspacePicker (chip + popover)

**Files:**

- Create: `src/components/Workspaces/WorkspacePicker.tsx`

- [ ] **Step 1: Write the file**

```tsx
// src/components/Workspaces/WorkspacePicker.tsx
'use client';

import { cn } from '@/lib/utils';
import { workspaceColorClasses } from '@/lib/workspaces/appearance';
import WorkspaceIcon from './WorkspaceIcon';
import { Check, ChevronDown, FolderOpen, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface WorkspaceOption {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
}

interface Props {
  value: string | null;
  onChange: (id: string | null) => void;
}

const WorkspacePicker = ({ value, onChange }: Props) => {
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch('/api/workspaces')
      .then((r) => r.json())
      .then((d) => setWorkspaces(d.workspaces ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClickAway = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, [open]);

  if (workspaces.length === 0) return null;

  const selected = workspaces.find((w) => w.id === value) ?? null;
  const filtered = workspaces.filter((w) =>
    w.name.toLowerCase().includes(filter.toLowerCase()),
  );
  // List entries: index 0 is "No workspace", then filtered workspaces.
  const entries: Array<{
    id: string | null;
    label: string;
    ws?: WorkspaceOption;
  }> = [
    { id: null, label: 'No workspace' },
    ...filtered.map((w) => ({ id: w.id, label: w.name, ws: w })),
  ];

  const c = selected
    ? workspaceColorClasses(selected.color)
    : workspaceColorClasses(null);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, entries.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const entry = entries[activeIndex];
      if (entry) {
        onChange(entry.id);
        setOpen(false);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-colors',
          selected
            ? cn(c.bgTint, c.border, c.text)
            : 'bg-surface border-surface-2 text-fg/60 hover:text-fg hover:border-fg/30',
        )}
      >
        {selected ? (
          <WorkspaceIcon
            name={selected.icon}
            color={selected.color}
            size={13}
          />
        ) : (
          <FolderOpen size={13} className="text-fg/50" />
        )}
        <span>{selected ? selected.name : 'Workspace'}</span>
        <ChevronDown size={13} className="opacity-60" />
      </button>

      {open && (
        <div
          className="absolute z-30 mt-2 w-64 rounded-xl border border-surface-2 bg-surface shadow-xl overflow-hidden"
          onKeyDown={onKeyDown}
        >
          <div className="relative border-b border-surface-2">
            <Search
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg/40"
              size={13}
            />
            <input
              autoFocus
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setActiveIndex(0);
              }}
              placeholder="Search workspaces…"
              className="w-full pl-8 pr-2 py-2 text-xs bg-transparent focus:outline-none"
            />
          </div>
          <ul className="max-h-64 overflow-y-auto py-1" role="listbox">
            {entries.map((entry, idx) => {
              const active = idx === activeIndex;
              const isSelected =
                entry.id === value || (entry.id === null && value === null);
              return (
                <li key={entry.id ?? 'none'}>
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => {
                      onChange(entry.id);
                      setOpen(false);
                    }}
                    className={cn(
                      'w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left',
                      active ? 'bg-surface-2' : '',
                    )}
                  >
                    {entry.ws ? (
                      <>
                        <WorkspaceIcon
                          name={entry.ws.icon}
                          color={entry.ws.color}
                          size={13}
                        />
                        <span
                          className={cn(
                            'h-2 w-2 rounded-full',
                            workspaceColorClasses(entry.ws.color).swatch,
                          )}
                        />
                      </>
                    ) : (
                      <FolderOpen size={13} className="text-fg/40" />
                    )}
                    <span className="flex-1 truncate">{entry.label}</span>
                    {isSelected && <Check size={12} className="text-accent" />}
                  </button>
                </li>
              );
            })}
            {entries.length === 1 && filter && (
              <li className="px-3 py-2 text-xs text-fg/40">No matches.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
};

export default WorkspacePicker;
```

- [ ] **Step 2: Verify type-check**

Run: `yarn tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/Workspaces/WorkspacePicker.tsx
git commit -m "feat(workspaces): chip+popover WorkspacePicker"
```

---

## Task 15: Wire new WorkspacePicker into EmptyChat

**Files:**

- Modify: `src/components/EmptyChat.tsx`

- [ ] **Step 1: Remove the inline picker and import the new one**

In `src/components/EmptyChat.tsx`:

1. Remove the entire inline `WorkspaceOption` interface (lines 8-12) and the inline `WorkspacePicker` component (lines 14-46).
2. Add import:

```tsx
import WorkspacePicker from './Workspaces/WorkspacePicker';
```

3. The existing usage block (lines 124-129) already references `<WorkspacePicker value={...} onChange={...} />` and continues to work as-is.

- [ ] **Step 2: Verify type-check**

Run: `yarn tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Automated verification (playwright-cli)**

```bash
playwright-cli -s=ws goto http://localhost:3000/
playwright-cli -s=ws snapshot
# Confirm: a chip-style workspace picker (button with FolderOpen icon) is present — NO native <select>.
playwright-cli -s=ws eval "document.querySelectorAll('select').length"
# Expect: 0 (or only unrelated selects).

# Open the popover
playwright-cli -s=ws click <ref-of-workspace-picker-chip>
playwright-cli -s=ws snapshot
# Confirm: a popover appears with a search input and entries including "No workspace" + "Plan Test WS".

# Filter by typing
playwright-cli -s=ws fill <ref-of-popover-search-input> "Plan"
playwright-cli -s=ws snapshot
# Confirm only matching entries shown.

# Keyboard navigation: ArrowDown then Enter selects "Plan Test WS"
playwright-cli -s=ws press ArrowDown
playwright-cli -s=ws press Enter
playwright-cli -s=ws snapshot
# Confirm chip now displays "Plan Test WS" with violet tint.

# Re-open and select "No workspace"
playwright-cli -s=ws click <ref-of-workspace-picker-chip>
playwright-cli -s=ws snapshot
playwright-cli -s=ws click <ref-of-No-workspace-entry>
playwright-cli -s=ws snapshot
# Confirm chip reverts to "Workspace" placeholder.

# Outside-click closes the popover
playwright-cli -s=ws click <ref-of-workspace-picker-chip>
playwright-cli -s=ws snapshot
playwright-cli -s=ws click <ref-of-page-body-or-far-element>
playwright-cli -s=ws snapshot
# Confirm popover is gone.

playwright-cli -s=ws snapshot --filename=task-15-final.yml
```

- [ ] **Step 4: Commit**

```bash
git add src/components/EmptyChat.tsx
git commit -m "feat(workspaces): use chip+popover picker on EmptyChat"
```

---

## Task 16: ChatWindow reads `?workspace=` and renders header chip

**Files:**

- Modify: `src/components/ChatWindow.tsx`
- Create: `src/components/Workspaces/WorkspaceHeaderChip.tsx`

### Part A — initialize workspace from URL

- [ ] **Step 1: Update the initializer**

In `src/components/ChatWindow.tsx`, find around line 439:

```tsx
const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
  null,
);
```

Replace with:

```tsx
const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
  () => searchParams.get('workspace'),
);
```

(`searchParams` is already in scope; verify by `grep -n "searchParams" src/components/ChatWindow.tsx | head`.)

### Part B — header chip component

- [ ] **Step 2: Create the header chip helper**

```tsx
// src/components/Workspaces/WorkspaceHeaderChip.tsx
'use client';

import { useEffect, useState } from 'react';
import WorkspaceChip from './WorkspaceChip';

interface Workspace {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  archivedAt: string | null;
}

const WorkspaceHeaderChip = ({ workspaceId }: { workspaceId: string }) => {
  const [ws, setWs] = useState<Workspace | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.workspace) setWs(d.workspace);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  if (!ws) return null;

  return (
    <WorkspaceChip
      id={ws.id}
      name={ws.name}
      icon={ws.icon}
      color={ws.color}
      muted={!!ws.archivedAt}
    />
  );
};

export default WorkspaceHeaderChip;
```

### Part C — render chip in ChatWindow header

- [ ] **Step 3: Find the chat header location**

Run: `grep -n "Navbar\|chat title\|chatTitle\|<h1\|<h2" src/components/ChatWindow.tsx | head -20`

Identify where the active chat's title is rendered at the top of the thread (likely inside a `<Navbar>` component or a top-of-viewport div). If a separate `Navbar.tsx` component exists for the chat thread, modify it instead.

Run: `find src/components -maxdepth 2 -name 'Navbar*'`

- [ ] **Step 4: Render the chip near the title**

In whichever component renders the chat thread title (most likely `src/components/Navbar.tsx`):

1. Add a prop:

```tsx
workspaceId?: string | null;
```

2. Add import:

```tsx
import WorkspaceHeaderChip from '@/components/Workspaces/WorkspaceHeaderChip';
```

3. Render alongside the title (inside the same flex container as the title), gated on `!isPrivateSession`:

```tsx
{
  workspaceId && !isPrivateSession && (
    <WorkspaceHeaderChip workspaceId={workspaceId} />
  );
}
```

4. In `ChatWindow.tsx`, when rendering the Navbar (or equivalent), pass `workspaceId={selectedWorkspaceId}` and `isPrivateSession={isPrivateSession}`.

If no Navbar component exists, render the chip directly inside `ChatWindow.tsx` near the existing chat title (same flex row).

- [ ] **Step 5: Verify type-check**

Run: `yarn tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Automated verification (playwright-cli)**

```bash
WS_ID=$(curl -s 'http://localhost:3000/api/workspaces' | jq -r '.workspaces[] | select(.name=="Plan Test WS") | .id')

# Full flow from workspace ChatsTab → new chat → header chip
playwright-cli -s=ws goto "http://localhost:3000/workspaces/$WS_ID"
playwright-cli -s=ws snapshot
playwright-cli -s=ws click <ref-of-New-chat-button>
playwright-cli -s=ws snapshot
# Confirm URL is /?workspace=<WS_ID> AND the new chip-popover picker shows "Plan Test WS" pre-selected.

# Send a message
playwright-cli -s=ws fill <ref-of-message-input> "verify header chip"
playwright-cli -s=ws press Enter
sleep 2
playwright-cli -s=ws snapshot
# Confirm URL is /c/<chatId>; confirm the chat thread header contains a WorkspaceChip linking to /workspaces/<WS_ID>.

# Confirm chip click navigates to workspace
playwright-cli -s=ws click <ref-of-header-workspace-chip>
playwright-cli -s=ws snapshot
# Confirm URL is /workspaces/<WS_ID>.

# Find a chat WITHOUT a workspace and confirm no chip
playwright-cli -s=ws goto http://localhost:3000/library
playwright-cli -s=ws snapshot
# Click any chat row that has no workspace chip in the row
playwright-cli -s=ws click <ref-of-unassigned-chat-row>
playwright-cli -s=ws snapshot
# Confirm: header has NO workspace chip.

# Private session shouldn't show workspace UI
playwright-cli -s=ws goto http://localhost:3000/?private=1
playwright-cli -s=ws snapshot
# Confirm: no workspace picker chip rendered (because EmptyChat hides it in private mode).

playwright-cli -s=ws snapshot --filename=task-16-final.yml
```

- [ ] **Step 7: Commit**

```bash
git add src/components/ChatWindow.tsx src/components/Workspaces/WorkspaceHeaderChip.tsx src/components/Navbar.tsx 2>/dev/null
git commit -m "feat(workspaces): pre-select via ?workspace= and show chip in chat header"
```

(Use whichever files were actually modified — drop `Navbar.tsx` from the add list if it wasn't touched.)

---

## Task 17: Final regression sweep

**Files:** none modified — this is a verification task.

- [ ] **Step 1: Type check & lint**

```bash
yarn tsc --noEmit
yarn lint
```

Expected: both pass with no new errors.

- [ ] **Step 2: Build**

```bash
yarn build
```

Expected: build succeeds. (Note: `build` runs db:push first; that's fine since schema is unchanged.)

- [ ] **Step 3: End-to-end smoke (playwright-cli)**

Walk through each original issue using the existing `ws` session:

```bash
WS_ID=$(curl -s 'http://localhost:3000/api/workspaces' | jq -r '.workspaces[] | select(.name=="Plan Test WS") | .id')

# Issue #1 — color/icon visible everywhere
playwright-cli -s=ws goto http://localhost:3000/workspaces
playwright-cli -s=ws snapshot --filename=smoke-1-list.yml
playwright-cli -s=ws goto "http://localhost:3000/workspaces/$WS_ID"
playwright-cli -s=ws snapshot --filename=smoke-1-detail.yml
playwright-cli -s=ws goto http://localhost:3000/library
playwright-cli -s=ws snapshot --filename=smoke-1-library.yml
playwright-cli -s=ws goto http://localhost:3000/
playwright-cli -s=ws snapshot --filename=smoke-1-empty.yml

# Issue #2 — workspace-scoped chat start
playwright-cli -s=ws goto "http://localhost:3000/workspaces/$WS_ID"
playwright-cli -s=ws click <ref-of-New-chat-button>
playwright-cli -s=ws snapshot --filename=smoke-2-new-chat.yml

# Issue #3 — new-chat picker aesthetic
playwright-cli -s=ws goto http://localhost:3000/
playwright-cli -s=ws eval "document.querySelectorAll('select').length"
# Expect: 0

# Issue #4 — library filter chips
playwright-cli -s=ws goto http://localhost:3000/library
playwright-cli -s=ws click <ref-of-Plan-Test-WS-chip>
playwright-cli -s=ws snapshot --filename=smoke-4-filtered.yml

# Issue #5 — chat thread indicator
# (covered by Task 16 final snapshot; re-verify by opening any chat with a workspace)
playwright-cli -s=ws click <ref-of-chat-row-with-workspace>
playwright-cli -s=ws snapshot --filename=smoke-5-thread.yml

# Issue #6 — ChatsTab parity
playwright-cli -s=ws goto "http://localhost:3000/workspaces/$WS_ID"
playwright-cli -s=ws snapshot --filename=smoke-6-chatstab.yml
# Confirm search input, Pinned/Scheduled chips, "+ New chat" button all present.
```

Inspect each `smoke-*.yml` snapshot to confirm the relevant UI elements are present.

- [ ] **Step 4: Commit any cleanup if needed**

If lint surfaced warnings (e.g. unused imports), fix and commit:

```bash
git add -p
git commit -m "chore(workspaces): cleanup after polish refactor"
```

- [ ] **Step 5: Tear down**

```bash
playwright-cli -s=ws close
# Stop the backgrounded `yarn dev` (use the session's BashKill if available, or Ctrl+C in terminal)
```

---

## Self-Review Checklist (run mentally before claiming done)

- [ ] Spec issue #1 (color/icon visible everywhere): Tasks 1, 2, 3, 4, 5, 6, 7 + chip render in ChatBrowser/ChatRow/header chip.
- [ ] Spec issue #2 (start workspace-scoped chat): Task 11 (button) + Task 16 Part A (URL init).
- [ ] Spec issue #3 (new-chat picker aesthetic): Tasks 14, 15.
- [ ] Spec issue #4 (library filter chips): Task 11 (chips in unscoped mode).
- [ ] Spec issue #5 (chat thread indicator): Task 16 Parts B + C.
- [ ] Spec issue #6 (ChatsTab parity with Library): Tasks 10, 11, 13.
- [ ] No placeholders / TODOs in any task body.
- [ ] All file paths absolute or repo-relative; no inventions.
- [ ] No dynamic Tailwind class strings.
- [ ] DeleteChat contract verified (Task 10 step 2).
