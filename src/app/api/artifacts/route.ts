import { route } from '@/lib/api/route';
import {
  listAllArtifacts,
  listArtifacts,
  listWorkspaceArtifacts,
} from '@/lib/artifacts/service';

export const GET = route('Failed to fetch artifacts', async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get('workspaceId');
  if (workspaceId) return Response.json(listWorkspaceArtifacts(workspaceId));

  const chatId = searchParams.get('chatId');
  if (chatId) return Response.json(listArtifacts(chatId));

  // List-all mode: neither chatId nor workspaceId, optionally filtered by
  // workspace (comma-separated; the literal `none` means chat-scoped).
  const workspaceIdsParam = searchParams.get('workspaceIds');
  const workspaceIds = workspaceIdsParam
    ? workspaceIdsParam.split(',').filter(Boolean)
    : undefined;
  return Response.json(listAllArtifacts({ workspaceIds }));
});
