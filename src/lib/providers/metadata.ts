/**
 * Static, display-only provider metadata. Deliberately self-contained: it
 * imports NOTHING (no provider modules, no `./index`, no DB/settings code) so
 * that client components — e.g. the settings model-visibility/model-settings
 * panels — can import it without dragging any server-only code (model loaders,
 * better-sqlite3, etc.) into the client bundle.
 *
 * Keep the `key`/`displayName` values in sync with each provider module's
 * `PROVIDER_INFO` export (`src/lib/providers/<provider>.ts`).
 */
export const PROVIDER_METADATA = {
  openai: { key: 'openai', displayName: 'OpenAI' },
  ollama: { key: 'ollama', displayName: 'Ollama' },
  groq: { key: 'groq', displayName: 'Groq' },
  anthropic: { key: 'anthropic', displayName: 'Anthropic' },
  gemini: { key: 'gemini', displayName: 'Google Gemini' },
  transformers: { key: 'transformers', displayName: 'Hugging Face' },
  deepseek: { key: 'deepseek', displayName: 'Deepseek AI' },
  aimlapi: { key: 'aimlapi', displayName: 'AI/ML API' },
  lmstudio: { key: 'lmstudio', displayName: 'LM Studio' },
  openrouter: { key: 'openrouter', displayName: 'OpenRouter' },
  custom_openai: { key: 'custom_openai', displayName: 'Custom OpenAI' },
};
