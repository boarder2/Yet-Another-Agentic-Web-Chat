import { getWorkspace, updateWorkspace } from './service';

export const URL_LIMIT = 20;

export async function checkReachable(
  url: string,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(url, {
      method: 'HEAD',
      signal: ctrl.signal,
      redirect: 'follow',
    });
    clearTimeout(t);
    return { ok: res.ok, status: res.status };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'unreachable' };
  }
}

export async function setUrls(workspaceId: string, urls: string[]) {
  if (urls.length > URL_LIMIT)
    throw new Error(`too many URLs (max ${URL_LIMIT})`);
  for (const u of urls) {
    try {
      new URL(u);
    } catch {
      throw new Error(`invalid URL: ${u}`);
    }
  }
  return updateWorkspace(workspaceId, { sourceUrls: urls });
}

export async function getUrls(workspaceId: string): Promise<string[]> {
  const ws = await getWorkspace(workspaceId);
  return ws?.sourceUrls ?? [];
}
