import { getBraveLLMApiKey, getSearchLocale } from '@/lib/config';
import { SearchProvider, SearchResult, WebSearchOpts } from './types';

const BRAVE_LLM_ENDPOINT = 'https://api.search.brave.com/res/v1/llm/context';

interface LLMGenericEntry {
  url?: string;
  title?: string;
  snippets?: string[];
}

export const braveLLMProvider: SearchProvider = {
  id: 'brave_llm',
  displayName: 'Brave LLM Context',
  capabilities: {
    web: true,
    images: false,
    videos: false,
    autocomplete: false,
  },
  async webSearch(query: string, opts?: WebSearchOpts, signal?: AbortSignal) {
    const apiKey = getBraveLLMApiKey();
    if (!apiKey) throw new Error('Brave LLM API key not configured');

    const locale = getSearchLocale();
    const language = opts?.language ?? locale.language;
    const region = opts?.region ?? locale.region;

    const url = new URL(BRAVE_LLM_ENDPOINT);
    url.searchParams.append('q', query);
    if (language)
      url.searchParams.append('search_lang', language.toLowerCase());
    if (region) url.searchParams.append('country', region.toUpperCase());

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
    if (!res.ok) throw new Error(`Brave LLM returned HTTP ${res.status}`);

    const data = await res.json();

    const results: SearchResult[] = [];

    const generic = (data.grounding?.generic || []) as LLMGenericEntry[];
    for (const entry of generic) {
      if (!entry.url) continue;
      results.push({
        title: entry.title || '',
        url: entry.url,
        content: entry.snippets?.join('\n'),
      });
    }

    return {
      results,
      searchUrl: `https://search.brave.com/search?q=${encodeURIComponent(query)}`,
    };
  },
};
