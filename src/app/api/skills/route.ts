import { badRequest, conflict, route } from '@/lib/api/route';
import {
  listUserSkills,
  createUserSkill,
  isNameTakenInScope,
} from '@/lib/skills/service';
import db from '@/lib/db';
import { skills } from '@/lib/db/schema';
import { isNull } from 'drizzle-orm';
import { validateSkillFields } from '@/lib/skills/validation';
import { isSystemSkillName } from '@/lib/skills/systemRegistry';

export const GET = route('Failed to fetch skills', async (req: Request) => {
  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get('workspaceId') ?? undefined;
  const enabledOnly = searchParams.get('enabled') === 'true';

  let rows =
    !workspaceId && enabledOnly
      ? // Autocomplete/invocation outside a workspace: only global skills apply.
        db.select().from(skills).where(isNull(skills.workspaceId)).all()
      : await listUserSkills(workspaceId);

  if (enabledOnly) rows = rows.filter((r) => r.enabled);

  return Response.json(rows);
});

export const POST = route('Failed to create skill', async (req: Request) => {
  const { name, description, content, workspaceId, disableModelInvocation } =
    await req.json();

  if (!name || !description || !content)
    throw badRequest('name, description, and content are required');

  const invalid = validateSkillFields({ name, description, content });
  if (invalid) throw badRequest(invalid.message, invalid.extra);

  if (isSystemSkillName(name))
    throw conflict(`"${name}" is reserved by a built-in system skill`);

  const scope = workspaceId ?? null;
  if (await isNameTakenInScope(name, scope))
    throw conflict(`A skill named "${name}" already exists in that scope`);

  const skill = await createUserSkill({
    name,
    description,
    content,
    workspaceId: scope,
    disableModelInvocation: disableModelInvocation === true,
  });

  return Response.json(skill, { status: 201 });
});
