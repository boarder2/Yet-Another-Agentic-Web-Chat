import { searxngProvider } from './search/providers/searxng';

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

/**
 * @deprecated Use providers from @/lib/search/providers instead. Kept only for
 * back-compat with any remaining SearXNG-specific call sites.
 */
export const searchSearxng = async (
  query: string,
  opts?: SearxngSearchOptions,
  signal?: AbortSignal,
): Promise<{
  results: SearxngSearchResult[];
  suggestions: string[];
  searchUrl: string;
}> => {
  // Detect engine hints to route to the right SearXNG capability
  const engines = opts?.engines ?? [];
  const isImages = engines.some((e) => e.toLowerCase().includes('image'));
  const isVideos = engines.some(
    (e) =>
      e.toLowerCase().includes('youtube') || e.toLowerCase().includes('video'),
  );

  const resp = isImages
    ? await searxngProvider.imageSearch!(
        query,
        { language: opts?.language },
        signal,
      )
    : isVideos
      ? await searxngProvider.videoSearch!(
          query,
          { language: opts?.language },
          signal,
        )
      : await searxngProvider.webSearch(
          query,
          { language: opts?.language, pageno: opts?.pageno },
          signal,
        );
  return {
    results: resp.results as SearxngSearchResult[],
    suggestions: resp.suggestions ?? [],
    searchUrl: resp.searchUrl ?? '',
  };
};
