/**
 * Pure (dependency-free) helpers for stripping UI-only markup out of message
 * content. Kept separate from contentUtils.ts so client bundles can import them
 * without pulling in LangChain.
 */

/**
 * Removes all content within <think>...</think> blocks, including content
 * before orphaned </think> tags (from providers that don't send opening <think>).
 */
export const removeThinkingBlocks = (text: string): string => {
  // First remove properly paired <think>...</think> blocks
  let result = text.replace(/<think>[\s\S]*?<\/think>/g, '');

  // Then handle orphaned </think> (no opening <think>).
  // Remove text between the last closing HTML tag (or start of string) and </think>.
  if (result.includes('</think>')) {
    result = result.replace(
      /(^|<\/[a-zA-Z][a-zA-Z0-9]*\s*>)[\s\S]*?<\/think>/g,
      '$1',
    );
  }

  return result.trim();
};

/**
 * Removes <ToolCall ...></ToolCall> UI markup tags (both paired and self-closing),
 * including nested <SubagentExecution> trees.
 */
export const removeToolCallMarkup = (text: string): string => {
  // Strip SubagentExecution blocks first so a single pass handles the whole
  // nested tree (each SubagentExecution may contain nested ToolCall markup).
  return text
    .replace(/<SubagentExecution\b[^>]*\/>/g, '')
    .replace(/<SubagentExecution\b[^>]*>[\s\S]*?<\/SubagentExecution>/g, '')
    .replace(/<ToolCall\b[^>]*\/>/g, '')
    .replace(/<ToolCall\b[^>]*>[\s\S]*?<\/ToolCall>/g, '');
};

/**
 * Removes <Chart .../> markup (self-closing and paired).
 */
export const removeChartMarkup = (text: string): string =>
  text
    .replace(/<Chart\b[^>]*\/>/g, '')
    .replace(/<Chart\b[^>]*>[\s\S]*?<\/Chart>/g, '');

/**
 * Strips citation markers like [1] or [1, 2] from text.
 */
export const removeCitations = (text: string): string =>
  text.replace(/\[\d+(?:\s*,\s*\d+)*\]/g, '');

/**
 * Strips Markdown syntax so only spoken-meaningful words remain: code blocks,
 * images, link URLs (keeping link text), bare URLs, HTML tags, headings, list
 * and table markers, blockquotes, horizontal rules, and emphasis markers.
 */
export const stripMarkdown = (text: string): string => {
  let t = text;
  // Fenced code blocks (drop entirely — not meaningful spoken).
  t = t.replace(/```[\s\S]*?```/g, ' ');
  t = t.replace(/~~~[\s\S]*?~~~/g, ' ');
  // Images: ![alt](url) -> drop.
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  // Links: [text](url) and [text][ref] -> keep text only.
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  t = t.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1');
  // Reference link definitions: [id]: url
  t = t.replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, ' ');
  // Autolinks and bare URLs.
  t = t.replace(/<https?:\/\/[^>]+>/g, ' ');
  t = t.replace(/https?:\/\/\S+/g, ' ');
  // HTML tags.
  t = t.replace(/<\/?[a-zA-Z][^>]*>/g, ' ');
  // Inline code: keep inner text.
  t = t.replace(/`([^`]+)`/g, '$1');
  // Headings: leading #.
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  // Blockquotes.
  t = t.replace(/^\s{0,3}>\s?/gm, '');
  // Horizontal rules.
  t = t.replace(/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/gm, ' ');
  // List markers (unordered + ordered).
  t = t.replace(/^\s*[-*+]\s+/gm, '');
  t = t.replace(/^\s*\d+[.)]\s+/gm, '');
  // Table separator rows (|---|:--:|) then remaining pipes.
  t = t.replace(/^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/gm, ' ');
  t = t.replace(/\|/g, ' ');
  // Emphasis / strikethrough markers.
  t = t.replace(/(\*\*\*|\*\*|\*|___|__|_|~~)/g, '');
  // Unescape Markdown escapes (\* -> *).
  t = t.replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, '$1');
  return t;
};

/**
 * Converts assistant message content into plain prose suitable for text-to-speech:
 * strips think blocks, tool-call/subagent/chart UI markup, Markdown syntax, and
 * citation markers, then collapses whitespace.
 */
export const toSpeechText = (content: string): string => {
  let text = removeToolCallMarkup(content);
  text = removeChartMarkup(text);
  text = removeThinkingBlocks(text);
  text = removeCitations(text);
  text = stripMarkdown(text);
  return text.replace(/\s+/g, ' ').trim();
};
