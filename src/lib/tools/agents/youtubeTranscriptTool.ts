// import { retrieveYoutubeTranscript } from '@/lib/utils/documents';
// import { ToolMessage } from '@langchain/core/messages';
// import { RunnableConfig } from '@langchain/core/runnables';
// import { tool } from '@langchain/core/tools';
// import { Command } from '@langchain/langgraph';
// import { z } from 'zod';
// import { persistFromToolConfig } from '@/lib/utils/persistToolContext';

// // Schema for YouTube transcript tool input
// const YoutubeTranscriptToolSchema = z.object({
//   videoUrl: z.string(),
// });

// /**
//  * YoutubeTranscriptTool - Retrieves the transcript of a YouTube video
//  *
//  * ⚠️ DISABLED: This tool is intentionally NOT wired into the agent's available
//  * tools (see `src/lib/tools/agents/index.ts`). YouTube transcript retrieval no
//  * longer works reliably — the underlying loader/`youtubei.js` dependency fails
//  * against YouTube's current endpoints, so the tool would only error out. We keep
//  * the implementation here (and the `youtubei.js` dependency commented out in
//  * package.json) so it can be revived if/when a dependable transcript solution
//  * appears. Until then it must stay out of the agent's tool set — the agent
//  * should not be handed a tool that doesn't work.
//  *
//  * Responsibilities (when enabled):
//  * 1. Extract video ID from the provided URL
//  * 2. Fetch the transcript using YouTube API
//  * 3. Return the transcript as a string
//  */
// export const youtubeTranscriptTool = tool(
//   async (
//     input: z.infer<typeof YoutubeTranscriptToolSchema>,
//     config?: RunnableConfig,
//   ) => {
//     const { videoUrl } = input;

//     // Check for cancellation early
//     const retrievalSignal: AbortSignal | undefined =
//       config?.configurable?.retrievalSignal;
//     if (retrievalSignal?.aborted || config?.signal?.aborted) {
//       console.log('[youtubeTranscriptTool] Operation cancelled');
//       return new Command({
//         update: {
//           relevantDocuments: [],
//           messages: [
//             new ToolMessage({
//               content: 'YouTube transcript retrieval cancelled.',
//               tool_call_id: (config as unknown as { toolCall: { id: string } })
//                 ?.toolCall.id,
//             }),
//           ],
//         },
//       });
//     }

//     console.log(
//       `[youtubeTranscriptTool] Retrieving transcript for video: "${videoUrl}"`,
//     );

//     const doc = await retrieveYoutubeTranscript(videoUrl);

//     if (!doc) {
//       throw new Error(`Failed to retrieve transcript for video: ${videoUrl}`);
//     }

//     console.log(
//       `[youtubeTranscriptTool] Retrieved document from video: ${videoUrl}`,
//     );

//     await persistFromToolConfig({
//       config,
//       kind: 'youtube_transcript',
//       body: `[youtube_transcript ${videoUrl}]\n${doc.pageContent ?? ''}`,
//       metadataExtras: { videoId: videoUrl },
//     });

//     return new Command({
//       update: {
//         relevantDocuments: [doc],
//         messages: [
//           new ToolMessage({
//             content: JSON.stringify({
//               document: [doc],
//             }),
//             tool_call_id: (config as unknown as { toolCall: { id: string } })
//               ?.toolCall.id,
//           }),
//         ],
//       },
//     });
//   },
//   {
//     name: 'youtube_transcript',
//     description: 'Fetch YouTube transcript from a URL.',
//     schema: YoutubeTranscriptToolSchema,
//   },
// );
