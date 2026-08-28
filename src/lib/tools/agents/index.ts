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
import { imageGenerationTool } from './imageGenerationTool';
import { chatHistorySearchTool } from './chatHistorySearchTool';
import { getChatMessagesTool } from './getChatMessagesTool';
import { createChartTool } from './createChartTool';
import { showChartTool } from './showChartTool';
import { readSkillTool } from './readSkillTool';
import { editSkillTool } from './editSkillTool';
import { artifactTools } from './artifactTools';
import { yaawcDocsTool } from './yaawcDocsTool';
import { searchPlacesTool } from './searchPlacesTool';
import { getPlaceDetailsTool } from './getPlaceDetailsTool';
import { getRouteTool } from './getRouteTool';
import { showMapTool } from './showMapTool';
import { requestLocationTool } from './requestLocationTool';

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
export { imageGenerationTool };
export { chatHistorySearchTool };
export { getChatMessagesTool };
export { createChartTool };
export { showChartTool };
export const CHART_TOOL_NAMES = [createChartTool.name, showChartTool.name];
export { readSkillTool };
export { editSkillTool };
export { artifactTools };
export { yaawcDocsTool };
export { searchPlacesTool };
export { getPlaceDetailsTool };
export { getRouteTool };
export { showMapTool };
export { requestLocationTool };

/** Mapping tools are injected only by an eligible top-level Web Search turn. */
export const mappingTools = [
  searchPlacesTool,
  getPlaceDetailsTool,
  getRouteTool,
  requestLocationTool,
  showMapTool,
];
export const getMappingTools = () => [...mappingTools];
export const MAPPING_TOOL_NAMES = mappingTools.map((tool) => tool.name);

// Base tool arrays (non-interactive, used by subagents)
export const allAgentTools = [
  simpleWebSearchTool,
  fileSearchTool,
  urlFetchTool,
  imageSearchTool,
  imageAnalysisTool,
  imageGenerationTool,
  pdfLoaderTool,
  youtubeTranscriptTool,
  deepResearchTool,
  todoListTool,
  createChartTool,
  showChartTool,
  chatHistorySearchTool,
  getChatMessagesTool,
  readSkillTool,
  ...artifactTools,
];

export const webSearchTools = [
  simpleWebSearchTool,
  urlFetchTool,
  imageSearchTool,
  imageAnalysisTool,
  pdfLoaderTool,
  youtubeTranscriptTool,
  deepResearchTool,
  todoListTool,
  createChartTool,
  showChartTool,
  chatHistorySearchTool,
  getChatMessagesTool,
  readSkillTool,
  ...artifactTools,
];

export const fileSearchTools = [fileSearchTool];

export const coreTools: typeof allAgentTools = [
  imageGenerationTool,
  chatHistorySearchTool,
  getChatMessagesTool,
  createChartTool,
  showChartTool,
  readSkillTool,
];

// Whether the code_execution tool is configured and available for use.
export const isCodeExecutionEnabled = (): boolean => {
  const config = getCodeExecutionConfig();
  return config.enabled && !('validationError' in config);
};

// Present in every top-level toolset and deliberately absent from the static
// subagent arrays. ask_user and edit_skill check interactiveSession themselves.
const ALWAYS_ON_TOOLS = [askUserTool, editSkillTool, yaawcDocsTool];

// Helper to complete a top-level toolset: always-on tools plus code execution
// when it is configured.
function withTopLevelTools<T>(tools: T[]): T[] {
  const result = [...tools];
  if (isCodeExecutionEnabled()) {
    result.push(codeExecutionTool as unknown as T);
  }
  result.push(...(ALWAYS_ON_TOOLS as unknown as T[]));
  return result;
}

// Dynamic getters that include top-level-only tools when applicable
export const getAllAgentTools = () => withTopLevelTools([...allAgentTools]);
export const getWebSearchTools = () => withTopLevelTools([...webSearchTools]);
export const getCoreTools = () => withTopLevelTools([...coreTools]);
// Local research includes core tools plus artifact support (no web search)
export const getLocalResearchTools = () =>
  withTopLevelTools([...coreTools, ...artifactTools]);
