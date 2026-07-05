import { z } from 'zod';
import { listFiles } from '@/lib/workspaces/files';
import { defineTool } from '@/lib/tools/defineTool';

export function workspaceLsTool() {
  return defineTool(
    async (_input, runtime) => {
      const { workspaceId } = runtime.context;
      const files = await listFiles(workspaceId ?? '');
      const result = JSON.stringify({
        files: files.map((f) => ({
          name: f.name,
          mime: f.mime,
          size: f.size,
          mtime: Number(f.updatedAt),
        })),
      });
      await runtime.persist({
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
