import { marked, type Token, type Tokens } from 'marked';
import {
  removeChartMarkup,
  removeCitations,
  removeThinkingBlocks,
  removeToolCallMarkup,
} from '@/lib/utils/contentStripping';
import { normalizeForSpeech } from './normalize';

/**
 * One unit of speech: a run of text bracketed by pauses. `pauseAfterMs` /
 * `pauseBeforeMs` are *base* lengths in milliseconds — the synthesizer scales
 * them by playback speed before inserting that much silence around the audio.
 * `speed` is a per-segment multiplier on top of the global playback speed
 * (<1 slows the run, the only "emphasis" lever Kokoro exposes besides pauses).
 */
export interface SpeechSegment {
  text: string;
  pauseAfterMs: number;
  /** Silence inserted *before* this segment (default 0). Used to set off headings. */
  pauseBeforeMs?: number;
  /** Speed multiplier relative to global playback speed (default 1). */
  speed?: number;
}

// Base pause lengths (ms), scaled by playback speed at synthesis time.
const PAUSE = {
  emphasis: 140, // micro-pause flanking an emphasized run
  sentence: 300, // between table rows
  paragraph: 500, // paragraphs, list items, blockquotes, code markers
  headingLeadIn: 250, // before a heading, to detach it from prior text
  heading: 800, // after a heading, before the section body
  hr: 1000, // at a horizontal rule / hard section break
} as const;

// Per-segment speed multipliers. Kokoro can't pitch-emphasize, so a slight
// slowdown is what gives headings an "announcing" cadence and emphasized runs
// extra weight relative to the surrounding speech.
const SPEED = {
  heading: 0.95,
  emphasis: 0.9,
} as const;

/**
 * Recursively collect spoken text from a token subtree, discarding structure.
 * Used for inline runs and for flattening nested block content (list items,
 * table cells, blockquotes). Link text is kept and the URL dropped; images and
 * raw HTML are skipped; inline code keeps its inner text.
 */
const flattenText = (tokens: Token[] | undefined): string => {
  if (!tokens) return '';
  let out = '';
  for (const tok of tokens) {
    switch (tok.type) {
      case 'text': {
        const t = tok as Tokens.Text;
        out += t.tokens ? flattenText(t.tokens) : (t.text ?? '');
        break;
      }
      case 'escape':
      case 'codespan':
        out += (tok as Tokens.Codespan).text ?? '';
        break;
      case 'strong':
      case 'em':
      case 'del':
        out += flattenText((tok as Tokens.Strong).tokens);
        break;
      case 'link': {
        const link = tok as Tokens.Link;
        const linkText = flattenText(link.tokens) || link.text;
        // Drop bare/auto-links whose visible text is just the URL — speaking a
        // URL is noise, and it would otherwise reach normalizeForSpeech (e.g.
        // "%20" → "percent20"). Keep human-written link text.
        out += linkText === link.href ? '' : linkText;
        break;
      }
      case 'br':
        out += ' ';
        break;
      case 'paragraph':
      case 'heading':
      case 'blockquote':
        out += `${flattenText((tok as Tokens.Paragraph).tokens)} `;
        break;
      case 'list':
        for (const item of (tok as Tokens.List).items) {
          out += `${flattenText(item.tokens)} `;
        }
        break;
      // image, html, code, hr, space → contribute nothing spoken.
      default: {
        const maybe = tok as { tokens?: Token[] };
        if (maybe.tokens) out += flattenText(maybe.tokens);
      }
    }
  }
  return out;
};

/** Strip citations + normalize + collapse whitespace into final spoken text. */
const finalize = (raw: string): string =>
  normalizeForSpeech(removeCitations(raw)).replace(/\s+/g, ' ').trim();

/** Bump the previous segment's trailing pause to at least `ms`. */
const extendLastPause = (segments: SpeechSegment[], ms: number): void => {
  const last = segments[segments.length - 1];
  if (last && ms > last.pauseAfterMs) last.pauseAfterMs = ms;
};

/**
 * Convert assistant message markdown into speech-optimized segments. Strips
 * think/tool/chart UI markup, parses the remaining markdown into a token tree
 * (`marked`), and walks it emitting one `SpeechSegment` per structural element
 * with an appropriate trailing pause. Tables are linearized row-by-row as
 * "Header: value, …"; code blocks become a short marker; horizontal rules add a
 * long pause. Falls back to a single normalized segment if parsing fails.
 */
export const speechify = (markdown: string): SpeechSegment[] => {
  const cleaned = removeChartMarkup(
    removeToolCallMarkup(removeThinkingBlocks(markdown)),
  );

  let tokens: Token[];
  try {
    tokens = marked.lexer(cleaned);
  } catch {
    const text = finalize(cleaned);
    return text ? [{ text, pauseAfterMs: 0 }] : [];
  }

  const segments: SpeechSegment[] = [];
  const add = (
    raw: string,
    pauseAfterMs: number,
    opts?: { speed?: number; pauseBeforeMs?: number; terminal?: boolean },
  ): void => {
    let text = finalize(raw);
    if (!text) return;
    // A heading rendered as its own utterance reads more naturally with a
    // terminal period (declarative falling tone) than as an unpunctuated fragment.
    if (opts?.terminal && !/[.!?:,;]$/.test(text)) text += '.';
    segments.push({
      text,
      pauseAfterMs,
      speed: opts?.speed,
      pauseBeforeMs: opts?.pauseBeforeMs,
    });
  };

  /**
   * Emit an inline run (paragraph / list item / blockquote body), splitting out
   * *multi-word* emphasized spans so each can be set off with flanking micro-pauses
   * and a slight slowdown — the closest Kokoro gets to inline emphasis. Single-word
   * emphasis is left inline (setting off one word sounds choppy for little gain).
   * Non-emphasized text stays one segment, preserving normal sentence flow.
   */
  const addInline = (tokens: Token[] | undefined, trailing: number): void => {
    if (!tokens) return;
    type Piece = { text: string; emphatic: boolean };
    const pieces: Piece[] = [];
    let buf = '';
    const flushBuf = () => {
      if (buf.trim()) pieces.push({ text: buf, emphatic: false });
      buf = '';
    };
    for (const tok of tokens) {
      if (tok.type === 'strong' || tok.type === 'em') {
        const inner = flattenText((tok as Tokens.Strong).tokens);
        if (inner.trim().split(/\s+/).length > 1) {
          flushBuf();
          pieces.push({ text: inner, emphatic: true });
          continue;
        }
      }
      buf += flattenText([tok]);
    }
    flushBuf();

    const real = pieces.filter((p) => finalize(p.text));
    if (real.length === 0) return;
    // Fast path: nothing to set off — one segment, exactly as before.
    if (real.length === 1 && !real[0].emphatic) {
      add(real[0].text, trailing);
      return;
    }
    real.forEach((p, i) => {
      const last = i === real.length - 1;
      const pauseAfter = last ? trailing : p.emphatic ? PAUSE.emphasis : 0;
      add(
        p.text,
        pauseAfter,
        p.emphatic
          ? { speed: SPEED.emphasis, pauseBeforeMs: PAUSE.emphasis }
          : undefined,
      );
    });
  };

  for (const tok of tokens) {
    switch (tok.type) {
      case 'heading':
        add(flattenText((tok as Tokens.Heading).tokens), PAUSE.heading, {
          speed: SPEED.heading,
          pauseBeforeMs: PAUSE.headingLeadIn,
          terminal: true,
        });
        break;
      case 'paragraph':
        addInline((tok as Tokens.Paragraph).tokens, PAUSE.paragraph);
        break;
      case 'blockquote':
        addInline((tok as Tokens.Blockquote).tokens, PAUSE.paragraph);
        break;
      case 'list':
        for (const item of (tok as Tokens.List).items) {
          addInline(item.tokens, PAUSE.paragraph);
        }
        break;
      case 'table': {
        const table = tok as Tokens.Table;
        const headers = table.header.map((cell) =>
          finalize(flattenText(cell.tokens)),
        );
        for (const row of table.rows) {
          const parts = row
            .map((cell, i) => {
              const value = flattenText(cell.tokens);
              const header = headers[i];
              return header ? `${header}: ${value}` : value;
            })
            .join(', ');
          add(parts, PAUSE.sentence);
        }
        // Longer breath after the whole table.
        extendLastPause(segments, PAUSE.paragraph);
        break;
      }
      case 'code':
        add('Code example.', PAUSE.paragraph);
        break;
      case 'hr':
        extendLastPause(segments, PAUSE.hr);
        break;
      default:
        break; // space, html, etc.
    }
  }

  return segments;
};
