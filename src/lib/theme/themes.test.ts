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
  themeFamiliesByMode,
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
    // The picker is built from the metadata, so a missing entry hides a style
    // and a stray one offers a key that resolves to nothing.
    const { PRISM_STYLES, SYNTAX_STYLES } = await import('./syntax');
    expect(Object.keys(SYNTAX_STYLES).sort()).toEqual(
      Object.keys(PRISM_STYLES).sort(),
    );
  });

  it('gives every theme but the two stock ones a syntax style', async () => {
    // Dark and Light are ours and have no upstream syntax spec, so they use the
    // One Dark / One Light fallback on purpose. Anything else falling back means
    // a theme shipped without its own style.
    const { PRISM_STYLES } = await import('./syntax');
    expect(Object.keys(PRISM_STYLES).length).toBeGreaterThan(0);
    for (const theme of THEMES) {
      if (theme.id === 'dark' || theme.id === 'light') continue;
      expect(theme.syntax, `${theme.id} has no syntax style`).toBeTruthy();
    }
  });

  it('offers every style through the family/variant pair', async () => {
    // The picker reaches a style only through its family, so a style missing
    // from the families list is unreachable however well it renders.
    const { SYNTAX_FAMILIES, SYNTAX_STYLES, syntaxFamilyOf } =
      await import('./syntax');
    const listed = SYNTAX_FAMILIES.flatMap((f) =>
      f.variants.map((v) => v.value),
    );
    expect(listed.sort()).toEqual(Object.keys(SYNTAX_STYLES).sort());
    for (const family of SYNTAX_FAMILIES)
      for (const variant of family.variants)
        expect(syntaxFamilyOf(variant.value)).toBe(family.family);
  });

  it('lists families alphabetically and keeps variants grouped together', async () => {
    const { SYNTAX_FAMILIES } = await import('./syntax');
    const names = SYNTAX_FAMILIES.map((f) => f.family);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    // A family's optgroups must be contiguous, or the picker splits a flavour
    // across two headings.
    for (const { family, variants } of SYNTAX_FAMILIES) {
      const runs = variants
        .map((v) => v.group)
        .filter((g, i, all) => i === 0 || g !== all[i - 1]);
      expect(new Set(runs).size, `${family}`).toBe(runs.length);
    }
  });
});

describe('theme families', () => {
  const families = new Map<string, typeof THEMES>();
  for (const theme of THEMES) {
    if (!theme.family) continue;
    families.set(theme.family, [...(families.get(theme.family) ?? []), theme]);
  }

  it('pairs family with variant, never one without the other', () => {
    for (const theme of THEMES) {
      expect(!!theme.family, `${theme.id}`).toBe(!!theme.variant);
    }
  });

  it('only declares a family that has more than one member', () => {
    // A family of one would render as a tile with a single-option dropdown.
    expect(families.size).toBeGreaterThan(0);
    for (const [name, members] of families) {
      expect(members.length, `${name} has one member`).toBeGreaterThan(1);
    }
  });

  it('keeps variant names unique within a family, or within its group', () => {
    // Catppuccin repeats every accent across its four flavours, so uniqueness
    // is per group there; a family without groups is one group of undefined.
    for (const [name, members] of families) {
      const keys = members.map((t) => `${t.group ?? ''}/${t.variant}`);
      expect(new Set(keys).size, `${name}`).toBe(members.length);
    }
  });

  it('groups a family’s tile options contiguously', () => {
    // The tile dropdown builds optgroups from consecutive runs, so a flavour
    // split in two would render as two headings with the same name.
    for (const mode of ['dark', 'light'] as const) {
      for (const { name, themes } of themeFamiliesByMode(mode)) {
        const runs = themes
          .map((t) => t.group)
          .filter((g, i, all) => i === 0 || g !== all[i - 1]);
        expect(new Set(runs).size, `${name} in ${mode}`).toBe(runs.length);
      }
    }
  });

  it('lists every theme exactly once across the mode tiles', () => {
    const listed = (['dark', 'light'] as const).flatMap((mode) =>
      themeFamiliesByMode(mode).flatMap((f) => f.themes),
    );
    expect(listed).toHaveLength(THEMES.length);
    expect(new Set(listed.map((t) => t.id)).size).toBe(THEMES.length);
  });

  it('keeps a family tile to a single mode', () => {
    for (const mode of ['dark', 'light'] as const) {
      for (const family of themeFamiliesByMode(mode)) {
        for (const theme of family.themes) expect(theme.mode).toBe(mode);
      }
    }
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

  it('keeps semantic muted and subtle text distinguishable', () => {
    const mutedContrast = contrastRatio(mix(theme.fg, theme.bg, 0.7), theme.bg);
    const subtleContrast = contrastRatio(
      mix(theme.fg, theme.bg, 0.5),
      theme.bg,
    );
    expect(mutedContrast).toBeGreaterThanOrEqual(2.3);
    expect(mutedContrast).toBeGreaterThan(subtleContrast);
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
