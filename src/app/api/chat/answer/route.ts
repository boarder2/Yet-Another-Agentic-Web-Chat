import { NextResponse } from 'next/server';
import { resolveUserQuestion } from '@/lib/userQuestion/pendingQuestions';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { questionId, selectedOptions, freeformText, skipped } = body;

  if (!questionId || typeof questionId !== 'string') {
    return NextResponse.json(
      { error: 'questionId (string) is required' },
      { status: 400 },
    );
  }

  const found = resolveUserQuestion(questionId, {
    selectedOptions:
      Array.isArray(selectedOptions) &&
      selectedOptions.every((o: unknown) => typeof o === 'string')
        ? selectedOptions
        : undefined,
    freeformText:
      typeof freeformText === 'string'
        ? freeformText.slice(0, 2000)
        : undefined,
    skipped: skipped === true,
  });

  if (!found) {
    return NextResponse.json(
      { error: 'Question not found or already resolved' },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true });
}
