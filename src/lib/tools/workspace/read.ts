import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { RunnableConfig } from '@langchain/core/runnables';
import { HumanMessage, ToolMessage } from '@langchain/core/messages';
import { Command } from '@langchain/langgraph';
import { getFileByName, readFileBytes } from '@/lib/workspaces/files';
import { getText, isImageMime } from '@/lib/workspaces/extract';

export function workspaceReadTool(opts: {
  workspaceId: string;
  visionCapable: boolean;
}) {
  return tool(
    async ({ file, startLine, endLine }, config?: RunnableConfig) => {
      const toolCallId =
        (config as unknown as { toolCall?: { id?: string } })?.toolCall?.id ??
        'workspace_read';

      const row = await getFileByName(opts.workspaceId, file);
      if (!row) return JSON.stringify({ error: 'file_not_found' });

      if (isImageMime(row.mime)) {
        if (!opts.visionCapable)
          return JSON.stringify({ error: 'image_requires_vision_model' });
        const r = await readFileBytes(opts.workspaceId, row.id);
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
