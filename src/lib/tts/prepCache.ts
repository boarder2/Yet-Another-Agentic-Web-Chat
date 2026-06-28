// Short-lived bridge between the two-step TTS flow: POST /api/tts prepares the
// speech segments and stashes them here under a random id; GET /api/tts/stream
// then claims them by id and streams the WAV. This indirection exists because an
// <audio> element loads from a GET URL, but the synthesis request (markdown,
// narration model, voice) is too large to encode in a query string.
//
// Module state is shared across route handlers within the single Next.js server
// process. This is NOT multi-instance safe — fine for this single-instance app.
import { randomUUID } from 'crypto';
import type { SpeechSegment } from './speechify';

interface PrepEntry {
  segments: SpeechSegment[];
  voice: string;
  expires: number;
  // Lazily-rendered full WAV, memoized for the Safari/byte-range path so the
  // probe request and the follow-up full request don't synthesize twice.
  wav?: Promise<Buffer>;
}

const TTL_MS = 2 * 60_000;
// Hard cap so a burst of prepares that are never claimed (client navigated away
// between POST and GET) can't grow the map — and, with the Safari path, can't pin
// many full-WAV buffers in RAM. Oldest entries are evicted first.
const MAX_ENTRIES = 64;
const store = new Map<string, PrepEntry>();

// Drop anything past its TTL. Called lazily on every access — there's never more
// than a handful of in-flight entries, so a full sweep is cheap.
const sweep = () => {
  const now = Date.now();
  for (const [id, entry] of store) {
    if (entry.expires <= now) store.delete(id);
  }
};

/** Stash prepared segments and return the id the client GETs by. */
export const put = (segments: SpeechSegment[], voice: string): string => {
  sweep();
  while (store.size >= MAX_ENTRIES) {
    // Map preserves insertion order, so the first key is the oldest.
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
  const id = randomUUID();
  store.set(id, { segments, voice, expires: Date.now() + TTL_MS });
  return id;
};

/**
 * Look up prepared segments by id without removing them. Used by the Safari /
 * byte-range path, where the same id is fetched more than once (a 0-1 probe then
 * the full request) and the rendered WAV is memoized on the entry.
 */
export const peek = (id: string): PrepEntry | undefined => {
  sweep();
  return store.get(id);
};

/**
 * Claim prepared segments by id, removing them so they're synthesized exactly
 * once. Used by the progressive-streaming path, where each GET starts a fresh
 * synthesis job — leaving the entry would let a stray re-request spawn a duplicate.
 */
export const take = (id: string): PrepEntry | undefined => {
  sweep();
  const entry = store.get(id);
  if (entry) store.delete(id);
  return entry;
};
