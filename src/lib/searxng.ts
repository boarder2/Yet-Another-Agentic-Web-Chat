import { getSearxngApiEndpoint } from './config';

interface SearxngSearchOptions {
  categories?: string[];
  engines?: string[];
  language?: string;
  pageno?: number;
}

interface SearxngSearchResult {
  title: string;
  url: string;
  img_src?: string;
  thumbnail_src?: string;
  thumbnail?: string;
  content?: string;
  author?: string;
  iframe_src?: string;
}

export const searchSearxng = async (
  query: string,
  opts?: SearxngSearchOptions,
  signal?: AbortSignal,
) => {
  const searxngURL = getSearxngApiEndpoint();

  console.log('[searchSearxng] Searching:', query, opts);
  const url = new URL(`${searxngURL}/search?format=json`);
  url.searchParams.append('q', query);

  if (opts) {
    Object.keys(opts).forEach((key) => {
      const value = opts[key as keyof SearxngSearchOptions];
      if (Array.isArray(value)) {
        url.searchParams.append(key, value.join(','));
        return;
      }
      url.searchParams.append(key, value as string);
    });
  }

  const res = await fetch(url.toString(), { signal });

  if (!res.ok) throw new Error(`SearXNG returned HTTP ${res.status}`);

  const data = await res.json();
  const results: SearxngSearchResult[] = data.results;
  const suggestions: string[] = data.suggestions;

  // Create a URL for viewing the search results in the SearXNG web interface
  const searchUrl = new URL(searxngURL);
  searchUrl.pathname = '/search';
  searchUrl.searchParams.append('q', query);
  if (opts?.engines?.length) {
    searchUrl.searchParams.append('engines', opts.engines.join(','));
  }
  if (opts?.language) {
    searchUrl.searchParams.append('language', opts.language);
  }

  console.log(
    `[searchSearxng] Search for "${query}" returned ${results.length} results`,
  );

  return { results, suggestions, searchUrl: searchUrl.toString() };
};
