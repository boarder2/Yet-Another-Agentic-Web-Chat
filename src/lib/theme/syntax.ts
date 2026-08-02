/**
 * Syntax styles for code rendering, keyed by `Theme.syntax`. The key is a
 * neutral name rather than a Prism one so a second renderer (CodeMirror) can
 * bind the same key to its own style without the theme having to know.
 * Unset — or a key with no binding — falls back to One Dark / One Light by mode.
 *
 * Only the styles actually referenced are imported — previously the whole
 * `styles/prism` barrel was pulled in, which bundled every style in the package.
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

type PrismStyle = Record<string, React.CSSProperties>;

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
 */
function toSyntaxTheme(style: PrismStyle): SyntaxTheme {
  const next = { ...style };
  let background: string | undefined;
  for (const selector of PRE_SELECTORS) {
    if (!next[selector]) continue;
    background ??= solidFill(next[selector]);
    const pre = { ...next[selector] };
    delete pre.background;
    delete pre.backgroundColor;
    next[selector] = pre;
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
  }).map(([key, style]) => [key, toSyntaxTheme(style)]),
);

/** Display names for the style picker. Keys mirror the bindings exactly. */
export const SYNTAX_LABELS: Record<string, string> = {
  atomDark: 'Atom Dark',
  dracula: 'Dracula',
  gruvboxDark: 'Gruvbox Dark',
  gruvboxLight: 'Gruvbox Light',
  materialDark: 'Material Dark',
  materialOceanic: 'Material Oceanic',
  nightOwl: 'Night Owl',
  nord: 'Nord',
  oneDark: 'One Dark',
  oneLight: 'One Light',
  shadesOfPurple: 'Shades of Purple',
  solarizedDarkAtom: 'Solarized Dark',
  solarizedlight: 'Solarized Light',
  synthwave84: "Synthwave '84",
  tomorrow: 'Tomorrow',
};

/** Picker options, alphabetical by label. */
export const SYNTAX_OPTIONS = Object.entries(SYNTAX_LABELS)
  .map(([value, label]) => ({ value, label }))
  .sort((a, b) => a.label.localeCompare(b.label));

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
