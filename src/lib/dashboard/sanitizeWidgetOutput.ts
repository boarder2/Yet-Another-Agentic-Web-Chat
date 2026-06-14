import DOMPurify from 'isomorphic-dompurify';

// Widget output is DB-synced and rendered on every device. It's markdown
// (rendered by markdown-to-jsx) and may contain <Chart id="c0"/> placeholders.
//
// Policy (owner-approved code — see approve-on-save trust model):
//   - Images are ALLOWED, including remote http(s) and raster data: URIs, since
//     many widgets legitimately display images. Remote images can act as
//     tracking beacons; that's an accepted tradeoff because the user reviews
//     the code that produces the output.
//   - SVG is BLOCKED in every form: inline <svg>/<foreignObject> tags and
//     data:image/svg+xml URIs (SVG can carry scripts → XSS, and a remote SVG's
//     contents can change without warning).
//   - Real code-execution / framing vectors stay blocked: script, iframe,
//     object, embed, base, link, style.
//   - Inline `style` attributes are ALLOWED so widgets can lay out their
//     output (flexbox, sizing, colors). DOMPurify still sanitizes the CSS
//     values (blocking javascript: urls, expression(), etc.); this matches
//     the owner-approved-code trust model used for remote images above.
//
// Markdown images (![](url)) are rendered by markdown-to-jsx AFTER this runs,
// so we only need to (a) not strip them and (b) neutralize svg data URIs in the
// raw string. Raw <img> tags are governed by the DOMPurify URI allowlist below.

const CHART_TAG_RE = /<Chart\b[^>]*\/?>(?:\s*<\/Chart>)?/g;
const CHART_PLACEHOLDER = (i: number) => `⁣CHART_${i}_PLACEHOLDER⁣`;
const CHART_PLACEHOLDER_RE = /⁣CHART_(\d+)_PLACEHOLDER⁣/g;

// http(s), mail/tel, anchors/relative paths, and RASTER data: images (no svg).
const ALLOWED_URI =
  /^(?:(?:https?|mailto|tel):|[#/]|data:image\/(?:png|jpe?g|gif|webp|avif);base64,)/i;

export function sanitizeWidgetMarkdown(input: string | null): string {
  if (!input) return input ?? '';

  const charts: string[] = [];
  let out = input.replace(CHART_TAG_RE, (m) => {
    const token = CHART_PLACEHOLDER(charts.length);
    charts.push(m);
    return token;
  });

  // Strip svg data URIs everywhere (markdown images bypass DOMPurify, and
  // img-rendered SVG is the one image form we don't allow).
  out = out.replace(/data:image\/svg\+xml[^)\s"'>]*/gi, '');

  out = DOMPurify.sanitize(out, {
    FORBID_TAGS: [
      'script',
      'iframe',
      'object',
      'embed',
      'svg',
      'foreignObject',
      'base',
      'link',
      'style',
    ],
    ALLOWED_URI_REGEXP: ALLOWED_URI,
  });

  return out.replace(CHART_PLACEHOLDER_RE, (_, i) => charts[Number(i)] ?? '');
}
