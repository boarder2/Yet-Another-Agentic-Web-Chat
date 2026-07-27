import { badRequest, notFound, route } from '@/lib/api/route';
import {
  getUserSkillById,
  updateUserSkill,
  deleteUserSkill,
  setUserSkillEnabled,
} from '@/lib/skills/service';
import {
  MAX_SKILL_DESC_LEN,
  MAX_SKILL_CONTENT_LEN,
} from '@/lib/skills/validation';

type Ctx = { params: Promise<{ id: string }> };

async function requireSkill(params: Ctx['params']) {
  const { id } = await params;
  const skill = await getUserSkillById(id);
  if (!skill) throw notFound();
  return { id, skill };
}

export const GET = route(
  'Failed to fetch skill',
  async (_req: Request, { params }: Ctx) => {
    const { skill } = await requireSkill(params);
    return Response.json(skill);
  },
);

export const PUT = route(
  'Failed to update skill',
  async (req: Request, { params }: Ctx) => {
    const { id } = await requireSkill(params);
    const { description, content, enabled, disableModelInvocation } =
      await req.json();

    if (typeof enabled === 'boolean') {
      return Response.json(await setUserSkillEnabled(id, enabled));
    }
    if (description !== undefined && description.length > MAX_SKILL_DESC_LEN) {
      throw badRequest('description too long', {
        maxLength: MAX_SKILL_DESC_LEN,
      });
    }
    if (content !== undefined && content.length > MAX_SKILL_CONTENT_LEN) {
      throw badRequest('content too long');
    }

    return Response.json(
      await updateUserSkill(id, {
        description,
        content,
        ...(typeof disableModelInvocation === 'boolean' && {
          disableModelInvocation,
        }),
      }),
    );
  },
);

export const DELETE = route(
  'Failed to delete skill',
  async (_req: Request, { params }: Ctx) => {
    const { id } = await requireSkill(params);
    await deleteUserSkill(id);
    return Response.json({ success: true });
  },
);
