import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { CachedEmbeddings } from '@/lib/utils/cachedEmbeddings';

import { webSearchTool } from './webSearchTool';
import { urlSummarizationTool } from './urlSummarizationTool';
import { fileSearchTool } from './fileSearchTool';
import { imageSearchTool } from './imageSearchTool';
import { imageAnalysisTool } from './imageAnalysisTool';
import { youtubeTranscriptTool } from './youtubeTranscriptTool';
import { pdfLoaderTool } from './pdfLoaderTool';

export {
  webSearchTool,
  urlSummarizationTool,
  fileSearchTool,
  imageSearchTool,
  imageAnalysisTool,
  youtubeTranscriptTool,
  pdfLoaderTool,
};

export type ToolRuntimeDeps = {
  systemLlm: BaseChatModel;
  embeddings: CachedEmbeddings;
  fileIds: string[];
  messageId?: string;
  retrievalSignal?: AbortSignal;
};

/** Tools available in web search mode (no file search) */
export const webSearchTools = [
  webSearchTool,
  urlSummarizationTool,
  imageSearchTool,
  imageAnalysisTool,
  youtubeTranscriptTool,
  pdfLoaderTool,
];

/** Web search tools plus file search — used when files are attached */
export const webSearchWithFileTools = [
  webSearchTool,
  urlSummarizationTool,
  fileSearchTool,
  imageSearchTool,
  imageAnalysisTool,
  youtubeTranscriptTool,
  pdfLoaderTool,
];

/** File search only — local research mode */
export const localResearchTools = [fileSearchTool];

/** No tools — chat mode */
export const chatTools: never[] = [];
