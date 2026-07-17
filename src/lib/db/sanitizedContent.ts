import { removeToolCallMarkup } from '@/lib/utils/contentStripping';

/**
 * Canonical derivation of the `sanitizedContent` column from raw message
 * `content`. Every insert/update that writes `content` must derive
 * `sanitizedContent` through this function — the one seam history search
 * relies on to never see execution UI markup.
 */
export function computeSanitizedContent(content: string): string {
  return removeToolCallMarkup(content);
}
