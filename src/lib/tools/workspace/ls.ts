import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { listFiles } from '@/lib/workspaces/files';

export function workspaceLsTool(workspaceId: string) {
  return tool(
    async () => {
      const files = await listFiles(workspaceId);
      return JSON.stringify({
        files: files.map((f) => ({
          name: f.name,
          mime: f.mime,
          size: f.size,
          mtime: Number(f.updatedAt),
        })),
      });
    },
    {
      name: 'workspace_ls',
      description: 'List all files in the current workspace. No arguments.',
      schema: z.object({}),
    },
  );
}
