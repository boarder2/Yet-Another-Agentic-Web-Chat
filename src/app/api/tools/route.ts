import { route } from '@/lib/api/route';
import { allTools } from '@/lib/tools';

export const GET = route('Failed to fetch available tools', async () =>
  Response.json(
    allTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
    })),
  ),
);
