import { getMojeekApiKey, getSearchLocale } from '@/lib/config';
import { SearchProvider, SearchResult, WebSearchOpts } from './types';

const MOJEEK_ENDPOINT = 'https://api.mojeek.com/search';
const MOJEEK_MIN_INTERVAL_MS = 1000;

let mojeekQueueTail: Promise<void> = Promise.resolve();
let mojeekLastRequestAt = 0;

function scheduleMojeekRequest(signal?: AbortSignal): Promise<void> {
  const slot = mojeekQueueTail.then(async () => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const now = Date.now();
    const wait = Math.max(
      0,
      mojeekLastRequestAt + MOJEEK_MIN_INTERVAL_MS - now,
    );
    if (wait > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }, wait);
        const onAbort = () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        };
        if (signal) signal.addEventListener('abort', onAbort, { once: true });
      });
    }
    mojeekLastRequestAt = Date.now();
  });
  mojeekQueueTail = slot.catch(() => {});
  return slot;
}

export const mojeekProvider: SearchProvider = {
  id: 'mojeek',
  displayName: 'Mojeek',
  capabilities: {
    web: true,
    images: false,
    videos: false,
    autocomplete: false,
  },
  async webSearch(query: string, opts?: WebSearchOpts, signal?: AbortSignal) {
    const apiKey = getMojeekApiKey();
    if (!apiKey) throw new Error('Mojeek API key not configured');

    const locale = getSearchLocale();
    const language = opts?.language ?? locale.language;
    const region = opts?.region ?? locale.region;

    const url = new URL(MOJEEK_ENDPOINT);
    url.searchParams.append('q', query);
    url.searchParams.append('api_key', apiKey);
    url.searchParams.append('fmt', 'json');
    if (language) url.searchParams.append('lb', language.toUpperCase());
    if (region) url.searchParams.append('rb', region.toUpperCase());
    if (opts?.pageno && opts.pageno > 1) {
      url.searchParams.append('s', String((opts.pageno - 1) * 10 + 1));
    }

    await scheduleMojeekRequest(signal);
    const res = await fetch(url.toString(), { signal });
    if (!res.ok) throw new Error(`Mojeek returned HTTP ${res.status}`);
    const data = await res.json();

    const rawResults = (data.response?.results || []) as Array<{
      title?: string;
      url?: string;
      desc?: string;
    }>;
    const results: SearchResult[] = rawResults
      .filter((r) => r.url)
      .map((r) => ({
        title: r.title || '',
        url: r.url!,
        content: r.desc,
      }));

    return {
      results,
      searchUrl: `https://www.mojeek.com/search?q=${encodeURIComponent(query)}`,
    };
  },
};
