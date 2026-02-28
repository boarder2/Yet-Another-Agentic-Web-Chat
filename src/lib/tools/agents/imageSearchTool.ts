import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { RunnableConfig } from '@langchain/core/runnables';
import { searchSearxng } from '@/lib/searxng';
import { dispatchCustomEvent } from '@langchain/core/callbacks/dispatch';

// Schema for image search tool input
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

/**
 * ImageSearchTool - Performs image search via SearXNG and returns image results
 */
export const imageSearchTool = tool(
  async (
    input: z.infer<typeof ImageSearchToolSchema>,
    config?: RunnableConfig,
  ) => {
    try {
      const { query, maxResults = 12 } = input;

      console.log(`ImageSearchTool: Searching images for query: "${query}"`);
      const retrievalSignal: AbortSignal | undefined =
        config?.configurable?.retrievalSignal as AbortSignal | undefined;

      const searchResults = await searchSearxng(
        query,
        {
          language: 'en',
          engines: ['bing images', 'google images'],
        },
        retrievalSignal,
      );

      const images = (searchResults.results || [])
        .filter((r) => r && r.img_src && r.url)
        .slice(0, maxResults);

      if (images.length === 0) {
        return 'No image results found.';
      }

      // Emit source metadata as custom event for frontend
      const sources = images.map((img, i) => ({
        sourceId: i + 1,
        title: img.title || 'Image',
        url: img.url,
        img_src: img.img_src,
        thumbnail: img.thumbnail || undefined,
      }));

      await dispatchCustomEvent('sources', {
        sources,
        searchQuery: query,
        type: 'images',
      }, config);

      const formattedResults = images
        .map(
          (img, i) =>
            `[${i + 1}] ${img.title || 'Image'}\nURL: ${img.url}\nImage: ${img.img_src}`,
        )
        .join('\n\n');

      return formattedResults;
    } catch (error) {
      console.error('ImageSearchTool: Error during image search:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return 'Error occurred during image search: ' + errorMessage;
    }
  },
  {
    name: 'image_search',
    description:
      'Searches the web for images related to a query using SearXNG and returns image URLs, titles, and sources. Use when the user asks for pictures, photos, charts, or visual examples.',
    schema: ImageSearchToolSchema,
  },
);
