/**
 * Syntax styles for code rendering, keyed by `Theme.syntax`. The key is a
 * neutral name rather than a Prism one so a second renderer (CodeMirror) can
 * bind the same key to its own style without the theme having to know.
 * Unset — or a key with no binding — falls back to One Dark / One Light by mode.
 *
 * Styles come from two places. Fifteen are bundled with
 * `react-syntax-highlighter` and imported individually — previously the whole
 * `styles/prism` barrel was pulled in, which bundled every style in the package.
 * The rest are authored in this directory from each project's own spec, because
 * those families ship no Prism port; see `build.ts`.
 *
 * A fence is painted with the style's own background, so a code theme reads as
 * itself rather than as the app's surface. It is lifted out of the style into
 * `SyntaxTheme.background` because the wrapper is a `div`, not a `pre`.
 */
import atomDark from 'react-syntax-highlighter/dist/cjs/styles/prism/atom-dark';
import dracula from 'react-syntax-highlighter/dist/cjs/styles/prism/dracula';
import gruvboxDark from 'react-syntax-highlighter/dist/cjs/styles/prism/gruvbox-dark';
import gruvboxLight from 'react-syntax-highlighter/dist/cjs/styles/prism/gruvbox-light';
import materialDark from 'react-syntax-highlighter/dist/cjs/styles/prism/material-dark';
import materialOceanic from 'react-syntax-highlighter/dist/cjs/styles/prism/material-oceanic';
import nightOwl from 'react-syntax-highlighter/dist/cjs/styles/prism/night-owl';
import nord from 'react-syntax-highlighter/dist/cjs/styles/prism/nord';
import oneDark from 'react-syntax-highlighter/dist/cjs/styles/prism/one-dark';
import oneLight from 'react-syntax-highlighter/dist/cjs/styles/prism/one-light';
import shadesOfPurple from 'react-syntax-highlighter/dist/cjs/styles/prism/shades-of-purple';
import solarizedDarkAtom from 'react-syntax-highlighter/dist/cjs/styles/prism/solarized-dark-atom';
import solarizedlight from 'react-syntax-highlighter/dist/cjs/styles/prism/solarizedlight';
import synthwave84 from 'react-syntax-highlighter/dist/cjs/styles/prism/synthwave84';
import tomorrow from 'react-syntax-highlighter/dist/cjs/styles/prism/tomorrow';
import { AYU_STYLES } from './ayu';
import type { PrismStyle } from './build';
import {
  ACCENTS,
  accentName,
  FLAVOR_NAMES,
  FLAVORS,
} from '../catppuccinPalette';
import { CATPPUCCIN_STYLES, catppuccinSyntaxKey } from './catppuccin';
import { EVERFOREST_STYLES } from './everforest';
import { GITHUB_STYLES } from './github';
import { KANAGAWA_STYLES } from './kanagawa';
import { ROSE_PINE_STYLES } from './rosePine';
import { TOKYO_NIGHT_STYLES } from './tokyoNight';
import { YONCE_STYLES } from './yonce';

/** A resolved style plus the fence fill it wants painted behind it. */
export interface SyntaxTheme {
  style: PrismStyle;
  /** Absent when the style declares no solid fill — callers supply their own. */
  background?: string;
}

// Both spellings occur upstream: most styles quote the selector with `"`, but
// Shades of Purple uses `'`. Missing one leaves its background in place.
const PRE_SELECTORS = ['pre[class*="language-"]', "pre[class*='language-']"];

/**
 * A fill we can paint a fence with. Styles that build their look from gradients
 * or transparency (Synthwave '84) have nothing usable and are reported absent.
 */
function solidFill(pre: React.CSSProperties | undefined): string | undefined {
  const raw = pre?.background ?? pre?.backgroundColor;
  if (typeof raw !== 'string') return undefined;
  const value = raw.replace('!important', '').trim();
  return value && value !== 'none' && !/gradient|transparent/.test(value)
    ? value
    : undefined;
}

/**
 * Lift the style's own `pre` background out into `background` and strip it from
 * the style itself: the fill has to reach the wrapper `customStyle` (the `pre`
 * rule can't paint a `PreTag="div"`), and leaving both in place makes React warn
 * about mixing the `background` shorthand with `backgroundColor`.
 *
 * `fontFamily` goes too. Each bundled style names its own stack, so picking a
 * style used to change the code font as a side effect — and the editors, which
 * derive from the same key, never saw it. Dropping it puts fences and editors on
 * the app's mono together.
 */
function toSyntaxTheme(style: PrismStyle): SyntaxTheme {
  const next: PrismStyle = {};
  let background: string | undefined;

  for (const [selector, rule] of Object.entries(style)) {
    const copy = { ...rule };
    if (PRE_SELECTORS.includes(selector)) {
      background ??= solidFill(rule);
      delete copy.background;
      delete copy.backgroundColor;
    }
    delete copy.fontFamily;
    next[selector] = copy;
  }

  return { style: next, background };
}

export const PRISM_STYLES: Record<string, SyntaxTheme> = Object.fromEntries(
  Object.entries({
    atomDark,
    dracula,
    gruvboxDark,
    gruvboxLight,
    materialDark,
    materialOceanic,
    nightOwl,
    nord,
    oneDark,
    oneLight,
    shadesOfPurple,
    solarizedDarkAtom,
    solarizedlight,
    synthwave84,
    tomorrow,
    ...AYU_STYLES,
    ...CATPPUCCIN_STYLES,
    ...EVERFOREST_STYLES,
    ...GITHUB_STYLES,
    ...KANAGAWA_STYLES,
    ...ROSE_PINE_STYLES,
    ...TOKYO_NIGHT_STYLES,
    ...YONCE_STYLES,
  }).map(([key, style]) => [key, toSyntaxTheme(style)]),
);

/**
 * How the picker names and groups a style. `label` stays explicit rather than
 * composed from family and variant — "Tokyo Night" is both a family and its own
 * base variant, and composing would name it twice.
 */
export interface SyntaxStyleMeta {
  label: string;
  family: string;
  /** Absent on the families that ship exactly one style. */
  variant?: string;
  /**
   * A heading within the family's variant list, for a family whose variants
   * have two axes. Only Catppuccin has one: flavour, then accent.
   */
  group?: string;
}

/**
 * Catppuccin's fifty-six entries, generated rather than listed: four flavours ×
 * fourteen accents, grouped by flavour so the variant list stays browsable.
 */
const CATPPUCCIN_META: Record<string, SyntaxStyleMeta> = Object.fromEntries(
  Object.keys(FLAVORS).flatMap((flavor) =>
    ACCENTS.map((accent) => [
      catppuccinSyntaxKey(flavor, accent),
      {
        label: `Catppuccin ${FLAVOR_NAMES[flavor]} (${accentName(accent)})`,
        family: 'Catppuccin',
        group: FLAVOR_NAMES[flavor],
        variant: accentName(accent),
      },
    ]),
  ),
);

/** Metadata for every style. Keys mirror the bindings exactly. */
export const SYNTAX_STYLES: Record<string, SyntaxStyleMeta> = {
  atomDark: { label: 'Atom Dark', family: 'Atom Dark' },
  ayuDark: { label: 'Ayu Dark', family: 'Ayu Dark' },
  ...CATPPUCCIN_META,
  dracula: { label: 'Dracula', family: 'Dracula' },
  everforestDark: {
    label: 'Everforest Dark',
    family: 'Everforest',
    variant: 'Dark',
  },
  everforestLight: {
    label: 'Everforest Light',
    family: 'Everforest',
    variant: 'Light',
  },
  githubDark: { label: 'GitHub Dark', family: 'GitHub', variant: 'Dark' },
  githubDarkHighContrast: {
    label: 'GitHub Dark High Contrast',
    family: 'GitHub',
    variant: 'Dark High Contrast',
  },
  githubLight: { label: 'GitHub Light', family: 'GitHub', variant: 'Light' },
  gruvboxDark: { label: 'Gruvbox Dark', family: 'Gruvbox', variant: 'Dark' },
  gruvboxLight: { label: 'Gruvbox Light', family: 'Gruvbox', variant: 'Light' },
  kanagawaDragon: { label: 'Kanagawa Dragon', family: 'Kanagawa Dragon' },
  materialDark: { label: 'Material Dark', family: 'Material', variant: 'Dark' },
  materialOceanic: {
    label: 'Material Oceanic',
    family: 'Material',
    variant: 'Oceanic',
  },
  nightOwl: { label: 'Night Owl', family: 'Night Owl' },
  nord: { label: 'Nord', family: 'Nord' },
  oneDark: { label: 'One Dark', family: 'One', variant: 'Dark' },
  oneLight: { label: 'One Light', family: 'One', variant: 'Light' },
  rosePine: { label: 'Rosé Pine', family: 'Rosé Pine', variant: 'Main' },
  rosePineDawn: {
    label: 'Rosé Pine Dawn',
    family: 'Rosé Pine',
    variant: 'Dawn',
  },
  rosePineMoon: {
    label: 'Rosé Pine Moon',
    family: 'Rosé Pine',
    variant: 'Moon',
  },
  shadesOfPurple: { label: 'Shades of Purple', family: 'Shades of Purple' },
  solarizedDarkAtom: {
    label: 'Solarized Dark',
    family: 'Solarized',
    variant: 'Dark',
  },
  solarizedlight: {
    label: 'Solarized Light',
    family: 'Solarized',
    variant: 'Light',
  },
  synthwave84: { label: "Synthwave '84", family: "Synthwave '84" },
  tokyoNight: {
    label: 'Tokyo Night',
    family: 'Tokyo Night',
    variant: 'Night',
  },
  tokyoNightDay: {
    label: 'Tokyo Night Day',
    family: 'Tokyo Night',
    variant: 'Day',
  },
  tokyoNightStorm: {
    label: 'Tokyo Night Storm',
    family: 'Tokyo Night',
    variant: 'Storm',
  },
  tomorrow: { label: 'Tomorrow', family: 'Tomorrow' },
  yonce: { label: 'Yoncé', family: 'Yoncé' },
};

export interface SyntaxVariant {
  value: string;
  /** The variant name, or the full label for a family that has only one style. */
  label: string;
  /** Heading to list this variant under, for a family with two axes. */
  group?: string;
}

export interface SyntaxFamily {
  family: string;
  /** In declared order — Catppuccin's is its palette's, not alphabetical. */
  variants: SyntaxVariant[];
}

/**
 * The picker's two axes: pick a family, then a variant within it. Families are
 * alphabetical; variants keep their declared order, which for Catppuccin is the
 * palette's own flavour-then-accent sequence.
 */
export const SYNTAX_FAMILIES: SyntaxFamily[] = Object.entries(SYNTAX_STYLES)
  .reduce<SyntaxFamily[]>((families, [value, meta]) => {
    const found = families.find((f) => f.family === meta.family);
    const variant = {
      value,
      label: meta.variant ?? meta.label,
      group: meta.group,
    };
    if (found) found.variants.push(variant);
    else families.push({ family: meta.family, variants: [variant] });
    return families;
  }, [])
  .sort((a, b) => a.family.localeCompare(b.family));

/** The family a style key belongs to, for driving the family dropdown. */
export function syntaxFamilyOf(key: string | undefined): string | undefined {
  return key ? SYNTAX_STYLES[key]?.family : undefined;
}

/** The Prism binding for a syntax key, falling back by mode. */
export function prismStyleFor(
  key: string | undefined,
  mode: 'light' | 'dark',
): SyntaxTheme {
  const match = key ? PRISM_STYLES[key] : undefined;
  return (
    match ?? (mode === 'dark' ? PRISM_STYLES.oneDark : PRISM_STYLES.oneLight)
  );
}
