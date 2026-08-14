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
