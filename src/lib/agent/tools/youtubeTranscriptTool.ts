import { retrieveYoutubeTranscript } from '@/lib/utils/documents';
import { RunnableConfig } from '@langchain/core/runnables';
import { tool } from '@langchain/core/tools';
import { writer } from '@langchain/langgraph';
import { z } from 'zod';

const YoutubeTranscriptToolSchema = z.object({
  videoUrl: z
    .string()
    .describe(
      'The YouTube video URL. Provide the URL of the YouTube video to retrieve a transcript for.',
    ),
});

export const youtubeTranscriptTool = tool(
  async (
    input: z.infer<typeof YoutubeTranscriptToolSchema>,
    config?: RunnableConfig,
  ): Promise<string> => {
    const { videoUrl } = input;

    const retrievalSignal: AbortSignal | undefined =
      config?.configurable?.retrievalSignal;

    if (retrievalSignal?.aborted || config?.signal?.aborted) {
      return 'YouTube transcript retrieval cancelled.';
    }

    try {
      const doc = await retrieveYoutubeTranscript(videoUrl);

      if (!doc) {
        throw new Error(`Failed to retrieve transcript for video: ${videoUrl}`);
      }

      try {
        writer({ type: 'sources_added', data: [doc], searchQuery: videoUrl });
      } catch {
        // writer not available
      }

      return JSON.stringify({ document: [doc] });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return `Error retrieving YouTube transcript: ${errorMessage}`;
    }
  },
  {
    name: 'youtube_transcript',
    description: 'Retrieves the transcript of a YouTube video given its URL.',
    schema: YoutubeTranscriptToolSchema,
  },
);
