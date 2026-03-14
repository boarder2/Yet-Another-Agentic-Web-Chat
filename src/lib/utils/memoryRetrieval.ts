import db from '@/lib/db';
import { memories } from '@/lib/db/schema';
import { CachedEmbeddings } from './cachedEmbeddings';
import computeSimilarity from './computeSimilarity';
import { eq } from 'drizzle-orm';

export type ScoredMemory = {
  id: string;
  content: string;
  category: string | null;
  score: number;
  sourceType: string | null;
  sourceChatId: string | null;
  accessCount: number;
  createdAt: Date;
};

export async function retrieveRelevantMemories(
  queryText: string,
  embeddingModel: CachedEmbeddings,
  options?: { limit?: number; threshold?: number },
): Promise<ScoredMemory[]> {
  const limit = options?.limit ?? 10;
  const threshold = options?.threshold ?? 0.5;

  const queryEmbedding = await embeddingModel.embedQuery(queryText);
  const embeddingIdentifier = embeddingModel.getIdentifier();

  const allMemories = await db.select().from(memories).all();

  const scored: ScoredMemory[] = [];
  for (const memory of allMemories) {
    if (!memory.embedding) continue;
    // Skip memories embedded with a different model
    if (memory.embeddingModel !== embeddingIdentifier) continue;

    const memoryEmbedding: number[] = JSON.parse(memory.embedding);
    const score = computeSimilarity(queryEmbedding, memoryEmbedding);

    if (score >= threshold) {
      scored.push({
        id: memory.id,
        content: memory.content,
        category: memory.category,
        score,
        sourceType: memory.sourceType,
        sourceChatId: memory.sourceChatId,
        accessCount: memory.accessCount,
        createdAt: memory.createdAt,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const results = scored.slice(0, limit);

  // Update access count and lastAccessedAt for returned memories
  const now = new Date();
  for (const result of results) {
    db.update(memories)
      .set({
        accessCount: result.accessCount + 1,
        lastAccessedAt: now,
      })
      .where(eq(memories.id, result.id))
      .execute()
      .catch((err) => {
        console.warn('Failed to update memory access stats:', err);
      });
  }

  return results;
}
