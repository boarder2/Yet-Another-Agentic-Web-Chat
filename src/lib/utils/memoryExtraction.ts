import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage } from '@langchain/core/messages';
import {
  extractionPrompt,
  type ExistingMemorySummary,
} from '@/lib/prompts/memory/extraction';
import { isSensitive } from './sensitiveDataFilter';
import { embedMemoryContent } from './memoryEmbedding';
import {
  findDuplicate,
  findNearDuplicates,
  checkSimilarityWithLLM,
  findConflictsWithLLM,
} from './memoryDeduplication';
import { classifyMemory, MemoryCategory } from './memoryCategories';
import { CachedEmbeddings } from './cachedEmbeddings';
import db from '@/lib/db';
import { memories } from '@/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';

export type ExtractedFact = {
  action: 'create' | 'update' | 'skip';
  content: string;
  suggestedCategory: string;
  id?: string; // existing memory ID for updates
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
  existingMemories: ExistingMemorySummary[] = [],
): Promise<ExtractedFact[]> {
  try {
    const prompt = extractionPrompt(
      userMessage,
      assistantResponse,
      existingMemories,
    );
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

    return parsed
      .filter(
        (item: unknown) =>
          item &&
          typeof item === 'object' &&
          'content' in (item as Record<string, unknown>) &&
          typeof (item as Record<string, string>).content === 'string' &&
          (item as Record<string, string>).content.trim().length > 0,
      )
      .map((item: Record<string, unknown>) => ({
        action:
          item.action === 'update' || item.action === 'skip'
            ? (item.action as 'update' | 'skip')
            : 'create',
        content: (item.content as string).trim(),
        suggestedCategory: (item.suggestedCategory as string) ?? 'Preference',
        ...(item.id ? { id: item.id as string } : {}),
      })) as ExtractedFact[];
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

  // Fetch existing memories for context-aware extraction
  const existingMemories = await db
    .select({
      id: memories.id,
      content: memories.content,
      category: memories.category,
      embedding: memories.embedding,
      embeddingModel: memories.embeddingModel,
    })
    .from(memories)
    .all();

  const memorySummaries: ExistingMemorySummary[] = existingMemories.map(
    (m) => ({
      id: m.id,
      content: m.content,
      category: m.category,
    }),
  );

  const facts = await extractMemories(
    userMessage,
    assistantResponse,
    systemModel,
    memorySummaries,
  );
  if (facts.length === 0) return result;

  const embeddingModelId = embeddingModel.getIdentifier();

  for (const fact of facts) {
    // Skip actions don't persist anything
    if (fact.action === 'skip') {
      continue;
    }

    // Sensitive data check
    const sensitiveCheck = isSensitive(fact.content);
    if (sensitiveCheck.sensitive) {
      result.blocked++;
      continue;
    }

    // Handle update action: merge into existing memory
    if (fact.action === 'update' && fact.id) {
      const target = existingMemories.find((m) => m.id === fact.id);
      if (target) {
        const embedding = await embedMemoryContent(
          fact.content,
          embeddingModel,
        );
        await db
          .update(memories)
          .set({
            content: fact.content,
            embedding: JSON.stringify(embedding),
            embeddingModel: embeddingModel.getIdentifier(),
            updatedAt: new Date(),
          })
          .where(eq(memories.id, target.id))
          .execute();
        result.updated++;
        result.memories.push({
          id: target.id,
          content: fact.content,
          category: target.category,
        });
        continue;
      }
      // If referenced memory not found, fall through to create
    }

    // Create action (or update fallback if ID not found)
    const embedding = await embedMemoryContent(fact.content, embeddingModel);

    // Safety net: embedding-based deduplication still catches near-duplicates
    const duplicate = findDuplicate(
      embedding,
      existingMemories,
      embeddingModelId,
    );

    if (duplicate) {
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
      // Gray zone: check near-duplicates with LLM before creating
      const nearDuplicates = findNearDuplicates(
        embedding,
        existingMemories,
        embeddingModelId,
      );
      const llmMatch = await checkSimilarityWithLLM(
        fact.content,
        nearDuplicates,
        systemModel,
      );

      if (llmMatch) {
        // LLM confirmed it's the same fact — update instead of creating
        await db
          .update(memories)
          .set({
            content: fact.content,
            embedding: JSON.stringify(embedding),
            embeddingModel: embeddingModel.getIdentifier(),
            updatedAt: new Date(),
          })
          .where(eq(memories.id, llmMatch.id))
          .execute();
        result.updated++;
        result.memories.push({
          id: llmMatch.id,
          content: fact.content,
          category: null,
        });
        continue;
      }

      const category: MemoryCategory = await classifyMemory(
        fact.content,
        systemModel,
      );

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
