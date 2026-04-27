import { getSearchLocale, getSearxngApiEndpoint } from '@/lib/config';
import {
  ImageSearchOpts,
  SearchProvider,
  SearchResponse,
  SearchResult,
  VideoSearchOpts,
  WebSearchOpts,
} from './types';

const resolveSearxngLanguage = (opts?: {
  language?: string;
  region?: string;
}): string => {
  const locale = getSearchLocale();
  const lang = opts?.language ?? locale.language;
  const region = opts?.region ?? locale.region;
  if (!lang) return '';
  return region ? `${lang}-${region.toUpperCase()}` : lang;
};

interface RawSearxngOpts {
  categories?: string[];
  engines?: string[];
  language?: string;
  pageno?: number;
}

const callSearxng = async (
  query: string,
  opts: RawSearxngOpts,
  signal?: AbortSignal,
): Promise<SearchResponse> => {
  const searxngURL = getSearxngApiEndpoint();
  if (!searxngURL) {
    throw new Error('SearXNG API URL not configured');
  }

  const url = new URL(`${searxngURL}/search?format=json`);
  url.searchParams.append('q', query);

  Object.entries(opts).forEach(([key, value]) => {
    if (value === undefined) return;
    if (Array.isArray(value)) {
      url.searchParams.append(key, value.join(','));
    } else {
      url.searchParams.append(key, String(value));
    }
  });

  const res = await fetch(url.toString(), { signal });
  if (!res.ok) throw new Error(`SearXNG returned HTTP ${res.status}`);
  const data = await res.json();

  const results: SearchResult[] = (data.results || []).map(
    (r: SearchResult) => r,
  );
  const suggestions: string[] = data.suggestions || [];

  const searchUrl = new URL(searxngURL);
  searchUrl.pathname = '/search';
  searchUrl.searchParams.append('q', query);
  if (opts.engines?.length) {
    searchUrl.searchParams.append('engines', opts.engines.join(','));
  }
  if (opts.language) {
    searchUrl.searchParams.append('language', opts.language);
  }

  return { results, suggestions, searchUrl: searchUrl.toString() };
};

export const searxngProvider: SearchProvider = {
  id: 'searxng',
  displayName: 'SearXNG',
  capabilities: {
    web: true,
    images: true,
    videos: true,
    autocomplete: true,
  },
  async webSearch(query: string, opts?: WebSearchOpts, signal?: AbortSignal) {
    return callSearxng(
      query,
      { language: resolveSearxngLanguage(opts), pageno: opts?.pageno },
      signal,
    );
  },
  async imageSearch(
    query: string,
    opts?: ImageSearchOpts,
    signal?: AbortSignal,
  ) {
    return callSearxng(
      query,
      {
        language: resolveSearxngLanguage(opts),
        engines: ['bing images', 'google images'],
      },
      signal,
    );
  },
  async videoSearch(
    query: string,
    opts?: VideoSearchOpts,
    signal?: AbortSignal,
  ) {
    return callSearxng(
      query,
      { language: resolveSearxngLanguage(opts), engines: ['youtube'] },
      signal,
    );
  },
  async autocomplete(query: string, signal?: AbortSignal) {
    const searxngURL = getSearxngApiEndpoint();
    if (!searxngURL) return [];
    const formatted = searxngURL.replace(/\/+$/, '');
    const res = await fetch(
      `${formatted}/autocompleter?q=${encodeURIComponent(query)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: signal ?? AbortSignal.timeout(3000),
      },
    );
    if (!res.ok) return [];
    const json = await res.json();
    if (Array.isArray(json) && json.length >= 2 && Array.isArray(json[1])) {
      return json[1] as string[];
    }
    return [];
  },
};
