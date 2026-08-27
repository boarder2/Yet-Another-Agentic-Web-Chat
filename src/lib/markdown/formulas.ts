import katex, { type KatexOptions } from 'katex';

export type FormulaTokenValue =
  | {
      type: 'formula';
      displayMode: boolean;
      source: string;
      html: string;
    }
  | {
      type: 'literal';
      source: string;
    };

export interface PreparedFormulaMarkdown {
  text: string;
  tokens: Readonly<Record<string, FormulaTokenValue>>;
}

interface ProtectedRange {
  start: number;
  end: number;
}

type FormulaCandidate =
  | {
      status: 'valid';
      end: number;
      displayMode: boolean;
      body: string;
    }
  | {
      status: 'invalid';
      end: number;
    }
  | {
      status: 'incomplete';
      end: number;
    };

const TRUST_REQUIRING_COMMAND =
  /\\(?:href|url|hyperref|includegraphics|html(?:Class|Id|Style|Data)|(?:class|id|style|data))\b/i;
const MACRO_DEFINITION_COMMAND =
  /\\(?:def|gdef|edef|xdef|let|futurelet|newcommand|renewcommand|providecommand|DeclareMathOperator)\b/i;

const SAFE_KATEX_OPTIONS: Omit<KatexOptions, 'displayMode'> = {
  output: 'htmlAndMathml',
  throwOnError: true,
  trust: false,
  macros: {},
  strict: 'error',
};

const isWhitespace = (value: string | undefined): boolean =>
  value !== undefined && /\s/u.test(value);

const isEscaped = (source: string, index: number): boolean => {
  let backslashes = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && source[cursor] === '\\';
    cursor--
  ) {
    backslashes++;
  }
  return backslashes % 2 === 1;
};

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const lineEnd = (source: string, start: number): number => {
  const newline = source.indexOf('\n', start);
  return newline === -1 ? source.length : newline;
};

const nextLineStart = (source: string, end: number): number =>
  end < source.length ? end + 1 : source.length;

const withoutCarriageReturn = (line: string): string =>
  line.endsWith('\r') ? line.slice(0, -1) : line;

const mergeRanges = (ranges: ProtectedRange[]): ProtectedRange[] => {
  if (ranges.length === 0) return [];

  const sorted = [...ranges].sort((left, right) => left.start - right.start);
  const merged: ProtectedRange[] = [
    { start: sorted[0].start, end: sorted[0].end },
  ];

  for (const range of sorted.slice(1)) {
    const current = merged[merged.length - 1];
    if (range.start <= current.end) {
      current.end = Math.max(current.end, range.end);
    } else {
      merged.push({ start: range.start, end: range.end });
    }
  }

  return merged;
};

const rangeContaining = (
  ranges: ProtectedRange[],
  index: number,
): ProtectedRange | undefined => {
  for (const range of ranges) {
    if (range.start > index) return undefined;
    if (index < range.end) return range;
  }
  return undefined;
};

const rangeIntersects = (
  ranges: ProtectedRange[],
  start: number,
  end: number,
): boolean => {
  for (const range of ranges) {
    if (range.start >= end) return false;
    if (range.end > start && range.start < end) return true;
  }
  return false;
};

const addFencedCodeRanges = (
  source: string,
  ranges: ProtectedRange[],
): void => {
  let cursor = 0;

  while (cursor < source.length) {
    const currentEnd = lineEnd(source, cursor);
    const currentLine = withoutCarriageReturn(source.slice(cursor, currentEnd));
    const opening = currentLine.match(
      /^(?:(?:[ \t]{0,3}>[ \t]?)+|[ \t]{0,3}(?:[-+*]|\d+[.)])[ \t]+)?[ \t]{0,3}(`{3,}|~{3,})(.*)$/,
    );

    if (!opening || (opening[1][0] === '`' && opening[2].includes('`'))) {
      cursor = nextLineStart(source, currentEnd);
      continue;
    }

    const fence = opening[1];
    const fenceCharacter = fence[0];
    const fenceLength = fence.length;
    let closingCursor = nextLineStart(source, currentEnd);
    let rangeEnd = source.length;

    while (closingCursor < source.length) {
      const closingEnd = lineEnd(source, closingCursor);
      const closingLine = withoutCarriageReturn(
        source.slice(closingCursor, closingEnd),
      );
      const closing = closingLine.match(
        /^(?:(?:[ \t]{0,3}>[ \t]?)+|[ \t]{0,3}(?:[-+*]|\d+[.)])[ \t]+)?[ \t]{0,3}(`+|~+)[ \t]*$/,
      );

      if (
        closing &&
        closing[1][0] === fenceCharacter &&
        closing[1].length >= fenceLength
      ) {
        rangeEnd = nextLineStart(source, closingEnd);
        break;
      }
      closingCursor = nextLineStart(source, closingEnd);
    }

    ranges.push({ start: cursor, end: rangeEnd });
    cursor = rangeEnd;
  }
};

const addIndentedCodeRanges = (
  source: string,
  ranges: ProtectedRange[],
): void => {
  let cursor = 0;

  while (cursor < source.length) {
    const currentEnd = lineEnd(source, cursor);
    const currentLine = withoutCarriageReturn(source.slice(cursor, currentEnd));
    const isIndentedCode = /^(?: {4}|\t)\S/.test(currentLine);

    if (!isIndentedCode || rangeContaining(ranges, cursor)) {
      cursor = nextLineStart(source, currentEnd);
      continue;
    }

    const start = cursor;
    let end = nextLineStart(source, currentEnd);
    while (end < source.length) {
      const nextEnd = lineEnd(source, end);
      const nextLine = withoutCarriageReturn(source.slice(end, nextEnd));
      if (nextLine.trim() !== '' && !/^(?: {4}|\t)/.test(nextLine)) break;
      end = nextLineStart(source, nextEnd);
    }

    ranges.push({ start, end });
    cursor = end;
  }
};

const backtickRunLength = (source: string, index: number): number => {
  let start = index;
  while (start > 0 && source[start - 1] === '`') start--;

  let end = index;
  while (end < source.length && source[end] === '`') end++;
  return end - start;
};

const isExactBacktickRun = (
  source: string,
  index: number,
  length: number,
): boolean => {
  if (index > 0 && source[index - 1] === '`') return false;
  return backtickRunLength(source, index) === length;
};

const addInlineCodeRanges = (
  source: string,
  ranges: ProtectedRange[],
): void => {
  let cursor = 0;

  while (cursor < source.length) {
    if (
      source[cursor] !== '`' ||
      isEscaped(source, cursor) ||
      rangeContaining(ranges, cursor)
    ) {
      cursor++;
      continue;
    }

    const length = backtickRunLength(source, cursor);
    let closing = cursor + length;
    let closingEnd = -1;

    while (closing < source.length) {
      const next = source.indexOf('`', closing);
      if (next === -1) break;
      if (
        isExactBacktickRun(source, next, length) &&
        !rangeContaining(ranges, next)
      ) {
        closingEnd = next + length;
        break;
      }
      closing = next + 1;
    }

    ranges.push({
      start: cursor,
      end: closingEnd === -1 ? source.length : closingEnd,
    });
    cursor = closingEnd === -1 ? source.length : closingEnd;
  }
};

const findTagEnd = (source: string, start: number): number => {
  let quote: '"' | "'" | undefined;
  for (let cursor = start + 1; cursor < source.length; cursor++) {
    const character = source[cursor];
    if (quote) {
      if (character === quote) quote = undefined;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return cursor + 1;
    }
  }
  return source.length;
};

const addRawHtmlRanges = (source: string, ranges: ProtectedRange[]): void => {
  const verbatimTags = new Set([
    'code',
    'pre',
    'script',
    'style',
    'textarea',
    'xmp',
  ]);

  for (let cursor = 0; cursor < source.length; cursor++) {
    if (
      source[cursor] !== '<' ||
      isEscaped(source, cursor) ||
      rangeContaining(ranges, cursor)
    ) {
      continue;
    }

    if (source.startsWith('<!--', cursor)) {
      const commentEnd = source.indexOf('-->', cursor + 4);
      ranges.push({
        start: cursor,
        end: commentEnd === -1 ? source.length : commentEnd + 3,
      });
      continue;
    }

    if (source.startsWith('<![CDATA[', cursor)) {
      const cdataEnd = source.indexOf(']]>', cursor + 9);
      ranges.push({
        start: cursor,
        end: cdataEnd === -1 ? source.length : cdataEnd + 3,
      });
      continue;
    }

    if (source.startsWith('<?', cursor)) {
      const processingEnd = source.indexOf('?>', cursor + 2);
      ranges.push({
        start: cursor,
        end: processingEnd === -1 ? source.length : processingEnd + 2,
      });
      continue;
    }

    const tag = source
      .slice(cursor)
      .match(/^<\/?([A-Za-z][A-Za-z0-9-]*)(?=[\s/>])/);
    const tagEnd = findTagEnd(source, cursor);
    if (tag) {
      const tagName = tag[1].toLowerCase();
      const tagText = source.slice(cursor, tagEnd);
      ranges.push({ start: cursor, end: tagEnd });

      const isClosing = /^<\//.test(tagText);
      const isSelfClosing = /\/\s*>$/.test(tagText);
      if (!isClosing && !isSelfClosing && verbatimTags.has(tagName)) {
        const closingTag = new RegExp(
          `<\\/\\s*${escapeRegExp(tagName)}\\s*>`,
          'i',
        ).exec(source.slice(tagEnd));
        ranges.push({
          start: cursor,
          end:
            closingTag === null
              ? source.length
              : tagEnd + closingTag.index + closingTag[0].length,
        });
      }
      cursor = tagEnd - 1;
      continue;
    }

    const autolinkEnd = source.indexOf('>', cursor + 1);
    if (autolinkEnd !== -1) {
      const autolink = source.slice(cursor + 1, autolinkEnd);
      if (/^(?:[A-Za-z][A-Za-z0-9+.-]*:|[^ <>@]+@[^ <>@]+$)/.test(autolink)) {
        ranges.push({ start: cursor, end: autolinkEnd + 1 });
        cursor = autolinkEnd;
      }
    }
  }
};

const findMatchingBracket = (
  source: string,
  start: number,
  ranges: ProtectedRange[],
): number => {
  let depth = 0;
  for (let cursor = start; cursor < source.length; cursor++) {
    const protectedRange = rangeContaining(ranges, cursor);
    if (protectedRange) {
      cursor = protectedRange.end - 1;
      continue;
    }
    if (isEscaped(source, cursor)) continue;

    if (source[cursor] === '[') depth++;
    if (source[cursor] === ']') {
      depth--;
      if (depth === 0) return cursor;
    }
  }
  return -1;
};

const findParenthesizedLinkEnd = (source: string, start: number): number => {
  let depth = 1;
  let quote: '"' | "'" | undefined;
  let inAngleDestination = false;

  for (let cursor = start + 1; cursor < source.length; cursor++) {
    const character = source[cursor];
    if (isEscaped(source, cursor)) continue;

    if (quote) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (inAngleDestination) {
      if (character === '>') inAngleDestination = false;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '<') {
      inAngleDestination = true;
    } else if (character === '(') {
      depth++;
    } else if (character === ')') {
      depth--;
      if (depth === 0) return cursor + 1;
    }
  }

  return source.length;
};

const BARE_AUTOLINK_PREFIX = /(?:[Hh]ttps?:\/\/|[Ff]tp:\/\/|[Ww]ww\.)/g;
const BARE_URL_TRAILING_PUNCTUATION = new Set([
  '.',
  ',',
  ':',
  '!',
  '?',
  ')',
  '*',
  '_',
  '~',
]);

const isBareUrlWhitespace = (character: string | undefined): boolean =>
  character === ' ' ||
  character === '\t' ||
  character === '\n' ||
  character === '\r';

const addBareAutolinkRanges = (
  source: string,
  ranges: ProtectedRange[],
): void => {
  const addRange = (range: ProtectedRange): void => {
    ranges.push(range);
    ranges.splice(0, ranges.length, ...mergeRanges(ranges));
  };

  for (const match of source.matchAll(BARE_AUTOLINK_PREFIX)) {
    const start = match.index;
    const prefix = match[0];
    if (
      (start > 0 && source[start - 1] === '<') ||
      rangeContaining(ranges, start)
    ) {
      continue;
    }

    const prefixEnd = start + prefix.length;
    let scanEnd = prefixEnd;
    while (
      scanEnd < source.length &&
      !isBareUrlWhitespace(source[scanEnd]) &&
      source[scanEnd] !== '<' &&
      source[scanEnd] !== '>'
    ) {
      scanEnd++;
    }

    let end = scanEnd;
    let openParens = 0;
    let closeParens = 0;
    for (let cursor = start; cursor < scanEnd; cursor++) {
      if (source[cursor] === '(') openParens++;
      if (source[cursor] === ')') closeParens++;
    }

    while (end > prefixEnd) {
      const character = source[end - 1];
      if (BARE_URL_TRAILING_PUNCTUATION.has(character)) {
        if (character === ')') {
          if (openParens >= closeParens) break;
          closeParens--;
        }
        end--;
        continue;
      }
      if (character === ';') {
        let ampersand = end - 2;
        while (ampersand > start && /[A-Za-z0-9]/u.test(source[ampersand])) {
          ampersand--;
        }
        end =
          ampersand >= start && source[ampersand] === '&' ? ampersand : end - 1;
        continue;
      }
      break;
    }

    if (end <= prefixEnd) continue;

    const isWww = prefix.length === 4;
    const domainStart = isWww ? start + 4 : prefixEnd;
    if (isWww && source.indexOf('.', domainStart) === -1) continue;

    let domainEnd = source.indexOf('/', domainStart);
    if (domainEnd === -1 || domainEnd > end) domainEnd = end;
    let lastDot = -1;
    let previousDot = -1;
    for (let cursor = domainEnd - 1; cursor >= domainStart; cursor--) {
      if (source[cursor] !== '.') continue;
      if (lastDot === -1) lastDot = cursor;
      else {
        previousDot = cursor;
        break;
      }
    }
    const segmentStart = previousDot === -1 ? domainStart : previousDot + 1;
    let hasRecentSegmentUnderscore = false;
    for (let cursor = segmentStart; cursor < domainEnd; cursor++) {
      if (source[cursor] === '_') {
        hasRecentSegmentUnderscore = true;
        break;
      }
    }
    if (hasRecentSegmentUnderscore) continue;

    addRange({ start, end });
  }

  const isAsciiAlphaNumeric = (character: string | undefined): boolean =>
    character !== undefined && /[A-Za-z0-9]/u.test(character);
  const isEmailLocalCharacter = (character: string | undefined): boolean =>
    character !== undefined &&
    /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]/u.test(character);

  for (let start = 0; start < source.length; start++) {
    if (rangeContaining(ranges, start) || !isAsciiAlphaNumeric(source[start])) {
      continue;
    }

    let cursor = start;
    while (cursor < source.length && isEmailLocalCharacter(source[cursor])) {
      cursor++;
    }
    if (source[cursor] !== '@') continue;

    cursor++;
    const domainStart = cursor;
    let lastDot = -1;
    let labelStart = cursor;
    while (cursor < source.length) {
      const character = source[cursor];
      if (isAsciiAlphaNumeric(character)) {
        cursor++;
      } else if (
        (character === '-' || character === '_') &&
        cursor > domainStart
      ) {
        cursor++;
      } else if (character === '.') {
        if (cursor === domainStart) break;
        const previous = source[cursor - 1];
        if (previous === '-' || previous === '_') break;
        if (cursor - labelStart > 63) break;
        if (
          cursor + 1 < source.length &&
          isAsciiAlphaNumeric(source[cursor + 1])
        ) {
          lastDot = cursor;
          labelStart = cursor + 1;
          cursor++;
        } else {
          break;
        }
      } else {
        break;
      }
    }

    if (
      cursor - labelStart > 63 ||
      lastDot < 0 ||
      !isAsciiAlphaNumeric(source[cursor - 1]) ||
      cursor <= lastDot + 1
    ) {
      continue;
    }

    const previousDot = source.lastIndexOf('.', lastDot - 1);
    const segmentStart = previousDot < 0 ? domainStart : previousDot + 1;
    let hasRecentSegmentUnderscore = false;
    for (let index = segmentStart; index < cursor; index++) {
      if (source[index] === '_') {
        hasRecentSegmentUnderscore = true;
        break;
      }
    }
    if (hasRecentSegmentUnderscore) continue;

    addRange({ start, end: cursor });
  }
};

const referenceTitleEnd = (
  source: string,
  start: number,
): number | undefined => {
  if (start >= source.length) return undefined;

  const firstLineEnd = lineEnd(source, start);
  const firstLine = withoutCarriageReturn(source.slice(start, firstLineEnd));
  const opening = firstLine.match(/^[ \t]*(["'(])/u);
  if (!opening) return undefined;

  const titleStart = start + opening[0].length - 1;
  const closing = opening[1] === '(' ? ')' : opening[1];
  for (let cursor = titleStart + 1; cursor < source.length; cursor++) {
    const character = source[cursor];
    if (character === '\\') {
      cursor++;
      continue;
    }
    if (character === closing) {
      const currentEnd = lineEnd(source, cursor);
      if (/^[ \t\r]*$/u.test(source.slice(cursor + 1, currentEnd))) {
        return nextLineStart(source, currentEnd);
      }
      return undefined;
    }
    if (character === '\n') {
      const nextEnd = lineEnd(source, cursor + 1);
      if (/^[ \t\r]*$/u.test(source.slice(cursor + 1, nextEnd))) {
        return undefined;
      }
    }
  }

  return undefined;
};

const addLinkDestinationRanges = (
  source: string,
  ranges: ProtectedRange[],
): void => {
  const referenceDefinition = /^[ \t]{0,3}\[[^\]\n]+\]:/;
  const addRange = (range: ProtectedRange): void => {
    ranges.push(range);
    ranges.splice(0, ranges.length, ...mergeRanges(ranges));
  };
  let cursor = 0;

  while (cursor < source.length) {
    const currentEnd = lineEnd(source, cursor);
    const currentLine = withoutCarriageReturn(source.slice(cursor, currentEnd));
    if (referenceDefinition.test(currentLine)) {
      const firstLineEnd = nextLineStart(source, currentEnd);
      addRange({
        start: cursor,
        end: referenceTitleEnd(source, firstLineEnd) ?? firstLineEnd,
      });
    }
    cursor = nextLineStart(source, currentEnd);
  }

  ranges.splice(0, ranges.length, ...mergeRanges(ranges));

  for (cursor = 0; cursor < source.length; cursor++) {
    if (
      source[cursor] !== '[' ||
      isEscaped(source, cursor) ||
      rangeContaining(ranges, cursor)
    ) {
      continue;
    }

    const closingBracket = findMatchingBracket(source, cursor, ranges);
    if (closingBracket === -1) continue;

    const isImage =
      cursor > 0 &&
      source[cursor - 1] === '!' &&
      !isEscaped(source, cursor - 1);
    let suffix = closingBracket + 1;
    while (suffix < source.length && /[ \t\r\n]/u.test(source[suffix]))
      suffix++;

    if (isImage) {
      if (source[suffix] === '(') {
        addRange({
          start: cursor,
          end: findParenthesizedLinkEnd(source, suffix),
        });
      } else if (source[suffix] === '[') {
        const referenceEnd = findMatchingBracket(source, suffix, ranges);
        addRange({
          start: cursor,
          end: referenceEnd === -1 ? source.length : referenceEnd + 1,
        });
      } else {
        addRange({ start: cursor, end: closingBracket + 1 });
      }
      continue;
    }

    if (source[suffix] === '(') {
      addRange({
        start: suffix,
        end: findParenthesizedLinkEnd(source, suffix),
      });
    } else if (source[suffix] === '[') {
      const referenceEnd = findMatchingBracket(source, suffix, ranges);
      if (referenceEnd !== -1) {
        addRange({ start: suffix, end: referenceEnd + 1 });
      }
    }
  }
};

const protectedRangesFor = (source: string): ProtectedRange[] => {
  const ranges: ProtectedRange[] = [];
  addFencedCodeRanges(source, ranges);
  addIndentedCodeRanges(source, ranges);
  ranges.splice(0, ranges.length, ...mergeRanges(ranges));
  addInlineCodeRanges(source, ranges);
  ranges.splice(0, ranges.length, ...mergeRanges(ranges));
  addRawHtmlRanges(source, ranges);
  ranges.splice(0, ranges.length, ...mergeRanges(ranges));
  addLinkDestinationRanges(source, ranges);
  addBareAutolinkRanges(source, ranges);
  return mergeRanges(ranges);
};

const dollarRunLength = (source: string, index: number): number => {
  let start = index;
  while (start > 0 && source[start - 1] === '$') start--;

  let end = index;
  while (end < source.length && source[end] === '$') end++;
  return end - start;
};

const isExactDollarRun = (
  source: string,
  index: number,
  length: number,
): boolean => {
  if (index > 0 && source[index - 1] === '$') return false;
  return dollarRunLength(source, index) === length;
};

const findDollarCandidate = (
  source: string,
  start: number,
  displayMode: boolean,
  ranges: ProtectedRange[],
): FormulaCandidate => {
  const delimiterLength = displayMode ? 2 : 1;
  let cursor = start + delimiterLength;

  while (cursor < source.length) {
    const protectedRange = rangeContaining(ranges, cursor);
    if (protectedRange) {
      cursor = protectedRange.end;
      continue;
    }

    const next = source.indexOf('$', cursor);
    if (next === -1) break;
    const nextRange = rangeContaining(ranges, next);
    if (nextRange) {
      cursor = nextRange.end;
      continue;
    }
    if (isEscaped(source, next)) {
      cursor = next + 1;
      continue;
    }

    if (
      !isExactDollarRun(source, next, delimiterLength) ||
      (displayMode && source[next + 1] !== '$')
    ) {
      cursor = next + 1;
      continue;
    }

    const end = next + delimiterLength;
    if (rangeIntersects(ranges, start, end)) {
      cursor = end;
      continue;
    }

    const body = source.slice(start + delimiterLength, next);
    const invalid = displayMode
      ? body.trim().length === 0 || /\d/u.test(source[end] ?? '')
      : body.length === 0 ||
        isWhitespace(body[0]) ||
        isWhitespace(body[body.length - 1]) ||
        body.includes('\n') ||
        body.includes('\r') ||
        /\d/u.test(source[end] ?? '');

    if (invalid) return { status: 'invalid', end: next };

    return { status: 'valid', end, displayMode, body };
  }

  return {
    status: 'incomplete',
    end: displayMode ? source.length : lineEnd(source, start),
  };
};

const findNextFormulaOpening = (
  source: string,
  start: number,
  end: number,
  ranges: ProtectedRange[],
): number => {
  for (let cursor = start; cursor < end; cursor++) {
    const protectedRange = rangeContaining(ranges, cursor);
    if (protectedRange) {
      cursor = protectedRange.end - 1;
      continue;
    }
    if (
      source[cursor] === '\\' &&
      !isEscaped(source, cursor) &&
      (source.startsWith('\\(', cursor) || source.startsWith('\\[', cursor))
    ) {
      return cursor;
    }
  }
  return -1;
};

const findBackslashCandidate = (
  source: string,
  start: number,
  displayMode: boolean,
  ranges: ProtectedRange[],
): FormulaCandidate => {
  const closingCharacter = displayMode ? ']' : ')';
  let cursor = start + 2;

  while (cursor < source.length) {
    const protectedRange = rangeContaining(ranges, cursor);
    if (protectedRange) {
      cursor = protectedRange.end;
      continue;
    }

    const next = source.indexOf(`\\${closingCharacter}`, cursor);
    if (next === -1) break;
    const nextRange = rangeContaining(ranges, next);
    if (nextRange) {
      cursor = nextRange.end;
      continue;
    }
    if (isEscaped(source, next)) {
      cursor = next + 1;
      continue;
    }

    const nestedOpening = findNextFormulaOpening(source, cursor, next, ranges);
    if (nestedOpening !== -1) {
      return { status: 'invalid', end: nestedOpening };
    }

    const end = next + 2;
    if (rangeIntersects(ranges, start, end)) {
      cursor = end;
      continue;
    }

    const body = source.slice(start + 2, next);
    const invalid =
      body.trim().length === 0 || (!displayMode && /[\r\n]/u.test(body));
    if (invalid) return { status: 'invalid', end };

    return { status: 'valid', end, displayMode, body };
  }

  return {
    status: 'incomplete',
    end: displayMode ? source.length : lineEnd(source, start),
  };
};

const renderSafeKatex = (
  expression: string,
  displayMode: boolean,
): string | null => {
  if (TRUST_REQUIRING_COMMAND.test(expression)) return null;
  if (MACRO_DEFINITION_COMMAND.test(expression)) return null;

  try {
    const html = katex.renderToString(expression, {
      ...SAFE_KATEX_OPTIONS,
      displayMode,
    });

    // With trust=false, KaTeX represents trust-gated commands as an error
    // node instead of throwing. Keep the source visible rather than showing
    // that error or allowing an extension to introduce a link or image.
    if (html.includes('#cc0000') || /<(?:a|img|script|iframe)\b/i.test(html)) {
      return null;
    }

    return html;
  } catch {
    return null;
  }
};

const hashSource = (source: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const createTokenFactory = (source: string) => {
  let prefix = `\uE000YAAWC_FORMULA_${hashSource(source)}_`;
  while (source.includes(prefix)) prefix += 'x';
  let index = 0;

  return () => `${prefix}${index++}\uE001`;
};

export function prepareFormulaMarkdown(
  source: string,
): PreparedFormulaMarkdown {
  if (!source) return { text: source, tokens: {} };

  const ranges = protectedRangesFor(source);
  const createToken = createTokenFactory(source);
  const tokens: Record<string, FormulaTokenValue> = {};
  let text = '';
  let rangeIndex = 0;

  const addToken = (value: FormulaTokenValue): string => {
    const token = createToken();
    tokens[token] = value;
    return token;
  };

  const appendLiteral = (literal: string): void => {
    text += addToken({ type: 'literal', source: literal });
  };

  const appendCandidate = (
    candidate: Extract<FormulaCandidate, { status: 'valid' }>,
    original: string,
  ): void => {
    const html = renderSafeKatex(candidate.body, candidate.displayMode);
    text +=
      html === null
        ? addToken({ type: 'literal', source: original })
        : addToken({
            type: 'formula',
            displayMode: candidate.displayMode,
            source: original,
            html,
          });
  };

  for (let cursor = 0; cursor < source.length;) {
    while (rangeIndex < ranges.length && ranges[rangeIndex].end <= cursor) {
      rangeIndex++;
    }
    const protectedRange = ranges[rangeIndex];
    if (protectedRange && protectedRange.start <= cursor) {
      text += source.slice(cursor, protectedRange.end);
      cursor = protectedRange.end;
      continue;
    }

    const character = source[cursor];
    if (character === '$' && !isEscaped(source, cursor)) {
      const runLength = dollarRunLength(source, cursor);
      if (runLength === 2 && isExactDollarRun(source, cursor, 2)) {
        const candidate = findDollarCandidate(source, cursor, true, ranges);
        if (
          candidate.status === 'valid' &&
          !rangeIntersects(ranges, cursor, candidate.end)
        ) {
          appendCandidate(candidate, source.slice(cursor, candidate.end));
          cursor = candidate.end;
          continue;
        }

        // A rejected dollar opener may be ordinary currency followed much
        // later by another dollar amount. Preserve only the opener so Markdown
        // structure between the two amounts still reaches markdown-to-jsx.
        text += '$$';
        cursor += 2;
        continue;
      }

      if (runLength === 1 && isExactDollarRun(source, cursor, 1)) {
        const candidate = findDollarCandidate(source, cursor, false, ranges);
        if (
          candidate.status === 'valid' &&
          !rangeIntersects(ranges, cursor, candidate.end)
        ) {
          appendCandidate(candidate, source.slice(cursor, candidate.end));
          cursor = candidate.end;
          continue;
        }

        text += '$';
        cursor++;
        continue;
      }
    }

    if (
      character === '\\' &&
      !isEscaped(source, cursor) &&
      (source.startsWith('\\(', cursor) || source.startsWith('\\[', cursor))
    ) {
      const displayMode = source[cursor + 1] === '[';
      const candidate = findBackslashCandidate(
        source,
        cursor,
        displayMode,
        ranges,
      );
      if (
        candidate.status === 'valid' &&
        !rangeIntersects(ranges, cursor, candidate.end)
      ) {
        appendCandidate(candidate, source.slice(cursor, candidate.end));
        cursor = candidate.end;
        continue;
      }

      // Backslash delimiters are Markdown escapes, so preserve the rejected
      // opener as a token but leave its body available to the Markdown parser.
      appendLiteral(source.slice(cursor, cursor + 2));
      cursor += 2;
      continue;
    }

    if (
      character === '\\' &&
      !isEscaped(source, cursor) &&
      (source.startsWith('\\)', cursor) || source.startsWith('\\]', cursor))
    ) {
      appendLiteral(source.slice(cursor, cursor + 2));
      cursor += 2;
      continue;
    }

    text += character;
    cursor++;
  }

  return { text, tokens };
}

export const scanFormulaMarkdown = prepareFormulaMarkdown;
