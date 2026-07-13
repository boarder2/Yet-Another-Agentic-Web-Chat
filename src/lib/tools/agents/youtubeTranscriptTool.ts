import { z } from 'zod';
import { Command } from '@langchain/langgraph';
import { ToolMessage } from '@langchain/core/messages';
import { retrieveYoutubeTranscript } from '@/lib/utils/documents';
import { defineTool } from '@/lib/tools/defineTool';

const YoutubeTranscriptToolSchema = z.object({
  videoUrl: z.string(),
});

/**
 * YoutubeTranscriptTool - Retrieves the transcript of a YouTube video.
 *
 * Transcript retrieval is browser-driven (see `retrieveYoutubeTranscript`);
 * plain HTTP no longer works against YouTube's current endpoints.
 */
export const youtubeTranscriptTool = defineTool(
  async (input: z.infer<typeof YoutubeTranscriptToolSchema>, runtime) => {
    try {
      const { videoUrl } = input;
      const { retrievalSignal } = runtime.context;

      if (retrievalSignal?.aborted || runtime.signal?.aborted) {
        console.log('[youtubeTranscriptTool] Operation cancelled');
        return new Command({
          update: {
            relevantDocuments: [],
            messages: [
              new ToolMessage({
                content: 'YouTube transcript retrieval cancelled.',
                tool_call_id: runtime.toolCallId,
              }),
            ],
          },
        });
      }

      console.log(
        `[youtubeTranscriptTool] Retrieving transcript for video: "${videoUrl}"`,
      );

      const doc = await retrieveYoutubeTranscript(videoUrl, retrievalSignal);

      if (!doc) {
        return new Command({
          update: {
            relevantDocuments: [],
            messages: [
              new ToolMessage({
                content: 'No transcript available for this video.',
                tool_call_id: runtime.toolCallId,
              }),
            ],
          },
        });
      }

      console.log(
        `[youtubeTranscriptTool] Retrieved transcript from video: ${videoUrl}`,
      );

      await runtime.persist({
        kind: 'youtube_transcript',
        body: `[youtube_transcript ${videoUrl}]\n${doc.pageContent ?? ''}`,
        metadataExtras: { source: videoUrl },
      });

      return new Command({
        update: {
          relevantDocuments: [doc],
          messages: [
            new ToolMessage({
              content: JSON.stringify({ document: [doc] }),
              tool_call_id: runtime.toolCallId,
            }),
          ],
        },
      });
    } catch (error) {
      console.error(
        '[youtubeTranscriptTool] Error during transcript retrieval:',
        error,
      );
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return new Command({
        update: {
          messages: [
            new ToolMessage({
              content:
                'Error occurred during transcript retrieval: ' + errorMessage,
              tool_call_id: runtime.toolCallId,
            }),
          ],
        },
      });
    }
  },
  {
    name: 'youtube_transcript',
    description: 'Fetch the transcript of a YouTube video from its URL.',
    schema: YoutubeTranscriptToolSchema,
  },
);
