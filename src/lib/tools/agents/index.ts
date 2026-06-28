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
// youtubeTranscriptTool is intentionally NOT added to any tool array below.
// It is disabled because YouTube transcript retrieval no longer works; the
// implementation is kept so it can be revived later. See youtubeTranscriptTool.ts.
// import { youtubeTranscriptTool } from './youtubeTranscriptTool';
import { pdfLoaderTool } from './pdfLoaderTool';
import { deepResearchTool } from './deepResearchTool';
import { todoListTool } from './todoListTool';
import { imageAnalysisTool } from './imageAnalysisTool';
import { memoryTools } from './memoryTools';
import { getCodeExecutionConfig } from '@/lib/config';
import { codeExecutionTool } from './codeExecutionTool';
import { askUserTool } from './askUserTool';
import { imageGenerationTool } from './imageGenerationTool';
import { chatHistorySearchTool } from './chatHistorySearchTool';
import { getChatMessagesTool } from './getChatMessagesTool';
import { createChartTool } from './createChartTool';
import { readSkillTool } from './readSkillTool';
import { editSkillTool } from './editSkillTool';

export { simpleWebSearchTool };
export { urlFetchTool };
export { fileSearchTool };
export { imageSearchTool };
export { imageAnalysisTool };
// export { youtubeTranscriptTool };
export { pdfLoaderTool };
export { deepResearchTool };
export { todoListTool };
export { memoryTools };
export { codeExecutionTool };
export { askUserTool };
export { imageGenerationTool };
export { chatHistorySearchTool };
export { getChatMessagesTool };
export { createChartTool };
export { readSkillTool };
export { editSkillTool };

// Base tool arrays (non-interactive, used by subagents)
export const allAgentTools = [
  simpleWebSearchTool,
  fileSearchTool,
  urlFetchTool,
  imageSearchTool,
  imageAnalysisTool,
  imageGenerationTool,
  pdfLoaderTool,
  deepResearchTool,
  todoListTool,
  createChartTool,
  chatHistorySearchTool,
  getChatMessagesTool,
  readSkillTool,
];

export const webSearchTools = [
  simpleWebSearchTool,
  urlFetchTool,
  imageSearchTool,
  imageAnalysisTool,
  pdfLoaderTool,
  deepResearchTool,
  todoListTool,
  createChartTool,
  chatHistorySearchTool,
  getChatMessagesTool,
  readSkillTool,
];

export const fileSearchTools = [fileSearchTool];

export const coreTools: typeof allAgentTools = [
  imageGenerationTool,
  chatHistorySearchTool,
  getChatMessagesTool,
  readSkillTool,
];

// Whether the code_execution tool is configured and available for use.
export const isCodeExecutionEnabled = (): boolean => {
  const config = getCodeExecutionConfig();
  return config.enabled && !('validationError' in config);
};

// Helper to append interactive-only tools (code execution + ask_user) for top-level use
function withInteractiveTools<T>(tools: T[]): T[] {
  const result = [...tools];
  if (isCodeExecutionEnabled()) {
    result.push(codeExecutionTool as unknown as T);
  }
  // ask_user is always available; it checks interactiveSession at call time
  result.push(askUserTool as unknown as T);
  // edit_skill is always available; it checks interactiveSession at call time
  result.push(editSkillTool as unknown as T);
  return result;
}

// Dynamic getters that include interactive tools when applicable
export const getAllAgentTools = () => withInteractiveTools([...allAgentTools]);
export const getWebSearchTools = () =>
  withInteractiveTools([...webSearchTools]);
export const getCoreTools = () => withInteractiveTools([...coreTools]);
// Local research includes core tools plus chart support (no web search)
export const getLocalResearchTools = () =>
  withInteractiveTools([...coreTools, createChartTool]);
