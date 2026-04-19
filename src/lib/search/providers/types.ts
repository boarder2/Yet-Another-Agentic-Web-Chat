export type SearchProviderId =
  | 'searxng'
  | 'brave_search'
  | 'brave_llm'
  | 'mojeek';

export type SearchCapability = 'web' | 'images' | 'videos' | 'autocomplete';

export interface SearchCapabilities {
  web: boolean;
  images: boolean;
  videos: boolean;
  autocomplete: boolean;
}

export interface SearchResult {
  title: string;
  url: string;
  content?: string;
  img_src?: string;
  thumbnail_src?: string;
  thumbnail?: string;
  iframe_src?: string;
  author?: string;
}

export interface SearchResponse {
  results: SearchResult[];
  suggestions?: string[];
  searchUrl?: string;
}

export interface WebSearchOpts {
  language?: string;
  region?: string;
  pageno?: number;
}

export interface ImageSearchOpts {
  language?: string;
  region?: string;
}

export interface VideoSearchOpts {
  language?: string;
  region?: string;
}

export interface SearchProvider {
  id: SearchProviderId;
  displayName: string;
  capabilities: SearchCapabilities;
  webSearch(
    query: string,
    opts?: WebSearchOpts,
    signal?: AbortSignal,
  ): Promise<SearchResponse>;
  imageSearch?(
    query: string,
    opts?: ImageSearchOpts,
    signal?: AbortSignal,
  ): Promise<SearchResponse>;
  videoSearch?(
    query: string,
    opts?: VideoSearchOpts,
    signal?: AbortSignal,
  ): Promise<SearchResponse>;
  autocomplete?(query: string, signal?: AbortSignal): Promise<string[]>;
}

export const ALL_PROVIDER_IDS: SearchProviderId[] = [
  'searxng',
  'brave_search',
  'brave_llm',
  'mojeek',
];

export const PROVIDER_DISPLAY_NAMES: Record<SearchProviderId, string> = {
  searxng: 'SearXNG',
  brave_search: 'Brave Search',
  brave_llm: 'Brave LLM Context',
  mojeek: 'Mojeek',
};
