import { z } from 'zod';
import { Document } from '@langchain/core/documents';
import { Command, getCurrentTaskInput } from '@langchain/langgraph';
import { ToolMessage } from '@langchain/core/messages';
import { SimplifiedAgentStateType } from '@/lib/state/chatAgentState';
import {
  processFilesToDocuments,
  getRankedDocs,
} from '@/lib/utils/fileProcessing';
import { defineTool } from '@/lib/tools/defineTool';

// Schema for file search tool input
const FileSearchToolSchema = z.object({
  query: z.string(),
  maxResults: z.number().optional().default(12),
  similarityThreshold: z.number().optional().default(0.3),
});

/**
 * FileSearchTool - Reimplementation of FileSearchAgent as a tool
 *
 * This tool handles:
 * 1. Processing uploaded files into searchable documents
 * 2. Performing similarity search across file content
 * 3. Ranking and filtering results by relevance
 * 4. Returning relevant file sections as documents
 */
export const fileSearchTool = defineTool(
  async (input: z.infer<typeof FileSearchToolSchema>, runtime) => {
    try {
      const { query, maxResults = 12, similarityThreshold = 0.3 } = input;

      const currentState = getCurrentTaskInput() as SimplifiedAgentStateType;
      let currentDocCount = currentState.relevantDocuments?.length ?? 0;

      const { retrievalSignal, embeddings, systemLlm } = runtime.context;

      // Check for cancellation early
      if (retrievalSignal?.aborted || runtime.signal?.aborted) {
        console.log('FileSearchTool: Operation cancelled');
        return new Command({
          update: {
            relevantDocuments: [],
            messages: [
              new ToolMessage({
                content: 'File search cancelled.',
                tool_call_id: runtime.toolCallId,
              }),
            ],
          },
        });
      }

      // Get fileIds from context (provided by the agent)
      const fileIds: string[] = runtime.context.fileIds || [];

      console.log(
        `FileSearchTool: Processing ${fileIds.length} files for query: "${query}"`,
      );

      // Check if we have files to process
      if (!fileIds || fileIds.length === 0) {
        console.log('FileSearchTool: No files provided for search');
        return new Command({
          update: {
            relevantDocuments: [],
            messages: [
              new ToolMessage({
                content: 'No files attached to search.',
                tool_call_id: runtime.toolCallId,
              }),
            ],
          },
        });
      }

      // Get embeddings from context
      if (!embeddings) {
        throw new Error('Embeddings not available in context');
      }
      // Ensure system LLM is present for any LLM-based extraction steps (future)
      if (!systemLlm) {
        throw new Error('System LLM not available in context');
      }

      // Step 1: Process files to documents
      console.log('FileSearchTool: Processing files to documents...');
      const fileDocuments = await processFilesToDocuments(fileIds);

      if (fileDocuments.length === 0) {
        console.log('FileSearchTool: No processable content found in files');
        return new Command({
          update: {
            relevantDocuments: [],
            messages: [
              new ToolMessage({
                content: 'No searchable content found in attached files.',
                tool_call_id: runtime.toolCallId,
              }),
            ],
          },
        });
      }

      console.log(
        `FileSearchTool: Processed ${fileDocuments.length} file sections`,
      );

      // Step 2: Generate query embedding for similarity search
      console.log('FileSearchTool: Generating query embedding...');
      const queryEmbedding = await embeddings.embedQuery(query);

      // Step 3: Perform similarity search and ranking
      console.log('FileSearchTool: Performing similarity search...');
      const rankedDocuments = getRankedDocs(
        queryEmbedding,
        fileDocuments,
        maxResults,
        similarityThreshold,
      );

      console.log(
        `FileSearchTool: Found ${rankedDocuments.length} relevant file sections`,
      );

      // Add search metadata to documents and remove embeddings to reduce context size
      const documentsWithMetadata = rankedDocuments.map((doc) => {
        // Extract metadata and exclude embeddings
        const { embeddings: _embeddings, ...metadataWithoutEmbeddings } =
          doc.metadata || {};

        return new Document({
          pageContent: doc.pageContent,
          metadata: {
            ...metadataWithoutEmbeddings,
            sourceId: ++currentDocCount,
            source: 'file_search',
            searchQuery: query,
            similarityScore: doc.metadata?.similarity || 0,
          },
        });
      });

      console.log(
        `FileSearchTool: Created ${documentsWithMetadata.length} documents from file search`,
      );

      const persistBody =
        `[file_search query="${query}"]\n` +
        rankedDocuments
          .map(
            (d) =>
              `[${(d.metadata?.title as string | undefined) ?? 'file'}] ${d.pageContent}`,
          )
          .join('\n\n');
      await runtime.persist({
        kind: 'file_search',
        body: persistBody,
        metadataExtras: { query, fileCount: fileIds.length },
      });

      return new Command({
        update: {
          relevantDocuments: documentsWithMetadata,
          messages: [
            new ToolMessage({
              content: JSON.stringify({
                documents: documentsWithMetadata,
                processedFiles: fileIds.length,
                relevantSections: rankedDocuments.length,
              }),
              tool_call_id: runtime.toolCallId,
            }),
          ],
        },
      });
    } catch (error) {
      console.error('FileSearchTool: Error during file search:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      return new Command({
        update: {
          relevantDocuments: [],
          messages: [
            new ToolMessage({
              content: 'Error occurred during file search: ' + errorMessage,
              tool_call_id: runtime.toolCallId,
            }),
          ],
        },
      });
    }
  },
  {
    name: 'file_search',
    description: 'Semantic search across uploaded files.',
    schema: FileSearchToolSchema,
  },
);
