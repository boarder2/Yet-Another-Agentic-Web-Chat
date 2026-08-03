/**
 * Invariants over the hand-authored styles. The bundled `react-syntax-highlighter`
 * styles arrive complete and are covered by `themes.test.ts`; these are the ones
 * we transcribe ourselves, so a typo here is only caught by a test.
 *
 * Catppuccin and Rosé Pine publish their palettes as packages, so those tables
 * are pinned to upstream outright. The other six families publish no package;
 * their values carry per-value source comments instead.
 */
import { flavors } from '@catppuccin/palette';
import { variantColors } from '@rose-pine/palette';
import { describe, expect, it } from 'vitest';
import { contrastRatio, isHexColor } from '../derive';
import { AYU_STYLES } from './ayu';
import { ACCENTS, FLAVORS } from '../catppuccinPalette';
import { CATPPUCCIN_STYLES, catppuccinSyntaxKey } from './catppuccin';
import { EVERFOREST_STYLES } from './everforest';
import { GITHUB_STYLES } from './github';
import { KANAGAWA_STYLES } from './kanagawa';
import { ROSE_PINE_STYLES, VARIANTS } from './rosePine';
import { TOKYO_NIGHT_STYLES } from './tokyoNight';
import { YONCE_STYLES } from './yonce';

const AUTHORED = {
  ...AYU_STYLES,
  ...CATPPUCCIN_STYLES,
  ...EVERFOREST_STYLES,
  ...GITHUB_STYLES,
  ...KANAGAWA_STYLES,
  ...ROSE_PINE_STYLES,
  ...TOKYO_NIGHT_STYLES,
  ...YONCE_STYLES,
};

const CODE = 'code[class*="language-"]';
const PRE = 'pre[class*="language-"]';

describe('authored syntax styles', () => {
  it('covers every family that ships no Prism port', () => {
    // 14 styles across seven families, plus Catppuccin's four flavours in each
    // of the palette's fourteen accents.
    expect(Object.keys(CATPPUCCIN_STYLES)).toHaveLength(4 * ACCENTS.length);
    expect(Object.keys(AUTHORED)).toHaveLength(14 + 4 * ACCENTS.length);
  });

  it('gives every Catppuccin flavour the same accent set', () => {
    for (const flavor of Object.keys(FLAVORS))
      for (const accent of ACCENTS)
        expect(
          CATPPUCCIN_STYLES[catppuccinSyntaxKey(flavor, accent)],
          `${flavor} ${accent}`,
        ).toBeTruthy();
  });

  it('recolours only the accent roles, leaving the rest of the flavour alone', () => {
    // An accent is a swap for mauve, not a repaint: strings, comments and the
    // fill must be identical across a flavour's fourteen styles.
    const mocha = FLAVORS.mocha;
    for (const accent of ACCENTS) {
      const style = CATPPUCCIN_STYLES[catppuccinSyntaxKey('mocha', accent)];
      expect(style[PRE].background).toBe(mocha.surface0);
      expect(style.string.color).toBe(mocha.green);
      expect(style.comment.color).toBe(mocha.overlay2);
      for (const role of ['keyword', 'variable', 'tag', 'atrule'])
        expect(style[role].color, `${accent}.${role}`).toBe(mocha[accent]);
    }
  });

  it('pins the Catppuccin table to @catppuccin/palette', () => {
    for (const [flavor, palette] of Object.entries(FLAVORS)) {
      const upstream = flavors[flavor as keyof typeof flavors].colors;
      for (const [name, hex] of Object.entries(palette)) {
        expect(
          upstream[name as keyof typeof upstream].hex,
          `catppuccin ${flavor}.${name}`,
        ).toBe(hex);
      }
    }
  });

  it('pins the Rosé Pine table to @rose-pine/palette', () => {
    for (const [variant, palette] of Object.entries(VARIANTS)) {
      for (const [name, hex] of Object.entries(palette)) {
        const upstream =
          variantColors[variant as keyof typeof variantColors][
            name as keyof (typeof palette & object)
          ];
        expect(`#${upstream.hex}`, `rose-pine ${variant}.${name}`).toBe(hex);
      }
    }
  });
});

describe.each(Object.entries(AUTHORED))('%s', (key, style) => {
  it('declares a hex foreground and fence fill', () => {
    expect(isHexColor(String(style[CODE].color)), `${key} foreground`).toBe(
      true,
    );
    expect(isHexColor(String(style[PRE].background)), `${key} fill`).toBe(true);
  });

  it('keeps its foreground readable on its own fill', () => {
    // Base text only. Token colours stay faithful to upstream even where a
    // palette runs low-contrast by design — see docs/THEMES.md.
    expect(
      contrastRatio(String(style[CODE].color), String(style[PRE].background)),
    ).toBeGreaterThanOrEqual(4);
  });

  it('names no font, so fences and editors share the app mono', () => {
    for (const rule of Object.values(style))
      expect(rule.fontFamily).toBe(undefined);
  });

  // `punctuation` and `property` are absent from the list on purpose: GitHub
  // renders both at the default foreground, and substituting a colour there
  // would make the style look like something other than GitHub.
  it('colours the tokens a fence actually emits', () => {
    for (const token of [
      'comment',
      'keyword',
      'string',
      'number',
      'function',
      'class-name',
      'operator',
      'tag',
      'attr-name',
      'regex',
      'constant',
    ]) {
      expect(style[token]?.color, `${key} has no ${token}`).toBeTruthy();
    }
  });
});
