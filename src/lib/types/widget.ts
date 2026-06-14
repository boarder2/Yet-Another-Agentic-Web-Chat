// Core domain types for widgets
import type { ChartSpec } from '@/lib/chart/chartSpec';

export interface Source {
  url: string;
  type: 'Web Page' | 'HTTP Data';
}

// Resolved theme colors handed to widgets so their output matches the user's
// selected dashboard theme. Values are concrete CSS color strings (e.g. rgb(...))
// resolved from the live theme tokens — usable in inline styles and chart colors.
export interface WidgetTheme {
  mode: 'light' | 'dark' | 'custom';
  colors: {
    background: string;
    foreground: string;
    surface: string;
    surface2: string;
    border: string;
    accent: string;
    accentForeground: string;
    danger: string;
    success: string;
    warning: string;
    info: string;
  };
}

// Grid layout properties for widgets (only position and size data that should be persisted)
export interface WidgetLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  static?: boolean;
  isDraggable?: boolean;
  isResizable?: boolean;
}

interface WidgetConfigBase {
  id?: string;
  title: string;
  sources: Source[];
  refreshFrequency: number;
  refreshUnit: 'minutes' | 'hours';
  layout?: WidgetLayout;
}

export interface LlmWidgetConfig extends WidgetConfigBase {
  widgetType: 'llm';
  prompt: string;
  provider: string;
  model: string;
  tool_names?: string[];
}

export interface CodeWidgetConfig extends WidgetConfigBase {
  widgetType: 'code';
  code: string;
}

export type WidgetConfig = LlmWidgetConfig | CodeWidgetConfig;

export type Widget = WidgetConfig & {
  id: string;
  lastUpdated: Date | null;
  isLoading: boolean;
  content: string | null;
  error: string | null;
  layout: WidgetLayout;
  charts?: Record<string, ChartSpec>;
};
