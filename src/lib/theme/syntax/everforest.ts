/**
 * Everforest Dark and Light, medium contrast — matching the two built-in themes.
 *
 * Everforest is a Vim colourscheme, so its highlight groups are the spec:
 * https://github.com/sainnhe/everforest/blob/master/colors/everforest.vim
 * Palette hexes come from its palette.md, whose table also documents what each
 * colour is for; the comments below name the Vim group.
 */
import { buildPrismStyle, type PrismStyle, type TokenRule } from './build';

interface Palette {
  fg: string;
  bg1: string;
  red: string;
  orange: string;
  yellow: string;
  green: string;
  aqua: string;
  blue: string;
  purple: string;
  grey1: string;
}

const PALETTES: Record<string, Palette> = {
  dark: {
    fg: '#d3c6aa',
    bg1: '#343f44',
    red: '#e67e80',
    orange: '#e69875',
    yellow: '#dbbc7f',
    green: '#a7c080',
    aqua: '#83c092',
    blue: '#7fbbb3',
    purple: '#d699b6',
    grey1: '#859289',
  },
  light: {
    fg: '#5c6a72',
    bg1: '#f4f0d9',
    red: '#f85552',
    orange: '#f57d26',
    yellow: '#dfa000',
    green: '#8da101',
    aqua: '#35a77c',
    blue: '#3a94c5',
    purple: '#df69ba',
    grey1: '#939f91',
  },
};

function tokens(p: Palette): Record<string, TokenRule> {
  return {
    comment: p.grey1, // Comment
    keyword: p.red, // Keyword / Statement
    string: p.green, // String
    char: p.green, // Character links String
    number: p.purple, // Number
    boolean: p.purple, // Boolean
    function: p.green, // Function
    'class-name': p.yellow, // Type
    variable: p.blue, // Identifier
    property: p.blue, // palette.md: blue is Treesitter fields
    'attr-name': p.blue,
    'attr-value': p.green,
    tag: p.orange, // palette.md: orange covers tags
    operator: p.orange, // Operator
    punctuation: p.grey1, // Delimiter is fg, but grey1 is documented for these
    regex: p.green, // palette.md: green covers regex literals
    constant: p.aqua, // Constant
    symbol: p.blue, // palette.md: blue covers uncategorised special symbols
    builtin: p.green, // palette.md: green covers built-in functions
    url: { color: p.blue, textDecoration: 'underline' },
    deleted: p.red, // diff deleted
    inserted: p.green, // diff added
    important: { color: p.red, fontWeight: 'bold' },
    selector: p.orange,
    atrule: p.purple, // PreProc
    entity: p.yellow, // Special / special characters
    bold: { color: p.fg, fontWeight: 'bold' },
    italic: { color: p.fg, fontStyle: 'italic' },
  };
}

function build(variant: string): PrismStyle {
  const p = PALETTES[variant];
  return buildPrismStyle({
    background: p.bg1,
    foreground: p.fg,
    tokens: tokens(p),
  });
}

export const EVERFOREST_STYLES: Record<string, PrismStyle> = {
  everforestDark: build('dark'),
  everforestLight: build('light'),
};
