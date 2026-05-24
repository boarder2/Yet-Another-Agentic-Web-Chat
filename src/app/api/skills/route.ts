import { NextResponse } from 'next/server';
import {
  listUserSkills,
  createUserSkill,
  getUserSkillByName,
} from '@/lib/skills/service';
import db from '@/lib/db';
import { skills } from '@/lib/db/schema';
import { isNull, or, eq } from 'drizzle-orm';
import {
  SKILL_NAME_REGEX,
  MAX_SKILL_NAME_LEN,
  MAX_SKILL_DESC_LEN,
  MAX_SKILL_CONTENT_LEN,
} from '@/lib/skills/validation';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const workspaceId = searchParams.get('workspaceId') ?? undefined;
    const enabledOnly = searchParams.get('enabled') === 'true';

    let rows;
    if (workspaceId) {
      rows = db
        .select()
        .from(skills)
        .where(
          or(isNull(skills.workspaceId), eq(skills.workspaceId, workspaceId)),
        )
        .all();
    } else if (enabledOnly) {
      // Autocomplete/invocation outside a workspace: only global skills apply.
      rows = db.select().from(skills).where(isNull(skills.workspaceId)).all();
    } else {
      rows = await listUserSkills();
    }

    if (enabledOnly) {
      rows = rows.filter((r) => r.enabled);
    }

    return NextResponse.json(rows);
  } catch (err) {
    console.error('[api/skills] GET error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch skills' },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, description, content, workspaceId, disableModelInvocation } =
      body;

    if (!name || !description || !content) {
      return NextResponse.json(
        { error: 'name, description, and content are required' },
        { status: 400 },
      );
    }

    if (!SKILL_NAME_REGEX.test(name)) {
      return NextResponse.json(
        { error: `name must match ${SKILL_NAME_REGEX}` },
        { status: 400 },
      );
    }
    if (name.length > MAX_SKILL_NAME_LEN) {
      return NextResponse.json({ error: 'name too long' }, { status: 400 });
    }
    if (description.length > MAX_SKILL_DESC_LEN) {
      return NextResponse.json(
        { error: 'description too long', maxLength: MAX_SKILL_DESC_LEN },
        { status: 400 },
      );
    }
    if (content.length > MAX_SKILL_CONTENT_LEN) {
      return NextResponse.json({ error: 'content too long' }, { status: 400 });
    }

    // Check uniqueness
    const existing = await getUserSkillByName(name, workspaceId ?? null);
    if (existing) {
      return NextResponse.json(
        { error: `A skill named "${name}" already exists in this scope` },
        { status: 409 },
      );
    }

    const skill = await createUserSkill({
      name,
      description,
      content,
      workspaceId: workspaceId ?? null,
      disableModelInvocation:
        typeof disableModelInvocation === 'boolean'
          ? disableModelInvocation
          : false,
    });

    return NextResponse.json(skill, { status: 201 });
  } catch (err) {
    console.error('[api/skills] POST error:', err);
    return NextResponse.json(
      { error: 'Failed to create skill' },
      { status: 500 },
    );
  }
}
