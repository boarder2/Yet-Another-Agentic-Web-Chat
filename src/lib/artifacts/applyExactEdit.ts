/**
 * The exact-match edit primitive behind `edit_artifact`: `oldStr` must occur
 * exactly once. Pure and string-only — no regex is ever built from the inputs,
 * so metacharacters in either string stay literal.
 */

export type ExactEditResult =
  | { ok: true; content: string }
  | {
      ok: false;
      reason: 'no_match' | 'ambiguous' | 'no_change';
      message: string;
      count?: number;
    };

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  for (
    let i = haystack.indexOf(needle);
    i !== -1;
    i = haystack.indexOf(needle, i + needle.length)
  ) {
    count++;
  }
  return count;
}

export function applyExactEdit(
  content: string,
  oldStr: string,
  newStr: string,
): ExactEditResult {
  if (oldStr === '') {
    return {
      ok: false,
      reason: 'no_match',
      message:
        'oldStr must not be empty. Provide the exact text to replace, then retry.',
    };
  }
  if (oldStr === newStr) {
    return {
      ok: false,
      reason: 'no_change',
      message:
        'oldStr and newStr are identical, so this edit would change nothing.',
    };
  }

  const count = countOccurrences(content, oldStr);
  if (count === 0) {
    return {
      ok: false,
      reason: 'no_match',
      message:
        'oldStr was not found in the artifact. Call read_artifact to get the current content, then retry with text copied exactly from it.',
    };
  }
  if (count > 1) {
    return {
      ok: false,
      reason: 'ambiguous',
      count,
      message: `oldStr matches ${count} times. Include more surrounding context so it identifies exactly one location.`,
    };
  }

  const at = content.indexOf(oldStr);
  return {
    ok: true,
    content: content.slice(0, at) + newStr + content.slice(at + oldStr.length),
  };
}
