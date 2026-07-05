import { z } from 'zod';
import { Document } from '@langchain/core/documents';
import { getImageSearchProvider } from '@/lib/search/providers';
import { Command, getCurrentTaskInput } from '@langchain/langgraph';
import { SimplifiedAgentStateType } from '@/lib/state/chatAgentState';
import { ToolMessage } from '@langchain/core/messages';
import { defineTool } from '@/lib/tools/defineTool';

const ImageSearchToolSchema = z.object({
  query: z.string(),
  maxResults: z.number().optional().default(12),
});

export const imageSearchTool = defineTool(
  async (input: z.infer<typeof ImageSearchToolSchema>, runtime) => {
    try {
      const { query, maxResults = 12 } = input;
      const currentState = getCurrentTaskInput() as SimplifiedAgentStateType;
      let currentDocCount = currentState.relevantDocuments?.length ?? 0;

      const { retrievalSignal, isPrivate } = runtime.context;

      const provider = getImageSearchProvider({ isPrivate });
      if (!provider || !provider.imageSearch) {
        return new Command({
          update: {
            messages: [
              new ToolMessage({
                content:
                  'Image search is not available with the currently configured search provider.',
                tool_call_id: runtime.toolCallId,
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
                tool_call_id: runtime.toolCallId,
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

      await runtime.persist({
        kind: 'image_search',
        body: `[image_search query="${query}" provider=${provider.id}]\n${images
          .map((img) => `${img.title || 'Image'}: ${img.url} (${img.img_src})`)
          .join('\n')}`,
        metadataExtras: { query, engine: provider.id, type: 'image' },
      });

      return new Command({
        update: {
          relevantDocuments: documents,
          messages: [
            new ToolMessage({
              content: JSON.stringify({ images }),
              tool_call_id: runtime.toolCallId,
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
              tool_call_id: runtime.toolCallId,
            }),
          ],
        },
      });
    }
  },
  {
    name: 'image_search',
    description: 'Web image search. Returns URLs, titles, sources.',
    schema: ImageSearchToolSchema,
  },
);
