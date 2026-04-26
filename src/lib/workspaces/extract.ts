import fs from 'node:fs/promises';
import { blobPath } from './paths';

const cache = new Map<string, string>(); // sha256 -> text
const MAX_ENTRIES = 64;

function lruTouch(key: string, value: string) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > MAX_ENTRIES) {
    const first = cache.keys().next().value;
    if (first === undefined) break;
    cache.delete(first);
  }
}

export function isImageMime(mime?: string | null): boolean {
  return !!mime && mime.startsWith('image/');
}

export function isTextLikeMime(mime?: string | null): boolean {
  if (!mime) return true; // treat unknown as text
  return /^(text\/|application\/(json|xml|javascript|typescript|x-yaml|toml))/.test(
    mime,
  );
}

export function isExtractableBinary(mime?: string | null): boolean {
  if (!mime) return false;
  return (
    mime === 'application/pdf' ||
    mime ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );
}

export async function getText(
  sha256: string,
  mime?: string | null,
): Promise<string | null> {
  const hit = cache.get(sha256);
  if (hit !== undefined) {
    lruTouch(sha256, hit);
    return hit;
  }
  const buf = await fs.readFile(blobPath(sha256));
  let text: string | null = null;
  if (isTextLikeMime(mime)) {
    text = buf.toString('utf8');
  } else if (isExtractableBinary(mime)) {
    const { extractText } = await import('@/lib/workspaces/extractAdapter');
    text = await extractText(buf, mime);
  } else {
    text = null;
  }
  if (text !== null) lruTouch(sha256, text);
  return text;
}
