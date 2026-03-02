import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { RunnableConfig } from '@langchain/core/runnables';
import { Document } from '@langchain/core/documents';
import { searchSearxng } from '@/lib/searxng';
import { writer } from '@langchain/langgraph';

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
  ): Promise<string> => {
    const { query, maxResults = 12 } = input;

    const retrievalSignal: AbortSignal | undefined =
      config?.configurable?.retrievalSignal;

    try {
      const searchResults = await searchSearxng(
        query,
        { language: 'en', engines: ['bing images', 'google images'] },
        retrievalSignal,
      );

      const images = (searchResults.results || [])
        .filter((r) => r && r.img_src && r.url)
        .slice(0, maxResults);

      if (!images.length) {
        return 'No image results found.';
      }

      const documents: Document[] = images.map(
        (img) =>
          new Document({
            pageContent: `${img.title || 'Image'}\n${img.url}`,
            metadata: {
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

      try {
        writer({ type: 'sources_added', data: documents, searchQuery: query });
      } catch {
        // writer not available
      }

      return JSON.stringify({ images });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return `Error occurred during image search: ${errorMessage}`;
    }
  },
  {
    name: 'image_search',
    description:
      'Searches the web for images related to a query using SearXNG and returns image URLs, titles, and sources. Use when the user asks for pictures, photos, charts, or visual examples.',
    schema: ImageSearchToolSchema,
  },
);
