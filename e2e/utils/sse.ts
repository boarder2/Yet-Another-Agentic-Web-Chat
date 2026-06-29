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
