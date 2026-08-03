/**
 * The CodeMirror binding for a `Theme.syntax` key, derived from the very same
 * Prism style the markdown fences render with, so an editor and a fence painted
 * from one key look alike.
 *
 * Prism is the coarser vocabulary, so one Prism colour feeds several lezer tags.
 * A tag only gets a rule when its Prism source key exists — never a substitute
 * colour — so a style that deliberately leaves a token at base colour (Gruvbox
 * has no `class-name`) reproduces faithfully instead of being invented.
 *
 * Kept out of `syntax/` on purpose: that module reaches the chat bundle via
 * `CodeBlock`, and CodeMirror is loaded only by the editors, all of which are
 * `next/dynamic({ ssr: false })`.
 */
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t, type Tag } from '@lezer/highlight';
import { EditorView, type Extension } from '@uiw/react-codemirror';
import { isHexColor, luminance } from './derive';
import { prismStyleFor, type SyntaxTheme } from './syntax';

/** The subset of a Prism token rule worth carrying onto a lezer tag. */
export interface TokenStyle {
  color?: string;
  fontStyle?: string;
  fontWeight?: string;
}

export interface SyntaxColors {
  /** The style's own fill, or the app surface when it declares none. */
  background: string;
  foreground: string;
  /** Whether the resolved background reads dark. Unknown without a hex fill. */
  dark: boolean | undefined;
  caret: string;
  selection: string;
  activeLine: string;
  gutterBackground: string;
  gutterForeground: string;
  /** Prism key → its style, only for the keys the style actually defines. */
  tokens: Record<string, TokenStyle>;
}

/** Prism keys we bind. Anything outside this list has no useful lezer analogue. */
const TOKEN_KEYS = [
  'comment',
  'keyword',
  'string',
  'char',
  'number',
  'boolean',
  'function',
  'class-name',
  'variable',
  'property',
  'attr-name',
  'attr-value',
  'tag',
  'operator',
  'punctuation',
  'regex',
  'constant',
  'symbol',
  'builtin',
  'url',
  'deleted',
  'inserted',
  'important',
];

/** The lezer tags each bound Prism key paints. */
const TAG_SOURCES: Array<[string, Tag[]]> = [
  ['comment', [t.comment, t.lineComment, t.blockComment, t.docComment]],
  [
    'keyword',
    [
      t.keyword,
      t.controlKeyword,
      t.moduleKeyword,
      t.definitionKeyword,
      t.operatorKeyword,
      t.self,
      t.null,
    ],
  ],
  ['string', [t.string, t.docString, t.special(t.string)]],
  ['char', [t.character, t.escape]],
  ['number', [t.number, t.integer, t.float, t.unit]],
  ['boolean', [t.bool]],
  ['function', [t.function(t.variableName), t.function(t.propertyName)]],
  ['class-name', [t.typeName, t.className, t.namespace]],
  ['variable', [t.variableName, t.local(t.variableName)]],
  ['property', [t.propertyName]],
  ['attr-name', [t.attributeName]],
  ['attr-value', [t.attributeValue]],
  ['tag', [t.tagName]],
  [
    'operator',
    [
      t.operator,
      t.derefOperator,
      t.arithmeticOperator,
      t.logicOperator,
      t.bitwiseOperator,
      t.compareOperator,
      t.updateOperator,
      t.definitionOperator,
      t.typeOperator,
    ],
  ],
  [
    'punctuation',
    [
      t.punctuation,
      t.paren,
      t.brace,
      t.bracket,
      t.squareBracket,
      t.angleBracket,
      t.separator,
    ],
  ],
  ['regex', [t.regexp]],
  ['constant', [t.constant(t.name), t.standard(t.name)]],
  ['symbol', [t.atom, t.labelName]],
  ['builtin', [t.standard(t.variableName), t.macroName]],
  ['url', [t.url, t.link]],
  ['deleted', [t.deleted, t.invalid]],
  ['inserted', [t.inserted]],
  ['important', [t.strong]],
];

const CODE_SELECTORS = [
  'code[class*="language-"]',
  "code[class*='language-']",
  'pre[class*="language-"]',
  "pre[class*='language-']",
];

/** `color-mix` rather than `derive.mix` so a `var()` background mixes too. */
const toward = (fg: string, bg: string, pct: number) =>
  `color-mix(in srgb, ${fg} ${pct}%, ${bg})`;

const HSL = /^hsl\(\s*[\d.]+\s*,\s*[\d.]+%\s*,\s*([\d.]+)%\s*\)$/i;

/**
 * Whether a fill reads dark. Hex goes through WCAG luminance; the One Dark /
 * One Light pair state their fills as `hsl`, where lightness answers it
 * directly. Anything else — notably the `var()` fallback — is unknowable here.
 */
function readsDark(color: string): boolean | undefined {
  const hsl = HSL.exec(color.trim());
  if (hsl) return Number(hsl[1]) < 50;
  return isHexColor(color) ? luminance(color) < 0.5 : undefined;
}

function baseForeground(style: SyntaxTheme['style']): string | undefined {
  for (const selector of CODE_SELECTORS) {
    const color = style[selector]?.color;
    if (typeof color === 'string' && color.trim()) return color.trim();
  }
  return undefined;
}

/**
 * The colours a CodeMirror theme needs, read off a resolved Prism style. Pure —
 * unit-tested through this interface.
 */
export function syntaxColorsFor(syntax: SyntaxTheme): SyntaxColors {
  const background = syntax.background ?? 'var(--color-surface)';
  const foreground = baseForeground(syntax.style) ?? 'var(--color-fg)';

  const tokens: Record<string, TokenStyle> = {};
  for (const key of TOKEN_KEYS) {
    const rule = syntax.style[key];
    if (!rule) continue;
    const style: TokenStyle = {};
    if (typeof rule.color === 'string') style.color = rule.color;
    if (typeof rule.fontStyle === 'string') style.fontStyle = rule.fontStyle;
    if (
      typeof rule.fontWeight === 'string' ||
      typeof rule.fontWeight === 'number'
    )
      style.fontWeight = String(rule.fontWeight);
    if (Object.keys(style).length) tokens[key] = style;
  }

  return {
    background,
    foreground,
    dark: readsDark(background),
    caret: foreground,
    selection: toward(foreground, background, 25),
    activeLine: toward(foreground, background, 6),
    gutterBackground: toward(foreground, background, 4),
    gutterForeground: toward(foreground, background, 45),
    tokens,
  };
}

/**
 * The editor theme for a syntax key. `mode` only decides the style fallback and
 * stands in for `dark` when the style declares no measurable fill.
 */
export function codeMirrorTheme(
  key: string | undefined,
  mode: 'light' | 'dark',
): Extension {
  const c = syntaxColorsFor(prismStyleFor(key, mode));

  const highlight = HighlightStyle.define(
    TAG_SOURCES.flatMap(([source, tags]) => {
      const style = c.tokens[source];
      return style ? [{ tag: [...tags], ...style }] : [];
    }),
  );

  const theme = EditorView.theme(
    {
      '&': { color: c.foreground, backgroundColor: c.background },
      '.cm-content': { caretColor: c.caret },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: c.caret },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
        { backgroundColor: c.selection },
      '.cm-activeLine': { backgroundColor: c.activeLine },
      '.cm-gutters': {
        backgroundColor: c.gutterBackground,
        color: c.gutterForeground,
        border: 'none',
      },
      '.cm-activeLineGutter': { backgroundColor: c.activeLine },
    },
    { dark: c.dark ?? mode === 'dark' },
  );

  return [theme, syntaxHighlighting(highlight)];
}
