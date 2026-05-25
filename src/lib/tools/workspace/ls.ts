import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { RunnableConfig } from '@langchain/core/runnables';
import { listFiles } from '@/lib/workspaces/files';
import { persistFromToolConfig } from '@/lib/utils/persistToolContext';

export function workspaceLsTool(workspaceId: string) {
  return tool(
    async (_input: unknown, config?: RunnableConfig) => {
      const files = await listFiles(workspaceId);
      const result = JSON.stringify({
        files: files.map((f) => ({
          name: f.name,
          mime: f.mime,
          size: f.size,
          mtime: Number(f.updatedAt),
        })),
      });
      await persistFromToolConfig({
        config,
        kind: 'workspace_ls',
        body: `[workspace_ls]\n${result}`,
        metadataExtras: { path: '/' },
      });
      return result;
    },
    {
      name: 'workspace_ls',
      description: 'List all files in the current workspace. No arguments.',
      schema: z.object({}),
    },
  );
}
