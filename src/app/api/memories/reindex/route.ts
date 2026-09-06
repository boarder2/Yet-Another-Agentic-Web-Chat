import db from '@/lib/db';
import { memories } from '@/lib/db/schema';
import { NextResponse } from 'next/server';
import { embedMemoryContent } from '@/lib/utils/memoryEmbedding';
import { getAvailableEmbeddingModelProviders } from '@/lib/providers';
import { CachedEmbeddings } from '@/lib/utils/cachedEmbeddings';
import { eq } from 'drizzle-orm';
import { getEmbeddingModelSelection } from '@/lib/settings/server';

export async function POST() {
  try {
    const embeddingModelProviders = await getAvailableEmbeddingModelProviders();
    const selected = getEmbeddingModelSelection();

    let embeddingModel: CachedEmbeddings | null = null;
    const selectionPresent = selected.provider !== '' || selected.name !== '';

    if (selectionPresent) {
      const provider = embeddingModelProviders[selected.provider];
      if (!provider?.[selected.name]) {
        return NextResponse.json(
          { error: 'Invalid embedding model selected' },
          { status: 400 },
        );
      }
      embeddingModel = new CachedEmbeddings(
        provider[selected.name].model,
        selected.provider,
        selected.name,
      );
    }

    // No selection: use the first available model.
    if (!embeddingModel) {
      const defaultProvider = Object.keys(embeddingModelProviders)[0];
      if (!defaultProvider) {
        return NextResponse.json(
          { error: 'No embedding model available' },
          { status: 500 },
        );
      }
      const provider = embeddingModelProviders[defaultProvider];
      const defaultModel = Object.keys(provider)[0];
      if (!defaultModel) {
        return NextResponse.json(
          { error: 'No embedding model available' },
          { status: 500 },
        );
      }
      embeddingModel = new CachedEmbeddings(
        provider[defaultModel].model,
        defaultProvider,
        defaultModel,
      );
    }

    const allMemories = await db.select().from(memories).all();
    let reindexed = 0;

    for (const memory of allMemories) {
      const embedding = await embedMemoryContent(
        memory.content,
        embeddingModel,
      );
      await db
        .update(memories)
        .set({
          embedding: JSON.stringify(embedding),
          embeddingModel: embeddingModel.getIdentifier(),
          updatedAt: new Date(),
        })
        .where(eq(memories.id, memory.id))
        .execute();
      reindexed++;
    }

    return NextResponse.json({ success: true, count: reindexed });
  } catch (error) {
    console.error('Failed to reindex memories:', error);
    return NextResponse.json(
      { error: 'Failed to reindex memories' },
      { status: 500 },
    );
  }
}
