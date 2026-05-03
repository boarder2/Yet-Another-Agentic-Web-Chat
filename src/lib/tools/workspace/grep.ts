import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { listFiles } from '@/lib/workspaces/files';
import { getText, isImageMime } from '@/lib/workspaces/extract';
import { grepText } from '@/lib/workspaces/grep';

const RESULT_BYTES_CAP = 64 * 1024;

export function workspaceGrepTool(workspaceId: string) {
  return tool(
    async ({ pattern, regex = false, maxMatches = 50 }) => {
      const files = await listFiles(workspaceId);
      const out: { file: string; line: number; snippet: string }[] = [];
      let bytes = 0;
      for (const f of files) {
        if (isImageMime(f.mime)) continue;
        let text: string | null;
        try {
          text = await getText(f.sha256, f.mime);
        } catch {
          continue;
        }
        if (text === null) continue;
        let matches: { line: number; snippet: string }[];
        try {
          matches = await grepText({ pattern, regex, text, maxMatches });
        } catch (e: unknown) {
          if (e instanceof Error && e.message === 'regex_timeout')
            return JSON.stringify({ error: 'regex_timeout' });
          continue;
        }
        for (const m of matches) {
          const row = { file: f.name, line: m.line, snippet: m.snippet };
          const rowBytes = JSON.stringify(row).length;
          if (bytes + rowBytes > RESULT_BYTES_CAP) {
            return JSON.stringify({ matches: out, truncated: true });
          }
          bytes += rowBytes;
          out.push(row);
          if (out.length >= maxMatches) break;
        }
        if (out.length >= maxMatches) break;
      }
      if (out.length === 0) return JSON.stringify({ error: 'no_match' });
      return JSON.stringify({ matches: out });
    },
    {
      name: 'workspace_grep',
      description:
        "Search the workspace's text files for a pattern. Literal by default; pass regex:true for regex. Returns file/line/snippet rows.",
      schema: z.object({
        pattern: z.string(),
        regex: z.boolean().optional(),
        maxMatches: z.number().int().min(1).max(200).optional(),
      }),
    },
  );
}
