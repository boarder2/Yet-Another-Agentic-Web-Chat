import db from '@/lib/db';
import { memories } from '@/lib/db/schema';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { classifyMemory, MemoryCategory } from '@/lib/utils/memoryCategories';
import { embedMemoryContent } from '@/lib/utils/memoryEmbedding';
import {
  getAvailableChatModelProviders,
  getAvailableEmbeddingModelProviders,
} from '@/lib/providers';
import { CachedEmbeddings } from '@/lib/utils/cachedEmbeddings';
import {
  getSelectedSystemModel,
  getSelectedEmbeddingModel,
} from '@/lib/config';

async function getEmbeddingModel(): Promise<CachedEmbeddings | null> {
  const embeddingModelProviders = await getAvailableEmbeddingModelProviders();
  const selected = getSelectedEmbeddingModel();

  if (selected.provider && selected.name) {
    const provider = embeddingModelProviders[selected.provider];
    if (provider && provider[selected.name]) {
      return new CachedEmbeddings(
        provider[selected.name].model,
        selected.provider,
        selected.name,
      );
    }
  }

  const defaultProvider = Object.keys(embeddingModelProviders)[0];
  if (!defaultProvider) return null;
  const provider = embeddingModelProviders[defaultProvider];
  const defaultModel = Object.keys(provider)[0];
  if (!defaultModel) return null;
  return new CachedEmbeddings(
    provider[defaultModel].model,
    defaultProvider,
    defaultModel,
  );
}

async function getSystemModel() {
  const chatModelProviders = await getAvailableChatModelProviders();
  const selected = getSelectedSystemModel();

  if (selected.provider && selected.name) {
    const provider = chatModelProviders[selected.provider];
    if (provider && provider[selected.name]) {
      return provider[selected.name].model;
    }
  }

  for (const providerName of Object.keys(chatModelProviders)) {
    const provider = chatModelProviders[providerName];
    for (const modelName of Object.keys(provider)) {
      if (modelName.toLowerCase().includes('embedding')) continue;
      return provider[modelName].model;
    }
  }
  return null;
}

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const memory = await db.query.memories.findFirst({
      where: eq(memories.id, id),
    });

    if (!memory) {
      return NextResponse.json({ error: 'Memory not found' }, { status: 404 });
    }

    return NextResponse.json(memory);
  } catch (error) {
    console.error('Failed to fetch memory:', error);
    return NextResponse.json(
      { error: 'Failed to fetch memory' },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { content } = await req.json();

    if (
      !content ||
      typeof content !== 'string' ||
      content.trim().length === 0
    ) {
      return NextResponse.json(
        { error: 'Content is required' },
        { status: 400 },
      );
    }

    const existing = await db.query.memories.findFirst({
      where: eq(memories.id, id),
    });

    if (!existing) {
      return NextResponse.json({ error: 'Memory not found' }, { status: 404 });
    }

    const embeddingModel = await getEmbeddingModel();
    const systemModel = await getSystemModel();

    let embedding: number[] | null = null;
    let embeddingIdentifier: string | null = null;
    let category: MemoryCategory =
      (existing.category as MemoryCategory) || 'Preference';

    if (embeddingModel) {
      embedding = await embedMemoryContent(content.trim(), embeddingModel);
      embeddingIdentifier = embeddingModel.getIdentifier();
    }

    if (systemModel) {
      category = await classifyMemory(content.trim(), systemModel);
    }

    await db
      .update(memories)
      .set({
        content: content.trim(),
        embedding: embedding ? JSON.stringify(embedding) : existing.embedding,
        embeddingModel: embeddingIdentifier ?? existing.embeddingModel,
        category,
        updatedAt: new Date(),
      })
      .where(eq(memories.id, id))
      .execute();

    const updated = await db.query.memories.findFirst({
      where: eq(memories.id, id),
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Failed to update memory:', error);
    return NextResponse.json(
      { error: 'Failed to update memory' },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const { id } = await context.params;

    const existing = await db.query.memories.findFirst({
      where: eq(memories.id, id),
    });

    if (!existing) {
      return NextResponse.json({ error: 'Memory not found' }, { status: 404 });
    }

    await db.delete(memories).where(eq(memories.id, id)).execute();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete memory:', error);
    return NextResponse.json(
      { error: 'Failed to delete memory' },
      { status: 500 },
    );
  }
}
