/**
 * Pure string transforms for the `<PanelColumns>` markup embedded in an agent
 * panel assistant message. All panel executors live in ONE block whose `data`
 * attribute holds a base64-encoded JSON document, so the renderer can lay the
 * executors out as side-by-side columns regardless of streaming interleave.
 *
 * Shared by the live streaming handler and the reconnect/replay handler in
 * ChatWindow (and by runHost for the persisted copy) so all paths build
 * identical markup. Transforms are idempotent on `started` so seeded/replayed
 * markup is never duplicated.
 */

import { encodeBase64, decodeBase64 } from '@/lib/utils/html';

export type PanelExecutorStatus = 'running' | 'success' | 'error';

export interface PanelExecutorView {
  idx: number;
  model: string;
  status: PanelExecutorStatus;
  responseText: string;
  sourceCount?: number;
  tokens?: number;
  error?: string;
}

interface PanelColumnsData {
  executors: PanelExecutorView[];
}

const BLOCK_RE = /<PanelColumns data="([^"]*)"><\/PanelColumns>/;

/**
 * Total tokens (chat + system) reported for a completed panel executor, or
 * `undefined` when no usage is present. Shared by the live/replay handlers and
 * runHost so every path derives the per-column token badge identically.
 */
export function panelExecutorTokens(usage: unknown): number | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  const u = usage as {
    usageChat?: { total_tokens?: number };
    usageSystem?: { total_tokens?: number };
  };
  return (u.usageChat?.total_tokens ?? 0) + (u.usageSystem?.total_tokens ?? 0);
}

export function emptyPanelColumnsMarkup(): string {
  return `<PanelColumns data="${encodeData({ executors: [] })}"></PanelColumns>`;
}

function encodeData(data: PanelColumnsData): string {
  return encodeBase64(JSON.stringify(data));
}

export function decodePanelColumns(encoded: string): PanelColumnsData {
  if (!encoded) return { executors: [] };
  try {
    const parsed = JSON.parse(decodeBase64(encoded));
    if (parsed && Array.isArray(parsed.executors)) {
      return parsed as PanelColumnsData;
    }
  } catch {
    // fall through
  }
  return { executors: [] };
}

/** Read the panel data from content, mutate it, write it back (appending the
 *  block if it does not yet exist). */
function mutate(content: string, fn: (data: PanelColumnsData) => void): string {
  const match = content.match(BLOCK_RE);
  if (!match) {
    const data: PanelColumnsData = { executors: [] };
    fn(data);
    const block = `<PanelColumns data="${encodeData(data)}"></PanelColumns>\n`;
    return content + block;
  }
  const data = decodePanelColumns(match[1]);
  fn(data);
  return content.replace(
    BLOCK_RE,
    `<PanelColumns data="${encodeData(data)}"></PanelColumns>`,
  );
}

export function applyPanelExecutorStarted(
  content: string,
  idx: number,
  model: string,
): string {
  return mutate(content, (data) => {
    if (data.executors.some((e) => e.idx === idx)) return; // idempotent
    data.executors.push({
      idx,
      model,
      status: 'running',
      responseText: '',
    });
    data.executors.sort((a, b) => a.idx - b.idx);
  });
}

export function applyPanelExecutorResponseToken(
  content: string,
  idx: number,
  token: string,
): string {
  if (!token) return content;
  return mutate(content, (data) => {
    const ex = data.executors.find((e) => e.idx === idx);
    if (ex) ex.responseText += token;
  });
}

export function applyPanelExecutorStatus(
  content: string,
  idx: number,
  status: PanelExecutorStatus,
  opts?: {
    sourceCount?: number;
    tokens?: number;
    error?: string;
    model?: string;
  },
): string {
  return mutate(content, (data) => {
    let ex = data.executors.find((e) => e.idx === idx);
    if (!ex) {
      ex = {
        idx,
        model: opts?.model ?? `Model ${idx + 1}`,
        status,
        responseText: '',
      };
      data.executors.push(ex);
      data.executors.sort((a, b) => a.idx - b.idx);
    }
    ex.status = status;
    if (opts?.sourceCount !== undefined) ex.sourceCount = opts.sourceCount;
    if (opts?.tokens !== undefined) ex.tokens = opts.tokens;
    if (opts?.error) ex.error = opts.error;
  });
}
