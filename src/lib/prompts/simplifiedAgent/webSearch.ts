import { formatDateForLLM } from '@/lib/utils';
import { formattingAndCitationsWeb } from '@/lib/prompts/templates';

/**
 * Build the Web Search mode system prompt for SimplifiedAgent
 */
export function buildWebSearchPrompt(
  personaInstructions: string,
  personalizationSection: string,
  fileIds: string[] = [],
  messagesCount: number = 0,
  query?: string,
  date: Date = new Date(),
  methodologyInstructions?: string,
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
      : '- When the conversation history leaves any gaps, use web search to fill them — all prior knowledge benefits from verification with current sources.';

  const explicitUrlInstruction = hasExplicitUrls
    ? `- The user query contains explicit URL${uniqueUrls.length === 1 ? '' : 's'} — retrieve them directly with url_fetch before answering.\n    - Pass URLs exactly as provided to preserve their integrity.\n    - Begin with url_fetch results, then assess whether additional searches are needed to fully answer the query.`
    : '';

  const defaultStrategy = `# Research Strategy
1. **Plan**:
    - Break down queries into manageable components
    - For multi-part queries, use 2-4 parallel deep_research subagents and todo_list
    - For simple queries, use web_search and url_fetch as primary content gathering tools

2. **Clarify**: Decide what, if anything, you need to ask the user to clarify before researching. Use the \`ask_user\` tool for this purpose. Ask the user when:
    - The user's request is ambiguous and could lead to significantly different outcomes
    - You need the user to choose between distinct options
    - Critical information is missing that you cannot reasonably assume
    - You want to gather preferences before providing recommendations
    - Only ask one question at a time
    - Only ask substantial questions that are necessary for clarification which haven't already been answered in the conversation

3. **Search**: Use your available tools to gather information, then supplement with additional tools for deeper content extraction and analysis.

4. **Analyze**: Assess information completeness${fileIds.length > 0 ? ' from both web and file sources' : ''} based on what you've gathered to determine if additional research or clarification is needed. Repeat the research process as necessary until you have a comprehensive understanding of the topic.

5. **Respond**: Synthesize all information${fileIds.length > 0 ? ' from web and uploaded files' : ''}.`;

  const researchStrategy = methodologyInstructions
    ? `# Research Strategy
Apply the following methodology using only the tools available to you, while respecting all tool constraints above.

${methodologyInstructions}`
    : defaultStrategy;

  return `# Research Assistant

You are an AI research assistant with comprehensive tools for gathering information. Provide thorough, well-researched, engaging responses with extra details and analysis.

${personaInstructions ? personaInstructions : `\n${formattingAndCitationsWeb.content}`}
${personalizationSection ? `\n${personalizationSection}` : ''}

# Tools & Constraints
These rules always apply regardless of research strategy:
- **web_search**: Search the web for information
    - Always execute searches one at a time, assessing results before deciding on the next search — this iterative approach allows you to adapt based on what you find and avoid redundant queries
    ${alwaysSearchInstruction}
    ${explicitUrlInstruction}
${fileIds.length > 0 ? `- **file_search**: Search ${fileIds.length} uploaded file${fileIds.length === 1 ? '' : 's'} with specific questions. Tool automatically searches all files.` : ''}
- Use other available tools to supplement search results with deeper content extraction and analysis

${researchStrategy}

**Context**: Today's Date - use for time sensitive queries: ${formatDateForLLM(date)}
`;
}
