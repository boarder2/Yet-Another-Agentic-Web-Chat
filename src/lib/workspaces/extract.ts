import fs from 'node:fs/promises';
import { blobPath, hasNulByte } from './paths';

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

export function isExtractableBinary(mime?: string | null): boolean {
  if (!mime) return false;
  return (
    mime === 'application/pdf' ||
    mime ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );
}

/** Cached by sha: the extracted text is a function of the content alone. */
export async function getText(row: {
  workspaceId: string;
  id: string;
  sha256: string;
  mime?: string | null;
}): Promise<string | null> {
  const hit = cache.get(row.sha256);
  if (hit !== undefined) {
    lruTouch(row.sha256, hit);
    return hit;
  }
  const buf = await fs.readFile(blobPath(row.workspaceId, row.id, row.sha256));
  let text: string | null = null;
  if (isExtractableBinary(row.mime)) {
    const { extractText } = await import('@/lib/workspaces/extractAdapter');
    text = await extractText(buf, row.mime);
  } else if (!hasNulByte(buf)) {
    text = buf.toString('utf8');
  }
  if (text !== null) lruTouch(row.sha256, text);
  return text;
}
