import { NextRequest, NextResponse } from 'next/server';
import { OpenAICompatibleDiscoveryError } from '@/lib/providers/openaiCompatible/client';
import { discoverOpenAICompatibleModels } from '@/lib/providers/openaiCompatible/client';
import { getOpenAICompatibleProvider } from '@/lib/providers/openaiCompatible/store';

export const runtime = 'nodejs';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const provider = await getOpenAICompatibleProvider(id);
    if (!provider)
      return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const models = await discoverOpenAICompatibleModels(provider, {
      forceRefresh: true,
      cacheResult: false,
    });
    return NextResponse.json({ ok: true, modelCount: models.length });
  } catch (error) {
    if (
      error instanceof OpenAICompatibleDiscoveryError &&
      error.kind === 'timeout'
    ) {
      return NextResponse.json({ error: error.message }, { status: 504 });
    }
    if (error instanceof OpenAICompatibleDiscoveryError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    console.error('Failed to test OpenAI-compatible provider:', error);
    return NextResponse.json(
      { error: 'Failed to test OpenAI-compatible provider' },
      { status: 502 },
    );
  }
}
