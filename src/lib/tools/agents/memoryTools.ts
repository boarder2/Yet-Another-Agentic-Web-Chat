import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { RunnableConfig } from '@langchain/core/runnables';
import db from '@/lib/db';
import { memories } from '@/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { isSensitive } from '@/lib/utils/sensitiveDataFilter';
import { embedMemoryContent } from '@/lib/utils/memoryEmbedding';
import {
  classifyMemory,
  type MemoryCategory,
} from '@/lib/utils/memoryCategories';
import computeSimilarity from '@/lib/utils/computeSimilarity';
import { findConflictsWithLLM } from '@/lib/utils/memoryDeduplication';

const DUPLICATE_THRESHOLD = 0.8;

export const saveMemoryTool = tool(
  async (
    input: { content: string; sensitivityOverride?: boolean },
    config?: RunnableConfig,
  ): Promise<string> => {
    const embeddings = config?.configurable?.embeddings;
    const systemLlm = config?.configurable?.systemLlm;

    if (!input.content || input.content.trim().length === 0) {
      return 'Error: No content provided to save.';
    }

    // Sensitive data check
    if (!input.sensitivityOverride) {
      const sensitiveCheck = isSensitive(input.content);
      if (sensitiveCheck.sensitive) {
        return `SENSITIVE_WARNING: ${sensitiveCheck.reason}. This memory was not saved. The content may contain sensitive information.`;
      }
    }

    try {
      let embedding: number[] | null = null;
      let embeddingIdentifier: string | null = null;
      let category: MemoryCategory = 'Preference';

      if (embeddings) {
        embedding = await embedMemoryContent(input.content.trim(), embeddings);
        embeddingIdentifier = embeddings.getIdentifier();

        // Check for duplicates and conflicts among same-model memories
        const existingMemories = await db
          .select({
            id: memories.id,
            content: memories.content,
            embedding: memories.embedding,
            embeddingModel: memories.embeddingModel,
          })
          .from(memories)
          .all();

        for (const existing of existingMemories) {
          if (
            !existing.embedding ||
            existing.embeddingModel !== embeddingIdentifier
          )
            continue;
          const existingEmbedding: number[] = JSON.parse(existing.embedding);
          const score = computeSimilarity(embedding, existingEmbedding);

          if (score >= DUPLICATE_THRESHOLD) {
            // Update in place rather than creating a duplicate
            await db
              .update(memories)
              .set({
                content: input.content.trim(),
                embedding: JSON.stringify(embedding),
                updatedAt: new Date(),
              })
              .where(eq(memories.id, existing.id))
              .execute();
            return `Updated existing memory: "${existing.content}" → "${input.content.trim()}"`;
          }
        }
      }

      if (systemLlm) {
        category = await classifyMemory(input.content.trim(), systemLlm);

        // Use LLM to find and remove conflicting memories
        const allMemoriesWithCategory = await db
          .select({
            id: memories.id,
            content: memories.content,
            category: memories.category,
          })
          .from(memories)
          .all();

        const conflictIds = await findConflictsWithLLM(
          input.content.trim(),
          category,
          allMemoriesWithCategory,
          systemLlm,
        );

        if (conflictIds.length > 0) {
          await db
            .delete(memories)
            .where(inArray(memories.id, conflictIds))
            .execute();
        }
      }

      const id = crypto.randomUUID();
      const now = new Date();
      const chatId = config?.configurable?.chatId;
      const workspaceId = config?.configurable?.workspaceId ?? null;

      await db
        .insert(memories)
        .values({
          id,
          content: input.content.trim(),
          embedding: embedding ? JSON.stringify(embedding) : null,
          embeddingModel: embeddingIdentifier,
          category,
          sourceType: 'automatic',
          sourceChatId: chatId ?? null,
          workspaceId,
          createdAt: now,
          updatedAt: now,
        })
        .execute();

      return `Saved memory: "${input.content.trim()}" (Category: ${category})`;
    } catch (error) {
      console.error('save_memory tool error:', error);
      return 'Error: Failed to save memory. Please try again.';
    }
  },
  {
    name: 'save_memory',
    description:
      'Save a fact, preference, or instruction about the user to long-term memory. Use when the user explicitly asks you to remember something.',
    schema: z.object({
      content: z.string().describe('The fact or preference to remember'),
      sensitivityOverride: z
        .boolean()
        .optional()
        .describe(
          'If true, skip sensitivity check (only after user confirmation)',
        ),
    }),
  },
);

export const deleteMemoryTool = tool(
  async (
    input: { query: string; id?: string },
    config?: RunnableConfig,
  ): Promise<string> => {
    const embeddings = config?.configurable?.embeddings;

    try {
      // If an explicit ID is provided, delete directly without search
      if (input.id) {
        const target = await db.query.memories.findFirst({
          where: eq(memories.id, input.id),
        });
        if (!target) {
          return `No memory found with id: "${input.id}"`;
        }
        await db.delete(memories).where(eq(memories.id, input.id)).execute();
        return `Deleted memory: "${target.content}"`;
      }

      const allMemories = await db.select().from(memories).all();

      if (allMemories.length === 0) {
        return 'No memories found to delete.';
      }

      if (embeddings) {
        const queryEmbedding = await embeddings.embedQuery(input.query);
        const embeddingIdentifier = embeddings.getIdentifier();

        let bestMatch: (typeof allMemories)[0] | null = null;
        let bestScore = 0;

        for (const memory of allMemories) {
          if (!memory.embedding) continue;
          if (memory.embeddingModel !== embeddingIdentifier) continue;
          const memoryEmbedding: number[] = JSON.parse(memory.embedding);
          const score = computeSimilarity(queryEmbedding, memoryEmbedding);
          if (score > bestScore) {
            bestScore = score;
            bestMatch = memory;
          }
        }

        if (bestMatch && bestScore >= 0.7) {
          await db
            .delete(memories)
            .where(eq(memories.id, bestMatch.id))
            .execute();
          return `Deleted memory: "${bestMatch.content}"`;
        }
      }

      // Fallback: text-based search
      const textMatch = allMemories.find((m) =>
        m.content.toLowerCase().includes(input.query.toLowerCase()),
      );
      if (textMatch) {
        await db
          .delete(memories)
          .where(eq(memories.id, textMatch.id))
          .execute();
        return `Deleted memory: "${textMatch.content}"`;
      }

      return `No matching memory found for: "${input.query}"`;
    } catch (error) {
      console.error('delete_memory tool error:', error);
      return 'Error: Failed to delete memory. Please try again.';
    }
  },
  {
    name: 'delete_memory',
    description:
      'Delete a stored memory. Prefer using the `id` field (from list_memories) for precise deletion. Fall back to `query` for fuzzy matching.',
    schema: z.object({
      query: z
        .string()
        .describe(
          'Description of the memory to find and delete (used when id is not provided)',
        ),
      id: z
        .string()
        .optional()
        .describe(
          'The exact memory ID from list_memories. When provided, deletes that specific memory without any search.',
        ),
    }),
  },
);

export const listMemoriesTool = tool(
  async (): Promise<string> => {
    try {
      const allMemories = await db.select().from(memories).all();

      if (allMemories.length === 0) {
        return 'No memories stored yet.';
      }

      const grouped: Record<string, string[]> = {};
      for (const memory of allMemories) {
        const cat = memory.category || 'Uncategorized';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(memory.content);
      }

      // Build id lookup for output
      const idMap = new Map(allMemories.map((m) => [m.content, m.id]));

      let result = `You have ${allMemories.length} stored memories:\n\n`;
      for (const [category, items] of Object.entries(grouped)) {
        result += `**${category}**:\n`;
        for (const item of items) {
          const id = idMap.get(item);
          result += `- [id: ${id}] ${item}\n`;
        }
        result += '\n';
      }

      return result;
    } catch (error) {
      console.error('list_memories tool error:', error);
      return 'Error: Failed to retrieve memories.';
    }
  },
  {
    name: 'list_memories',
    description:
      'List all stored memories about the user, grouped by category. Use when the user asks what you remember about them.',
    schema: z.object({}),
  },
);

export const memoryTools = [saveMemoryTool, deleteMemoryTool, listMemoriesTool];
