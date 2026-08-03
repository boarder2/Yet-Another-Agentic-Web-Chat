/**
 * Rosé Pine's three variants.
 *
 * Roles come from the project's own Neovim port, which assigns every Vim and
 * Treesitter group a palette role once and reuses it across all three variants:
 * https://github.com/rose-pine/neovim/blob/main/lua/rose-pine.lua
 *
 * The palette hexes are pinned to `@rose-pine/palette` by a unit test.
 */
import { buildPrismStyle, type PrismStyle, type TokenRule } from './build';

interface Variant {
  text: string;
  subtle: string;
  muted: string;
  surface: string;
  love: string;
  gold: string;
  rose: string;
  pine: string;
  foam: string;
  iris: string;
}

export const VARIANTS: Record<string, Variant> = {
  main: {
    text: '#e0def4',
    subtle: '#908caa',
    muted: '#6e6a86',
    surface: '#1f1d2e',
    love: '#eb6f92',
    gold: '#f6c177',
    rose: '#ebbcba',
    pine: '#31748f',
    foam: '#9ccfd8',
    iris: '#c4a7e7',
  },
  moon: {
    text: '#e0def4',
    subtle: '#908caa',
    muted: '#6e6a86',
    surface: '#2a273f',
    love: '#eb6f92',
    gold: '#f6c177',
    rose: '#ea9a97',
    pine: '#3e8fb0',
    foam: '#9ccfd8',
    iris: '#c4a7e7',
  },
  dawn: {
    text: '#575279',
    subtle: '#797593',
    muted: '#9893a5',
    surface: '#fffaf3',
    love: '#b4637a',
    gold: '#ea9d34',
    rose: '#d7827e',
    pine: '#286983',
    foam: '#56949f',
    iris: '#907aa9',
  },
};

function tokens(p: Variant): Record<string, TokenRule> {
  return {
    comment: { color: p.subtle, fontStyle: 'italic' }, // Comment
    keyword: p.pine, // Keyword / Statement / Conditional / Repeat
    string: p.gold, // String
    char: p.pine, // @string.escape
    number: p.gold, // Number
    boolean: p.rose, // Boolean
    function: p.rose, // Function / @function
    'class-name': p.foam, // Type / Structure
    variable: p.text, // Identifier / @variable
    property: p.foam, // @property
    'attr-name': p.iris, // @attribute
    'attr-value': p.gold, // String
    tag: p.foam, // Tag
    operator: p.subtle, // Operator
    punctuation: p.subtle, // Delimiter / @punctuation
    regex: p.iris, // @string.regexp
    constant: p.gold, // Constant / @constant
    symbol: p.foam, // Special
    builtin: p.love, // @variable.builtin
    url: { color: p.foam, fontStyle: 'italic' }, // Title, used for links
    deleted: p.love, // Error / diff removed
    inserted: p.foam, // the palette has no green; foam is its "added"
    important: { color: p.love, fontWeight: 'bold' },
    selector: p.foam, // Tag
    atrule: p.iris, // PreProc / Define
    entity: p.iris, // Macro
    bold: { color: p.rose, fontWeight: 'bold' },
    italic: { color: p.rose, fontStyle: 'italic' },
  };
}

function build(variant: string): PrismStyle {
  const p = VARIANTS[variant];
  return buildPrismStyle({
    background: p.surface,
    foreground: p.text,
    tokens: tokens(p),
  });
}

export const ROSE_PINE_STYLES: Record<string, PrismStyle> = {
  rosePine: build('main'),
  rosePineMoon: build('moon'),
  rosePineDawn: build('dawn'),
};
