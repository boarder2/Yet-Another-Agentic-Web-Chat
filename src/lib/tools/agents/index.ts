/**
 * Agent Tools for Simplified Chat Agent
 *
 * This module exports all the tools that reimplement the functionality of the
 * existing LangGraph agents for use with createAgent. Each tool encapsulates
 * the core logic of its corresponding agent and follows the Command pattern for
 * state management.
 */

import { simpleWebSearchTool } from './simpleWebSearchTool';
import { fileSearchTool } from './fileSearchTool';
import { imageSearchTool } from './imageSearchTool';
import { urlFetchTool } from './urlFetchTool';
import { youtubeTranscriptTool } from './youtubeTranscriptTool';
import { pdfLoaderTool } from './pdfLoaderTool';
import { deepResearchTool } from './deepResearchTool';
import { todoListTool } from './todoListTool';
import { imageAnalysisTool } from './imageAnalysisTool';
import { memoryTools } from './memoryTools';
import { getCodeExecutionConfig } from '@/lib/config';
import { codeExecutionTool } from './codeExecutionTool';
import { askUserTool } from './askUserTool';

export { simpleWebSearchTool };
export { urlFetchTool };
export { fileSearchTool };
export { imageSearchTool };
export { imageAnalysisTool };
export { youtubeTranscriptTool };
export { pdfLoaderTool };
export { deepResearchTool };
export { todoListTool };
export { memoryTools };
export { codeExecutionTool };
export { askUserTool };

// Base tool arrays (non-interactive, used by subagents)
export const allAgentTools = [
  simpleWebSearchTool,
  fileSearchTool,
  urlFetchTool,
  imageSearchTool,
  imageAnalysisTool,
  youtubeTranscriptTool,
  pdfLoaderTool,
  deepResearchTool,
  todoListTool,
];

export const webSearchTools = [
  simpleWebSearchTool,
  urlFetchTool,
  imageSearchTool,
  imageAnalysisTool,
  youtubeTranscriptTool,
  pdfLoaderTool,
  deepResearchTool,
  todoListTool,
];

export const fileSearchTools = [fileSearchTool];

export const coreTools: typeof allAgentTools = [];

// Helper to append interactive-only tools (code execution + ask_user) for top-level use
function withInteractiveTools<T>(tools: T[]): T[] {
  const result = [...tools];
  const config = getCodeExecutionConfig();
  if (config.enabled && !('validationError' in config)) {
    result.push(codeExecutionTool as unknown as T);
  }
  // ask_user is always available; it checks interactiveSession at call time
  result.push(askUserTool as unknown as T);
  return result;
}

// Dynamic getters that include interactive tools when applicable
export const getAllAgentTools = () => withInteractiveTools([...allAgentTools]);
export const getWebSearchTools = () =>
  withInteractiveTools([...webSearchTools]);
export const getCoreTools = () => withInteractiveTools([...coreTools]);
