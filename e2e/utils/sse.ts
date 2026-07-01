export interface ChatEvent {
  type: string;
  [k: string]: unknown;
}

/**
 * Parse newline-delimited JSON SSE text into typed events.
 * Each line is a `JSON.stringify(event)` — the wire format from runHub.
 */
export function parseSseText(text: string): ChatEvent[] {
  const events: ChatEvent[] = [];
  // Buffer partial lines (trailing chunk that doesn't end with \n).
  const lines = text.split('\n');
  for (const line of lines) {
    if (!line) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // Skip unparseable lines (e.g. trailing partial chunk).
    }
  }
  return events;
}

/** Something with a `.body()` that returns a Buffer — e.g. Playwright APIResponse. */
interface HasBody {
  body(): Promise<Buffer>;
}

/**
 * Consume an SSE stream and return all parsed events.
 * Pass a raw string (from `response.text()`) or a Playwright `APIResponse`.
 */
export async function collectSseEvents(
  source: string | HasBody,
): Promise<ChatEvent[]> {
  if (typeof source === 'string') {
    return parseSseText(source);
  }
  const buf = await source.body();
  return parseSseText(buf.toString('utf-8'));
}

export function eventsOfType(events: ChatEvent[], type: string): ChatEvent[] {
  return events.filter((e) => e.type === type);
}

/**
 * Concatenate the `data` of all `response` events into the streamed answer.
 * Note: events before the `replay_complete` marker are buffered replay;
 * `response` tokens may appear in both the replay and live phases.
 */
export function joinResponseText(events: ChatEvent[]): string {
  return eventsOfType(events, 'response')
    .map((e) => (typeof e.data === 'string' ? e.data : ''))
    .join('');
}

/** A citation source from a `sources` or `sources_added` event. */
export interface CitationSource {
  id?: string;
  title?: string;
  url?: string;
  content?: string;
  [k: string]: unknown;
}

/**
 * Extract all citation sources from `sources` and `sources_added` events
 * in order of occurrence.
 */
export function extractSources(events: ChatEvent[]): CitationSource[] {
  const sources: CitationSource[] = [];
  for (const e of events) {
    if (e.type === 'sources' || e.type === 'sources_added') {
      const data = e.data;
      if (Array.isArray(data)) {
        sources.push(...(data as CitationSource[]));
      }
    }
  }
  return sources;
}

/**
 * POST /api/chat via raw fetch and read the SSE stream incrementally,
 * stopping as soon as `stopWhen` matches the accumulated events (or the
 * stream ends naturally). Needed because a run paused at an interrupt
 * (awaiting_user) keeps its HTTP connection open indefinitely — Playwright's
 * `request` fixture has no partial-read API, so this reads the fetch body
 * reader directly and aborts the connection once satisfied.
 */
export async function streamChatUntil(
  baseUrl: string,
  body: Record<string, unknown>,
  stopWhen: (events: ChatEvent[]) => boolean,
  timeoutMs = 10_000,
): Promise<ChatEvent[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`POST /api/chat returned ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const events: ChatEvent[] = [];
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line) continue;
        try {
          events.push(JSON.parse(line));
        } catch {
          // skip unparseable lines
        }
      }
      if (stopWhen(events)) {
        await reader.cancel().catch(() => {});
        return events;
      }
    }
    // Flush any trailing multi-byte sequence and parse a final unterminated line.
    buffer += decoder.decode();
    if (buffer) {
      try {
        events.push(JSON.parse(buffer));
      } catch {
        // skip unparseable trailing content
      }
    }
    return events;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
