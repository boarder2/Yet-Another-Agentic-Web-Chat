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
