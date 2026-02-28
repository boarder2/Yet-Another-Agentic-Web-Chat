import { searchSearxng } from '@/lib/searxng';
import { CachedEmbeddings } from '@/lib/utils/cachedEmbeddings';
import computeSimilarity from '@/lib/utils/computeSimilarity';
import { RunnableConfig } from '@langchain/core/runnables';
import { tool } from '@langchain/core/tools';
import { dispatchCustomEvent } from '@langchain/core/callbacks/dispatch';
import { z } from 'zod';

// Schema for simple web search tool input
const SimpleWebSearchToolSchema = z.object({
  query: z
    .string()
    .describe(
      'The query to use for web search. You can limit the scope to specific websites by including "site:example.com" in the query.',
    ),
});

/**
 * SimpleWebSearchTool - Performs web search using SearXNG
 *
 * This tool handles:
 * 1. Web search execution using SearXNG
 * 2. Document ranking and filtering (top 3 + ranked top 5)
 * 3. Returns search results as formatted text
 * 4. Emits source metadata via custom events for frontend display
 */
export const simpleWebSearchTool = tool(
  async (
    input: z.infer<typeof SimpleWebSearchToolSchema>,
    config?: RunnableConfig,
  ) => {
    try {
      const { query } = input;

      if (!config?.configurable?.embeddings) {
        throw new Error('Embeddings not available in config');
      }

      const embeddings: CachedEmbeddings = config.configurable.embeddings;
      const retrievalSignal: AbortSignal | undefined =
        config?.configurable?.retrievalSignal as AbortSignal | undefined;

      console.log(
        `SimpleWebSearchTool: Performing web search for query: "${query}"`,
      );

      const searchResults = await searchSearxng(
        query,
        {
          language: 'en',
          engines: [],
        },
        retrievalSignal,
      );

      console.log(
        `SimpleWebSearchTool: Found ${searchResults.results.length} search results`,
      );

      if (!searchResults.results || searchResults.results.length === 0) {
        return 'No search results found.';
      }

      // Calculate similarities and rank results
      const queryVector = await embeddings.embedQuery(query);

      const resultsWithSimilarity = await Promise.all(
        searchResults.results.map(async (result) => {
          const content = result.title + ' ' + (result.content || '');
          const vector = await embeddings.embedQuery(content);
          const similarity = computeSimilarity(vector, queryVector);
          return { result, similarity };
        }),
      );

      // Always take the top 3 results first
      const top3Results = searchResults.results.slice(0, 3);

      // Sort by relevance score and take top 5 from the remaining results
      const remainingResults = resultsWithSimilarity
        .slice(3)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 5);

      const allResults = [
        ...top3Results.map((r) => ({ result: r, rank: 'top-3' })),
        ...remainingResults.map(({ result }) => ({
          result,
          rank: 'ranked',
        })),
      ];

      // Emit source metadata as custom event for frontend
      const sources = allResults.map(({ result, rank }, i) => ({
        sourceId: i + 1,
        title: result.title || 'Untitled',
        url: result.url,
        rank,
      }));

      await dispatchCustomEvent('sources', {
        sources,
        searchQuery: query,
      }, config);

      // Build formatted text for LLM consumption
      const formattedResults = allResults
        .map(
          ({ result }, i) =>
            `[${i + 1}] ${result.title || 'Untitled'}\nURL: ${result.url}\n${result.content || ''}`,
        )
        .join('\n\n');

      console.log(
        `SimpleWebSearchTool: Created ${allResults.length} results from search`,
      );

      return formattedResults;
    } catch (error: unknown) {
      console.error('SimpleWebSearchTool: Error during web search:', error);

      if (
        error instanceof Error &&
        (error.name === 'CanceledError' || error.name === 'AbortError')
      ) {
        return 'Web search was cancelled.';
      }

      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return 'Error occurred during web search: ' + errorMessage;
    }
  },
  {
    name: 'web_search',
    description:
      'Performs web search using SearXNG and returns ranked search results as documents without content analysis or extraction',
    schema: SimpleWebSearchToolSchema,
  },
);
