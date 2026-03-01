import { createDeepAgent, type SubAgent } from 'deepagents';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { allAgentTools, webSearchTools, coreTools } from '@/lib/tools/agents';
import { buildChatPrompt } from '@/lib/prompts/simplifiedAgent/chat';
import { buildFirefoxAIPrompt } from '@/lib/prompts/simplifiedAgent/firefoxAI';
import { buildLocalResearchPrompt } from '@/lib/prompts/simplifiedAgent/localResearch';
import { buildWebSearchPrompt } from '@/lib/prompts/simplifiedAgent/webSearch';
import { buildPersonalizationSection } from '@/lib/utils/personalization';
import { checkpointer } from './checkpointer';

export interface CreateAgentOptions {
  chatLlm: BaseChatModel;
  systemLlm: BaseChatModel;
  focusMode: string;
  personaInstructions?: string;
  fileIds?: string[];
  messagesCount?: number;
  query?: string;
  firefoxAIDetected?: boolean;
  userLocation?: string;
  userProfile?: string;
}

/**
 * Get tools for a given focus mode.
 */
function getToolsForFocusMode(focusMode: string) {
  switch (focusMode) {
    case 'chat':
      return coreTools;
    case 'webSearch':
      return allAgentTools;
    case 'localResearch':
      return coreTools;
    default:
      return allAgentTools;
  }
}

/**
 * Build the system prompt for a given focus mode.
 */
function buildSystemPrompt(options: CreateAgentOptions): string {
  const {
    focusMode,
    personaInstructions = '',
    fileIds = [],
    messagesCount = 0,
    query,
    firefoxAIDetected,
    userLocation,
    userProfile,
  } = options;

  const personalizationSection = buildPersonalizationSection({
    location: userLocation,
    profile: userProfile,
  });

  if (firefoxAIDetected) {
    return buildFirefoxAIPrompt(
      personaInstructions,
      personalizationSection,
      new Date(),
    );
  }

  switch (focusMode) {
    case 'chat':
      return buildChatPrompt(
        personaInstructions,
        personalizationSection,
        new Date(),
      );
    case 'webSearch':
      return buildWebSearchPrompt(
        personaInstructions,
        personalizationSection,
        messagesCount,
        query,
        new Date(),
      );
    case 'localResearch':
      return buildLocalResearchPrompt(
        personaInstructions,
        personalizationSection,
        new Date(),
      );
    default:
      return buildWebSearchPrompt(
        personaInstructions,
        personalizationSection,
        messagesCount,
        query,
        new Date(),
      );
  }
}

/**
 * Create a deep agent configured for the given focus mode.
 * Returns a LangGraph CompiledStateGraph that supports .stream() and .invoke().
 */
export function createSearchAgent(options: CreateAgentOptions) {
  const tools = options.firefoxAIDetected
    ? []
    : getToolsForFocusMode(options.focusMode);

  const systemPrompt = buildSystemPrompt(options);

  // Register a research subagent so the agent can delegate complex,
  // multi-step research tasks via the `task` tool. The default
  // general-purpose subagent is also created automatically by deepagents.
  const subagents: SubAgent[] =
    tools.length > 0
      ? [
          {
            name: 'Researcher',
            description:
              'Research assistant for complex, multi-step research tasks. ' +
              'Delegates web searches, URL analysis, and information gathering ' +
              'to produce a synthesized report. Use for any research task that ' +
              'involves multiple searches or deep investigation of a topic.',
            systemPrompt,
            tools,
          },
        ]
      : [];

  console.log(
    `createSearchAgent: Creating agent for focus mode "${options.focusMode}" with ${tools.length} tools`,
  );

  const agent = createDeepAgent({
    model: options.chatLlm,
    tools,
    systemPrompt,
    checkpointer,
    subagents,
  });

  return agent;
}
