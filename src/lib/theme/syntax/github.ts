/**
 * GitHub Dark, Light and Dark High Contrast.
 *
 * GitHub publishes its syntax colours as first-class design tokens rather than
 * only inside an editor theme: the `prettylights.syntax.*` scale in
 * https://github.com/primer/primitives/blob/main/src/tokens/functional/color/syntax.json5
 * (read from that package's resolved per-theme CSS). Token names below are that
 * scale's own.
 *
 * Properties and punctuation are deliberately absent — GitHub renders both at
 * the default foreground, and inventing a colour for them would not be GitHub.
 */
import { buildPrismStyle, type PrismStyle, type TokenRule } from './build';

interface Theme {
  fg: string;
  surface: string;
  comment: string;
  constant: string;
  referenceLink: string;
  entity: string;
  entityTag: string;
  keyword: string;
  string: string;
  stringRegexp: string;
  variable: string;
  unmatched: string;
}

const THEMES: Record<string, Theme> = {
  dark: {
    fg: '#f0f6fc', // scale.neutral.12
    surface: '#151b23', // scale.neutral.2
    comment: '#9198a1',
    constant: '#79c0ff',
    referenceLink: '#a5d6ff',
    entity: '#d2a8ff',
    entityTag: '#7ee787',
    keyword: '#ff7b72',
    string: '#a5d6ff',
    stringRegexp: '#7ee787',
    variable: '#ffa657',
    unmatched: '#f85149',
  },
  light: {
    fg: '#1f2328', // base.black
    surface: '#f6f8fa', // scale.neutral.1
    comment: '#59636e',
    constant: '#0550ae',
    referenceLink: '#0a3069',
    entity: '#6639ba',
    entityTag: '#0550ae',
    keyword: '#cf222e',
    string: '#0a3069',
    stringRegexp: '#116329',
    variable: '#953800',
    unmatched: '#82071e',
  },
  darkHighContrast: {
    fg: '#ffffff', // base.white
    surface: '#0d1117', // scale.neutral.1 (from the base dark palette)
    comment: '#9198a1',
    constant: '#91cbff',
    referenceLink: '#addcff',
    entity: '#dbb7ff',
    entityTag: '#72f088',
    keyword: '#ff9492',
    string: '#addcff',
    stringRegexp: '#72f088',
    variable: '#ffb757',
    unmatched: '#ff8080',
  },
};

function tokens(p: Theme): Record<string, TokenRule> {
  return {
    comment: p.comment,
    keyword: p.keyword,
    string: p.string,
    char: p.constant,
    number: p.constant,
    boolean: p.constant,
    function: p.entity,
    'class-name': p.entity,
    variable: p.variable,
    'attr-name': p.constant,
    'attr-value': p.string,
    tag: p.entityTag,
    operator: p.keyword,
    regex: p.stringRegexp,
    constant: p.constant,
    symbol: p.constant,
    builtin: p.constant,
    url: { color: p.referenceLink, textDecoration: 'underline' },
    deleted: p.unmatched,
    inserted: p.stringRegexp,
    important: { color: p.keyword, fontWeight: 'bold' },
    selector: p.entityTag,
    // No prettylights token covers either; at-rules read as keywords, and an
    // entity is closest to the constant scale GitHub uses for escapes.
    atrule: p.keyword,
    entity: p.constant,
    bold: { color: p.fg, fontWeight: 'bold' },
    italic: { color: p.fg, fontStyle: 'italic' },
  };
}

function build(theme: string): PrismStyle {
  const p = THEMES[theme];
  return buildPrismStyle({
    background: p.surface,
    foreground: p.fg,
    tokens: tokens(p),
  });
}

export const GITHUB_STYLES: Record<string, PrismStyle> = {
  githubDark: build('dark'),
  githubLight: build('light'),
  githubDarkHighContrast: build('darkHighContrast'),
};
