import db from '@/lib/db';
import { memories } from '@/lib/db/schema';
import { NextResponse } from 'next/server';
import { like, eq, desc, count } from 'drizzle-orm';
import {
  MEMORY_CATEGORIES,
  classifyMemory,
  MemoryCategory,
} from '@/lib/utils/memoryCategories';
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

  // Use configured selection if available
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

  // Fallback to first available
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

  // Use configured selection if available
  if (selected.provider && selected.name) {
    const provider = chatModelProviders[selected.provider];
    if (provider && provider[selected.name]) {
      return provider[selected.name].model;
    }
  }

  // Fallback to first non-embedding chat model
  for (const providerName of Object.keys(chatModelProviders)) {
    const provider = chatModelProviders[providerName];
    for (const modelName of Object.keys(provider)) {
      if (modelName.toLowerCase().includes('embedding')) continue;
      return provider[modelName].model;
    }
  }
  return null;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get('q');
    const category = searchParams.get('category');
    const sort = searchParams.get('sort') || 'createdAt';
    const limit = Math.min(
      parseInt(searchParams.get('limit') || '50', 10),
      200,
    );
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    let query = db.select().from(memories).$dynamic();

    const conditions = [];
    if (q) {
      conditions.push(like(memories.content, `%${q}%`));
    }
    if (category && MEMORY_CATEGORIES.includes(category as MemoryCategory)) {
      conditions.push(eq(memories.category, category as MemoryCategory));
    }

    if (conditions.length === 1) {
      query = query.where(conditions[0]) as typeof query;
    } else if (conditions.length > 1) {
      const { and } = await import('drizzle-orm');
      query = query.where(and(...conditions)) as typeof query;
    }

    // Sort
    if (sort === 'lastAccessedAt') {
      query = query.orderBy(desc(memories.lastAccessedAt)) as typeof query;
    } else if (sort === 'accessCount') {
      query = query.orderBy(desc(memories.accessCount)) as typeof query;
    } else {
      query = query.orderBy(desc(memories.createdAt)) as typeof query;
    }

    query = query.limit(limit).offset(offset) as typeof query;

    const data = await query;

    // Get total count
    const countConditions = [];
    if (q) countConditions.push(like(memories.content, `%${q}%`));
    if (category && MEMORY_CATEGORIES.includes(category as MemoryCategory)) {
      countConditions.push(eq(memories.category, category as MemoryCategory));
    }

    let totalQuery = db.select({ count: count() }).from(memories).$dynamic();
    if (countConditions.length === 1) {
      totalQuery = totalQuery.where(countConditions[0]) as typeof totalQuery;
    } else if (countConditions.length > 1) {
      const { and } = await import('drizzle-orm');
      totalQuery = totalQuery.where(
        and(...countConditions),
      ) as typeof totalQuery;
    }

    const [{ count: total }] = await totalQuery;

    return NextResponse.json({
      data,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    });
  } catch (error) {
    console.error('Failed to fetch memories:', error);
    return NextResponse.json(
      { error: 'Failed to fetch memories' },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
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

    const embeddingModel = await getEmbeddingModel();
    const systemModel = await getSystemModel();

    let embedding: number[] | null = null;
    let embeddingIdentifier: string | null = null;
    let category: MemoryCategory = 'Preference';

    if (embeddingModel) {
      embedding = await embedMemoryContent(content.trim(), embeddingModel);
      embeddingIdentifier = embeddingModel.getIdentifier();
    }

    if (systemModel) {
      category = await classifyMemory(content.trim(), systemModel);
    }

    const id = crypto.randomUUID();
    const now = new Date();

    await db
      .insert(memories)
      .values({
        id,
        content: content.trim(),
        embedding: embedding ? JSON.stringify(embedding) : null,
        embeddingModel: embeddingIdentifier,
        category,
        sourceType: 'manual',
        createdAt: now,
        updatedAt: now,
      })
      .execute();

    const created = await db.query.memories.findFirst({
      where: eq(memories.id, id),
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error('Failed to create memory:', error);
    return NextResponse.json(
      { error: 'Failed to create memory' },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  try {
    await db.delete(memories).execute();
    return NextResponse.json({
      success: true,
      message: 'All memories deleted',
    });
  } catch (error) {
    console.error('Failed to delete all memories:', error);
    return NextResponse.json(
      { error: 'Failed to delete memories' },
      { status: 500 },
    );
  }
}
