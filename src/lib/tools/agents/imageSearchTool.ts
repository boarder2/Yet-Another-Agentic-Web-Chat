import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { RunnableConfig } from '@langchain/core/runnables';
import { Document } from '@langchain/core/documents';
import { getImageSearchProvider } from '@/lib/search/providers';
import { Command, getCurrentTaskInput } from '@langchain/langgraph';
import { SimplifiedAgentStateType } from '@/lib/state/chatAgentState';
import { ToolMessage } from '@langchain/core/messages';

const ImageSearchToolSchema = z.object({
  query: z
    .string()
    .describe(
      'The image search query. Provide a concise description of what images to find.',
    ),
  maxResults: z
    .number()
    .optional()
    .default(12)
    .describe('Maximum number of image results to return.'),
});

export const imageSearchTool = tool(
  async (
    input: z.infer<typeof ImageSearchToolSchema>,
    config?: RunnableConfig,
  ) => {
    try {
      const { query, maxResults = 12 } = input;
      const currentState = getCurrentTaskInput() as SimplifiedAgentStateType;
      let currentDocCount = currentState.relevantDocuments?.length ?? 0;

      const retrievalSignal: AbortSignal | undefined = (
        config as unknown as Record<string, Record<string, unknown>>
      )?.configurable?.retrievalSignal as AbortSignal | undefined;
      const isPrivate: boolean = Boolean(
        (config as unknown as Record<string, Record<string, unknown>>)
          ?.configurable?.isPrivate,
      );

      const provider = getImageSearchProvider({ isPrivate });
      if (!provider || !provider.imageSearch) {
        return new Command({
          update: {
            messages: [
              new ToolMessage({
                content:
                  'Image search is not available with the currently configured search provider.',
                tool_call_id: (
                  config as unknown as { toolCall: { id: string } }
                )?.toolCall?.id,
              }),
            ],
          },
        });
      }

      console.log(
        `ImageSearchTool: Searching images for "${query}" via ${provider.id}`,
      );

      const searchResults = await provider.imageSearch(
        query,
        {},
        retrievalSignal,
      );

      const images = (searchResults.results || [])
        .filter((r) => r && r.img_src && r.url)
        .slice(0, maxResults);

      if (images.length === 0) {
        return new Command({
          update: {
            messages: [
              new ToolMessage({
                content: 'No image results found.',
                tool_call_id: (
                  config as unknown as { toolCall: { id: string } }
                )?.toolCall?.id,
              }),
            ],
          },
        });
      }

      const documents: Document[] = images.map(
        (img) =>
          new Document({
            pageContent: `${img.title || 'Image'}\n${img.url}`,
            metadata: {
              sourceId: ++currentDocCount,
              title: img.title || 'Image',
              url: img.url,
              source: img.url,
              img_src: img.img_src,
              thumbnail: img.thumbnail || undefined,
              processingType: 'image-search',
              searchQuery: query,
            },
          }),
      );

      return new Command({
        update: {
          relevantDocuments: documents,
          messages: [
            new ToolMessage({
              content: JSON.stringify({ images }),
              tool_call_id: (config as unknown as { toolCall: { id: string } })
                ?.toolCall?.id,
            }),
          ],
        },
      });
    } catch (error) {
      console.error('ImageSearchTool: Error during image search:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      return new Command({
        update: {
          messages: [
            new ToolMessage({
              content: 'Error occurred during image search: ' + errorMessage,
              tool_call_id: (config as unknown as { toolCall: { id: string } })
                ?.toolCall?.id,
            }),
          ],
        },
      });
    }
  },
  {
    name: 'image_search',
    description:
      'Searches the web for images related to a query and returns image URLs, titles, and sources. Use when the user asks for pictures, photos, charts, or visual examples.',
    schema: ImageSearchToolSchema,
  },
);
