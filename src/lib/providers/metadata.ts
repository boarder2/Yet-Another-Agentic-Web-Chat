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
export interface ProviderMetadata {
  key: string;
  displayName: string;
}

export const PROVIDER_METADATA = {
  openai: { key: 'openai', displayName: 'OpenAI' },
  anthropic: { key: 'anthropic', displayName: 'Anthropic' },
  gemini: { key: 'gemini', displayName: 'Google Gemini' },
  transformers: { key: 'transformers', displayName: 'Hugging Face' },
  deepseek: { key: 'deepseek', displayName: 'Deepseek AI' },
  openrouter: { key: 'openrouter', displayName: 'OpenRouter' },
  test: { key: 'test', displayName: 'Test' },
};
