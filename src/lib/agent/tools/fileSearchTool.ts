import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { RunnableConfig } from '@langchain/core/runnables';
import { Document } from '@langchain/core/documents';
import {
  processFilesToDocuments,
  getRankedDocs,
} from '@/lib/utils/fileProcessing';
import { CachedEmbeddings } from '@/lib/utils/cachedEmbeddings';
import { writer } from '@langchain/langgraph';

const FileSearchToolSchema = z.object({
  query: z
    .string()
    .describe('The search query to find relevant content in files'),
  maxResults: z
    .number()
    .optional()
    .default(12)
    .describe('Maximum number of results to return'),
  similarityThreshold: z
    .number()
    .optional()
    .default(0.3)
    .describe('Minimum similarity threshold for results'),
});

export const fileSearchTool = tool(
  async (
    input: z.infer<typeof FileSearchToolSchema>,
    config?: RunnableConfig,
  ): Promise<string> => {
    const { query, maxResults = 12, similarityThreshold = 0.3 } = input;

    const retrievalSignal: AbortSignal | undefined =
      config?.configurable?.retrievalSignal;

    if (retrievalSignal?.aborted || config?.signal?.aborted) {
      return 'File search cancelled.';
    }

    const fileIds: string[] = config?.configurable?.fileIds || [];
    if (!fileIds.length) {
      return 'No files attached to search.';
    }

    const embeddings: CachedEmbeddings | undefined =
      config?.configurable?.embeddings;
    if (!embeddings) {
      return 'Error: Embeddings not available in config.';
    }

    try {
      const fileDocuments = await processFilesToDocuments(fileIds);
      if (!fileDocuments.length) {
        return 'No searchable content found in attached files.';
      }

      const queryEmbedding = await embeddings.embedQuery(query);
      const rankedDocuments = getRankedDocs(
        queryEmbedding,
        fileDocuments,
        maxResults,
        similarityThreshold,
      );

      const documents: Document[] = rankedDocuments.map((doc) => {
        const { embeddings: _emb, ...metadataWithoutEmbeddings } =
          doc.metadata || {};
        return new Document({
          pageContent: doc.pageContent,
          metadata: {
            ...metadataWithoutEmbeddings,
            source: 'file_search',
            searchQuery: query,
            similarityScore: doc.metadata?.similarity || 0,
          },
        });
      });

      if (documents.length > 0) {
        try {
          writer({
            type: 'sources_added',
            data: documents,
            searchQuery: query,
          });
        } catch {
          // writer not available
        }
      }

      return JSON.stringify({
        documents,
        processedFiles: fileIds.length,
        relevantSections: documents.length,
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return `Error occurred during file search: ${errorMessage}`;
    }
  },
  {
    name: 'file_search',
    description:
      'Searches through all uploaded files to find relevant content sections based on a query using semantic similarity. Automatically searches all available files.',
    schema: FileSearchToolSchema,
  },
);
