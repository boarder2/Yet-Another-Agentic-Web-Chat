import { badRequest, conflict, notFound, route } from '@/lib/api/route';
import {
  getUserSkillById,
  updateUserSkill,
  deleteUserSkill,
  isNameTakenInScope,
} from '@/lib/skills/service';
import { validateSkillFields } from '@/lib/skills/validation';
import { isSystemSkillName } from '@/lib/skills/systemRegistry';

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
    const { id, skill } = await requireSkill(params);
    const {
      name,
      description,
      content,
      workspaceId,
      enabled,
      disableModelInvocation,
    } = await req.json();

    const invalid = validateSkillFields({ name, description, content });
    if (invalid) throw badRequest(invalid.message, invalid.extra);

    if (name !== undefined && isSystemSkillName(name))
      throw conflict(`"${name}" is reserved by a built-in system skill`);

    // A rename and a scope move each shift the row's (name, scope) identity,
    // so validate the destination pair rather than either half alone.
    const nextName = name ?? skill.name;
    const nextScope =
      workspaceId === undefined ? skill.workspaceId : (workspaceId ?? null);
    if (
      (nextName !== skill.name || nextScope !== skill.workspaceId) &&
      (await isNameTakenInScope(nextName, nextScope, id))
    )
      throw conflict(
        `A skill named "${nextName}" already exists in that scope`,
      );

    return Response.json(
      await updateUserSkill(id, {
        name,
        description,
        content,
        workspaceId: workspaceId === undefined ? undefined : nextScope,
        enabled: typeof enabled === 'boolean' ? enabled : undefined,
        disableModelInvocation:
          typeof disableModelInvocation === 'boolean'
            ? disableModelInvocation
            : undefined,
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
