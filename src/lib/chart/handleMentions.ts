/**
 * Narrated chart placements.
 *
 * Weaker chat models sometimes describe a placement instead of calling
 * `show_chart`, writing `{chart_4}`, `[chart_4]`, or a bare `show_chart` line
 * into the answer. These helpers recover the intent — the writer places the
 * mentioned chart — and remove the leftover text either way, so a placeholder
 * the reader cannot act on never survives into the message.
 *
 * Pure and dependency-free: imported by the agent, the run host, and the
 * client's content stripping.
 */

/** `{chart_4}`, `{{chart_4}}`, or `[chart_4]` anywhere in the text. */
const BRACKETED_MENTION =
  '\\{\\{?[ \\t]*(chart_\\d+)[ \\t]*\\}\\}?|\\[[ \\t]*(chart_\\d+)[ \\t]*\\]';

const BRACKETED_MENTION_RE = new RegExp(BRACKETED_MENTION, 'g');

/** A whole line that is only a mention or the bare tool name. */
const MENTION_LINE_RE = new RegExp(
  `^[ \\t]*(?:${BRACKETED_MENTION}|chart_\\d+|show_chart)[ \\t]*(?:\\r?\\n|$)`,
  'gm',
);

/**
 * The handles of every complete bracketed mention, in the order they appear.
 * Bare `chart_4` lines are deliberately excluded: they are indistinguishable
 * from prose about a handle until the line ends, and stripping them is enough.
 */
export function findChartHandleMentions(text: string): string[] {
  return [...text.matchAll(BRACKETED_MENTION_RE)].map(
    (match) => (match[1] ?? match[2]) as string,
  );
}

/** Remove every narrated mention, dropping the line when it holds nothing else. */
export function stripChartHandleMentions(text: string): string {
  return text.replace(MENTION_LINE_RE, '').replace(BRACKETED_MENTION_RE, '');
}

/**
 * Reports each narrated mention exactly once as an answer streams in. Only a
 * mention whose closing bracket has arrived is reported, so a handle is never
 * acted on from a half-streamed token.
 */
export class ChartMentionTracker {
  private text = '';
  private seen = 0;

  /** Handles newly completed by this chunk, in the order they were written. */
  push(chunk: string): string[] {
    this.text += chunk;
    const mentions = findChartHandleMentions(this.text);
    const fresh = mentions.slice(this.seen);
    this.seen = mentions.length;
    return fresh;
  }
}
