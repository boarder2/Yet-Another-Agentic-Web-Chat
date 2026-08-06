import { badRequest, route } from '@/lib/api/route';
import { listArtifacts, listWorkspaceArtifacts } from '@/lib/artifacts/service';

export const GET = route('Failed to fetch artifacts', async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get('workspaceId');
  if (workspaceId) return Response.json(listWorkspaceArtifacts(workspaceId));

  const chatId = searchParams.get('chatId');
  if (!chatId) throw badRequest('chatId or workspaceId is required');
  return Response.json(listArtifacts(chatId));
});
