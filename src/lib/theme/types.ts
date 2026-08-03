/**
 * A theme is seven seed colors plus a mode. Everything else the UI needs
 * (surface-2, well, border, the accent ramp, the -soft status fills) derives
 * from these in `globals.css` via `color-mix`, so applying a theme is just
 * writing the seeds onto `:root`.
 *
 * Built-in themes and the user's custom theme are the same shape. Built-ins are
 * immutable; the single custom slot is only ever written by an explicit,
 * confirmed action (copying a built-in into it, or pasting one), so a custom
 * theme always starts from a coherent palette rather than a blank one.
 */
export type ThemeMode = 'light' | 'dark';

/** The seven pickable colors. Hex, because that's what `<input type="color">` speaks. */
export interface ThemeSeeds {
  bg: string;
  fg: string;
  surface: string;
  accent: string;
  danger: string;
  success: string;
  warning: string;
}

export interface Theme extends ThemeSeeds {
  id: string;
  name: string;
  mode: ThemeMode;
  /** Canonical palette spec this was transcribed from. Absent on custom themes. */
  source?: string;
  /**
   * Key into `SYNTAX_STYLES` for code rendering. Absent means "automatic" —
   * One Dark / One Light by mode. Editable on the custom theme.
   */
  syntax?: string;
  /**
   * The palette this theme belongs to, when it is one of several. The picker
   * shows one tile per family per mode and offers the variants in a dropdown,
   * so a family of forty-odd themes stays browsable. Absent means standalone:
   * `name` is the whole story and the tile has no dropdown.
   */
  family?: string;
  /** This theme's name within its family. Present exactly when `family` is. */
  variant?: string;
  /**
   * A heading within the family's variant list, for a family whose variants
   * have two axes. Only Catppuccin has one: flavour, then accent.
   */
  group?: string;
}

export const SEED_KEYS = [
  'bg',
  'fg',
  'surface',
  'accent',
  'danger',
  'success',
  'warning',
] as const satisfies readonly (keyof ThemeSeeds)[];

/** Labels for the custom editor's pickers, in display order. */
export const SEED_LABELS: Record<keyof ThemeSeeds, string> = {
  bg: 'Background',
  fg: 'Text',
  surface: 'Surface',
  accent: 'Accent',
  danger: 'Danger',
  success: 'Success',
  warning: 'Warning',
};
