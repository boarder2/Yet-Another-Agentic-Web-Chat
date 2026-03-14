import { createDeepAgent } from 'deepagents';
import { createMiddleware } from 'langchain';
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

type TodoItem = {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
};

function normalizeTodosArg(value: unknown): TodoItem[] | undefined {
  const normalizeTodo = (item: unknown): TodoItem | null => {
    if (!item || typeof item !== 'object') return null;

    const candidate = item as Record<string, unknown>;
    const content =
      typeof candidate.content === 'string' ? candidate.content.trim() : '';
    const status =
      candidate.status === 'pending' ||
      candidate.status === 'in_progress' ||
      candidate.status === 'completed'
        ? candidate.status
        : null;

    if (!content || !status) return null;

    return { content, status };
  };

  if (Array.isArray(value)) {
    const todos = value.map(normalizeTodo).filter(Boolean) as TodoItem[];
    return todos.length > 0 ? todos : undefined;
  }

  if (typeof value !== 'string') return undefined;

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    const todos = parsed.map(normalizeTodo).filter(Boolean) as TodoItem[];
    return todos.length > 0 ? todos : undefined;
  } catch {
    return undefined;
  }
}

const normalizeWriteTodosMiddleware = createMiddleware({
  name: 'normalizeWriteTodosMiddleware',
  wrapToolCall: async (request, handler) => {
    if (request.toolCall.name !== 'write_todos') {
      return handler(request);
    }

    const rawArgs =
      request.toolCall.args && typeof request.toolCall.args === 'object'
        ? (request.toolCall.args as Record<string, unknown>)
        : {};
    const normalizedTodos = normalizeTodosArg(rawArgs.todos);

    if (!normalizedTodos) {
      return handler(request);
    }

    return handler({
      ...request,
      toolCall: {
        ...request.toolCall,
        args: {
          ...rawArgs,
          todos: normalizedTodos,
        },
      },
    });
  },
});

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
    middleware: [normalizeWriteTodosMiddleware] as never,
    ...(checkpointer && { checkpointer }),
  });
}
