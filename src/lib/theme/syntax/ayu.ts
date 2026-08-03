/**
 * Ayu Dark.
 *
 * Ayu is the one family here whose palette spec names syntax roles directly, and
 * documents what each is for:
 * https://github.com/ayu-theme/ayu-colors/blob/master/themes/dark.yaml
 * Those descriptions drive the mapping below, so nothing here is guesswork.
 */
import { buildPrismStyle, type PrismStyle } from './build';

const p = {
  fg: '#bfbdb6', // editor.fg
  surface: '#141821', // ui.panel.bg
  tag: '#39bae6', // HTML/XML tags, language variables, library classes, CSS properties
  func: '#ffb454', // function names and calls, tag attributes, list bullets
  entity: '#59c2ff', // type names, class names, CSS tag names, markup links
  string: '#aad94c', // string literals, imports/packages, markup headings
  regexp: '#95e6cb', // regular expressions, escape characters, blockquotes
  markup: '#f07178', // member variables, library functions, markup italic/bold
  keyword: '#ff8f40', // keywords, storage types, template expressions
  special: '#e6c08a', // decorators, annotations, markup strikethrough
  // Spec value is #99adbf at 55% alpha; flattened over the fence fill so the
  // colour survives into CodeMirror, which gets no background to blend against.
  comment: '#5d6a78',
  constant: '#d2a6ff', // named constants, function parameters
  operator: '#f29668', // binary operators, accessor punctuation
  added: '#70bf56', // vcs.added
  removed: '#f26d78', // vcs.removed
};

export const AYU_STYLES: Record<string, PrismStyle> = {
  ayuDark: buildPrismStyle({
    background: p.surface,
    foreground: p.fg,
    tokens: {
      comment: p.comment,
      keyword: p.keyword,
      string: p.string,
      char: p.regexp,
      number: p.constant,
      boolean: p.constant,
      function: p.func,
      'class-name': p.entity,
      variable: p.tag,
      property: p.tag,
      'attr-name': p.func,
      'attr-value': p.string,
      tag: p.tag,
      operator: p.operator,
      punctuation: p.operator,
      regex: p.regexp,
      constant: p.constant,
      symbol: p.markup,
      builtin: p.tag,
      url: { color: p.entity, textDecoration: 'underline' },
      deleted: p.removed,
      inserted: p.added,
      important: p.special,
      selector: p.entity,
      atrule: p.keyword,
      entity: p.regexp,
      bold: { color: p.markup, fontWeight: 'bold' },
      italic: { color: p.markup, fontStyle: 'italic' },
    },
  }),
};
