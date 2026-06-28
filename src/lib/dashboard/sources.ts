import { getWebContent } from '@/lib/utils/documents';
import { Source } from '@/lib/types/widget';

// Shared source fetcher for the LLM widget route, the code-widget runner, and
// Phase 2 sample_source.
//
// DELIBERATE NON-DECISION — NO SSRF GUARD.
// This intentionally does NOT block private/loopback/metadata addresses or
// restrict the scheme, and it follows redirects like a normal fetch. That is a
// conscious choice, not an oversight:
//   - YAAWC is self-hosted and single-user; the operator already has full
//     network access to the host. Source URLs are authored and approved by that
//     same operator and are plainly visible in the widget editor (and in the
//     Phase 2 proposal diff before acceptance). There is no untrusted submitter
//     to defend against in the normal flow.
//   - Supporting internal/LAN/localhost services (e.g. a self-hosted API a user
//     wants a widget for) is a legitimate, desired use case. An IP/scheme guard
//     blocks exactly that with significant added complexity (DNS pre-resolution,
//     connection pinning to defeat rebinding, redirect refusal).
//   - The residual vectors a guard would address are narrow and require the
//     operator's own action: importing a third-party dashboard JSON, or running
//     the Phase 2 assistant with auto-apply on against a poisoned source. Those
//     are accepted under the same owner-reviews-everything trust model used for
//     the sandbox and the output sanitizer.
// If this app ever grows multi-tenant or accepts source URLs from untrusted
// users, reinstate a guard (resolve-and-validate + pinned fetch) here.

export const SOURCE_CONTENT_CAP = 300_000;
export const MAX_SOURCES_PER_WIDGET = 8;

export interface FetchedSource {
  url: string;
  type: Source['type'];
  content: string;
  error?: string;
  ok: boolean;
  truncated: boolean;
}

export interface RawHttpMeta {
  status: number;
  headers: Record<string, string>;
  contentType: string | null;
}

async function fetchHttpData(
  rawUrl: string,
  cap: number,
): Promise<{ content: string; truncated: boolean; meta: RawHttpMeta }> {
  const response = await fetch(rawUrl, {
    signal: AbortSignal.timeout(20_000),
  });
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => (headers[key] = value));
  const meta: RawHttpMeta = {
    status: response.status,
    headers,
    contentType: response.headers.get('content-type'),
  };
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  const truncated = text.length > cap;
  return { content: truncated ? text.slice(0, cap) : text, truncated, meta };
}

// Fetch a single source's content (cap-limited). Web Page uses the headless
// browser path; HTTP Data uses a plain fetch.
export async function fetchSourceContent(
  source: Source,
  cap: number = SOURCE_CONTENT_CAP,
): Promise<FetchedSource> {
  const base = { url: source.url, type: source.type };
  try {
    if (source.type === 'Web Page') {
      const doc = await getWebContent(source.url, cap);
      const content = doc?.pageContent ?? '';
      return {
        ...base,
        content,
        ok: !!content,
        truncated: content.length >= cap,
        error: content ? undefined : `Failed to fetch ${source.url}`,
      };
    }
    const { content, truncated } = await fetchHttpData(source.url, cap);
    return { ...base, content, ok: true, truncated };
  } catch (error) {
    return {
      ...base,
      content: '',
      ok: false,
      truncated: false,
      error: `Error fetching ${source.url}: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    };
  }
}

// Fetch one source plus raw HTTP metadata (Phase 2 sample_source debugging).
export async function fetchSourceWithMeta(
  source: Source,
  cap: number = SOURCE_CONTENT_CAP,
): Promise<FetchedSource & { meta?: RawHttpMeta }> {
  if (source.type !== 'HTTP Data') {
    return fetchSourceContent(source, cap);
  }
  try {
    const { content, truncated, meta } = await fetchHttpData(source.url, cap);
    return {
      url: source.url,
      type: source.type,
      content,
      ok: true,
      truncated,
      meta,
    };
  } catch (error) {
    return {
      url: source.url,
      type: source.type,
      content: '',
      ok: false,
      truncated: false,
      error: `Error fetching ${source.url}: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    };
  }
}
