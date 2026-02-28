import { retrieveYoutubeTranscript } from '@/lib/utils/documents';
import { RunnableConfig } from '@langchain/core/runnables';
import { tool } from '@langchain/core/tools';
import { dispatchCustomEvent } from '@langchain/core/callbacks/dispatch';
import { z } from 'zod';

// Schema for YouTube transcript tool input
const YoutubeTranscriptToolSchema = z.object({
  videoUrl: z
    .string()
    .describe(
      'The YouTube video URL. Provide the URL of the YouTube video to retrieve a transcript for.',
    ),
});

/**
 * YoutubeTranscriptTool - Retrieves the transcript of a YouTube video
 */
export const youtubeTranscriptTool = tool(
  async (
    input: z.infer<typeof YoutubeTranscriptToolSchema>,
    config?: RunnableConfig,
  ) => {
    const { videoUrl } = input;

    const retrievalSignal: AbortSignal | undefined =
      config?.configurable?.retrievalSignal;
    if (retrievalSignal?.aborted || config?.signal?.aborted) {
      console.log('[youtubeTranscriptTool] Operation cancelled');
      return 'YouTube transcript retrieval cancelled.';
    }

    console.log(
      `[youtubeTranscriptTool] Retrieving transcript for video: "${videoUrl}"`,
    );

    const doc = await retrieveYoutubeTranscript(videoUrl);

    if (!doc) {
      throw new Error(`Failed to retrieve transcript for video: ${videoUrl}`);
    }

    // Emit source metadata
    await dispatchCustomEvent('sources', {
      sources: [{
        sourceId: 1,
        title: doc.metadata?.title || 'YouTube Video',
        url: videoUrl,
      }],
    }, config);

    console.log(
      `[youtubeTranscriptTool] Retrieved document from video: ${videoUrl}`,
    );
    return `YouTube Transcript (${videoUrl}):\n\n${doc.pageContent}`;
  },
  {
    name: 'youtube_transcript',
    description: 'Retrieves the transcript of a YouTube video given its URL.',
    schema: YoutubeTranscriptToolSchema,
  },
);
