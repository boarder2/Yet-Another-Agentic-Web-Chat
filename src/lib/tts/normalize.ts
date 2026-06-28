/**
 * Bounded, dependency-free text normalization for speech. Deliberately small: it
 * only rewrites the handful of tokens that the TTS model otherwise mispronounces
 * (currency, percentages, common Latin abbreviations, empty call parens, grouped
 * numbers). Everything else is left literal — this is *not* a general number-to-
 * words engine. Applied to each speech segment's text after markdown is stripped.
 *
 * Lives below both read and narrate modes: the narration LLM preserves prose
 * verbatim, so it never fixes "$24.5M" / "e.g." itself — this layer does, for
 * both modes.
 */

const MAGNITUDE: Record<string, string> = {
  k: 'thousand',
  m: 'million',
  b: 'billion',
  t: 'trillion',
};

export const normalizeForSpeech = (input: string): string => {
  let t = input;

  // Latin abbreviations. Done first, before currency/percent, because they carry
  // periods that would otherwise confuse downstream sentence splitting.
  t = t.replace(/\be\.g\.\s*/gi, 'for example, ');
  t = t.replace(/\bi\.e\.\s*/gi, 'that is, ');
  t = t.replace(/\betc\.(?=[^a-zA-Z]|$)/gi, 'and so on');
  t = t.replace(/\bvs\.?(?=[^a-zA-Z]|$)/gi, 'versus');

  // Currency: $5, $1,000, $24.5M → "<n> [magnitude] dollars".
  t = t.replace(
    /\$\s?(\d[\d,]*(?:\.\d+)?)(?:\s?([kmbt]))?\b/gi,
    (_match, num: string, mag?: string) => {
      const n = num.replace(/,/g, '');
      const magWord = mag ? ` ${MAGNITUDE[mag.toLowerCase()]}` : '';
      return `${n}${magWord} dollars`;
    },
  );

  // Percent: 50% / 3.5 % → "50 percent".
  t = t.replace(/(\d+(?:\.\d+)?)\s?%/g, '$1 percent');

  // Empty call parens: foo() → foo (so it isn't read "foo open paren close paren").
  t = t.replace(/\b([A-Za-z_]\w*)\(\)/g, '$1');

  // Thousands separators in bare numbers: 1,000,000 → 1000000 so the model reads
  // it as a single number rather than "one comma zero zero zero …".
  t = t.replace(/\b\d{1,3}(?:,\d{3})+\b/g, (m) => m.replace(/,/g, ''));

  return t;
};
