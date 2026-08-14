export const CAPABILITY_DOCS_ROUTE = '/docs/capabilities';

/** Files currently shipped as the authoritative capability corpus. */
export const CAPABILITY_DOC_FILENAMES = [
  'README.md',
  'administration-and-settings.md',
  'agent-capabilities.md',
  'artifacts-and-dashboards.md',
  'automation.md',
  'chat-and-research.md',
  'files-and-workspaces.md',
  'models-and-providers.md',
  'personalization-and-memory.md',
  'privacy-and-data.md',
] as const;

export const CAPABILITY_DOC_MAX_QUERY_LENGTH = 500;
export const CAPABILITY_DOC_MAX_PAGE_LENGTH = 200_000;
export const CAPABILITY_DOC_MAX_RESULTS = 8;
export const CAPABILITY_DOC_MAX_CONTENT_LENGTH = 6_000;

export type CapabilityDocFilename = (typeof CAPABILITY_DOC_FILENAMES)[number];

export interface CapabilitySection {
  pageSlug: string;
  pageTitle: string;
  heading: string;
  anchor: string;
  level: number;
  /** One-based line numbers in the source Markdown. */
  startLine: number;
  endLine: number;
  /** The heading and its section body, bounded when returned by search. */
  content: string;
  /** The section body without its heading, also bounded with `content`. */
  body: string;
}

export interface CapabilityPage {
  /** `README` is the index page and maps to `/docs/capabilities`. */
  slug: string;
  filename: string;
  title: string;
  markdown: string;
  sections: CapabilitySection[];
}

export interface CapabilitySearchHit {
  section: CapabilitySection;
  score: number;
  matchedTerms: string[];
}

export type CapabilityFailureKind = 'no_match' | 'unavailable' | 'invalid';

export interface CapabilityFailure {
  ok: false;
  kind: CapabilityFailureKind;
  message: string;
}

export interface CapabilitySuccess<T> {
  ok: true;
  value: T;
}

export type CapabilityResult<T> = CapabilitySuccess<T> | CapabilityFailure;

/**
 * A filesystem adapter. Implementations deal in corpus-relative filenames only;
 * callers never provide a path to the adapter.
 */
export interface CapabilityDocsLoader {
  listFiles(): readonly string[] | Promise<readonly string[]>;
  readFile(filename: string): string | Promise<string>;
}

export interface CapabilitySearchOptions {
  maxResults?: number;
  maxContentChars?: number;
  pageSlug?: string;
  sectionAnchor?: string;
}

export interface CapabilityPageUrlOptions {
  anchor?: string;
}

const README_SLUG = 'README';

function isIndexSlug(slug: string): boolean {
  return slug.toLocaleLowerCase() === 'readme';
}

/** Anchors address a catalogued heading; they never carry a path or fragment. */
export function isValidSectionAnchor(anchor: unknown): anchor is string {
  return (
    typeof anchor === 'string' &&
    anchor.length > 0 &&
    anchor.length <= 200 &&
    !anchor.includes('/') &&
    !anchor.includes('\\') &&
    !anchor.includes('..') &&
    !anchor.includes('#')
  );
}

export function isExternalHref(href: string): boolean {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href);
}

/** The single place the `README`-is-the-index rule turns into a route. */
export function capabilityPageUrl(
  pageOrSlug: Pick<CapabilityPage, 'slug'> | string,
  options: CapabilityPageUrlOptions = {},
): string {
  const slug = typeof pageOrSlug === 'string' ? pageOrSlug : pageOrSlug.slug;
  const base = isIndexSlug(slug)
    ? CAPABILITY_DOCS_ROUTE
    : `${CAPABILITY_DOCS_ROUTE}/${encodeURIComponent(slug)}`;
  return options.anchor
    ? `${base}#${encodeURIComponent(options.anchor)}`
    : base;
}

/** Inverse of `capabilityPageUrl`; unknown paths fall back to the index. */
export function capabilitySlugFromPathname(pathname: string | null): string {
  const prefix = `${CAPABILITY_DOCS_ROUTE}/`;
  if (!pathname?.startsWith(prefix)) return README_SLUG;
  const segment = pathname.slice(prefix.length).split('/')[0];
  try {
    return decodeURIComponent(segment) || README_SLUG;
  } catch {
    return README_SLUG;
  }
}
