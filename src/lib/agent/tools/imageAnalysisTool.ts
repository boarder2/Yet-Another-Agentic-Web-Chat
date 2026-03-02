import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { RunnableConfig } from '@langchain/core/runnables';
import { Document } from '@langchain/core/documents';
import { HumanMessage } from '@langchain/core/messages';
import { removeThinkingBlocks } from '@/lib/utils/contentUtils';
import { isSoftStop } from '@/lib/utils/runControl';
import { writer } from '@langchain/langgraph';
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

export const imageAnalysisTool = tool(
  async (
    input: z.infer<typeof ImageAnalysisToolSchema>,
    config?: RunnableConfig,
  ): Promise<string> => {
    const { url, query } = input;

    const messageId: string | undefined = config?.configurable?.messageId;
    const retrievalSignal: AbortSignal | undefined =
      config?.configurable?.retrievalSignal;

    if (messageId && isSoftStop(messageId)) {
      return 'Operation stopped by user.';
    }

    const llm = config?.configurable?.systemLlm;
    if (!llm) {
      return 'Error: System LLM not available in config.';
    }

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

      const contentType = (
        response.headers['content-type'] || ''
      ).toLowerCase();
      const imageBuffer = Buffer.from(response.data);

      const mimeType = ALLOWED_MIME_PREFIXES.find((prefix) =>
        contentType.startsWith(prefix),
      );
      if (!mimeType) {
        return `URL did not return a supported image format. Content-Type: ${contentType}`;
      }

      if (imageBuffer.length === 0) {
        return 'Image URL returned empty content.';
      }

      if (messageId && isSoftStop(messageId)) {
        return 'Operation stopped by user.';
      }

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
        return 'The image could not be analyzed — the vision model returned no useful content.';
      }

      const document = new Document({
        pageContent: analysisContent,
        metadata: {
          title: `Image Analysis: ${query.slice(0, 100)}`,
          url,
          source: url,
          processingType: 'image-analysis',
          searchQuery: query,
        },
      });

      try {
        writer({ type: 'sources_added', data: [document], searchQuery: query });
      } catch {
        // writer not available
      }

      return JSON.stringify({ document: [document] });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return `Error occurred during image analysis: ${errorMessage}`;
    }
  },
  {
    name: 'image_analysis',
    description:
      'Fetches an image from a URL and analyzes its visual content using a vision model. Use this to understand what is shown in an image found on the web — charts, diagrams, photos, screenshots, infographics, etc. The URL must point directly to an image file.',
    schema: ImageAnalysisToolSchema,
  },
);
