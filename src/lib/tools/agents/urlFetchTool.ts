import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { RunnableConfig } from '@langchain/core/runnables';
import { Document } from '@langchain/core/documents';
import { getWebContent } from '@/lib/utils/documents';
import { removeThinkingBlocks } from '@/lib/utils/contentUtils';
import { Command, getCurrentTaskInput } from '@langchain/langgraph';
import { SimplifiedAgentStateType } from '@/lib/state/chatAgentState';
import { ToolMessage } from '@langchain/core/messages';
// import { getLangfuseCallbacks } from '@/lib/tracing/langfuse';
import { isSoftStop } from '@/lib/utils/runControl';

// Schema for URL fetch tool input
const URLFetchToolSchema = z.object({
  urls: z.array(z.string()).describe('Array of URLs to fetch and process'),
  query: z
    .string()
    .describe('The user query to guide content extraction and summarization'),
  intent: z
    .string()
    .optional()
    .default('extract relevant content')
    .describe('Processing intent for the URLs'),
});

/**
 * URLFetchTool - Fetches full web content from URLs.
 *
 * This tool handles:
 * 1. Fetching content from provided URLs
 * 2. Deciding whether to use content directly or summarize it
 * 3. Generating summaries using LLM when content is too long
 * 4. Returning processed documents with metadata
 */
export const urlFetchTool = tool(
  async (
    input: z.infer<typeof URLFetchToolSchema>,
    config?: RunnableConfig,
  ) => {
    try {
      const { urls, query, intent = 'extract relevant content' } = input;

      const currentState = getCurrentTaskInput() as SimplifiedAgentStateType;
      let currentDocCount = currentState.relevantDocuments?.length ?? 0;

      console.log(
        `URLFetchTool: Processing ${urls.length} \n  URLs for query: "${query}"\n  intent: ${intent}`,
      );

      if (!urls || urls.length === 0) {
        console.log('URLFetchTool: No URLs provided for processing');
        return new Command({
          update: {
            messages: [
              new ToolMessage({
                content: 'No search results found.',
                tool_call_id: (
                  config as unknown as { toolCall: { id: string } }
                )?.toolCall.id,
              }),
            ],
          },
        });
      }

      // Get LLM from config
      if (!config?.configurable?.systemLlm) {
        throw new Error('System LLM not available in config');
      }
      const llm = config.configurable.systemLlm;
      const emitter = config.configurable?.emitter as
        | import('events').EventEmitter
        | undefined;
      const retrievalSignal: AbortSignal | undefined = (
        config as unknown as Record<string, Record<string, unknown>>
      )?.configurable?.retrievalSignal as AbortSignal | undefined;
      const messageId: string | undefined = (
        config as unknown as Record<string, Record<string, unknown>>
      )?.configurable?.messageId as string | undefined;
      const documents: Document[] = [];

      // Process each URL
      for (const url of urls) {
        if (config?.signal?.aborted) {
          console.warn('URLFetchTool: Operation aborted by signal');
          break;
        }
        if (messageId && isSoftStop(messageId)) {
          console.warn('URLFetchTool: Soft-stop set; skipping URL');
          break;
        }

        try {
          console.log(`URLFetchTool: Processing ${url}`);

          // Fetch full content using the enhanced web content retrieval.
          // Content is returned as clean markdown with inline links.
          const webContent = await getWebContent(url, 50000, retrievalSignal);

          if (!webContent || !webContent.pageContent) {
            console.warn(`URLFetchTool: No content retrieved from URL: ${url}`);
            continue;
          }

          const contentLength = webContent.pageContent.length;
          let finalContent: string;
          let processingType: string;

          // If content is short (< 4000 chars), use it directly; otherwise summarize
          if (contentLength < 4000) {
            finalContent = webContent.pageContent;
            processingType = 'url-direct-content';

            console.log(
              `URLFetchTool: Content is short (${contentLength} chars), using directly without summarization`,
            );
          } else {
            // Content is long, summarize using LLM
            console.log(
              `URLFetchTool: Content is long (${contentLength} chars), generating summary`,
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

# IMPORTANT — Link Preservation
The input content contains markdown links in the format [text](url). You MUST preserve these links in your summary output. When you mention a topic, story, or fact from the page, include the original markdown link inline. For example, if the input contains "[Example Link](https://example.com/some/deep/link)", your summary must include that same link when discussing that topic. Do NOT strip links. Do NOT convert links to plain text. Every major item in your summary should have its source link from the input content.

# User's Query: ${query}
# Processing Intent: ${intent}

# Content Title: ${webContent.metadata.title || 'Web Page'}
# Content URL: ${url}

# Web Page Content to Summarize:
${webContent.pageContent}

Provide a comprehensive summary of the above web page content, focusing on information relevant to the user's query. Remember: preserve all markdown links from the input.`;

            const result = await llm.invoke(summarizationPrompt, {
              signal: retrievalSignal || config?.signal,
              // ...getLangfuseCallbacks(),
            });

            // Emit token usage from this LLM call so parent agent can accumulate it.
            // Prefer usage_metadata (standardized LangChain field); fall back to
            // response_metadata.usage for OpenAI-format providers (Ollama, LM Studio, etc.)
            // that don't populate usage_metadata but do include prompt_tokens/completion_tokens.
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
              emitter.emit(
                'tool_llm_usage',
                JSON.stringify({
                  target: 'system',
                  input_tokens: inputTokens,
                  output_tokens: outputTokens,
                  total_tokens:
                    rawUsage.total_tokens ||
                    rawUsage.totalTokens ||
                    inputTokens + outputTokens,
                }),
              );
            }

            finalContent = removeThinkingBlocks(result.content as string);
            processingType = 'url-content-extraction';
          }

          // Web content less than 100 characters probably isn't useful so discard it.
          if (finalContent && finalContent.trim().length > 100) {
            const document = new Document({
              pageContent: finalContent,
              metadata: {
                sourceId: ++currentDocCount,
                title: webContent.metadata.title || 'URL Content',
                url: url,
                source: url,
                processingType: processingType,
                processingIntent: intent,
                originalContentLength: contentLength,
                searchQuery: query,
              },
            });

            documents.push(document);

            console.log(
              `URLFetchTool: Successfully processed content from ${url} (${finalContent.length} characters, ${processingType})`,
            );
          } else {
            console.warn(
              `URLFetchTool: No valid content generated for URL: ${url}`,
            );
          }
        } catch (error: unknown) {
          console.error(`URLFetchTool: Error processing URL ${url}:`, error);
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
        `URLFetchTool: Successfully processed ${documents.length} out of ${urls.length} URLs`,
      );

      return new Command({
        update: {
          relevantDocuments: documents,
          messages: [
            new ToolMessage({
              content: JSON.stringify({
                document: documents,
              }),
              tool_call_id: (config as unknown as { toolCall: { id: string } })
                ?.toolCall.id,
            }),
          ],
        },
      });
    } catch (error) {
      console.error('URLFetchTool: Error during URL processing:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      return new Command({
        update: {
          messages: [
            new ToolMessage({
              content: 'Error occurred during URL processing: ' + errorMessage,
              tool_call_id: (config as unknown as { toolCall: { id: string } })
                ?.toolCall.id,
            }),
          ],
        },
      });
    }
  },
  {
    name: 'url_fetch',
    description:
      'Retrieves full web content from URLs. Returns the complete page content when it fits within limits, falling back to a focused summary for very long pages. Use this to read the actual contents of a URL. URLs must be real and should not be invented.',
    schema: URLFetchToolSchema,
  },
);
