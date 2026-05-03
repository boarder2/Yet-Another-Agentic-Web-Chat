'use client';

import SettingsSection from '../components/SettingsSection';
import InputComponent from '../components/InputComponent';
import Select from '../components/Select';
import { SettingsType } from '../types';

const PROVIDER_OPTIONS = [
  { value: 'searxng', label: 'SearXNG' },
  { value: 'brave_search', label: 'Brave Search' },
  { value: 'brave_llm', label: 'Brave LLM Context' },
  { value: 'mojeek', label: 'Mojeek' },
];

const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'nl', label: 'Dutch' },
  { value: 'sv', label: 'Swedish' },
  { value: 'no', label: 'Norwegian' },
  { value: 'da', label: 'Danish' },
  { value: 'fi', label: 'Finnish' },
  { value: 'pl', label: 'Polish' },
  { value: 'cs', label: 'Czech' },
  { value: 'ru', label: 'Russian' },
  { value: 'tr', label: 'Turkish' },
  { value: 'ar', label: 'Arabic' },
  { value: 'he', label: 'Hebrew' },
  { value: 'hi', label: 'Hindi' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'zh', label: 'Chinese' },
];

const REGION_OPTIONS = [
  { value: 'US', label: 'United States' },
  { value: 'CA', label: 'Canada' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'IE', label: 'Ireland' },
  { value: 'AU', label: 'Australia' },
  { value: 'NZ', label: 'New Zealand' },
  { value: 'DE', label: 'Germany' },
  { value: 'FR', label: 'France' },
  { value: 'ES', label: 'Spain' },
  { value: 'IT', label: 'Italy' },
  { value: 'NL', label: 'Netherlands' },
  { value: 'BE', label: 'Belgium' },
  { value: 'CH', label: 'Switzerland' },
  { value: 'AT', label: 'Austria' },
  { value: 'SE', label: 'Sweden' },
  { value: 'NO', label: 'Norway' },
  { value: 'DK', label: 'Denmark' },
  { value: 'FI', label: 'Finland' },
  { value: 'PL', label: 'Poland' },
  { value: 'CZ', label: 'Czech Republic' },
  { value: 'PT', label: 'Portugal' },
  { value: 'BR', label: 'Brazil' },
  { value: 'MX', label: 'Mexico' },
  { value: 'AR', label: 'Argentina' },
  { value: 'JP', label: 'Japan' },
  { value: 'KR', label: 'South Korea' },
  { value: 'CN', label: 'China' },
  { value: 'HK', label: 'Hong Kong' },
  { value: 'TW', label: 'Taiwan' },
  { value: 'IN', label: 'India' },
  { value: 'SG', label: 'Singapore' },
  { value: 'ID', label: 'Indonesia' },
  { value: 'TH', label: 'Thailand' },
  { value: 'TR', label: 'Turkey' },
  { value: 'IL', label: 'Israel' },
  { value: 'AE', label: 'United Arab Emirates' },
  { value: 'SA', label: 'Saudi Arabia' },
  { value: 'ZA', label: 'South Africa' },
  { value: 'RU', label: 'Russia' },
];

const CAPABILITIES: Array<{
  key: 'web' | 'images' | 'videos' | 'autocomplete';
  label: string;
}> = [
  { key: 'web', label: 'Web search' },
  { key: 'images', label: 'Image search' },
  { key: 'videos', label: 'Video search' },
  { key: 'autocomplete', label: 'Autocomplete' },
];

// Capabilities per provider. Kept in sync with src/lib/search/providers/*.
const CAPABILITY_MATRIX: Record<
  string,
  { web: boolean; images: boolean; videos: boolean; autocomplete: boolean }
> = {
  searxng: { web: true, images: true, videos: true, autocomplete: true },
  brave_search: { web: true, images: true, videos: true, autocomplete: true },
  brave_llm: { web: true, images: false, videos: false, autocomplete: false },
  mojeek: { web: true, images: false, videos: false, autocomplete: false },
};

type Mode = 'regular' | 'private';

function getSourceForCapability(
  mode: Mode,
  capability: 'web' | 'images' | 'videos' | 'autocomplete',
  provider: string,
  privateProvider: string,
  fallbackProvider: string,
): 'primary' | 'fallback' | 'unavailable' {
  // Autocomplete ignores mode.
  const primaryId =
    capability === 'autocomplete'
      ? provider
      : mode === 'private' && privateProvider
        ? privateProvider
        : provider;
  const primaryCaps = CAPABILITY_MATRIX[primaryId];
  if (primaryCaps?.[capability]) return 'primary';

  const fallbackCaps = CAPABILITY_MATRIX[fallbackProvider];
  if (
    fallbackProvider &&
    fallbackProvider !== primaryId &&
    fallbackCaps?.[capability]
  ) {
    return 'fallback';
  }
  return 'unavailable';
}

const BADGE_STYLES: Record<string, string> = {
  primary: 'bg-accent/20 text-accent',
  fallback: 'bg-warning-soft text-warning',
  unavailable: 'bg-danger-soft text-danger',
};

export default function SearchProvidersSection({
  config,
  savingStates,
  setConfig,
  saveConfig,
}: {
  config: SettingsType;
  savingStates: Record<string, boolean>;
  setConfig: React.Dispatch<React.SetStateAction<SettingsType | null>>;
  saveConfig: (
    key: string,
    value: string | string[] | number | boolean,
  ) => void;
}) {
  const provider = config.searchProvider || 'searxng';
  const privateProvider = config.searchPrivateProvider || '';
  const fallbackProvider = config.searchFallbackProvider || 'searxng';
  const language = config.searchLanguage || 'en';
  const region = config.searchRegion ?? 'US';

  return (
    <SettingsSection title="Search Providers">
      <p className="text-xs text-fg/60">
        Choose which search provider powers web, image, video, and autocomplete
        searches. Private chats can use a different primary provider. When a
        provider doesn&apos;t support a capability, the fallback provider is
        used; if the fallback can&apos;t cover it either, that capability is
        hidden in the UI.
      </p>

      <div className="flex flex-col space-y-4">
        <div className="flex flex-col space-y-1">
          <p className="text-sm">Regular chat provider</p>
          <Select
            value={provider}
            options={PROVIDER_OPTIONS}
            onChange={(e) => {
              setConfig((prev) => ({
                ...prev!,
                searchProvider: e.target.value,
              }));
              saveConfig('searchProvider', e.target.value);
            }}
          />
        </div>

        <div className="flex flex-col space-y-1">
          <p className="text-sm">Private chat provider</p>
          <Select
            value={privateProvider}
            options={[
              { value: '', label: 'Same as regular provider' },
              ...PROVIDER_OPTIONS,
            ]}
            onChange={(e) => {
              setConfig((prev) => ({
                ...prev!,
                searchPrivateProvider: e.target.value,
              }));
              saveConfig('searchPrivateProvider', e.target.value);
            }}
          />
        </div>

        <div className="flex flex-col space-y-1">
          <p className="text-sm">Fallback provider</p>
          <Select
            value={fallbackProvider}
            options={PROVIDER_OPTIONS}
            onChange={(e) => {
              setConfig((prev) => ({
                ...prev!,
                searchFallbackProvider: e.target.value,
              }));
              saveConfig('searchFallbackProvider', e.target.value);
            }}
          />
          <p className="text-xs text-fg/60">
            Used for any capability the chosen primary provider doesn&apos;t
            support.
          </p>
        </div>

        <div className="flex flex-col space-y-1">
          <p className="text-sm">Search language</p>
          <Select
            value={language}
            options={LANGUAGE_OPTIONS}
            onChange={(e) => {
              setConfig((prev) => ({
                ...prev!,
                searchLanguage: e.target.value,
              }));
              saveConfig('searchLanguage', e.target.value);
            }}
          />
          <p className="text-xs text-fg/60">
            Sent to providers as the preferred result language.
          </p>
        </div>

        <div className="flex flex-col space-y-1">
          <p className="text-sm">Search region</p>
          <Select
            value={region}
            options={[{ value: '', label: 'No region' }, ...REGION_OPTIONS]}
            onChange={(e) => {
              setConfig((prev) => ({
                ...prev!,
                searchRegion: e.target.value,
              }));
              saveConfig('searchRegion', e.target.value);
            }}
          />
          <p className="text-xs text-fg/60">
            ISO 3166-1 alpha-2 country code passed to providers (e.g. country
            for Brave, region for Mojeek).
          </p>
        </div>
      </div>

      <div className="mt-6">
        <p className="text-sm font-medium mb-2">Capability availability</p>
        <div className="rounded-surface border border-surface-2 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-surface-2/40">
              <tr>
                <th className="text-left px-3 py-2">Capability</th>
                <th className="text-left px-3 py-2">Regular chat</th>
                <th className="text-left px-3 py-2">Private chat</th>
              </tr>
            </thead>
            <tbody>
              {CAPABILITIES.map(({ key, label }) => {
                const regular =
                  key === 'autocomplete'
                    ? getSourceForCapability(
                        'regular',
                        key,
                        provider,
                        privateProvider,
                        fallbackProvider,
                      )
                    : getSourceForCapability(
                        'regular',
                        key,
                        provider,
                        privateProvider,
                        fallbackProvider,
                      );
                const priv =
                  key === 'autocomplete'
                    ? null
                    : getSourceForCapability(
                        'private',
                        key,
                        provider,
                        privateProvider,
                        fallbackProvider,
                      );
                return (
                  <tr key={key} className="border-t border-surface-2">
                    <td className="px-3 py-2">{label}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`px-2 py-0.5 rounded-pill ${BADGE_STYLES[regular]}`}
                      >
                        {regular}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {priv === null ? (
                        <span className="text-fg/40">not applicable</span>
                      ) : (
                        <span
                          className={`px-2 py-0.5 rounded-pill ${BADGE_STYLES[priv]}`}
                        >
                          {priv}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6 flex flex-col space-y-4">
        <p className="text-sm font-medium">Provider credentials</p>

        <div className="flex flex-col space-y-1">
          <p className="text-sm">SearXNG API URL</p>
          <InputComponent
            type="text"
            placeholder="http://localhost:8080"
            value={config.searxngApiUrl || ''}
            isSaving={savingStates['searxngApiUrl']}
            onChange={(e) =>
              setConfig((prev) => ({
                ...prev!,
                searxngApiUrl: e.target.value,
              }))
            }
            onSave={(value) => saveConfig('searxngApiUrl', value)}
          />
        </div>

        <div className="flex flex-col space-y-1">
          <p className="text-sm">Brave Search API key</p>
          <InputComponent
            type="password"
            placeholder="Brave Search API key"
            value={config.braveSearchApiKey || ''}
            isSaving={savingStates['braveSearchApiKey']}
            onChange={(e) =>
              setConfig((prev) => ({
                ...prev!,
                braveSearchApiKey: e.target.value,
              }))
            }
            onSave={(value) => saveConfig('braveSearchApiKey', value)}
          />
        </div>

        <div className="flex flex-col space-y-1">
          <p className="text-sm">Brave LLM Context API key</p>
          <InputComponent
            type="password"
            placeholder="Brave LLM API key"
            value={config.braveLLMApiKey || ''}
            isSaving={savingStates['braveLLMApiKey']}
            onChange={(e) =>
              setConfig((prev) => ({
                ...prev!,
                braveLLMApiKey: e.target.value,
              }))
            }
            onSave={(value) => saveConfig('braveLLMApiKey', value)}
          />
        </div>

        <div className="flex flex-col space-y-1">
          <p className="text-sm">Mojeek API key</p>
          <InputComponent
            type="password"
            placeholder="Mojeek API key"
            value={config.mojeekApiKey || ''}
            isSaving={savingStates['mojeekApiKey']}
            onChange={(e) =>
              setConfig((prev) => ({
                ...prev!,
                mojeekApiKey: e.target.value,
              }))
            }
            onSave={(value) => saveConfig('mojeekApiKey', value)}
          />
        </div>
      </div>
    </SettingsSection>
  );
}
