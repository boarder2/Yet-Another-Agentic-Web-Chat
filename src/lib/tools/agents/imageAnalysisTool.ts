import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { RunnableConfig } from '@langchain/core/runnables';
import { HumanMessage } from '@langchain/core/messages';
import { removeThinkingBlocks } from '@/lib/utils/contentUtils';
import { dispatchCustomEvent } from '@langchain/core/callbacks/dispatch';
import axios from 'axios';

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB

const ALLOWED_MIME_PREFIXES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
];

const ImageAnalysisToolSchema = z.object({
  url: z.string().describe('The URL of the image to analyze'),
  query: z
    .string()
    .describe(
      'What to look for or describe about the image, guided by the user query',
    ),
});

/**
 * ImageAnalysisTool - Fetches an image from a URL and analyzes it using a
 * vision-capable system LLM, returning a description/analysis.
 */
export const imageAnalysisTool = tool(
  async (
    input: z.infer<typeof ImageAnalysisToolSchema>,
    config?: RunnableConfig,
  ) => {
    try {
      const { url, query } = input;

      console.log(
        `ImageAnalysisTool: Analyzing image at "${url}" for query: "${query}"`,
      );

      const retrievalSignal: AbortSignal | undefined =
        config?.configurable?.retrievalSignal as AbortSignal | undefined;

      if (!config?.configurable?.systemLlm) {
        throw new Error('System LLM not available in config');
      }
      const llm = config.configurable.systemLlm;

      // Fetch the image
      let imageBuffer: Buffer;
      let contentType: string;
      try {
        const response = await axios.get(url, {
          responseType: 'arraybuffer',
          timeout: 30000,
          maxContentLength: MAX_IMAGE_SIZE,
          signal: retrievalSignal,
          headers: {
            Accept: 'image/*',
            'User-Agent':
              'Mozilla/5.0 (compatible; YAAWC/1.0; +https://github.com/boarder2/Yet-Another-Agentic-Web-Chat)',
          },
        });

        contentType = (response.headers['content-type'] || '').toLowerCase();
        imageBuffer = Buffer.from(response.data);
      } catch (fetchError: unknown) {
        const msg =
          fetchError instanceof Error
            ? fetchError.message
            : 'Failed to fetch image';
        console.error(`ImageAnalysisTool: Error fetching image: ${msg}`);
        return `Failed to fetch image from URL: ${msg}`;
      }

      const mimeType = ALLOWED_MIME_PREFIXES.find((prefix) =>
        contentType.startsWith(prefix),
      );
      if (!mimeType) {
        return `URL did not return a supported image format. Content-Type: ${contentType}`;
      }

      if (imageBuffer.length === 0) {
        return 'Image URL returned empty content.';
      }

      // Build base64 data URI
      const base64Data = imageBuffer.toString('base64');
      const dataUri = `data:${mimeType};base64,${base64Data}`;

      const analysisPrompt = `You are an image analysis assistant. Analyze the image and provide a detailed, relevant description.

Focus on aspects of the image that relate to or help answer this query: "${query}"

Provide:
1. A brief description of what the image shows
2. Any relevant details, text, data, or information visible in the image
3. How the image content relates to the query

Be factual and specific. Describe only what you can actually see in the image.`;

      const humanMessage = new HumanMessage({
        content: [
          { type: 'text', text: analysisPrompt },
          { type: 'image_url', image_url: { url: dataUri } },
        ],
      });

      const result = await llm.invoke([humanMessage], {
        signal: retrievalSignal || config?.signal,
      });

      const analysisContent = removeThinkingBlocks(result.content as string);

      if (!analysisContent || analysisContent.trim().length < 10) {
        console.warn(
          'ImageAnalysisTool: LLM returned insufficient analysis content',
        );
        return 'The image could not be analyzed — the vision model returned no useful content.';
      }

      // Emit source metadata as custom event
      await dispatchCustomEvent('sources', {
        sources: [{
          sourceId: 1,
          title: `Image Analysis: ${query.slice(0, 100)}`,
          url: url,
        }],
        searchQuery: query,
      }, config);

      console.log(
        `ImageAnalysisTool: Successfully analyzed image (${analysisContent.length} chars)`,
      );

      return `Image Analysis (${url}):\n\n${analysisContent}`;
    } catch (error) {
      console.error('ImageAnalysisTool: Error during image analysis:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return 'Error occurred during image analysis: ' + errorMessage;
    }
  },
  {
    name: 'image_analysis',
    description:
      'Fetches an image from a URL and analyzes its visual content using a vision model. Use this to understand what is shown in an image found on the web — charts, diagrams, photos, screenshots, infographics, etc. The URL must point directly to an image file.',
    schema: ImageAnalysisToolSchema,
  },
);
