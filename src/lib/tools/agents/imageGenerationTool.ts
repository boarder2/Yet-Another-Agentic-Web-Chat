import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { RunnableConfig } from '@langchain/core/runnables';
import { Command, getCurrentTaskInput } from '@langchain/langgraph';
import { SimplifiedAgentStateType } from '@/lib/state/chatAgentState';
import { ToolMessage } from '@langchain/core/messages';
import { isSoftStop } from '@/lib/utils/runControl';
import { getOpenrouterApiKey } from '@/lib/config';
import { getImageGenerationConfig } from '@/lib/config';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { UPLOADS_DIR } from '@/lib/dataDir';

// ─── Backend interface (extensible to OpenAI etc.) ────────────────────────

interface ImageGenParams {
  query: string;
  aspectRatio?: string;
  imageSize?: string;
}

interface ImageGenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

interface ImageGenResult {
  imageBuffer: Buffer;
  mimeType: string;
  usage?: ImageGenUsage;
}

interface ImageGenerationBackend {
  generate(
    params: ImageGenParams,
    signal?: AbortSignal,
  ): Promise<ImageGenResult>;
}

// ─── OpenRouter backend ───────────────────────────────────────────────────

class OpenRouterImageBackend implements ImageGenerationBackend {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async generate(
    params: ImageGenParams,
    signal?: AbortSignal,
  ): Promise<ImageGenResult> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: [{ role: 'user', content: params.query }],
      modalities: ['image', 'text'],
    };

    if (params.aspectRatio || params.imageSize) {
      const imageConfig: Record<string, string> = {};
      if (params.aspectRatio) imageConfig.aspect_ratio = params.aspectRatio;
      if (params.imageSize) imageConfig.image_size = params.imageSize;
      body.image_config = imageConfig;
    }

    const response = await fetch(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenRouter image generation failed (HTTP ${response.status}): ${errorText}`,
      );
    }

    const data = await response.json();

    const images: Array<{ image_url?: { url?: string } }> | undefined =
      data?.choices?.[0]?.message?.images;

    if (!images || images.length === 0) {
      throw new Error(
        'OpenRouter returned no images. Ensure the configured model supports image output.',
      );
    }

    const imageUrl = images[0]?.image_url?.url;
    if (!imageUrl || !imageUrl.startsWith('data:image/')) {
      throw new Error(
        'OpenRouter returned an unexpected image format (expected data: URI).',
      );
    }

    // Parse data URI: "data:image/png;base64,xxxx"
    const match = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      throw new Error('Failed to parse image data URI from OpenRouter.');
    }

    const mimeType = match[1];
    const base64Data = match[2];
    const imageBuffer = Buffer.from(base64Data, 'base64');

    // Extract token usage from the response
    const usageRaw = data?.usage as Record<string, number> | undefined;
    const usage: ImageGenUsage | undefined = usageRaw
      ? {
          inputTokens: usageRaw.prompt_tokens || usageRaw.input_tokens || 0,
          outputTokens:
            usageRaw.completion_tokens || usageRaw.output_tokens || 0,
          totalTokens:
            usageRaw.total_tokens ||
            (usageRaw.prompt_tokens || 0) + (usageRaw.completion_tokens || 0),
        }
      : undefined;

    return { imageBuffer, mimeType, usage };
  }
}

// ─── Provider resolution ──────────────────────────────────────────────────

function getImageGenerationBackend(): ImageGenerationBackend | null {
  const config = getImageGenerationConfig();
  if (!config || !config.enabled || !config.model) return null;

  if (config.provider === 'openrouter') {
    const apiKey = getOpenrouterApiKey();
    if (!apiKey) return null;
    return new OpenRouterImageBackend(apiKey, config.model);
  }

  // Future providers (openai, etc.) added here
  return null;
}

// ─── Image storage ────────────────────────────────────────────────────────

function saveGeneratedImage(
  buffer: Buffer,
  mimeType: string,
): { imageId: string; ext: string } {
  const mimeToExt: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
  };
  const ext = mimeToExt[mimeType] || 'png';
  const imageId = crypto.randomBytes(16).toString('hex');
  const filename = `${imageId}.${ext}`;
  const filePath = path.join(UPLOADS_DIR, filename);

  fs.writeFileSync(filePath, new Uint8Array(buffer));

  return { imageId, ext };
}

// ─── Tool schema ──────────────────────────────────────────────────────────

const ImageGenerationToolSchema = z.object({
  query: z.string().describe('Detailed prompt.'),
  aspectRatio: z
    .string()
    .optional()
    .describe('e.g. "1:1","16:9","4:3","9:16".'),
  imageSize: z.string().optional().describe('"1K"|"2K"|"4K" (default 1K).'),
});

// ─── Tool implementation ──────────────────────────────────────────────────

export const imageGenerationTool = tool(
  async (
    input: z.infer<typeof ImageGenerationToolSchema>,
    config?: RunnableConfig,
  ) => {
    try {
      const { query, aspectRatio, imageSize } = input;

      const messageId: string | undefined = (
        config as unknown as Record<string, Record<string, unknown>>
      )?.configurable?.messageId as string | undefined;
      const retrievalSignal: AbortSignal | undefined = (
        config as unknown as Record<string, Record<string, unknown>>
      )?.configurable?.retrievalSignal as AbortSignal | undefined;

      if (messageId && isSoftStop(messageId)) {
        return new Command({
          update: {
            messages: [
              new ToolMessage({
                content: 'Operation stopped by user.',
                tool_call_id: (
                  config as unknown as { toolCall: { id: string } }
                )?.toolCall.id,
              }),
            ],
          },
        });
      }

      const backend = getImageGenerationBackend();
      if (!backend) {
        return new Command({
          update: {
            messages: [
              new ToolMessage({
                content:
                  'Image generation is not available. Check that it is enabled in settings and a valid OpenRouter API key with an image model is configured.',
                tool_call_id: (
                  config as unknown as { toolCall: { id: string } }
                )?.toolCall.id,
              }),
            ],
          },
        });
      }

      const generationConfig = getImageGenerationConfig();

      console.log(
        `ImageGenerationTool: Generating image for prompt: "${query.slice(0, 100)}" via ${generationConfig?.provider}`,
      );

      const effectiveRatio = aspectRatio || generationConfig?.aspectRatio;
      const effectiveSize = imageSize || generationConfig?.imageSize;

      const combinedSignal = retrievalSignal
        ? AbortSignal.any([retrievalSignal, AbortSignal.timeout(120000)])
        : AbortSignal.timeout(120000);

      const emitter = (
        config as unknown as Record<string, Record<string, unknown>>
      )?.configurable?.emitter as import('events').EventEmitter | undefined;

      const { imageBuffer, mimeType, usage } = await backend.generate(
        {
          query,
          aspectRatio: effectiveRatio,
          imageSize: effectiveSize,
        },
        combinedSignal,
      );

      // Emit token usage for stats tracking
      if (emitter && usage) {
        emitter.emit(
          'tool_llm_usage',
          JSON.stringify({
            target: 'image_gen',
            modelName: generationConfig?.model || 'unknown',
            input_tokens: usage.inputTokens,
            output_tokens: usage.outputTokens,
            total_tokens: usage.totalTokens,
          }),
        );
      }

      if (messageId && isSoftStop(messageId)) {
        return new Command({
          update: {
            messages: [
              new ToolMessage({
                content: 'Operation stopped by user.',
                tool_call_id: (
                  config as unknown as { toolCall: { id: string } }
                )?.toolCall.id,
              }),
            ],
          },
        });
      }

      const { imageId, ext } = saveGeneratedImage(imageBuffer, mimeType);

      const imageUrl = `/api/uploads/images/${imageId}`;
      const currentState = getCurrentTaskInput() as SimplifiedAgentStateType;
      const currentDocCount = currentState.relevantDocuments?.length ?? 0;

      console.log(
        `ImageGenerationTool: Image saved as ${imageId}.${ext} (${imageBuffer.length} bytes)`,
      );

      return new Command({
        update: {
          relevantDocuments: [
            {
              metadata: {
                sourceId: currentDocCount + 1,
                title: `Generated Image: ${query.slice(0, 100)}`,
                url: imageUrl,
                img_src: imageUrl,
                processingType: 'image-generation',
              },
              pageContent: `Generated image for query: "${query}"`,
            },
          ],
          messages: [
            new ToolMessage({
              content: JSON.stringify({
                imageId,
                imageUrl,
                mimeType,
                query,
                _instruction:
                  'The image has been generated and will be displayed to the user automatically. Respond with a brief, friendly natural language message about the image you just created. Do not output JSON, action objects, or any structured format — just plain conversational text.',
              }),
              tool_call_id: (config as unknown as { toolCall: { id: string } })
                ?.toolCall?.id,
            }),
          ],
        },
      });
    } catch (error) {
      console.error('ImageGenerationTool: Error:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      return new Command({
        update: {
          messages: [
            new ToolMessage({
              content: 'Image generation failed: ' + errorMessage,
              tool_call_id: (config as unknown as { toolCall: { id: string } })
                ?.toolCall?.id,
            }),
          ],
        },
      });
    }
  },
  {
    name: 'image_generation',
    description: 'Generate an image from a text prompt.',
    schema: ImageGenerationToolSchema,
  },
);
