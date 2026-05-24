import { NextResponse } from 'next/server';
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

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const skill = await getUserSkillById(id);
    if (!skill) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(skill);
  } catch (err) {
    console.error('[api/skills/[id]] GET error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch skill' },
      { status: 500 },
    );
  }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const skill = await getUserSkillById(id);
    if (!skill) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body = await req.json();
    const { description, content, enabled, disableModelInvocation } = body;

    // Handle toggle
    if (typeof enabled === 'boolean') {
      const updated = await setUserSkillEnabled(id, enabled);
      return NextResponse.json(updated);
    }

    if (description !== undefined && description.length > MAX_SKILL_DESC_LEN) {
      return NextResponse.json(
        { error: 'description too long', maxLength: MAX_SKILL_DESC_LEN },
        { status: 400 },
      );
    }
    if (content !== undefined && content.length > MAX_SKILL_CONTENT_LEN) {
      return NextResponse.json({ error: 'content too long' }, { status: 400 });
    }

    const updated = await updateUserSkill(id, {
      description,
      content,
      ...(typeof disableModelInvocation === 'boolean' && {
        disableModelInvocation,
      }),
    });
    return NextResponse.json(updated);
  } catch (err) {
    console.error('[api/skills/[id]] PUT error:', err);
    return NextResponse.json(
      { error: 'Failed to update skill' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const skill = await getUserSkillById(id);
    if (!skill) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    await deleteUserSkill(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[api/skills/[id]] DELETE error:', err);
    return NextResponse.json(
      { error: 'Failed to delete skill' },
      { status: 500 },
    );
  }
}
