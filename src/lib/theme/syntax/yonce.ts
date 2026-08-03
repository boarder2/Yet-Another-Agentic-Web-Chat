/**
 * Yoncé.
 *
 * Published only as a VS Code theme, so its `tokenColors` are the spec:
 * https://github.com/minamarkham/yonce-vscode/blob/master/themes/Yonc%C3%A9-color-theme.json
 * Comments name the TextMate scope each colour was read from.
 */
import { buildPrismStyle, type PrismStyle } from './build';

const p = {
  fg: '#d4d4d4', // editor.foreground
  surface: '#272727', // editorWidget.background
  pink: '#fc4384', // keyword, entity.name.tag, entity.name.function
  teal: '#00a7aa', // storage.type, support.function.builtin, property names
  purple: '#a06fca', // constant, constant.numeric, entity.name.class
  yellow: '#e6db74', // string, support.class
  green: '#98e342', // punctuation.separator, punctuation.accessor, storage
  orange: '#f39b35', // constant.language.boolean, constant.language.null
  rose: '#da7dae', // variable.other.object
  comment: '#696d70', // comment, markup.underline.link
};

export const YONCE_STYLES: Record<string, PrismStyle> = {
  yonce: buildPrismStyle({
    background: p.surface,
    foreground: p.fg,
    tokens: {
      comment: { color: p.comment, fontStyle: 'italic' },
      keyword: p.pink,
      string: p.yellow,
      char: p.pink, // constant.character.escape
      number: p.purple,
      boolean: p.orange, // constant.language.boolean
      function: p.pink,
      'class-name': p.purple, // entity.name.class / entity.name.type
      variable: p.rose,
      property: p.teal, // support.type.property-name
      'attr-name': p.pink,
      'attr-value': p.yellow,
      tag: p.pink,
      operator: p.green, // punctuation.accessor
      punctuation: p.green, // punctuation.separator
      regex: p.yellow,
      constant: p.purple,
      symbol: p.purple,
      builtin: p.teal, // support.function.builtin
      url: { color: p.comment, textDecoration: 'underline' }, // markup.underline.link
      deleted: p.pink, // markup.deleted
      inserted: p.purple, // markup.inserted
      important: { color: p.pink, fontWeight: 'bold' },
      selector: p.pink,
      // Neither has a scope upstream; at-rules read as keywords and entities as
      // the escapes they sit beside.
      atrule: p.pink,
      entity: p.pink,
      bold: { color: p.fg, fontWeight: 'bold' },
      italic: { color: p.fg, fontStyle: 'italic' },
    },
  }),
};
