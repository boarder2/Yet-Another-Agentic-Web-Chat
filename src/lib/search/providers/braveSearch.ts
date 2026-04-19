import { getBraveSearchApiKey, getSearchLocale } from '@/lib/config';
import {
  ImageSearchOpts,
  SearchProvider,
  SearchResult,
  VideoSearchOpts,
  WebSearchOpts,
} from './types';

const BRAVE_BASE = 'https://api.search.brave.com/res/v1';

const braveFetch = async (
  path: string,
  params: Record<string, string | undefined>,
  signal?: AbortSignal,
): Promise<Response> => {
  const apiKey = getBraveSearchApiKey();
  if (!apiKey) throw new Error('Brave Search API key not configured');

  const url = new URL(`${BRAVE_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined) url.searchParams.append(k, v);
  });

  const doFetch = () =>
    fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
      signal,
    });

  let res = await doFetch();
  if (res.status === 429) {
    const reset = parseInt(res.headers.get('X-RateLimit-Reset') || '1', 10);
    const waitMs = Math.min(Math.max(reset, 1), 5) * 1000;
    await new Promise((r) => setTimeout(r, waitMs));
    res = await doFetch();
  }
  if (!res.ok) {
    throw new Error(`Brave Search returned HTTP ${res.status}`);
  }
  return res;
};

const resolveLocale = (opts?: { language?: string; region?: string }) => {
  const locale = getSearchLocale();
  const language = (opts?.language ?? locale.language)?.toLowerCase();
  const country = (opts?.region ?? locale.region)?.toUpperCase();
  return {
    search_lang: language || undefined,
    country: country || undefined,
  };
};

const webResultToSearchResult = (r: {
  title?: string;
  url?: string;
  description?: string;
  thumbnail?: { src?: string; original?: string };
}): SearchResult | null => {
  if (!r.url) return null;
  return {
    title: r.title || '',
    url: r.url,
    content: r.description,
    thumbnail: r.thumbnail?.src,
    thumbnail_src: r.thumbnail?.src,
  };
};

export const braveSearchProvider: SearchProvider = {
  id: 'brave_search',
  displayName: 'Brave Search',
  capabilities: {
    web: true,
    images: true,
    videos: true,
    autocomplete: true,
  },
  async webSearch(query: string, opts?: WebSearchOpts, signal?: AbortSignal) {
    const loc = resolveLocale(opts);
    const res = await braveFetch(
      '/web/search',
      {
        q: query,
        search_lang: loc.search_lang,
        country: loc.country,
        offset:
          opts?.pageno && opts.pageno > 1
            ? String((opts.pageno - 1) * 20)
            : undefined,
      },
      signal,
    );
    const data = await res.json();
    const results: SearchResult[] = (data.web?.results || [])
      .map(webResultToSearchResult)
      .filter((r: SearchResult | null): r is SearchResult => r !== null);
    const suggestions: string[] =
      (data.query?.suggested_queries as string[] | undefined) || [];
    return {
      results,
      suggestions,
      searchUrl: `https://search.brave.com/search?q=${encodeURIComponent(query)}`,
    };
  },
  async imageSearch(
    query: string,
    opts?: ImageSearchOpts,
    signal?: AbortSignal,
  ) {
    const loc = resolveLocale(opts);
    const res = await braveFetch(
      '/images/search',
      { q: query, search_lang: loc.search_lang, country: loc.country },
      signal,
    );
    const data = await res.json();
    const results: SearchResult[] = (data.results || [])
      .map(
        (r: {
          title?: string;
          url?: string;
          thumbnail?: { src?: string };
          properties?: { url?: string };
        }) => {
          const img = r.properties?.url || r.thumbnail?.src;
          if (!img || !r.url) return null;
          return {
            title: r.title || '',
            url: r.url,
            img_src: img,
            thumbnail: r.thumbnail?.src,
            thumbnail_src: r.thumbnail?.src,
          } as SearchResult;
        },
      )
      .filter((r: SearchResult | null): r is SearchResult => r !== null);
    return {
      results,
      searchUrl: `https://search.brave.com/images?q=${encodeURIComponent(query)}`,
    };
  },
  async videoSearch(
    query: string,
    opts?: VideoSearchOpts,
    signal?: AbortSignal,
  ) {
    const loc = resolveLocale(opts);
    const res = await braveFetch(
      '/videos/search',
      { q: query, search_lang: loc.search_lang, country: loc.country },
      signal,
    );
    const data = await res.json();
    const results: SearchResult[] = (data.results || [])
      .map(
        (r: {
          title?: string;
          url?: string;
          description?: string;
          thumbnail?: { src?: string };
          video?: { embed_url?: string };
        }) => {
          if (!r.url) return null;
          return {
            title: r.title || '',
            url: r.url,
            content: r.description,
            thumbnail: r.thumbnail?.src,
            thumbnail_src: r.thumbnail?.src,
            iframe_src: r.video?.embed_url,
          } as SearchResult;
        },
      )
      .filter((r: SearchResult | null): r is SearchResult => r !== null);
    return {
      results,
      searchUrl: `https://search.brave.com/videos?q=${encodeURIComponent(query)}`,
    };
  },
  async autocomplete(query: string, signal?: AbortSignal) {
    const res = await braveFetch('/suggest/search', { q: query }, signal);
    const data = await res.json();
    if (Array.isArray(data) && data.length >= 2 && Array.isArray(data[1])) {
      return data[1] as string[];
    }
    const list = (data.results || []) as Array<{ query?: string }>;
    return list.map((r) => r.query || '').filter(Boolean);
  },
};
