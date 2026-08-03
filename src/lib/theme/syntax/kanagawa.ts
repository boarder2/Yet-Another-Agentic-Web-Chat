/**
 * Kanagawa Dragon.
 *
 * A Neovim colourscheme, so the spec is its `syn` table plus the Vim groups
 * those feed:
 * https://github.com/rebelot/kanagawa.nvim/blob/master/lua/kanagawa/themes.lua
 * https://github.com/rebelot/kanagawa.nvim/blob/master/lua/kanagawa/highlights/syntax.lua
 * Comments name the `syn` role; the hex is its palette colour.
 */
import { buildPrismStyle, type PrismStyle } from './build';

const p = {
  fg: '#c5c9c5', // ui.fg — dragonWhite
  surface: '#282727', // ui.bg_p1 — dragonBlack4
  string: '#8a9a7b', // syn.string — dragonGreen2
  number: '#a292a3', // syn.number — dragonPink
  constant: '#b6927b', // syn.constant — dragonOrange
  identifier: '#c4b28a', // syn.identifier — dragonYellow
  fun: '#8ba4b0', // syn.fun — dragonBlue2
  keyword: '#8992a7', // syn.keyword / syn.statement — dragonViolet
  operator: '#c4746e', // syn.operator / syn.preproc / syn.regex — dragonRed
  type: '#8ea4a2', // syn.type — dragonAqua
  punct: '#9e9b93', // syn.punct — dragonGray2
  comment: '#737c73', // syn.comment — dragonAsh
  special: '#949fb5', // syn.special1 — dragonTeal
  added: '#76946a', // vcs.added — autumnGreen
  removed: '#c34043', // vcs.removed — autumnRed
};

export const KANAGAWA_STYLES: Record<string, PrismStyle> = {
  kanagawaDragon: buildPrismStyle({
    background: p.surface,
    foreground: p.fg,
    tokens: {
      // Upstream's default `commentStyle` is italic.
      comment: { color: p.comment, fontStyle: 'italic' },
      keyword: p.keyword,
      string: p.string,
      char: p.special, // SpecialChar links Special
      number: p.number,
      boolean: { color: p.constant, fontWeight: 'bold' }, // Boolean is Constant + bold
      function: p.fun,
      'class-name': p.type,
      variable: p.identifier, // Identifier
      property: p.identifier,
      'attr-name': p.identifier,
      'attr-value': p.string,
      tag: p.special, // Tag links Special
      operator: p.operator,
      punctuation: p.punct, // Delimiter
      regex: p.operator, // syn.regex
      constant: p.constant,
      symbol: p.special,
      // No builtin group upstream; Special is where uncategorised symbols land.
      builtin: p.special,
      url: { color: p.special, textDecoration: 'underline' }, // Underlined
      deleted: p.removed,
      inserted: p.added,
      important: { color: p.special, fontWeight: 'bold' },
      selector: p.type,
      atrule: p.operator, // PreProc
      entity: p.special,
      bold: { color: p.fg, fontWeight: 'bold' },
      italic: { color: p.fg, fontStyle: 'italic' },
    },
  }),
};
