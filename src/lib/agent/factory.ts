import { createDeepAgent } from 'deepagents';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseCheckpointSaver } from '@langchain/langgraph';

import {
  chatTools,
  localResearchTools,
  webSearchTools,
  webSearchWithFileTools,
} from './tools';
import { deepResearchSubagent } from './subagents';
import {
  buildWebSearchPrompt,
  buildLocalResearchPrompt,
  buildChatPrompt,
  buildFirefoxAIPrompt,
} from '@/lib/prompts/simplifiedAgent';

export interface AgentConfig {
  focusMode: string;
  chatLlm: BaseChatModel;
  fileIds?: string[];
  messagesCount?: number;
  query?: string;
  personaInstructions?: string;
  personalizationSection?: string;
  isFirefoxAI?: boolean;
  checkpointer?: BaseCheckpointSaver;
}

/**
 * Build a system prompt for the given focus mode and runtime context.
 */
function buildSystemPrompt(config: AgentConfig): string {
  const {
    focusMode,
    fileIds = [],
    messagesCount = 0,
    query,
    personaInstructions = '',
    personalizationSection = '',
    isFirefoxAI = false,
  } = config;

  if (isFirefoxAI) {
    return buildFirefoxAIPrompt(personaInstructions, personalizationSection);
  }

  switch (focusMode) {
    case 'chat':
      return buildChatPrompt(personaInstructions, personalizationSection);
    case 'localResearch':
      return buildLocalResearchPrompt(
        personaInstructions,
        personalizationSection,
      );
    case 'webSearch':
    default:
      return buildWebSearchPrompt(
        personaInstructions,
        personalizationSection,
        fileIds,
        messagesCount,
        query,
      );
  }
}

/**
 * Select tools for the given focus mode.
 */
function getTools(focusMode: string, fileIds: string[] = []) {
  switch (focusMode) {
    case 'chat':
    case 'firefoxAI':
      return chatTools;
    case 'localResearch':
      return localResearchTools;
    case 'webSearch':
    default:
      return fileIds.length > 0 ? webSearchWithFileTools : webSearchTools;
  }
}

/**
 * Create a new deep agent for the given focusMode and runtime configuration.
 * Agents are created per-request (no caching) to support dynamic model selection
 * and personalization without stale state.
 */
export function createAgent(config: AgentConfig) {
  const {
    focusMode,
    chatLlm,
    fileIds = [],
    isFirefoxAI = false,
    checkpointer,
  } = config;

  const systemPrompt = buildSystemPrompt(config);
  const tools = getTools(isFirefoxAI ? 'firefoxAI' : focusMode, fileIds);
  const subagents =
    focusMode === 'webSearch' && !isFirefoxAI ? [deepResearchSubagent] : [];

  return createDeepAgent({
    model: chatLlm,
    tools,
    systemPrompt,
    subagents,
    ...(checkpointer && { checkpointer }),
  });
}
