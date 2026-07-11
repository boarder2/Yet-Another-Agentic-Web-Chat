import { z } from 'zod';
import { HumanMessage, ToolMessage } from '@langchain/core/messages';
import { Command } from '@langchain/langgraph';
import { getFileByName, readFileBytes } from '@/lib/workspaces/files';
import { getText, isImageMime } from '@/lib/workspaces/extract';
import { defineTool } from '@/lib/tools/defineTool';

export function workspaceReadTool(opts: { visionCapable: boolean }) {
  return defineTool(
    async ({ file, startLine, endLine }, runtime) => {
      const toolCallId = runtime.toolCallId;
      const { workspaceId } = runtime.context;

      const row = await getFileByName(workspaceId ?? '', file);
      if (!row) return JSON.stringify({ error: 'file_not_found' });

      if (isImageMime(row.mime)) {
        if (!opts.visionCapable)
          return JSON.stringify({ error: 'image_requires_vision_model' });
        const r = await readFileBytes(workspaceId ?? '', row.id);
        if (!r) return JSON.stringify({ error: 'file_not_found' });
        const dataUrl = `data:${row.mime};base64,${r.bytes.toString('base64')}`;
        // OpenAI (and compatible providers) only support image_url in user-role
        // messages, not in tool messages. Inject the image as a follow-up
        // HumanMessage so the model can see it regardless of provider.
        return new Command({
          update: {
            messages: [
              new ToolMessage({
                tool_call_id: toolCallId,
                content: JSON.stringify({
                  file: row.name,
                  mime: row.mime,
                  size: row.size,
                  note: 'Image data follows in the next message.',
                }),
              }),
              new HumanMessage({
                content: [
                  {
                    type: 'image_url',
                    image_url: { url: dataUrl },
                  },
                  {
                    type: 'text',
                    text: `[Image file: ${row.name}]`,
                  },
                ],
              }),
            ],
          },
        });
      }

      const text = await getText(row);
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
      const sliced = lines.slice(a - 1, b).join('\n');

      await runtime.persist({
        kind: 'workspace_read',
        body: `[workspace_read ${row.name}:${a}-${b}/${lines.length}]\n${sliced}`,
        metadataExtras: { path: row.name, startLine: a, endLine: b },
      });

      return JSON.stringify({
        file: row.name,
        totalLines: lines.length,
        startLine: a,
        endLine: b,
        content: sliced,
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
