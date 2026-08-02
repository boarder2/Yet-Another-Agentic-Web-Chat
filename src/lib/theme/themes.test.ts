/**
 * Invariants over the built-in catalogue. These exist because the palettes are
 * hand-transcribed from upstream specs — a mistyped hex is invisible to an e2e
 * test but caught here.
 *
 * The contrast floors are deliberately below WCAG AA in places: the catalogue
 * ships each palette faithfully, and several canonical palettes (Solarized,
 * Everforest Light, Rosé Pine Dawn, Catppuccin Latte) are lower-contrast by
 * design. The floors assert "no theme is worse than the palettes we chose to
 * ship", not "every theme is AA".
 */
import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  isHexColor,
  luminance,
  mix,
  readableFg,
} from './derive';
import {
  DEFAULT_THEME_ID,
  getTheme,
  resolveBuiltIn,
  THEMES,
  themesByMode,
} from './themes';
import { SEED_KEYS } from './types';

describe('theme catalogue', () => {
  it('has a default and both modes represented', () => {
    expect(getTheme(DEFAULT_THEME_ID)).toBeDefined();
    expect(THEMES.filter((t) => t.mode === 'dark').length).toBeGreaterThan(0);
    expect(THEMES.filter((t) => t.mode === 'light').length).toBeGreaterThan(0);
  });

  it('has unique ids and names', () => {
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
    expect(new Set(THEMES.map((t) => t.name)).size).toBe(THEMES.length);
  });

  it('orders both modes lightest background first', () => {
    for (const mode of ['dark', 'light'] as const) {
      const ls = themesByMode(mode).map((t) => luminance(t.bg));
      expect(ls, mode).toEqual([...ls].sort((a, b) => b - a));
    }
  });

  it('breaks background ties by name rather than declaration order', () => {
    for (const mode of ['dark', 'light'] as const) {
      const listed = themesByMode(mode);
      const ties = listed.filter((t, i) => i > 0 && listed[i - 1].bg === t.bg);
      // Guards the guard: if the catalogue ever stops sharing a background,
      // this test would silently pass without asserting anything.
      expect(
        ties.length,
        `${mode} has no tied backgrounds to check`,
      ).toBeGreaterThan(0);
      for (const t of ties) {
        const prev = listed[listed.indexOf(t) - 1];
        expect(
          prev.name.localeCompare(t.name),
          `${prev.name} vs ${t.name}`,
        ).toBeLessThan(0);
      }
    }
  });

  it('partitions the catalogue by mode without dropping or duplicating', () => {
    const listed = [...themesByMode('dark'), ...themesByMode('light')];
    expect(listed).toHaveLength(THEMES.length);
    expect(new Set(listed.map((t) => t.id)).size).toBe(THEMES.length);
  });

  it('does not reorder the registry itself', () => {
    const before = THEMES.map((t) => t.id);
    themesByMode('dark');
    themesByMode('light');
    expect(THEMES.map((t) => t.id)).toEqual(before);
  });

  it('falls back to the default for an unknown id', () => {
    expect(resolveBuiltIn('nope').id).toBe(DEFAULT_THEME_ID);
    expect(resolveBuiltIn(null).id).toBe(DEFAULT_THEME_ID);
  });

  it('only names syntax styles that actually resolve', async () => {
    // Guards against a theme declaring `syntax: 'x'` with no matching import,
    // which would silently fall back to One Dark instead of failing.
    const { PRISM_STYLES } = await import('./syntax');
    for (const theme of THEMES) {
      if (!theme.syntax) continue;
      expect(
        Object.keys(PRISM_STYLES),
        `${theme.id} names an unknown syntax style`,
      ).toContain(theme.syntax);
    }
  });

  it('lifts each style’s own fence background out of the style', async () => {
    // The fill has to reach the wrapper div, and leaving it on the `pre` rule
    // too makes React warn about mixing `background` with `backgroundColor`.
    const { PRISM_STYLES } = await import('./syntax');
    for (const [key, { style, background }] of Object.entries(PRISM_STYLES)) {
      // The bare fence rule only — `::selection` and friends keep theirs.
      for (const selector of [
        'pre[class*="language-"]',
        "pre[class*='language-']",
      ]) {
        const rule = style[selector];
        if (!rule) continue;
        expect(rule.background, `${key} kept a background on ${selector}`).toBe(
          undefined,
        );
        expect(rule.backgroundColor).toBe(undefined);
      }
      // Synthwave '84 builds its look from gradients and has no solid fill;
      // every other style must offer one or fences render unpainted.
      if (key === 'synthwave84') expect(background).toBe(undefined);
      else expect(background, `${key} has no fence background`).toBeTruthy();
    }
  });

  it('labels every syntax style, and only real ones', async () => {
    // The picker is built from the labels, so a missing one hides a style and a
    // stray one offers a key that resolves to nothing.
    const { PRISM_STYLES, SYNTAX_LABELS } = await import('./syntax');
    expect(Object.keys(SYNTAX_LABELS).sort()).toEqual(
      Object.keys(PRISM_STYLES).sort(),
    );
  });

  it('cites a canonical source for every third-party palette', () => {
    for (const theme of THEMES) {
      // The two stock themes are ours; everything else is transcribed.
      if (theme.id === 'dark' || theme.id === 'light') continue;
      expect(theme.source, `${theme.id} is missing a source`).toMatch(
        /^https:\/\//,
      );
    }
  });
});

describe.each(THEMES.map((t) => [t.id, t] as const))('%s', (id, theme) => {
  it('defines every seed as a valid hex', () => {
    for (const key of SEED_KEYS) {
      expect(isHexColor(theme[key]), `${id}.${key} = ${theme[key]}`).toBe(true);
    }
  });

  it('declares a mode', () => {
    expect(['light', 'dark']).toContain(theme.mode);
  });

  it('has a background whose lightness matches its mode', () => {
    const white = contrastRatio(theme.bg, '#ffffff');
    expect(theme.mode === 'dark' ? white > 4 : white < 4).toBe(true);
  });

  it('keeps body text readable on background and surface', () => {
    expect(contrastRatio(theme.fg, theme.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(theme.fg, theme.surface)).toBeGreaterThanOrEqual(4.0);
  });

  it('keeps secondary text (the text-fg/60 ramp) legible', () => {
    expect(
      contrastRatio(mix(theme.fg, theme.bg, 0.6), theme.bg),
    ).toBeGreaterThanOrEqual(2.3);
  });

  // Floor is low on purpose: several palettes' status colors are pale by design
  // (Rosé Pine Dawn's gold is the binding case at 2.05:1). This catches a
  // transcription error that lands a status color on top of the background, not
  // a palette that is merely soft.
  it('keeps accent and status colors distinguishable from the background', () => {
    for (const key of ['accent', 'danger', 'success', 'warning'] as const) {
      expect(
        contrastRatio(theme[key], theme.bg),
        `${id}.${key} on bg`,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  // readableFg already picks the better of the two inks; this asserts the
  // result clears the worst case in the catalogue (Nord's Aurora red, 4.17:1).
  it('produces readable text on every colored fill', () => {
    for (const key of ['accent', 'danger', 'success', 'warning'] as const) {
      expect(
        contrastRatio(readableFg(theme[key]), theme[key]),
        `text on ${id}.${key}`,
      ).toBeGreaterThanOrEqual(4);
    }
  });

  it('distinguishes surface from background', () => {
    expect(theme.surface).not.toBe(theme.bg);
  });
});
