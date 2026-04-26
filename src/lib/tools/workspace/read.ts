import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { getFileByName, readFileBytes } from '@/lib/workspaces/files';
import { getText, isImageMime } from '@/lib/workspaces/extract';

export function workspaceReadTool(opts: {
  workspaceId: string;
  visionCapable: boolean;
}) {
  return tool(
    async ({ file, startLine, endLine }) => {
      const row = await getFileByName(opts.workspaceId, file);
      if (!row) return JSON.stringify({ error: 'file_not_found' });

      if (isImageMime(row.mime)) {
        if (!opts.visionCapable)
          return JSON.stringify({ error: 'image_requires_vision_model' });
        const r = await readFileBytes(opts.workspaceId, row.id);
        if (!r) return JSON.stringify({ error: 'file_not_found' });
        const dataUrl = `data:${row.mime};base64,${r.bytes.toString('base64')}`;
        return JSON.stringify({
          image: { mime: row.mime, dataUrl, size: row.size },
        });
      }

      const text = await getText(row.sha256, row.mime);
      if (text === null) return JSON.stringify({ error: 'binary_file' });
      const lines = text.split(/\r?\n/);
      const needsRange = lines.length > 500;
      if (needsRange && (startLine === undefined || endLine === undefined)) {
        return JSON.stringify({
          error: 'range_required',
          totalLines: lines.length,
        });
      }
      const a = Math.max(1, startLine ?? 1);
      const b = Math.min(lines.length, endLine ?? lines.length);
      return JSON.stringify({
        file: row.name,
        totalLines: lines.length,
        startLine: a,
        endLine: b,
        content: lines.slice(a - 1, b).join('\n'),
      });
    },
    {
      name: 'workspace_read',
      description:
        'Read a workspace file by name. Range required for files >500 lines. Images return a vision content block; non-vision models will get a structured error.',
      schema: z.object({
        file: z.string(),
        startLine: z.number().int().positive().optional(),
        endLine: z.number().int().positive().optional(),
      }),
    },
  );
}
