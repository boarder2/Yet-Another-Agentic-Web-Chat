export function encodeHtmlAttribute(value: string): string {
  if (!value) return '';
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('\n', '&#10;')
    .replaceAll('\r', '&#13;');
}

/**
 * Base64-encode a string (isomorphic: works in Node and browser).
 * Used for long ToolCall attribute values (code, stdout, stderr) that would
 * otherwise break the markdown parser's HTML attribute parsing.
 */
export function encodeBase64(value: string): string {
  if (!value) return '';
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value, 'utf-8').toString('base64');
  }
  return btoa(
    new TextEncoder()
      .encode(value)
      .reduce((acc, byte) => acc + String.fromCharCode(byte), ''),
  );
}

/**
 * Decode a base64-encoded string (isomorphic: works in Node and browser).
 */
export function decodeBase64(value: string): string {
  if (!value) return '';
  try {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(value, 'base64').toString('utf-8');
    }
    return new TextDecoder().decode(
      Uint8Array.from(atob(value), (c) => c.charCodeAt(0)),
    );
  } catch {
    return value;
  }
}

export function decodeHtmlEntities(value: string): string {
  if (!value) return '';
  if (typeof value !== 'string') return '';

  const numericDecoded = value
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([\da-fA-F]+);/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    );

  return numericDecoded
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}
