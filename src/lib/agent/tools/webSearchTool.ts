import { searchSearxng } from '@/lib/searxng';
import { CachedEmbeddings } from '@/lib/utils/cachedEmbeddings';
import computeSimilarity from '@/lib/utils/computeSimilarity';
import { isSoftStop } from '@/lib/utils/runControl';
import { RunnableConfig } from '@langchain/core/runnables';
import { tool } from '@langchain/core/tools';
import { Document } from '@langchain/core/documents';
import { writer } from '@langchain/langgraph';
import { z } from 'zod';

const WebSearchToolSchema = z.object({
  query: z
    .string()
    .describe(
      'The query to use for web search. You can limit the scope to specific websites by including "site:example.com" in the query.',
    ),
});

export const webSearchTool = tool(
  async (
    input: z.infer<typeof WebSearchToolSchema>,
    config?: RunnableConfig,
  ): Promise<string> => {
    const { query } = input;

    const embeddings: CachedEmbeddings | undefined =
      config?.configurable?.embeddings;
    const retrievalSignal: AbortSignal | undefined =
      config?.configurable?.retrievalSignal;
    const messageId: string | undefined = config?.configurable?.messageId;

    if (!embeddings) {
      return 'Error: Embeddings not available in config.';
    }

    if (messageId && isSoftStop(messageId)) {
      return 'Soft-stop set; skipping web search.';
    }

    try {
      console.log(`webSearchTool: Performing web search for query: "${query}"`);
      const searchResults = await searchSearxng(
        query,
        { language: 'en', engines: [] },
        retrievalSignal,
      );

      if (!searchResults.results || searchResults.results.length === 0) {
        return 'No search results found.';
      }

      const queryVector = await embeddings.embedQuery(query);

      const resultsWithSimilarity = await Promise.all(
        searchResults.results.map(async (result) => {
          const content = result.title + ' ' + (result.content || '');
          const vector = await embeddings.embedQuery(content);
          const similarity = computeSimilarity(vector, queryVector);
          return { result, similarity };
        }),
      );

      const documents: Document[] = [];

      // Top 3 results always included
      searchResults.results.slice(0, 3).forEach((result) => {
        documents.push(
          new Document({
            pageContent: `${result.title || 'Untitled'}\n\n${result.content || ''}`,
            metadata: {
              title: result.title || 'Untitled',
              url: result.url,
              source: result.url,
              processingType: 'preview-only',
              searchQuery: query,
            },
          }),
        );
      });

      // Top 5 by relevance from remaining
      resultsWithSimilarity
        .slice(3)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 5)
        .forEach(({ result }) => {
          documents.push(
            new Document({
              pageContent: `${result.title || 'Untitled'}\n\n${result.content || ''}`,
              metadata: {
                title: result.title || 'Untitled',
                url: result.url,
                source: result.url,
                processingType: 'preview-only',
                searchQuery: query,
              },
            }),
          );
        });

      // Emit sources as custom event for the UI
      try {
        writer({ type: 'sources_added', data: documents, searchQuery: query });
      } catch {
        // writer not available (no custom streamMode)
      }

      return JSON.stringify({ documents });
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.name === 'CanceledError' || error.name === 'AbortError')
      ) {
        return 'Web search aborted.';
      }
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return `Error occurred during web search: ${errorMessage}`;
    }
  },
  {
    name: 'web_search',
    description:
      'Performs web search using SearXNG and returns ranked search results. Use for finding current information, news, facts, and web resources.',
    schema: WebSearchToolSchema,
  },
);
