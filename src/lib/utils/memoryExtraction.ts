import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage } from '@langchain/core/messages';
import { extractionPrompt } from '@/lib/prompts/memory/extraction';
import { isSensitive } from './sensitiveDataFilter';
import { embedMemoryContent } from './memoryEmbedding';
import { findDuplicate, findConflictsWithLLM } from './memoryDeduplication';
import { classifyMemory, MemoryCategory } from './memoryCategories';
import { CachedEmbeddings } from './cachedEmbeddings';
import db from '@/lib/db';
import { memories } from '@/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';

export type ExtractedFact = {
  content: string;
  suggestedCategory: string;
};

export type ExtractionResult = {
  saved: number;
  updated: number;
  blocked: number;
  memories: Array<{ id: string; content: string; category: string | null }>;
};

export async function extractMemories(
  userMessage: string,
  assistantResponse: string,
  systemModel: BaseChatModel,
): Promise<ExtractedFact[]> {
  try {
    const prompt = extractionPrompt(userMessage, assistantResponse);
    const response = await systemModel.invoke([new HumanMessage(prompt)]);
    const responseText =
      typeof response.content === 'string'
        ? response.content.trim()
        : String(response.content).trim();

    // Extract JSON array from response (handle potential markdown wrapping)
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (item: unknown) =>
        item &&
        typeof item === 'object' &&
        'content' in (item as Record<string, unknown>) &&
        typeof (item as Record<string, string>).content === 'string' &&
        (item as Record<string, string>).content.trim().length > 0,
    ) as ExtractedFact[];
  } catch (error) {
    console.warn('extractMemories: Failed to extract memories', error);
    return [];
  }
}

export async function processExtraction(
  userMessage: string,
  assistantResponse: string,
  systemModel: BaseChatModel,
  embeddingModel: CachedEmbeddings,
  sourceChatId?: string,
): Promise<ExtractionResult> {
  const result: ExtractionResult = {
    saved: 0,
    updated: 0,
    blocked: 0,
    memories: [],
  };

  const facts = await extractMemories(
    userMessage,
    assistantResponse,
    systemModel,
  );
  if (facts.length === 0) return result;

  const existingMemories = await db
    .select({
      id: memories.id,
      content: memories.content,
      embedding: memories.embedding,
      embeddingModel: memories.embeddingModel,
    })
    .from(memories)
    .all();

  const embeddingModelId = embeddingModel.getIdentifier();

  for (const fact of facts) {
    // Sensitive data check
    const sensitiveCheck = isSensitive(fact.content);
    if (sensitiveCheck.sensitive) {
      result.blocked++;
      continue;
    }

    // Compute embedding
    const embedding = await embedMemoryContent(fact.content, embeddingModel);

    // Check for duplicates (only among memories with same embedding model)
    const duplicate = findDuplicate(
      embedding,
      existingMemories,
      embeddingModelId,
    );

    if (duplicate) {
      // Update existing memory if new version is potentially more specific
      await db
        .update(memories)
        .set({
          content: fact.content,
          embedding: JSON.stringify(embedding),
          embeddingModel: embeddingModel.getIdentifier(),
          updatedAt: new Date(),
        })
        .where(eq(memories.id, duplicate.id))
        .execute();
      result.updated++;
      result.memories.push({
        id: duplicate.id,
        content: fact.content,
        category: null,
      });
    } else {
      // Classify first so we can use category for conflict detection
      const category: MemoryCategory = await classifyMemory(
        fact.content,
        systemModel,
      );

      // Use LLM to find memories that are contradicted by this new fact
      const allMemoriesWithCategory = await db
        .select({
          id: memories.id,
          content: memories.content,
          category: memories.category,
        })
        .from(memories)
        .all();

      const conflictIds = await findConflictsWithLLM(
        fact.content,
        category,
        allMemoriesWithCategory,
        systemModel,
      );

      if (conflictIds.length > 0) {
        await db
          .delete(memories)
          .where(inArray(memories.id, conflictIds))
          .execute();
      }

      const id = crypto.randomUUID();
      const now = new Date();

      await db
        .insert(memories)
        .values({
          id,
          content: fact.content,
          embedding: JSON.stringify(embedding),
          embeddingModel: embeddingModel.getIdentifier(),
          category,
          sourceType: 'automatic',
          sourceChatId: sourceChatId ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .execute();

      result.saved++;
      result.memories.push({ id, content: fact.content, category });
    }
  }

  return result;
}
