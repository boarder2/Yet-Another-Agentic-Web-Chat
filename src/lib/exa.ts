import Exa from 'exa-js';
import { getExaApiKey } from './config';

export type ExaSearchType =
  | 'auto'
  | 'neural'
  | 'fast'
  | 'deep-lite'
  | 'deep'
  | 'deep-reasoning'
  | 'instant';

export type ExaCategory =
  | 'company'
  | 'research paper'
  | 'news'
  | 'pdf'
  | 'personal site'
  | 'financial report'
  | 'people';

export interface ExaSearchOptions {
  type?: ExaSearchType;
  numResults?: number;
  category?: ExaCategory;
  includeDomains?: string[];
  excludeDomains?: string[];
  includeText?: string[];
  excludeText?: string[];
  startPublishedDate?: string;
  endPublishedDate?: string;
  userLocation?: string;
}

export interface ExaSearchResult {
  title: string;
  url: string;
  content?: string;
  publishedDate?: string;
  author?: string;
  score?: number;
  image?: string;
  favicon?: string;
  highlights?: string[];
  summary?: string;
  id?: string;
}

export interface ExaSearchResponse {
  results: ExaSearchResult[];
  searchUrl: string;
  requestId?: string;
  searchType?: string;
}

const INTEGRATION_NAME = 'yet-another-agentic-web-chat';

/**
 * Client cache so we only construct an Exa instance once per API key.
 * The SDK reads EXA_API_KEY from the env by default; we still pass the
 * resolved key explicitly so it also works when the key lives in config.toml.
 */
let cachedClient: { key: string; client: Exa } | null = null;

const getClient = (): Exa => {
  const apiKey = getExaApiKey();
  if (!apiKey) {
    throw new Error(
      'Exa API key is not configured. Set EXA_API_KEY or API_KEYS.EXA.API_KEY in config.toml.',
    );
  }
  if (cachedClient && cachedClient.key === apiKey) {
    return cachedClient.client;
  }
  const client = new Exa(apiKey);
  // Attribute API usage to this integration for Exa-side analytics. The SDK
  // exposes a fetch Headers instance on the client; silently skip if the shape
  // changes in a future SDK release so a rename never breaks search.
  const headers = (
    client as unknown as { headers?: { set?: (k: string, v: string) => void } }
  ).headers;
  if (headers && typeof headers.set === 'function') {
    headers.set('x-exa-integration', INTEGRATION_NAME);
  }
  cachedClient = { key: apiKey, client };
  return client;
};

/**
 * Build the canonical `https://exa.ai/search?q=...` URL used for "view on Exa"
 * style links in the UI. Mirrors the `searchUrl` field on searxng results.
 */
const buildSearchUrl = (query: string): string => {
  const url = new URL('https://exa.ai/search');
  url.searchParams.set('q', query);
  return url.toString();
};

/**
 * Execute an Exa search and return results normalized for this codebase. Each
 * result's `content` is derived by cascading through highlights → summary →
 * text, so downstream callers don't need to know which content types were
 * requested.
 */
export const searchExa = async (
  query: string,
  opts: ExaSearchOptions = {},
  signal?: AbortSignal,
): Promise<ExaSearchResponse> => {
  const client = getClient();

  const {
    type = 'auto',
    numResults = 10,
    category,
    includeDomains,
    excludeDomains,
    includeText,
    excludeText,
    startPublishedDate,
    endPublishedDate,
    userLocation,
  } = opts;

  console.log('[searchExa] Searching:', query, { type, numResults, category });

  // Request highlights + a bounded text blob so we can build snippets without
  // pulling full page bodies by default. Callers that want the full article
  // should use the url_summarization tool on the returned URLs.
  const searchParams: Record<string, unknown> = {
    type,
    numResults,
    contents: {
      highlights: { numSentences: 3, highlightsPerUrl: 2 },
      text: { maxCharacters: 1000 },
    },
  };

  if (category) searchParams.category = category;
  if (includeDomains?.length) searchParams.includeDomains = includeDomains;
  if (excludeDomains?.length) searchParams.excludeDomains = excludeDomains;
  if (includeText?.length) searchParams.includeText = includeText;
  if (excludeText?.length) searchParams.excludeText = excludeText;
  if (startPublishedDate) searchParams.startPublishedDate = startPublishedDate;
  if (endPublishedDate) searchParams.endPublishedDate = endPublishedDate;
  if (userLocation) searchParams.userLocation = userLocation;

  const abortPromise = new Promise<never>((_resolve, reject) => {
    if (!signal) return;
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    signal.addEventListener(
      'abort',
      () => reject(new DOMException('Aborted', 'AbortError')),
      { once: true },
    );
  });

  // The SDK's return shape is inferred from the options object at call time; we
  // build options dynamically, so accept an untyped raw response and read the
  // content fields defensively.
  interface RawExaResult {
    title?: string | null;
    url: string;
    publishedDate?: string | null;
    author?: string | null;
    score?: number;
    image?: string;
    favicon?: string;
    id?: string;
    text?: string;
    highlights?: string[];
    summary?: string;
  }
  interface RawExaResponse {
    results?: RawExaResult[];
    requestId?: string;
    searchType?: string;
  }

  const searchPromise = client.searchAndContents(
    query,
    searchParams,
  ) as unknown as Promise<RawExaResponse>;

  const response: RawExaResponse = signal
    ? await Promise.race([searchPromise, abortPromise])
    : await searchPromise;

  const results: ExaSearchResult[] = (response.results || []).map((r) => {
    const highlights = Array.isArray(r.highlights) ? r.highlights : undefined;
    const summary = typeof r.summary === 'string' ? r.summary : undefined;
    const text = typeof r.text === 'string' ? r.text : undefined;

    // Cascade: prefer highlights (concise, query-relevant) → summary → text.
    let content: string | undefined;
    if (highlights && highlights.length > 0) {
      content = highlights.join(' … ');
    } else if (summary) {
      content = summary;
    } else if (text) {
      content = text.length > 1000 ? text.slice(0, 1000) : text;
    }

    return {
      title: r.title ?? '',
      url: r.url,
      content,
      publishedDate: r.publishedDate ?? undefined,
      author: r.author ?? undefined,
      score: typeof r.score === 'number' ? r.score : undefined,
      image: r.image ?? undefined,
      favicon: r.favicon,
      highlights,
      summary,
      id: r.id,
    };
  });

  console.log(
    `[searchExa] Search for "${query}" returned ${results.length} results`,
  );

  return {
    results,
    searchUrl: buildSearchUrl(query),
    requestId: response.requestId,
    searchType: response.searchType,
  };
};
