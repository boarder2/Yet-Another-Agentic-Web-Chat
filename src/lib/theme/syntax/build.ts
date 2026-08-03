/**
 * Builds a Prism style from a palette, for the families that ship no Prism port
 * of their own. `react-syntax-highlighter` bundles fifteen styles; everything
 * else in the catalogue is authored here from its project's own spec.
 *
 * Colour only — no font stack and no metrics. `CodeBlock` supplies the padding
 * and paints the fill, and leaving `fontFamily` out keeps every style on the
 * app's mono so a fence and an editor painted from one key really do look alike.
 */
import type { CSSProperties } from 'react';

export type PrismStyle = Record<string, CSSProperties>;

/** A token rule: a bare colour, or a colour plus emphasis. */
export type TokenRule = string | (CSSProperties & { color: string });

export interface StyleSpec {
  /**
   * The fence and editor fill. Each family's own raised tone rather than its
   * canvas, so a fence reads as a slab even when the theme and the style match.
   * Upstream ports paint the canvas; this is the one place we deviate.
   */
  background: string;
  foreground: string;
  /** Prism token key → rule. A key the palette has no colour for is omitted. */
  tokens: Record<string, TokenRule>;
}

const CODE = 'code[class*="language-"]';
const PRE = 'pre[class*="language-"]';

/** Prism splits what every palette treats as one comment colour. */
const COMMENT_ALIASES = ['prolog', 'doctype', 'cdata'];

export function buildPrismStyle({
  background,
  foreground,
  tokens,
}: StyleSpec): PrismStyle {
  const style: PrismStyle = {
    [CODE]: { color: foreground },
    [PRE]: { color: foreground, background },
    // Prism's own convention for XML namespace prefixes; every bundled style
    // carries it verbatim and no palette assigns it a colour.
    '.namespace': { opacity: 0.7 },
  };

  for (const [key, rule] of Object.entries(tokens)) {
    style[key] = typeof rule === 'string' ? { color: rule } : rule;
    if (key === 'comment')
      for (const alias of COMMENT_ALIASES) style[alias] = style[key];
  }

  return style;
}
