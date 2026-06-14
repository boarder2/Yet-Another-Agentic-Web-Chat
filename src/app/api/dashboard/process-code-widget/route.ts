import { NextRequest, NextResponse } from 'next/server';
import { runCodeWidget } from '@/lib/dashboard/codeWidgetRunner';
import { MAX_SOURCES_PER_WIDGET } from '@/lib/dashboard/sources';
import { CodeWidgetProcessRequest } from '@/lib/types/api';

const MAX_CODE_CHARS = 50_000;

export async function POST(request: NextRequest) {
  try {
    const body: CodeWidgetProcessRequest = await request.json();

    if (!body.code || typeof body.code !== 'string') {
      return NextResponse.json(
        { error: 'Missing required field: code' },
        { status: 400 },
      );
    }
    if (body.code.length > MAX_CODE_CHARS) {
      return NextResponse.json(
        { error: `Code exceeds ${MAX_CODE_CHARS} characters.` },
        { status: 400 },
      );
    }
    if (
      Array.isArray(body.sources) &&
      body.sources.length > MAX_SOURCES_PER_WIDGET
    ) {
      return NextResponse.json(
        { error: `At most ${MAX_SOURCES_PER_WIDGET} sources allowed.` },
        { status: 400 },
      );
    }

    const result = await runCodeWidget({
      code: body.code,
      sources: body.sources ?? [],
      location: body.location,
      theme: body.theme,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error processing code widget:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
