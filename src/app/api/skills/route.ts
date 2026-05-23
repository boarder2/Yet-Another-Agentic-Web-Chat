import { NextResponse } from 'next/server';
import {
  listUserSkills,
  createUserSkill,
  getUserSkillByName,
} from '@/lib/skills/service';
import db from '@/lib/db';
import { skills } from '@/lib/db/schema';
import { isNull, or, eq } from 'drizzle-orm';

const NAME_REGEX = /^[a-z0-9][a-z0-9_:-]*$/;
const MAX_NAME_LEN = 64;
const MAX_DESC_LEN = 256;
const MAX_CONTENT_LEN = 65536;

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
    const { name, description, content, workspaceId } = body;

    if (!name || !description || !content) {
      return NextResponse.json(
        { error: 'name, description, and content are required' },
        { status: 400 },
      );
    }

    if (!NAME_REGEX.test(name)) {
      return NextResponse.json(
        { error: `name must match ${NAME_REGEX}` },
        { status: 400 },
      );
    }
    if (name.length > MAX_NAME_LEN) {
      return NextResponse.json({ error: 'name too long' }, { status: 400 });
    }
    if (description.length > MAX_DESC_LEN) {
      return NextResponse.json(
        { error: 'description too long' },
        { status: 400 },
      );
    }
    if (content.length > MAX_CONTENT_LEN) {
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
