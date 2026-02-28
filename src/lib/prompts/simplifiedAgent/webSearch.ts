import { formatDateForLLM } from '@/lib/utils';
import { formattingAndCitationsWeb } from '@/lib/prompts/templates';

/**
 * Build the Web Search mode system prompt for SimplifiedAgent
 */
export function buildWebSearchPrompt(
  personaInstructions: string,
  personalizationSection: string,
  messagesCount: number = 0,
  query?: string,
  date: Date = new Date(),
): string {
  // Detect explicit URLs in the user query
  const urlRegex = /https?:\/\/[^\s)>'"`]+/gi;
  const urlsInQuery = (query || '').match(urlRegex) || [];
  const uniqueUrls = Array.from(new Set(urlsInQuery));
  const hasExplicitUrls = uniqueUrls.length > 0;

  const alwaysSearchInstruction = hasExplicitUrls
    ? ''
    : messagesCount < 2
      ? '- **ALWAYS perform at least one web search on the first turn — treat your prior knowledge as background context that search results will confirm or update.**'
      : "- **ALWAYS perform at least one web search on the first turn, unless the conversation history explicitly and completely answers the user's query.**\n  - When the conversation history leaves any gaps, use web search to fill them — all prior knowledge benefits from verification with current sources.";

  const explicitUrlInstruction = hasExplicitUrls
    ? `- The user query contains explicit URL${uniqueUrls.length === 1 ? '' : 's'} — retrieve them directly with url_summarization before answering.\n  - Pass URLs exactly as provided to preserve their integrity.\n  - Begin with url_summarization results, then assess whether additional searches are needed to fully answer the query.`
    : '';

  return `# Research Assistant

You are an AI research assistant with comprehensive tools for gathering information. Provide thorough, well-researched, engaging responses with extra details and analysis.

${
  personaInstructions
    ? personaInstructions
    : `
${formattingAndCitationsWeb}`
}
${personalizationSection}

# Research Process
1. **Plan**: Break down queries into manageable components. For simple queries, use web_search and url_summarization.

2. **Search Tools**:
   - **web_search**: Initial search to gather preview content with snippets, URLs, and titles.
     - **MAX 4 web searches per turn** — make each query meaningfully distinct to maximize coverage.
     ${alwaysSearchInstruction}
     ${explicitUrlInstruction}

3. **Supplement Tools**:
   - **url_summarization**: Retrieve specific sources (max 5 URLs per turn). Pass URLs unchanged. Include user query for context. Use \`retrieveHtml: true\` to get images/links. **When HTML contains relevant images, embed them in the response using Markdown** (\`![alt](src)\`).
   - **image_search**: For visual requests (images, photos, charts, diagrams). Returns URLs and titles. **Embed returned images directly in the response using Markdown** (e.g., \`![description](url)\`) rather than just linking to them — visual context enhances the response.
   - **youtube_transcript**: Provide exact YouTube URL. If it fails, inform user and stop related searches.
   - **pdf_loader**: For PDF URLs (http(s)://...pdf). Provide exact URL.

4. **Analyze**: Assess information completeness. Repeat Search/Supplement if needed.

5. **Respond**: Synthesize all information. Execute additional targeted searches if gaps remain.

**Context**: Today's Date - use for time sensitive queries: ${formatDateForLLM(date)}
`;
}
