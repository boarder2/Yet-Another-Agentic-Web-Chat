export interface SettingsType {
  chatModelProviders: {
    [key: string]: { name: string; displayName: string }[];
  };
  embeddingModelProviders: {
    [key: string]: { name: string; displayName: string }[];
  };
  openaiApiKey: string;
  groqApiKey: string;
  openrouterApiKey: string;
  anthropicApiKey: string;
  geminiApiKey: string;
  ollamaApiUrl: string;
  lmStudioApiUrl: string;
  deepseekApiKey: string;
  aimlApiKey: string;
  customOpenaiApiKey: string;
  customOpenaiApiUrl: string;
  customOpenaiModelName: string;
  ollamaContextWindow: number;
  hiddenModels: string[];
  selectedSystemModelProvider: string;
  selectedSystemModel: string;
  selectedEmbeddingModelProvider: string;
  selectedEmbeddingModel: string;
  linkSystemToChat: boolean;
  privateSessionDurationMinutes: number;
  retentionChatsMode: 'days' | 'count' | 'disabled';
  retentionChatsValue: number;
  retentionScheduledRunsMode: 'days' | 'count' | 'disabled';
  retentionScheduledRunsValue: number;
}

export type SectionKey =
  | 'preferences'
  | 'automatic-search'
  | 'personalization'
  | 'memory'
  | 'retention'
  | 'persona-prompts'
  | 'research-methodologies'
  | 'default-search'
  | 'model-settings'
  | 'model-visibility'
  | 'api-keys';

export const SETTINGS_SECTIONS: {
  key: SectionKey;
  label: string;
  group: string;
}[] = [
  { key: 'preferences', label: 'Preferences', group: 'General' },
  { key: 'automatic-search', label: 'Automatic Search', group: 'General' },
  { key: 'personalization', label: 'Personalization', group: 'General' },
  { key: 'memory', label: 'Memory', group: 'General' },
  { key: 'retention', label: 'Retention', group: 'General' },
  { key: 'persona-prompts', label: 'Persona Prompts', group: 'General' },
  {
    key: 'research-methodologies',
    label: 'Research Methodologies',
    group: 'General',
  },
  { key: 'default-search', label: 'Default Search', group: 'AI Models' },
  { key: 'model-settings', label: 'Model Settings', group: 'AI Models' },
  { key: 'model-visibility', label: 'Model Visibility', group: 'AI Models' },
  { key: 'api-keys', label: 'API Keys', group: 'Security' },
];
