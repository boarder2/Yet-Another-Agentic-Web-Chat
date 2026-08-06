/**
 * The artifact sandbox policy. Artifact HTML is semi-trusted — a poisoned page
 * read during research can steer the agent into emitting hostile JS — so the
 * runtime grants it no network of any kind: no `connect-src`, no host sources
 * anywhere, and only inert schemes for assets.
 *
 * `sandbox` is what keeps the document off this app's origin, and it is stated
 * here rather than left to the embedder: the viewer's iframe also withholds
 * `allow-same-origin`, but the same bytes are reachable top-level (the panel's
 * "open in new tab", or a popup the artifact opens itself), where no iframe
 * attribute applies. Declaring it on the response makes the opaque origin
 * travel with the content instead of depending on how it was loaded — without
 * it, artifact JS opened in a tab runs same-origin and can read the local API
 * through a freshly opened, policy-free document.
 *
 * Served as a response header on the raw route, and injected as a `<meta>` tag
 * on export so a downloaded file keeps the network restrictions off-server.
 */

export const ARTIFACT_CSP_HEADER = [
  "default-src 'none'",
  'sandbox allow-scripts allow-popups',
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "frame-ancestors 'self'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

/** `frame-ancestors` and `sandbox` are header-only — the meta variant drops them. */
export const ARTIFACT_CSP_META = ARTIFACT_CSP_HEADER.split('; ')
  .filter((d) => !/^(frame-ancestors|sandbox)\b/.test(d))
  .join('; ');

const META_TAG = `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP_META}">`;

/**
 * Put {@link META_TAG} first inside the document's `<head>`, synthesizing one
 * when the document lacks it.
 *
 * Injected unconditionally, even when the document already carries a CSP meta.
 * The agent authors these bytes, so a permissive `default-src *` tag of its own
 * would otherwise suppress the policy the export exists to apply. Browsers
 * intersect multiple policies to the most restrictive, and ours goes in first,
 * so stacking is both safe and the only sound behaviour here.
 */
export function injectCspMeta(html: string): string {
  const head = /<head\b[^>]*>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + META_TAG + html.slice(at);
  }

  const htmlTag = /<html\b[^>]*>/i.exec(html);
  if (htmlTag) {
    const at = htmlTag.index + htmlTag[0].length;
    return html.slice(0, at) + `<head>${META_TAG}</head>` + html.slice(at);
  }

  return `<head>${META_TAG}</head>` + html;
}

/** Download filename: a slug of the title plus the version, ASCII-safe for Content-Disposition. */
export function artifactFilename(title: string, version: number): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'artifact'}-v${version}.html`;
}
