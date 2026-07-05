import { z } from 'zod';
import { Document } from '@langchain/core/documents';
import { HumanMessage } from '@langchain/core/messages';
import { Command, getCurrentTaskInput } from '@langchain/langgraph';
import { SimplifiedAgentStateType } from '@/lib/state/chatAgentState';
import { ToolMessage } from '@langchain/core/messages';
import { removeThinkingBlocks } from '@/lib/utils/contentUtils';
import { isSoftStop } from '@/lib/utils/runControl';
import { emitStreamEvent } from '@/lib/streaming/events';
import { defineTool } from '@/lib/tools/defineTool';
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB

const ALLOWED_MIME_PREFIXES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
];

const ImageAnalysisToolSchema = z.object({
  url: z.string(),
  query: z.string().describe('What to look for in the image.'),
});

/**
 * ImageAnalysisTool - Fetches an image from a URL and analyzes it using a
 * vision-capable system LLM, returning a description/analysis as a document.
 */
export const imageAnalysisTool = defineTool(
  async (input: z.infer<typeof ImageAnalysisToolSchema>, runtime) => {
    try {
      const { url, query } = input;

      console.log(
        `ImageAnalysisTool: Analyzing image at "${url}" for query: "${query}"`,
      );

      const {
        messageId,
        retrievalSignal,
        systemLlm: llm,
        emitter,
      } = runtime.context;

      if (!llm) {
        throw new Error('System LLM not available in context');
      }

      // Fetch the image
      let imageBuffer: Buffer;
      let contentType: string;
      try {
        const fetchSignal = retrievalSignal
          ? AbortSignal.any([retrievalSignal, AbortSignal.timeout(30000)])
          : AbortSignal.timeout(30000);

        const response = await fetch(url, {
          signal: fetchSignal,
          headers: {
            Accept: 'image/*',
            'User-Agent':
              'Mozilla/5.0 (compatible; YAAWC/1.0; +https://github.com/boarder2/Yet-Another-Agentic-Web-Chat)',
          },
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        // Check content-length before downloading the body
        const contentLength = response.headers.get('content-length');
        if (contentLength && parseInt(contentLength, 10) > MAX_IMAGE_SIZE) {
          throw new Error(
            `Image exceeds maximum size of ${MAX_IMAGE_SIZE} bytes`,
          );
        }

        contentType = (
          response.headers.get('content-type') || ''
        ).toLowerCase();
        const arrayBuffer = await response.arrayBuffer();
        imageBuffer = Buffer.from(arrayBuffer);
      } catch (fetchError: unknown) {
        const msg =
          fetchError instanceof Error
            ? fetchError.message
            : 'Failed to fetch image';
        console.error(`ImageAnalysisTool: Error fetching image: ${msg}`);
        return new Command({
          update: {
            messages: [
              new ToolMessage({
                content: `Failed to fetch image from URL: ${msg}`,
                tool_call_id: runtime.toolCallId,
              }),
            ],
          },
        });
      }

      // Validate that the response is actually an image
      const mimeType = ALLOWED_MIME_PREFIXES.find((prefix) =>
        contentType.startsWith(prefix),
      );
      if (!mimeType) {
        console.warn(
          `ImageAnalysisTool: URL returned non-image content-type: ${contentType}`,
        );
        return new Command({
          update: {
            messages: [
              new ToolMessage({
                content: `URL did not return a supported image format. Content-Type: ${contentType}`,
                tool_call_id: runtime.toolCallId,
              }),
            ],
          },
        });
      }

      if (imageBuffer.length === 0) {
        return new Command({
          update: {
            messages: [
              new ToolMessage({
                content: 'Image URL returned empty content.',
                tool_call_id: runtime.toolCallId,
              }),
            ],
          },
        });
      }

      // Check soft-stop again before the expensive LLM call
      if (messageId && isSoftStop(messageId)) {
        return new Command({
          update: {
            messages: [
              new ToolMessage({
                content: 'Operation stopped by user.',
                tool_call_id: runtime.toolCallId,
              }),
            ],
          },
        });
      }

      // Build base64 data URI
      const base64Data = imageBuffer.toString('base64');
      const dataUri = `data:${mimeType};base64,${base64Data}`;

      // Invoke the vision LLM with a multimodal message
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
        signal: retrievalSignal || runtime.signal,
      });

      // Emit token usage
      const usageData =
        result.usage_metadata ??
        (result.response_metadata?.usage as
          | Record<string, number>
          | null
          | undefined);
      if (emitter && usageData) {
        const rawUsage = usageData as Record<string, number>;
        const inputTokens =
          rawUsage.input_tokens ||
          rawUsage.prompt_tokens ||
          rawUsage.promptTokens ||
          0;
        const outputTokens =
          rawUsage.output_tokens ||
          rawUsage.completion_tokens ||
          rawUsage.completionTokens ||
          0;
        emitStreamEvent(emitter, {
          type: 'tool_llm_usage',
          target: 'system',
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          total_tokens:
            rawUsage.total_tokens ||
            rawUsage.totalTokens ||
            inputTokens + outputTokens,
        });
      }

      const analysisContent = removeThinkingBlocks(result.content as string);

      if (!analysisContent || analysisContent.trim().length < 10) {
        console.warn(
          'ImageAnalysisTool: LLM returned insufficient analysis content',
        );
        return new Command({
          update: {
            messages: [
              new ToolMessage({
                content:
                  'The image could not be analyzed — the vision model returned no useful content.',
                tool_call_id: runtime.toolCallId,
              }),
            ],
          },
        });
      }

      const currentState = getCurrentTaskInput() as SimplifiedAgentStateType;
      const currentDocCount = currentState.relevantDocuments?.length ?? 0;

      const document = new Document({
        pageContent: analysisContent,
        metadata: {
          sourceId: currentDocCount + 1,
          title: `Image Analysis: ${query.slice(0, 100)}`,
          url: url,
          source: url,
          processingType: 'image-analysis',
          searchQuery: query,
        },
      });

      console.log(
        `ImageAnalysisTool: Successfully analyzed image (${analysisContent.length} chars)`,
      );

      return new Command({
        update: {
          relevantDocuments: [document],
          messages: [
            new ToolMessage({
              content: JSON.stringify({ document: [document] }),
              tool_call_id: runtime.toolCallId,
            }),
          ],
        },
      });
    } catch (error) {
      console.error('ImageAnalysisTool: Error during image analysis:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      return new Command({
        update: {
          messages: [
            new ToolMessage({
              content: 'Error occurred during image analysis: ' + errorMessage,
              tool_call_id: runtime.toolCallId,
            }),
          ],
        },
      });
    }
  },
  {
    name: 'image_analysis',
    description:
      'Analyze an image URL with a vision model. URL must be a direct image file.',
    schema: ImageAnalysisToolSchema,
  },
);
