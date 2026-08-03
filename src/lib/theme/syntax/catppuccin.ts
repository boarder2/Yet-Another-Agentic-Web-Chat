/**
 * Catppuccin's four flavours, each in all fourteen accents.
 *
 * Roles come from Catppuccin's own highlighter port, which maps highlight.js
 * classes to palette colour *names* once and applies them across every flavour:
 * https://github.com/catppuccin/highlightjs/blob/main/sass/_theme.scss
 *
 * Accents work as they do in every Catppuccin port: the palette names fourteen
 * of its colours accents, and a port swaps the chosen one in wherever it uses
 * the default. Here that default is mauve — the port's colour for keywords,
 * variables and tag names — so picking an accent recolours exactly those.
 */
import {
  ACCENTS,
  accentName,
  DEFAULT_ACCENT,
  FLAVOR_NAMES,
  FLAVORS,
  type Accent,
  type Flavor,
} from '../catppuccinPalette';
import { buildPrismStyle, type PrismStyle, type TokenRule } from './build';

function tokens(p: Flavor, accent: string): Record<string, TokenRule> {
  return {
    comment: p.overlay2,
    keyword: accent, // keyword
    string: p.green,
    char: p.green, // char.escape_
    number: p.peach,
    boolean: p.peach, // literal
    function: p.blue, // title.function_
    'class-name': p.yellow, // title.class_ (and `type`)
    variable: accent, // variable / variable.language_
    property: p.teal,
    'attr-name': p.blue, // attr — blue so YAML keys read correctly upstream
    'attr-value': p.green, // attribute
    tag: accent, // name — the port picks the accent over blue for tag names
    operator: p.sky,
    punctuation: p.subtext1,
    regex: p.pink, // regexp
    constant: p.peach, // variable.constant_
    symbol: p.flamingo,
    builtin: p.red, // built_in
    url: { color: p.sapphire, fontStyle: 'italic' }, // link
    deleted: p.red, // deletion
    inserted: p.green, // addition
    important: { color: p.red, fontWeight: 'bold' }, // strong
    selector: p.yellow, // selector-tag
    // The port has no analogue for these two: at-rules behave as keywords, and
    // entities are the closest thing it has to `symbol`.
    atrule: accent,
    entity: p.flamingo,
    // Not in the port; Prism emits these for markdown emphasis.
    bold: { color: p.red, fontWeight: 'bold' },
    italic: { color: p.red, fontStyle: 'italic' },
  };
}

/**
 * The style key for a flavour and accent. The default accent keeps the bare key,
 * which is what shipped before accents existed and what a stored theme names.
 */
export function catppuccinSyntaxKey(flavor: string, accent: Accent): string {
  const base = `catppuccin${FLAVOR_NAMES[flavor].replace('é', 'e')}`;
  return accent === DEFAULT_ACCENT ? base : base + accentName(accent);
}

export const CATPPUCCIN_STYLES: Record<string, PrismStyle> = Object.fromEntries(
  Object.entries(FLAVORS).flatMap(([flavor, palette]) =>
    ACCENTS.map((accent) => [
      catppuccinSyntaxKey(flavor, accent),
      buildPrismStyle({
        background: palette.surface0,
        foreground: palette.text,
        tokens: tokens(palette, palette[accent]),
      }),
    ]),
  ),
);
