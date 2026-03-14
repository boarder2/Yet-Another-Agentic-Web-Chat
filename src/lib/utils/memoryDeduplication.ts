import computeSimilarity from './computeSimilarity';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage } from '@langchain/core/messages';

export type MemoryWithEmbedding = {
  id: string;
  content: string;
  embedding: string | null;
  embeddingModel: string | null;
};

export type MemoryWithCategory = {
  id: string;
  content: string;
  category: string | null;
};

const DUPLICATE_THRESHOLD = 0.85;

export function findDuplicate(
  newEmbedding: number[],
  existingMemories: MemoryWithEmbedding[],
  embeddingModelId: string,
  threshold: number = DUPLICATE_THRESHOLD,
): MemoryWithEmbedding | null {
  let bestMatch: MemoryWithEmbedding | null = null;
  let bestScore = 0;

  for (const memory of existingMemories) {
    if (!memory.embedding) continue;
    // Only compare against memories embedded with the same model
    if (memory.embeddingModel !== embeddingModelId) continue;
    const memoryEmbedding: number[] = JSON.parse(memory.embedding);
    const score = computeSimilarity(newEmbedding, memoryEmbedding);

    if (score >= threshold && score > bestScore) {
      bestScore = score;
      bestMatch = memory;
    }
  }

  return bestMatch;
}

/**
 * Use an LLM to identify memories that are contradicted by a new fact.
 * Queries same-category memories and asks the LLM which ones are outdated.
 */
export async function findConflictsWithLLM(
  newContent: string,
  newCategory: string | null,
  existingMemories: MemoryWithCategory[],
  systemModel: BaseChatModel,
): Promise<string[]> {
  // Only check memories in the same category
  const sameCategoryMemories = existingMemories.filter(
    (m) => m.category === newCategory && m.content !== newContent,
  );

  if (sameCategoryMemories.length === 0) return [];

  const memoriesList = sameCategoryMemories
    .map((m, i) => `${i + 1}. [ID: ${m.id}] "${m.content}"`)
    .join('\n');

  const prompt = `You are a memory conflict detector. A user's personal memory system has these existing facts:

${memoriesList}

A new fact has been learned: "${newContent}"

Which of the existing facts are DIRECTLY contradicted or made outdated by this new fact? Only identify facts that are about the SAME specific attribute/topic and express a DIFFERENT or incompatible value. For example, "Lives in Chicago" contradicts "Resides in Las Vegas" because both are about where the user lives but state different locations.

Do NOT flag facts that are merely related but not contradictory.

Return ONLY a JSON array of the IDs of contradicted facts, e.g. ["id1", "id2"]. If no facts are contradicted, return [].`;

  try {
    const response = await systemModel.invoke([new HumanMessage(prompt)]);
    const responseText =
      typeof response.content === 'string'
        ? response.content.trim()
        : String(response.content).trim();

    const jsonMatch = responseText.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    // Validate that returned IDs exist in our candidates
    const validIds = new Set(sameCategoryMemories.map((m) => m.id));
    return parsed.filter(
      (id: unknown) => typeof id === 'string' && validIds.has(id),
    );
  } catch (error) {
    console.warn('findConflictsWithLLM: Failed to detect conflicts', error);
    return [];
  }
}
