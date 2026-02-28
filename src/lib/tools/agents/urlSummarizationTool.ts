import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { RunnableConfig } from '@langchain/core/runnables';
import { getWebContent } from '@/lib/utils/documents';
import { removeThinkingBlocks } from '@/lib/utils/contentUtils';
import { dispatchCustomEvent } from '@langchain/core/callbacks/dispatch';

// Schema for URL summarization tool input
const URLSummarizationToolSchema = z.object({
  urls: z.array(z.string()).describe('Array of URLs to process and summarize'),
  query: z
    .string()
    .describe('The user query to guide content extraction and summarization'),
  retrieveHtml: z
    .preprocess(
      (val) =>
        typeof val === 'string'
          ? val.toLowerCase() === 'true'
          : val,
      z.boolean(),
    )
    .optional()
    .default(false)
    .describe('Whether to retrieve the full HTML content of the pages'),
  intent: z
    .string()
    .optional()
    .default('extract relevant content')
    .describe('Processing intent for the URLs'),
});

/**
 * URLSummarizationTool - Reimplementation of URLSummarizationAgent as a tool
 *
 * This tool handles:
 * 1. Fetching content from provided URLs
 * 2. Deciding whether to use content directly or summarize it
 * 3. Generating summaries using LLM when content is too long
 * 4. Returning processed documents with metadata
 */
export const urlSummarizationTool = tool(
  async (
    input: z.infer<typeof URLSummarizationToolSchema>,
    config?: RunnableConfig,
  ) => {
    try {
      const {
        urls,
        query,
        retrieveHtml = false,
        intent = 'extract relevant content',
      } = input;

      console.log(
        `URLSummarizationTool: Processing ${urls.length} \n  URLs for query: "${query}"\n  retrieveHtml: ${retrieveHtml}\n  intent: ${intent}`,
      );

      if (!urls || urls.length === 0) {
        return 'No URLs provided for processing.';
      }

      if (!config?.configurable?.systemLlm) {
        throw new Error('System LLM not available in config');
      }
      const llm = config.configurable.systemLlm;
      const retrievalSignal: AbortSignal | undefined =
        config?.configurable?.retrievalSignal as AbortSignal | undefined;

      const results: Array<{ title: string; url: string; content: string }> = [];

      // Process each URL
      for (const url of urls) {
        if (config?.signal?.aborted) {
          console.warn('URLSummarizationTool: Operation aborted by signal');
          break;
        }

        try {
          console.log(`URLSummarizationTool: Processing ${url}`);

          const webContent = await getWebContent(
            url,
            50000,
            retrieveHtml,
            retrievalSignal,
          );

          if (!webContent || !webContent.pageContent) {
            console.warn(
              `URLSummarizationTool: No content retrieved from URL: ${url}`,
            );
            continue;
          }

          const contentLength = webContent.pageContent.length;
          let finalContent: string;

          if (contentLength < 4000) {
            finalContent = webContent.pageContent;
            console.log(
              `URLSummarizationTool: Content is short (${contentLength} chars), using directly`,
            );
          } else {
            console.log(
              `URLSummarizationTool: Content is long (${contentLength} chars), generating summary`,
            );

            const summarizationPrompt = `You are a web content processor. Extract and summarize ONLY the information from the provided web page content that is relevant to the user's query.

# Critical Instructions
- Output ONLY a summary of the web page content provided below
- Focus on information that relates to or helps answer the user's query and processing intent
- Write in a direct, information-dense style — lead with facts from the page
- Summarize only what is present in the provided page content
- Deliver a self-contained summary that stands on its own
- Keep the focus on the page content itself, presented objectively
- Present the information in a clear, well-structured format with key facts and details
- Include all relevant details that could help answer the user's question

# User's Query: ${query}
# Processing Intent: ${intent}

# Content Title: ${webContent.metadata.title || 'Web Page'}
# Content URL: ${url}

# Web Page Content to Summarize:
${retrieveHtml && webContent.metadata?.html ? webContent.metadata.html : webContent.pageContent}

Provide a comprehensive summary of the above web page content, focusing on information relevant to the user's query:`;

            const result = await llm.invoke(summarizationPrompt, {
              signal: retrievalSignal || config?.signal,
            });

            finalContent = removeThinkingBlocks(result.content as string);
          }

          if (finalContent && finalContent.trim().length > 100) {
            const title = webContent.metadata.title || 'URL Content';
            results.push({ title, url, content: finalContent });

            console.log(
              `URLSummarizationTool: Successfully processed content from ${url} (${finalContent.length} characters)`,
            );
          } else {
            console.warn(
              `URLSummarizationTool: No valid content generated for URL: ${url}`,
            );
          }
        } catch (error: unknown) {
          console.error(
            `URLSummarizationTool: Error processing URL ${url}:`,
            error,
          );
          if (
            error instanceof Error &&
            (error.name === 'AbortError' || error.name === 'CanceledError')
          ) {
            break;
          }
          continue;
        }
      }

      console.log(
        `URLSummarizationTool: Successfully processed ${results.length} out of ${urls.length} URLs`,
      );

      if (results.length === 0) {
        return 'No content could be retrieved from the provided URLs.';
      }

      // Emit source metadata as custom event for frontend
      const sources = results.map((r, i) => ({
        sourceId: i + 1,
        title: r.title,
        url: r.url,
      }));

      await dispatchCustomEvent('sources', {
        sources,
        searchQuery: query,
      }, config);

      // Build formatted text for LLM consumption
      const formattedResults = results
        .map(
          (r, i) =>
            `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.content}`,
        )
        .join('\n\n---\n\n');

      return formattedResults;
    } catch (error) {
      console.error(
        'URLSummarizationTool: Error during URL processing:',
        error,
      );
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      return 'Error occurred during URL processing: ' + errorMessage;
    }
  },
  {
    name: 'url_summarization',
    description:
      'Fetches content from URLs and either uses it directly or summarizes it based on length, focusing on information relevant to the user query. URLs must be real and should not be invented.',
    schema: URLSummarizationToolSchema,
  },
);
