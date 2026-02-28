/**
 * Agent Tools for Deep Agent
 *
 * This module exports all the tools available to the deep agent.
 * Tools return plain strings — the React agent automatically wraps
 * return values in ToolMessages.
 * Source metadata is emitted via dispatchCustomEvent('sources', ...).
 */

import { simpleWebSearchTool } from './simpleWebSearchTool';
import { imageSearchTool } from './imageSearchTool';
import { urlSummarizationTool } from './urlSummarizationTool';
import { youtubeTranscriptTool } from './youtubeTranscriptTool';
import { pdfLoaderTool } from './pdfLoaderTool';
import { imageAnalysisTool } from './imageAnalysisTool';

export { simpleWebSearchTool };
export { imageSearchTool };
export { imageAnalysisTool };
export { youtubeTranscriptTool };
export { pdfLoaderTool };

// All available agent tools
export const allAgentTools = [
  simpleWebSearchTool,
  urlSummarizationTool,
  imageSearchTool,
  imageAnalysisTool,
  youtubeTranscriptTool,
  pdfLoaderTool,
];

// Tool categories for selective loading based on focus mode
export const webSearchTools = [
  simpleWebSearchTool,
  urlSummarizationTool,
  imageSearchTool,
  imageAnalysisTool,
  youtubeTranscriptTool,
  pdfLoaderTool,
];

// Core tools that are always available (empty — deep agent adds its own)
export const coreTools: typeof allAgentTools = [];
