/**
 * Pure colour maths for theming: contrast, the contrast-picked foregrounds, and
 * the CSS variables a theme resolves to. No DOM, no React — unit-tested through
 * this interface (`derive.test.ts`).
 *
 * Only the values that depend on a *contrast decision* are computed here. The
 * purely proportional derivations (surface-2, well, border, the accent ramp,
 * the -soft status fills) stay in `globals.css` as `color-mix`, so they follow
 * the seeds without a re-render.
 */
import { SEED_KEYS, type Theme, type ThemeSeeds } from './types';

/** Text placed on a light fill. Matches the old `--color-success-fg`. */
const INK_DARK = '#1c1c1c';
/** Text placed on a dark fill. Matches the old `--color-accent-fg`. */
const INK_LIGHT = '#fcfcfc';

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value.trim());
}

/** Expand `#abc` to `#aabbcc` and lowercase. Assumes `isHexColor` already passed. */
export function normalizeHex(hex: string): string {
  const h = hex.trim().toLowerCase();
  if (h.length === 4) {
    return `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  }
  return h;
}

function toRgb(hex: string): [number, number, number] {
  const h = normalizeHex(hex).slice(1);
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1–21. Order-independent. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Opaque blend of `a` over `b`, `amount` being the share of `a`. */
export function mix(a: string, b: string, amount: number): string {
  const ra = toRgb(a);
  const rb = toRgb(b);
  const ch = (i: number) => Math.round(ra[i] * amount + rb[i] * (1 - amount));
  return `#${[0, 1, 2].map((i) => ch(i).toString(16).padStart(2, '0')).join('')}`;
}

/** Whichever ink reads better on `fill` — used for text on accent/status fills. */
export function readableFg(fill: string): string {
  return contrastRatio(INK_LIGHT, fill) >= contrastRatio(INK_DARK, fill)
    ? INK_LIGHT
    : INK_DARK;
}

/**
 * The CSS custom properties a theme resolves to: the seven seeds, plus the four
 * foregrounds that need a contrast decision. Everything else derives in CSS.
 */
export function themeVars(theme: ThemeSeeds): Record<string, string> {
  return {
    '--color-bg': theme.bg,
    '--color-fg': theme.fg,
    '--color-surface': theme.surface,
    '--color-accent': theme.accent,
    '--color-danger': theme.danger,
    '--color-success': theme.success,
    '--color-warning': theme.warning,
    '--color-accent-fg': readableFg(theme.accent),
    '--color-danger-fg': readableFg(theme.danger),
    '--color-success-fg': readableFg(theme.success),
    '--color-warning-fg': readableFg(theme.warning),
  };
}

/**
 * Contrast pairs surfaced as warnings in the custom editor, keyed by the seed
 * whose picker they annotate. Advisory only — a custom theme always applies.
 */
export const CONTRAST_CHECKS: {
  seed: keyof ThemeSeeds;
  label: string;
  pair: (t: ThemeSeeds) => [string, string];
  min: number;
}[] = [
  {
    seed: 'fg',
    label: 'Text on background',
    pair: (t) => [t.fg, t.bg],
    min: 4.5,
  },
  {
    seed: 'surface',
    label: 'Text on surface',
    pair: (t) => [t.fg, t.surface],
    min: 4.5,
  },
  {
    seed: 'accent',
    label: 'Text on accent',
    pair: (t) => [readableFg(t.accent), t.accent],
    min: 4.5,
  },
  {
    seed: 'danger',
    label: 'Danger on background',
    pair: (t) => [t.danger, t.bg],
    min: 3,
  },
  {
    seed: 'success',
    label: 'Success on background',
    pair: (t) => [t.success, t.bg],
    min: 3,
  },
  {
    seed: 'warning',
    label: 'Warning on background',
    pair: (t) => [t.warning, t.bg],
    min: 3,
  },
];

/** Failing contrast checks for a theme, in `CONTRAST_CHECKS` order. */
export function contrastWarnings(theme: ThemeSeeds) {
  return CONTRAST_CHECKS.map((c) => ({
    ...c,
    ratio: contrastRatio(...c.pair(theme)),
  })).filter((c) => c.ratio < c.min);
}

/** The copyable form of a theme: seeds, name, mode and syntax style. */
export function serializeTheme(theme: Theme): string {
  return JSON.stringify(
    {
      name: theme.name,
      mode: theme.mode,
      ...(theme.syntax ? { syntax: theme.syntax } : {}),
      ...Object.fromEntries(SEED_KEYS.map((k) => [k, theme[k]])),
    },
    null,
    2,
  );
}

export type ParseResult =
  { ok: true; theme: Omit<Theme, 'id'> } | { ok: false; error: string };

/**
 * Parse a pasted theme. Unknown keys are ignored so a theme copied from a
 * future version still imports; every seed must be present and a valid hex.
 */
export function parseTheme(input: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(input);
  } catch {
    return { ok: false, error: "That doesn't look like valid JSON." };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'Expected a theme object.' };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.mode !== 'light' && obj.mode !== 'dark') {
    return {
      ok: false,
      error: 'Missing or invalid "mode" (expected light or dark).',
    };
  }
  const seeds = {} as ThemeSeeds;
  for (const key of SEED_KEYS) {
    const value = obj[key];
    if (!isHexColor(value)) {
      return { ok: false, error: `Missing or invalid hex color for "${key}".` };
    }
    seeds[key] = normalizeHex(value);
  }
  const name =
    typeof obj.name === 'string' && obj.name.trim()
      ? obj.name.trim()
      : 'Custom';
  // An unrecognised key isn't an error: `prismStyleFor` falls back by mode, and
  // validating here would drag the whole style registry into this pure module.
  const syntax = typeof obj.syntax === 'string' ? obj.syntax : undefined;
  return { ok: true, theme: { name, mode: obj.mode, syntax, ...seeds } };
}
