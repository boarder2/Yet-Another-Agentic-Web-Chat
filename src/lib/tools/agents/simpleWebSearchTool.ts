import { getWebSearchProvider } from '@/lib/search/providers';
import { SimplifiedAgentStateType } from '@/lib/state/chatAgentState';
import { ToolMessage } from '@langchain/core/messages';
import { Command, getCurrentTaskInput } from '@langchain/langgraph';
import { Document } from '@langchain/core/documents';
import { z } from 'zod';
import { defineTool } from '@/lib/tools/defineTool';

const MAX_RESULTS = 20;

const SimpleWebSearchToolSchema = z.object({
  query: z.string().describe('Supports "site:example.com" to scope.'),
});

/**
 * SimpleWebSearchTool
 *
 * Runs web search through the configured search provider and returns the first
 * 20 results as Documents, in provider order. No similarity ranking.
 */
export const simpleWebSearchTool = defineTool(
  async (input: z.infer<typeof SimpleWebSearchToolSchema>, runtime) => {
    try {
      const { query } = input;
      const currentState = getCurrentTaskInput() as SimplifiedAgentStateType;
      let currentDocCount = currentState.relevantDocuments?.length ?? 0;

      const { retrievalSignal, isPrivate } = runtime.context;

      console.log(
        `SimpleWebSearchTool: Performing web search for query: "${query}" (private=${isPrivate})`,
      );

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
                tool_call_id: runtime.toolCallId,
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

      await runtime.persist({
        kind: 'web_search',
        body: `[web_search query="${query}" provider=${provider.id}]\n${documents
          .map(
            (d, i) =>
              `[${i + 1}] ${d.metadata.title} — ${d.metadata.url}\n${d.pageContent}`,
          )
          .join('\n\n')}`,
        metadataExtras: { query, engine: provider.id },
      });

      return new Command({
        update: {
          relevantDocuments: documents,
          messages: [
            new ToolMessage({
              content: JSON.stringify({ document: documents }),
              tool_call_id: runtime.toolCallId,
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
                tool_call_id: runtime.toolCallId,
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
              tool_call_id: runtime.toolCallId,
            }),
          ],
        },
      });
    }
  },
  {
    name: 'web_search',
    description: 'Web search; up to 20 results.',
    schema: SimpleWebSearchToolSchema,
  },
);
