/**
 * Placeholder `GET /api/config` returns in place of a stored secret, which the
 * settings UI echoes back untouched. On write (`POST /api/config`) this value
 * means "keep the existing secret". A long random sequence, not a guessable
 * word, so no real API key or token can plausibly collide with it and be
 * mistaken for "unchanged". Must stay constant across GET/POST and restarts —
 * do not regenerate it.
 */
export const MASKED_SECRET =
  '__yaawc_unchanged_secret_1b58381c61adf1dc135f15dab7e0d26f__';

/** Mask a secret for the client: the sentinel if set, otherwise the falsy value as-is. */
export const maskSecret = (value: string | null | undefined) =>
  value ? MASKED_SECRET : value;
