import db from '@/lib/db';
import { systemPrompts } from '@/lib/db/schema';
import { NextResponse } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import {
  formattingAndCitationsLocal,
  formattingAndCitationsScholarly,
  formattingAndCitationsWeb,
  formattingChat,
} from '@/lib/prompts/templates';
import { builtinMethodologyTemplates } from '@/lib/prompts/methodologyTemplates';
import { Prompt } from '@/lib/types/prompt';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type');

    const prompts: Prompt[] = [];

    // Include persona-related prompts when no filter or type=persona
    if (!type || type === 'persona') {
      prompts.push(
        formattingAndCitationsLocal,
        formattingAndCitationsScholarly,
        formattingAndCitationsWeb,
        formattingChat,
      );

      prompts.push(
        ...(
          await db
            .select()
            .from(systemPrompts)
            .where(eq(systemPrompts.type, 'persona'))
            .orderBy(asc(systemPrompts.name))
        ).map((prompt) => ({ ...prompt, readOnly: false })),
      );
    }

    // Include methodology-related prompts when no filter or type=methodology
    if (!type || type === 'methodology') {
      prompts.push(...builtinMethodologyTemplates);

      prompts.push(
        ...(
          await db
            .select()
            .from(systemPrompts)
            .where(eq(systemPrompts.type, 'methodology'))
            .orderBy(asc(systemPrompts.name))
        ).map((prompt) => ({ ...prompt, readOnly: false })),
      );
    }

    return NextResponse.json(prompts);
  } catch (error) {
    console.error('Failed to fetch system prompts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch system prompts' },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const { name, content, type } = await req.json();
    if (!name || !content) {
      return NextResponse.json(
        { error: 'Name and content are required' },
        { status: 400 },
      );
    }
    const validTypes = ['persona', 'methodology'] as const;
    const promptType = validTypes.includes(type) ? type : 'persona';
    const newPrompt = await db
      .insert(systemPrompts)
      .values({
        name,
        content,
        type: promptType,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return NextResponse.json(newPrompt[0], { status: 201 });
  } catch (error) {
    console.error('Failed to create system prompt:', error);
    return NextResponse.json(
      { error: 'Failed to create system prompt' },
      { status: 500 },
    );
  }
}
