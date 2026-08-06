import { badRequest, notFound, route } from '@/lib/api/route';
import {
  deleteWorkspaceArtifact,
  getArtifact,
  getArtifactDetail,
} from '@/lib/artifacts/service';

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(
  'Failed to fetch artifact',
  async (_req: Request, { params }: Ctx) => {
    const { id } = await params;
    const detail = getArtifactDetail(id);
    if (!detail) throw notFound('Artifact not found');
    return Response.json(detail);
  },
);

/**
 * Only workspace documents can be deleted on their own. A chat-scoped artifact
 * is part of its transcript and goes when the chat does, so there is
 * deliberately no route that removes one.
 */
export const DELETE = route(
  'Failed to delete artifact',
  async (_req: Request, { params }: Ctx) => {
    const { id } = await params;
    const artifact = getArtifact(id);
    if (!artifact) throw notFound('Artifact not found');
    if (!artifact.workspaceId) {
      throw badRequest(
        'Only workspace documents can be deleted; a chat-scoped artifact is removed with its chat.',
      );
    }
    deleteWorkspaceArtifact(id, artifact.workspaceId);
    return Response.json({ ok: true });
  },
);
