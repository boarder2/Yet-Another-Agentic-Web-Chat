// API request/response types
import { Source, WidgetTheme } from './widget';
import type { ChartSpec } from '@/lib/chart/chartSpec';

export interface WidgetProcessRequest {
  sources: Source[];
  prompt: string;
  provider: string;
  model: string;
  tool_names?: string[];
  theme?: WidgetTheme;
}

export interface WidgetProcessResponse {
  content: string;
  success: boolean;
  sourcesFetched?: number;
  totalSources?: number;
  warnings?: string[];
  error?: string;
}

export interface CodeWidgetProcessRequest {
  code: string;
  sources: Source[];
  location?: string;
  theme?: WidgetTheme;
}

export interface CodeWidgetRunLogs {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  oomKilled: boolean;
}

export interface CodeWidgetProcessResponse {
  success: boolean;
  content: string;
  charts: Record<string, ChartSpec>;
  logs: CodeWidgetRunLogs;
  error?: string;
  warnings?: string[];
  sourcesFetched: number;
  totalSources: number;
}
