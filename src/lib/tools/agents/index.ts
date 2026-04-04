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
import { urlSummarizationTool } from './urlSummarizationTool';
import { youtubeTranscriptTool } from './youtubeTranscriptTool';
import { pdfLoaderTool } from './pdfLoaderTool';
import { deepResearchTool } from './deepResearchTool';
import { todoListTool } from './todoListTool';
import { imageAnalysisTool } from './imageAnalysisTool';
import { memoryTools } from './memoryTools';
import { getCodeExecutionConfig } from '@/lib/config';
import { codeExecutionTool } from './codeExecutionTool';

export { simpleWebSearchTool };
export { fileSearchTool };
export { imageSearchTool };
export { imageAnalysisTool };
export { youtubeTranscriptTool };
export { pdfLoaderTool };
export { deepResearchTool };
export { todoListTool };
export { memoryTools };
export { codeExecutionTool };

// Base tool arrays (non-interactive, used by subagents)
export const allAgentTools = [
  simpleWebSearchTool,
  fileSearchTool,
  urlSummarizationTool,
  imageSearchTool,
  imageAnalysisTool,
  youtubeTranscriptTool,
  pdfLoaderTool,
  deepResearchTool,
  todoListTool,
];

export const webSearchTools = [
  simpleWebSearchTool,
  urlSummarizationTool,
  imageSearchTool,
  imageAnalysisTool,
  youtubeTranscriptTool,
  pdfLoaderTool,
  deepResearchTool,
  todoListTool,
];

export const fileSearchTools = [fileSearchTool];

export const coreTools: typeof allAgentTools = [];

// Helper to conditionally append code execution tool for top-level interactive use
function withCodeExecution<T>(tools: T[]): T[] {
  const config = getCodeExecutionConfig();
  if (config.enabled && !('validationError' in config)) {
    return [...tools, codeExecutionTool as unknown as T];
  }
  return tools;
}

// Dynamic getters that include code execution when enabled
export const getAllAgentTools = () => withCodeExecution([...allAgentTools]);
export const getWebSearchTools = () => withCodeExecution([...webSearchTools]);
export const getCoreTools = () => withCodeExecution([...coreTools]);
