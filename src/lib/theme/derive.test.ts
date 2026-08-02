import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  contrastWarnings,
  isHexColor,
  mix,
  normalizeHex,
  parseTheme,
  readableFg,
  serializeTheme,
  themeVars,
} from './derive';
import type { Theme, ThemeSeeds } from './types';

const seeds: ThemeSeeds = {
  bg: '#1c1c1c',
  fg: '#f2f2f2',
  surface: '#2e2e2e',
  accent: '#2563eb',
  danger: '#ef4444',
  success: '#22c55e',
  warning: '#eab308',
};

describe('contrastRatio', () => {
  it('spans the full WCAG range', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#7f7f7f', '#7f7f7f')).toBeCloseTo(1, 5);
  });

  it('is order-independent', () => {
    expect(contrastRatio('#1c1c1c', '#f2f2f2')).toBeCloseTo(
      contrastRatio('#f2f2f2', '#1c1c1c'),
      10,
    );
  });
});

describe('normalizeHex', () => {
  it('expands shorthand and lowercases', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('  #FF0000 ')).toBe('#ff0000');
  });

  it('accepts both hex lengths and rejects everything else', () => {
    expect(isHexColor('#abc')).toBe(true);
    expect(isHexColor('#aabbcc')).toBe(true);
    expect(isHexColor('#abcd')).toBe(false);
    expect(isHexColor('rgb(0,0,0)')).toBe(false);
    expect(isHexColor(42)).toBe(false);
  });
});

describe('mix', () => {
  it('returns the endpoints at 1 and 0', () => {
    expect(mix('#ff0000', '#0000ff', 1)).toBe('#ff0000');
    expect(mix('#ff0000', '#0000ff', 0)).toBe('#0000ff');
  });

  it('blends channel-wise at the midpoint', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});

describe('readableFg', () => {
  it('picks dark ink on a light fill and light ink on a dark fill', () => {
    // A yellow accent is the classic trap: white-on-yellow is unreadable.
    expect(contrastRatio(readableFg('#ffd166'), '#ffd166')).toBeGreaterThan(
      4.5,
    );
    expect(readableFg('#ffd166')).toBe('#1c1c1c');
    expect(readableFg('#2563eb')).toBe('#fcfcfc');
  });

  it('always beats 4.5:1 against a mid-range fill', () => {
    for (const fill of ['#808080', '#767676', '#8a8a8a']) {
      const best = contrastRatio(readableFg(fill), fill);
      expect(best).toBeGreaterThanOrEqual(
        contrastRatio(
          readableFg(fill) === '#1c1c1c' ? '#fcfcfc' : '#1c1c1c',
          fill,
        ),
      );
    }
  });
});

describe('themeVars', () => {
  it('emits the seven seeds plus the four contrast-picked foregrounds', () => {
    const vars = themeVars(seeds);
    expect(Object.keys(vars)).toHaveLength(11);
    expect(vars['--color-bg']).toBe('#1c1c1c');
    expect(vars['--color-accent']).toBe('#2563eb');
    // Derived tokens stay in CSS — they must not appear here.
    expect(vars['--color-surface-2']).toBeUndefined();
    expect(vars['--color-well']).toBeUndefined();
  });

  it('picks a readable foreground for each fill', () => {
    const vars = themeVars({ ...seeds, accent: '#f9e2af' });
    expect(vars['--color-accent-fg']).toBe('#1c1c1c');
  });
});

describe('contrastWarnings', () => {
  it('is empty for a sound theme', () => {
    expect(contrastWarnings(seeds)).toEqual([]);
  });

  it('flags the offending seed with its measured ratio', () => {
    const warnings = contrastWarnings({ ...seeds, fg: '#222222' });
    const fg = warnings.find((w) => w.seed === 'fg');
    expect(fg).toBeDefined();
    expect(fg!.ratio).toBeLessThan(4.5);
  });

  it('never flags accent-fg, which is contrast-picked', () => {
    const warnings = contrastWarnings({ ...seeds, accent: '#ffd166' });
    expect(warnings.some((w) => w.seed === 'accent')).toBe(false);
  });
});

describe('parseTheme', () => {
  const valid = JSON.stringify({ name: 'Ocean', mode: 'dark', ...seeds });

  it('round-trips a serialized theme', () => {
    const theme: Theme = { id: 'x', name: 'Ocean', mode: 'dark', ...seeds };
    const result = parseTheme(serializeTheme(theme));
    expect(result).toEqual({
      ok: true,
      theme: { name: 'Ocean', mode: 'dark', ...seeds },
    });
  });

  it('ignores unknown keys so future exports still import', () => {
    const result = parseTheme(
      JSON.stringify({ ...JSON.parse(valid), somethingNew: 'x' }),
    );
    expect(result.ok).toBe(true);
  });

  it('defaults a missing name', () => {
    const { name, ...rest } = JSON.parse(valid);
    expect(name).toBe('Ocean');
    const result = parseTheme(JSON.stringify(rest));
    expect(result.ok && result.theme.name).toBe('Custom');
  });

  it('rejects malformed input with a usable message', () => {
    expect(parseTheme('not json').ok).toBe(false);
    expect(parseTheme('[]').ok).toBe(false);
    expect(parseTheme(JSON.stringify({ ...seeds })).ok).toBe(false); // no mode
    expect(
      parseTheme(JSON.stringify({ mode: 'dark', ...seeds, accent: 'blue' })).ok,
    ).toBe(false);
  });

  it('normalizes shorthand hex on the way in', () => {
    const result = parseTheme(
      JSON.stringify({ mode: 'dark', ...seeds, accent: '#ABC' }),
    );
    expect(result.ok && result.theme.accent).toBe('#aabbcc');
  });
});
