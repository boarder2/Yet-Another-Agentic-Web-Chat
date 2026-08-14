import {
  CAPABILITY_DOC_MAX_CONTENT_LENGTH,
  CAPABILITY_DOC_MAX_QUERY_LENGTH,
  CapabilityPage,
  CapabilitySearchHit,
  CapabilitySearchOptions,
  CapabilitySection,
} from './types';

const SEARCH_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'can',
  'do',
  'does',
  'for',
  'how',
  'i',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'the',
  'to',
  'what',
  'when',
  'where',
  'which',
  'with',
  'you',
]);

const normalizeWhitespace = (value: string): string =>
  value.replace(/\s+/g, ' ').trim();

const stripHeadingMarkup = (value: string): string =>
  normalizeWhitespace(
    value
      .replace(/[`*_~]/g, '')
      .replace(/<[^>]*>/g, '')
      .replace(/[ \t]+#+[ \t]*$/, ''),
  );

/** Convert a Markdown heading into the stable anchor used by the docs UI. */
export function createHeadingAnchor(heading: string): string {
  const normalized = stripHeadingMarkup(heading)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
  return normalized || 'section';
}

/** Alias kept explicit for callers that work with anchors rather than headings. */
export const createCapabilityAnchor = createHeadingAnchor;

function isFenceLine(line: string): { char: '`' | '~'; length: number } | null {
  const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
  if (!match) return null;
  return { char: match[1][0] as '`' | '~', length: match[1].length };
}

interface ParsedHeading {
  level: number;
  text: string;
  anchor: string;
  lineIndex: number;
}

function parseHeadings(markdown: string): ParsedHeading[] {
  const headings: ParsedHeading[] = [];
  const usedAnchors = new Map<string, number>();
  const lines = markdown.split(/\r?\n/);
  let fence: { char: '`' | '~'; length: number } | null = null;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const marker = isFenceLine(line);
    if (marker) {
      if (!fence) {
        fence = marker;
        continue;
      }
      if (marker.char === fence.char && marker.length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fence) continue;

    const match = /^(#{1,6})[ \t]+(.+?)[ \t]*$/.exec(line);
    if (!match) continue;

    const text = stripHeadingMarkup(match[2]);
    const baseAnchor = createHeadingAnchor(text);
    const occurrence = usedAnchors.get(baseAnchor) ?? 0;
    usedAnchors.set(baseAnchor, occurrence + 1);
    headings.push({
      level: match[1].length,
      text,
      anchor: occurrence === 0 ? baseAnchor : `${baseAnchor}-${occurrence}`,
      lineIndex,
    });
  }

  return headings;
}

function boundedText(value: string, maxLength: number): string {
  const limit = Math.max(
    1,
    Math.min(maxLength, CAPABILITY_DOC_MAX_CONTENT_LENGTH),
  );
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

/**
 * Parse one corpus page. The parser is deliberately Markdown-only: headings in
 * fenced examples are ignored, and each heading owns its nested subsections
 * until the next heading at the same or higher level.
 */
export function parseCapabilityMarkdown(
  markdown: string,
  page:
    | string
    | {
        slug?: string;
        filename?: string;
        title?: string;
      } = {},
): CapabilityPage {
  const options = typeof page === 'string' ? { slug: page } : page;
  const slug = options.slug || options.filename?.replace(/\.md$/i, '') || '';
  const lines = markdown.split(/\r?\n/);
  const headings = parseHeadings(markdown);
  const firstTitle = headings.find((heading) => heading.level === 1)?.text;
  const title = options.title || firstTitle || slug || 'YAAWC capabilities';
  const sections: CapabilitySection[] = [];

  headings.forEach((heading, index) => {
    let endIndex = lines.length;
    for (let next = index + 1; next < headings.length; next += 1) {
      if (headings[next].level <= heading.level) {
        endIndex = headings[next].lineIndex;
        break;
      }
    }

    const sectionLines = lines.slice(heading.lineIndex, endIndex);
    const content = sectionLines.join('\n').trim();
    const body = lines
      .slice(heading.lineIndex + 1, endIndex)
      .join('\n')
      .trim();
    sections.push({
      pageSlug: slug,
      pageTitle: title,
      heading: heading.text,
      anchor: heading.anchor,
      level: heading.level,
      startLine: heading.lineIndex + 1,
      endLine: Math.max(heading.lineIndex + 1, endIndex),
      content,
      body,
    });
  });

  return {
    slug,
    filename: options.filename || (slug ? `${slug}.md` : 'README.md'),
    title,
    markdown,
    sections,
  };
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function queryTerms(query: string): string[] {
  return [
    ...new Set(
      normalizeSearchText(query)
        .split(/[\s-]+/)
        .filter((term) => term.length > 1 && !SEARCH_STOP_WORDS.has(term)),
    ),
  ];
}

/**
 * Rank already-parsed sections without touching the filesystem, network, or an
 * embedding model. Empty queries intentionally return the corpus in source
 * order, which gives broad overview requests a predictable result.
 */
export function searchCapabilitySections(
  sections: readonly CapabilitySection[],
  query: string,
  options: CapabilitySearchOptions = {},
): CapabilitySearchHit[] {
  if (
    typeof query !== 'string' ||
    query.length > CAPABILITY_DOC_MAX_QUERY_LENGTH
  ) {
    return [];
  }

  const requestedMaxResults =
    typeof options.maxResults === 'number' &&
    Number.isFinite(options.maxResults)
      ? options.maxResults
      : 5;
  const maxResults = Math.max(1, Math.min(requestedMaxResults, 8));
  const requestedContentChars =
    typeof options.maxContentChars === 'number' &&
    Number.isFinite(options.maxContentChars)
      ? options.maxContentChars
      : CAPABILITY_DOC_MAX_CONTENT_LENGTH;
  const maxContentChars = Math.max(
    1,
    Math.min(requestedContentChars, CAPABILITY_DOC_MAX_CONTENT_LENGTH),
  );
  const normalizedQuery = normalizeSearchText(query);
  const terms = queryTerms(query);

  if (!normalizedQuery || terms.length === 0) {
    return sections.slice(0, maxResults).map((section, index) => ({
      section: {
        ...section,
        content: boundedText(section.content, maxContentChars),
        body: boundedText(section.body, maxContentChars),
      },
      score: 1 - index / 10_000,
      matchedTerms: [],
    }));
  }

  const phrase = normalizedQuery;
  return sections
    .map((section, index) => {
      const heading = normalizeSearchText(section.heading);
      const pageTitle = normalizeSearchText(section.pageTitle);
      const body = normalizeSearchText(section.body);
      const fullText = normalizeSearchText(section.content);
      const matchedTerms = terms.filter(
        (term) =>
          heading.includes(term) ||
          pageTitle.includes(term) ||
          body.includes(term),
      );
      if (matchedTerms.length === 0) return null;

      let score = 0;
      if (heading.includes(phrase)) score += 60;
      if (pageTitle.includes(phrase)) score += 12;
      if (fullText.includes(phrase)) score += 5;
      for (const term of matchedTerms) {
        if (heading.includes(term)) score += 12;
        if (pageTitle.includes(term)) score += 4;
        if (body.includes(term)) score += 2;
      }
      // Preserve source order for otherwise equivalent duplicate headings while
      // still making the ordering observable and deterministic.
      score += (sections.length - index) / 10_000;

      return {
        section: {
          ...section,
          content: boundedText(section.content, maxContentChars),
          body: boundedText(section.body, maxContentChars),
        },
        score,
        matchedTerms,
      };
    })
    .filter((hit): hit is CapabilitySearchHit => hit !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

/** Find an exact, already-catalogued section without interpreting a path. */
export function getSectionByAnchor(
  page: CapabilityPage,
  anchor: string,
): CapabilitySection | null {
  if (
    typeof anchor !== 'string' ||
    anchor.length === 0 ||
    anchor.length > 200 ||
    anchor.includes('/') ||
    anchor.includes('\\') ||
    anchor.includes('..') ||
    anchor.includes('#')
  ) {
    return null;
  }
  let decoded = anchor;
  try {
    decoded = decodeURIComponent(anchor);
  } catch {
    return null;
  }
  return page.sections.find((section) => section.anchor === decoded) ?? null;
}

export const findCapabilitySection = getSectionByAnchor;
