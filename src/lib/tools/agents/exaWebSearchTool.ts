import { searchExa, ExaSearchType, ExaCategory } from '@/lib/exa';
import { SimplifiedAgentStateType } from '@/lib/state/chatAgentState';
import { isSoftStop } from '@/lib/utils/runControl';
import { ToolMessage } from '@langchain/core/messages';
import { RunnableConfig } from '@langchain/core/runnables';
import { tool } from '@langchain/core/tools';
import { Command, getCurrentTaskInput } from '@langchain/langgraph';
import { Document } from '@langchain/core/documents';
import { z } from 'zod';

// Schema for Exa web search tool input
const ExaWebSearchToolSchema = z.object({
  query: z
    .string()
    .describe(
      'Natural-language search query. Exa is neural/semantic first, so phrase the query as you would describe the result you expect (e.g. "blog posts about Rust async runtimes" rather than keyword-only).',
    ),
  searchType: z
    .enum(['auto', 'neural', 'fast', 'instant'])
    .optional()
    .default('auto')
    .describe(
      'Search algorithm: "auto" picks the best method, "neural" for semantic/concept queries, "fast"/"instant" for low-latency lookups.',
    ),
  numResults: z
    .number()
    .int()
    .min(1)
    .max(25)
    .optional()
    .default(10)
    .describe('Number of results to return (1-25).'),
  category: z
    .enum([
      'company',
      'research paper',
      'news',
      'pdf',
      'personal site',
      'financial report',
      'people',
    ])
    .optional()
    .describe(
      'Optional category filter to restrict results to a specific data type.',
    ),
  includeDomains: z
    .array(z.string())
    .optional()
    .describe('Only return results from these domains.'),
  excludeDomains: z
    .array(z.string())
    .optional()
    .describe('Exclude results from these domains.'),
  includeText: z
    .array(z.string())
    .max(1)
    .optional()
    .describe(
      'Require result text to contain this phrase (single short phrase, up to 5 words).',
    ),
  startPublishedDate: z
    .string()
    .optional()
    .describe('ISO 8601 datetime; only return results published after this.'),
  endPublishedDate: z
    .string()
    .optional()
    .describe('ISO 8601 datetime; only return results published before this.'),
});

/**
 * ExaWebSearchTool - Neural/semantic web search powered by the Exa API.
 *
 * Companion to `web_search` (SearXNG). Registered only when an Exa API key is
 * configured. Returns Document objects with content synthesized from Exa
 * highlights/summary/text so the agent gets usable snippets without a
 * follow-up fetch for short answers.
 */
export const exaWebSearchTool = tool(
  async (
    input: z.infer<typeof ExaWebSearchToolSchema>,
    config?: RunnableConfig,
  ) => {
    try {
      const {
        query,
        searchType,
        numResults,
        category,
        includeDomains,
        excludeDomains,
        includeText,
        startPublishedDate,
        endPublishedDate,
      } = input;

      const currentState = getCurrentTaskInput() as SimplifiedAgentStateType;
      let currentDocCount = currentState.relevantDocuments?.length ?? 0;

      const retrievalSignal: AbortSignal | undefined = (
        config as unknown as Record<string, Record<string, unknown>>
      )?.configurable?.retrievalSignal as AbortSignal | undefined;
      const messageId: string | undefined = (
        config as unknown as Record<string, Record<string, unknown>>
      )?.configurable?.messageId as string | undefined;

      console.log(
        `ExaWebSearchTool: Performing Exa search for query: "${query}"`,
      );

      if (messageId && isSoftStop(messageId)) {
        return new Command({
          update: {
            relevantDocuments: [],
            messages: [
              new ToolMessage({
                content: 'Soft-stop set; skipping Exa web search.',
                tool_call_id: (
                  config as unknown as { toolCall: { id: string } }
                )?.toolCall.id,
              }),
            ],
          },
        });
      }

      const searchResults = await searchExa(
        query,
        {
          type: searchType as ExaSearchType,
          numResults,
          category: category as ExaCategory | undefined,
          includeDomains,
          excludeDomains,
          includeText,
          startPublishedDate,
          endPublishedDate,
        },
        retrievalSignal,
      );

      console.log(
        `ExaWebSearchTool: Found ${searchResults.results.length} search results`,
      );

      if (!searchResults.results || searchResults.results.length === 0) {
        return new Command({
          update: {
            relevantDocuments: [],
            messages: [
              new ToolMessage({
                content: 'No search results found.',
                tool_call_id: (
                  config as unknown as { toolCall: { id: string } }
                )?.toolCall.id,
              }),
            ],
          },
        });
      }

      const documents: Document[] = searchResults.results.map((result) => {
        const title = result.title || 'Untitled';
        const snippet = result.content || '';

        return new Document({
          pageContent: `${title}\n\n${snippet}`,
          metadata: {
            sourceId: ++currentDocCount,
            title,
            url: result.url,
            source: result.url,
            processingType: 'exa-search',
            searchQuery: query,
            publishedDate: result.publishedDate,
            author: result.author,
            score: result.score,
            favicon: result.favicon,
          },
        });
      });

      return new Command({
        update: {
          relevantDocuments: documents,
          messages: [
            new ToolMessage({
              content: JSON.stringify({
                document: documents,
              }),
              tool_call_id: (config as unknown as { toolCall: { id: string } })
                ?.toolCall.id,
            }),
          ],
        },
      });
    } catch (error: unknown) {
      console.error('ExaWebSearchTool: Error during Exa search:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      // Treat abort as non-fatal/no-op update, matching simpleWebSearchTool.
      if (
        error instanceof Error &&
        (error.name === 'CanceledError' || error.name === 'AbortError')
      ) {
        return new Command({
          update: {
            relevantDocuments: [],
            messages: [
              new ToolMessage({
                content: 'Exa web search aborted by soft-stop.',
                tool_call_id: (
                  config as unknown as { toolCall: { id: string } }
                )?.toolCall.id,
              }),
            ],
          },
        });
      }

      return new Command({
        update: {
          relevantDocuments: [],
          messages: [
            new ToolMessage({
              content: 'Error occurred during Exa web search: ' + errorMessage,
              tool_call_id: (config as unknown as { toolCall: { id: string } })
                ?.toolCall.id,
            }),
          ],
        },
      });
    }
  },
  {
    name: 'exa_web_search',
    description:
      'Neural/semantic web search powered by Exa (exa.ai). Returns ranked results with pre-extracted snippets (highlights/summary) so the agent often does not need a follow-up URL fetch. Use for concept-level or research queries, date-filtered news, category-scoped searches (news, research paper, company, financial report, etc.), and when a single high-quality answer matters more than breadth. Supports includeDomains/excludeDomains and includeText filters.',
    schema: ExaWebSearchToolSchema,
  },
);
