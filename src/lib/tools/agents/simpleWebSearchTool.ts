import { getWebSearchProvider } from '@/lib/search/providers';
import { SimplifiedAgentStateType } from '@/lib/state/chatAgentState';
import { isSoftStop } from '@/lib/utils/runControl';
import { ToolMessage } from '@langchain/core/messages';
import { RunnableConfig } from '@langchain/core/runnables';
import { tool } from '@langchain/core/tools';
import { Command, getCurrentTaskInput } from '@langchain/langgraph';
import { Document } from '@langchain/core/documents';
import { z } from 'zod';

const MAX_RESULTS = 20;

const SimpleWebSearchToolSchema = z.object({
  query: z
    .string()
    .describe(
      'The query to use for web search. You can limit the scope to specific websites by including "site:example.com" in the query.',
    ),
});

/**
 * SimpleWebSearchTool
 *
 * Runs web search through the configured search provider and returns the first
 * 20 results as Documents, in provider order. No similarity ranking.
 */
export const simpleWebSearchTool = tool(
  async (
    input: z.infer<typeof SimpleWebSearchToolSchema>,
    config?: RunnableConfig,
  ) => {
    try {
      const { query } = input;
      const currentState = getCurrentTaskInput() as SimplifiedAgentStateType;
      let currentDocCount = currentState.relevantDocuments?.length ?? 0;

      const retrievalSignal: AbortSignal | undefined = (
        config as unknown as Record<string, Record<string, unknown>>
      )?.configurable?.retrievalSignal as AbortSignal | undefined;
      const messageId: string | undefined = (
        config as unknown as Record<string, Record<string, unknown>>
      )?.configurable?.messageId as string | undefined;
      const isPrivate: boolean = Boolean(
        (config as unknown as Record<string, Record<string, unknown>>)
          ?.configurable?.isPrivate,
      );

      console.log(
        `SimpleWebSearchTool: Performing web search for query: "${query}" (private=${isPrivate})`,
      );

      if (messageId && isSoftStop(messageId)) {
        return new Command({
          update: {
            relevantDocuments: [],
            messages: [
              new ToolMessage({
                content: 'Soft-stop set; skipping web search.',
                tool_call_id: (
                  config as unknown as { toolCall: { id: string } }
                )?.toolCall.id,
              }),
            ],
          },
        });
      }

      const provider = getWebSearchProvider({ isPrivate });
      const searchResults = await provider.webSearch(
        query,
        {},
        retrievalSignal,
      );

      console.log(
        `SimpleWebSearchTool: Found ${searchResults.results.length} search results via ${provider.id}`,
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

      const documents: Document[] = searchResults.results
        .slice(0, MAX_RESULTS)
        .map((result) => {
          return new Document({
            pageContent: `${result.title || 'Untitled'}\n\n${result.content || ''}`,
            metadata: {
              sourceId: ++currentDocCount,
              title: result.title || 'Untitled',
              url: result.url,
              source: result.url,
              processingType: 'preview-only',
              searchQuery: query,
            },
          });
        });

      console.log(
        `SimpleWebSearchTool: Created ${documents.length} documents from search results`,
      );

      return new Command({
        update: {
          relevantDocuments: documents,
          messages: [
            new ToolMessage({
              content: JSON.stringify({ document: documents }),
              tool_call_id: (config as unknown as { toolCall: { id: string } })
                ?.toolCall.id,
            }),
          ],
        },
      });
    } catch (error: unknown) {
      console.error('SimpleWebSearchTool: Error during web search:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      if (
        error instanceof Error &&
        (error.name === 'CanceledError' || error.name === 'AbortError')
      ) {
        return new Command({
          update: {
            relevantDocuments: [],
            messages: [
              new ToolMessage({
                content: 'Web search aborted by soft-stop.',
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
              content: 'Error occurred during web search: ' + errorMessage,
              tool_call_id: (config as unknown as { toolCall: { id: string } })
                ?.toolCall.id,
            }),
          ],
        },
      });
    }
  },
  {
    name: 'web_search',
    description:
      'Performs web search using the configured search provider and returns up to 20 results as documents in provider order.',
    schema: SimpleWebSearchToolSchema,
  },
);
