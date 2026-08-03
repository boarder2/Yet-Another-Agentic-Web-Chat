/**
 * Tokyo Night, Storm and Day.
 *
 * The project ships no palette spec — its VS Code theme *is* the spec, so the
 * values are its `tokenColors` scopes, read per flavour from
 * https://github.com/enkia/tokyo-night-vscode-theme/tree/master/themes
 * The comment names the TextMate scope each colour came from.
 */
import { buildPrismStyle, type PrismStyle, type TokenRule } from './build';

interface Flavor {
  fg: string;
  surface: string;
  comment: string;
  keyword: string;
  operator: string;
  string: string;
  regexp: string;
  number: string;
  escape: string;
  variable: string;
  property: string;
  function: string;
  type: string;
  support: string;
  tag: string;
}

const FLAVORS: Record<string, Flavor> = {
  night: {
    fg: '#a9b1d6', // editor.foreground
    surface: '#292e42', // diffEditor.diagonalFill (bg_highlight)
    comment: '#51597d', // comment
    keyword: '#bb9af7', // keyword / storage.type
    operator: '#89ddff', // keyword.operator / punctuation
    string: '#9ece6a', // string
    regexp: '#b4f9f8', // string.regexp
    number: '#ff9e64', // constant.numeric / constant.language
    escape: '#89ddff', // constant.character.escape
    variable: '#c0caf5', // variable
    property: '#7dcfff', // variable.other.property
    function: '#7aa2f7', // entity.name.function
    type: '#73daca', // entity.name.type
    support: '#0db9d7', // support.function / support.type
    tag: '#f7768e', // entity.name.tag
  },
  storm: {
    fg: '#a9b1d6',
    surface: '#2c324a',
    comment: '#5f6996',
    keyword: '#bb9af7',
    operator: '#89ddff',
    string: '#9ece6a',
    regexp: '#b4f9f8',
    number: '#ff9e64',
    escape: '#89ddff',
    variable: '#c0caf5',
    property: '#7dcfff',
    function: '#7aa2f7',
    type: '#73daca',
    support: '#2ac3de',
    tag: '#f7768e',
  },
  day: {
    fg: '#343b59',
    surface: '#d6d8df',
    comment: '#888b94',
    keyword: '#65359d',
    operator: '#006c86',
    string: '#385f0d',
    regexp: '#3e6968',
    number: '#965027',
    escape: '#363c4d',
    variable: '#343b58',
    property: '#0f4b6e',
    function: '#2959aa',
    type: '#33635c',
    support: '#006c86',
    tag: '#8c4351',
  },
};

/** Upstream renders comments, and only comments, italic. */
function tokens(p: Flavor): Record<string, TokenRule> {
  return {
    comment: { color: p.comment, fontStyle: 'italic' },
    keyword: p.keyword,
    string: p.string,
    char: p.escape,
    number: p.number,
    boolean: p.number, // constant.language
    function: p.function,
    'class-name': p.type,
    variable: p.variable,
    property: p.property,
    'attr-name': p.keyword, // entity.other.attribute-name
    'attr-value': p.string,
    tag: p.tag,
    operator: p.operator,
    punctuation: p.operator,
    regex: p.regexp,
    constant: p.number, // support.constant
    symbol: p.property,
    builtin: p.support,
    url: { color: p.property, fontStyle: 'italic' },
    deleted: '#914c54', // markup.deleted — the same in all three flavours
    inserted: '#449dab', // markup.inserted
    important: { color: p.tag, fontWeight: 'bold' },
    selector: p.tag,
    // No scope maps to either; at-rules read as keywords and entities as escapes.
    atrule: p.keyword,
    entity: p.escape,
    bold: { color: p.number, fontWeight: 'bold' },
    italic: { color: p.number, fontStyle: 'italic' },
  };
}

function build(flavor: string): PrismStyle {
  const p = FLAVORS[flavor];
  return buildPrismStyle({
    background: p.surface,
    foreground: p.fg,
    tokens: tokens(p),
  });
}

export const TOKYO_NIGHT_STYLES: Record<string, PrismStyle> = {
  tokyoNight: build('night'),
  tokyoNightStorm: build('storm'),
  tokyoNightDay: build('day'),
};
