import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { RunnableConfig } from '@langchain/core/runnables';
import { Document } from '@langchain/core/documents';
import { getWebContent } from '@/lib/utils/documents';
import { removeThinkingBlocks } from '@/lib/utils/contentUtils';
import { isSoftStop } from '@/lib/utils/runControl';
import { writer } from '@langchain/langgraph';

const URLSummarizationToolSchema = z.object({
  urls: z.array(z.string()).describe('Array of URLs to process and summarize'),
  query: z
    .string()
    .describe('The user query to guide content extraction and summarization'),
  retrieveHtml: z
    .preprocess(
      (val) =>
        typeof val === 'string'
          ? val.toLowerCase() === 'true' || val === '1'
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

export const urlSummarizationTool = tool(
  async (
    input: z.infer<typeof URLSummarizationToolSchema>,
    config?: RunnableConfig,
  ): Promise<string> => {
    const {
      urls,
      query,
      retrieveHtml = false,
      intent = 'extract relevant content',
    } = input;

    if (!urls || urls.length === 0) {
      return 'No URLs provided for processing.';
    }

    const llm = config?.configurable?.systemLlm;
    if (!llm) {
      return 'Error: System LLM not available in config.';
    }

    const retrievalSignal: AbortSignal | undefined =
      config?.configurable?.retrievalSignal;
    const messageId: string | undefined = config?.configurable?.messageId;

    const documents: Document[] = [];

    for (const url of urls) {
      if (config?.signal?.aborted) break;
      if (messageId && isSoftStop(messageId)) break;

      try {
        const webContent = await getWebContent(
          url,
          50000,
          retrieveHtml,
          retrievalSignal,
        );

        if (!webContent?.pageContent) continue;

        const contentLength = webContent.pageContent.length;
        let finalContent: string;
        let processingType: string;

        if (contentLength < 4000) {
          finalContent = webContent.pageContent;
          processingType = 'url-direct-content';
        } else {
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
          processingType = 'url-content-extraction';
        }

        if (finalContent && finalContent.trim().length > 100) {
          documents.push(
            new Document({
              pageContent: finalContent,
              metadata: {
                title: webContent.metadata.title || 'URL Content',
                url,
                source: url,
                processingType,
                processingIntent: intent,
                originalContentLength: contentLength,
                searchQuery: query,
              },
            }),
          );
        }
      } catch (error: unknown) {
        if (
          error instanceof Error &&
          (error.name === 'AbortError' || error.name === 'CanceledError')
        ) {
          break;
        }
        console.error(
          `urlSummarizationTool: Error processing URL ${url}:`,
          error,
        );
      }
    }

    if (documents.length > 0) {
      try {
        writer({ type: 'sources_added', data: documents, searchQuery: query });
      } catch {
        // writer not available
      }
    }

    return JSON.stringify({ documents });
  },
  {
    name: 'url_summarization',
    description:
      'Fetches content from URLs and either uses it directly or summarizes it based on length, focusing on information relevant to the user query. URLs must be real and should not be invented.',
    schema: URLSummarizationToolSchema,
  },
);
