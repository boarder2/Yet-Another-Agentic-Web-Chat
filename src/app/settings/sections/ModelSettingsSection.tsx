'use client';

import { useState, useSyncExternalStore } from 'react';
import { LoaderCircle, RefreshCw, RotateCcw } from 'lucide-react';
import { PROVIDER_METADATA } from '@/lib/providers/metadata';
import SettingsSection from '../components/SettingsSection';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import Select from '@/components/ui/Select';
import InputComponent from '../components/InputComponent';
import { SettingsType } from '../types';
import {
  readLocalStorage,
  subscribeLocalStorage,
  useLocalStorageString,
  writeLocalStorage,
} from '@/lib/hooks/useLocalStorage';
import { useRefreshModels } from '@/lib/hooks/api/useModels';
import { flushSettings } from '@/lib/settings/persist';
import {
  OPENROUTER_QUANTIZATION_OPTIONS,
  OPENROUTER_QUANTIZATIONS,
  OPENROUTER_QUANTIZATIONS_SETTING_KEY,
  parseOpenRouterQuantizations,
  type OpenRouterQuantization,
} from '@/lib/settings/openrouterQuantizations';

const subscribeToOpenRouterQuantizations = (onStoreChange: () => void) =>
  subscribeLocalStorage(OPENROUTER_QUANTIZATIONS_SETTING_KEY, onStoreChange);
const getOpenRouterQuantizationsSnapshot = () =>
  readLocalStorage(OPENROUTER_QUANTIZATIONS_SETTING_KEY);
const getServerOpenRouterQuantizationsSnapshot = () => null;
const OPENROUTER_QUANTIZATION_GROUPS = ['Integer', 'Floating point'] as const;

type QuantizationSaveState = 'idle' | 'saving' | 'saved' | 'error';

function OpenRouterQuantizationSettings() {
  const rawValue = useSyncExternalStore(
    subscribeToOpenRouterQuantizations,
    getOpenRouterQuantizationsSnapshot,
    getServerOpenRouterQuantizationsSnapshot,
  );
  const parsed = parseOpenRouterQuantizations(rawValue);
  const selected = parsed.valid ? parsed.quantizations : [];
  const [saveState, setSaveState] = useState<QuantizationSaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const isSaving = saveState === 'saving';

  const saveSelection = async (next: OpenRouterQuantization[]) => {
    const canonical = OPENROUTER_QUANTIZATIONS.filter((value) =>
      next.includes(value),
    );
    setSaveState('saving');
    setSaveError(null);
    writeLocalStorage(
      OPENROUTER_QUANTIZATIONS_SETTING_KEY,
      canonical.length > 0 ? JSON.stringify(canonical) : null,
    );

    try {
      await flushSettings();
      setSaveState('saved');
    } catch (error) {
      console.error('Failed to save OpenRouter quantizations:', error);
      setSaveState('error');
      setSaveError(
        'Failed to save OpenRouter quantization settings. Try again.',
      );
    }
  };

  const handleToggle = (value: OpenRouterQuantization, checked: boolean) => {
    const currentRawValue = readLocalStorage(
      OPENROUTER_QUANTIZATIONS_SETTING_KEY,
    );
    const current = parseOpenRouterQuantizations(currentRawValue);
    const currentSelected = current.valid ? current.quantizations : [];
    const next = OPENROUTER_QUANTIZATIONS.filter((quantization) =>
      quantization === value ? checked : currentSelected.includes(quantization),
    );
    void saveSelection(next);
  };

  const invalidError = parsed.valid
    ? undefined
    : `Stored setting is invalid: ${parsed.error}`;

  return (
    <div className="flex flex-col space-y-4 pt-4 border-t border-surface-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">OpenRouter</h3>
        {saveState === 'saving' && (
          <span
            className="flex items-center gap-1 text-xs text-accent"
            role="status"
          >
            <LoaderCircle size={14} className="animate-spin" />
            Saving…
          </span>
        )}
        {saveState === 'saved' && (
          <span className="text-xs text-success" role="status">
            Saved
          </span>
        )}
        {saveState === 'error' && (
          <span className="text-xs text-danger" role="alert">
            Not saved
          </span>
        )}
      </div>

      <p className="text-xs text-fg-muted">
        Restrict OpenRouter chat routing to endpoints with selected
        quantizations. Select multiple values to allow any of them.
      </p>

      <Field
        grouped
        label="Allowed endpoint quantizations"
        error={invalidError}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {OPENROUTER_QUANTIZATION_GROUPS.map((group) => (
            <fieldset key={group} className="min-w-0 border-0 p-0">
              <legend className="mb-2 text-xs font-medium text-fg-muted">
                {group}
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {OPENROUTER_QUANTIZATION_OPTIONS.filter(
                  (option) => option.group === group,
                ).map((option) => (
                  <label
                    key={option.value}
                    className="flex items-center gap-2 rounded-control border border-transparent bg-surface-2 px-3 py-2 text-sm transition-colors duration-150 hover:bg-surface"
                  >
                    <input
                      type="checkbox"
                      aria-label={option.label}
                      className="accent-accent border border-transparent focus-border-neutral"
                      checked={selected.includes(option.value)}
                      onChange={(event) =>
                        handleToggle(option.value, event.currentTarget.checked)
                      }
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      </Field>

      {invalidError && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-danger" role="alert">
            Choose a supported value to replace it, or reset to default.
          </p>
          <Button
            size="sm"
            icon={RotateCcw}
            disabled={isSaving}
            onClick={() => void saveSelection([])}
          >
            Reset to default
          </Button>
        </div>
      )}

      {saveError && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-danger" role="alert">
            {saveError}
          </p>
          <Button
            size="sm"
            icon={RotateCcw}
            disabled={isSaving}
            onClick={() => void saveSelection(selected)}
          >
            Retry save
          </Button>
        </div>
      )}

      <p className="text-xs text-fg-muted">
        Leave all values unchecked for OpenRouter&apos;s default routing. The
        model catalog is not filtered, so a model can fail at runtime when no
        matching endpoint is available. Quantization restrictions may reduce
        availability and can affect response quality. Image generation uses a
        separate OpenRouter integration and is not affected.
      </p>
    </div>
  );
}

export default function ModelSettingsSection({
  config,
  selectedEmbeddingModelProvider,
  selectedEmbeddingModel,
  savingStates,
  setSelectedEmbeddingModelProvider,
  setSelectedEmbeddingModel,
  setConfig,
  saveConfig,
}: {
  config: SettingsType;
  selectedEmbeddingModelProvider: string | null;
  selectedEmbeddingModel: string | null;
  savingStates: Record<string, boolean>;
  setSelectedEmbeddingModelProvider: (val: string | null) => void;
  setSelectedEmbeddingModel: (val: string | null) => void;
  setConfig: React.Dispatch<React.SetStateAction<SettingsType | null>>;
  saveConfig: (
    key: string,
    value: string | string[] | number | boolean,
  ) => void;
}) {
  const { refresh, refreshing } = useRefreshModels();
  const [customOpenaiModelName, setCustomOpenaiModelName] =
    useLocalStorageString('customOpenaiModelName', '');
  const [customOpenaiApiUrl, setCustomOpenaiApiUrl] = useLocalStorageString(
    'customOpenaiApiUrl',
    '',
  );

  return (
    <SettingsSection
      title="Model Settings"
      headerAction={
        <Button
          size="sm"
          icon={RefreshCw}
          loading={refreshing}
          onClick={() => refresh({ reload: true })}
          title="Refresh models from providers"
        >
          {refreshing ? 'Refreshing…' : 'Refresh models'}
        </Button>
      }
    >
      <p className="text-xs text-fg-muted">
        Configure the embedding provider and model, Custom OpenAI connection
        details, and OpenRouter endpoint quantization preferences. Refresh
        provider model catalogs here.
      </p>

      {config.chatModelProviders?.openrouter?.length > 0 && (
        <OpenRouterQuantizationSettings />
      )}

      {/* Custom OpenAI credentials (provider configuration) */}
      <div className="flex flex-col space-y-4 pt-4 border-t border-surface-2">
        <p className="text-sm font-medium">Custom OpenAI</p>
        <Field label="Model Name">
          <InputComponent
            type="text"
            placeholder="Model name"
            value={customOpenaiModelName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setCustomOpenaiModelName(e.target.value)
            }
            onSave={() => refresh({ reload: true })}
          />
        </Field>
        <Field label="Custom OpenAI API Key">
          <InputComponent
            type="password"
            placeholder="Custom OpenAI API Key"
            value={config.customOpenaiApiKey}
            isSaving={savingStates['customOpenaiApiKey']}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setConfig((prev) => ({
                ...prev!,
                customOpenaiApiKey: e.target.value,
              }));
            }}
            onSave={(value) => saveConfig('customOpenaiApiKey', value)}
          />
        </Field>
        <Field label="Custom OpenAI Base URL">
          <InputComponent
            type="text"
            placeholder="Custom OpenAI Base URL"
            value={customOpenaiApiUrl}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setCustomOpenaiApiUrl(e.target.value)
            }
            onSave={() => refresh({ reload: true })}
          />
        </Field>
      </div>

      {config.embeddingModelProviders && (
        <div className="flex flex-col space-y-4 mt-4 pt-4 border-t border-surface-2">
          <Field label="Embedding Model Provider">
            <Select
              value={selectedEmbeddingModelProvider ?? undefined}
              onChange={(e) => {
                const value = e.target.value;
                setSelectedEmbeddingModelProvider(value);
                saveConfig('embeddingModelProvider', value);
                const firstModel =
                  config.embeddingModelProviders[value]?.[0]?.name;
                if (firstModel) {
                  setSelectedEmbeddingModel(firstModel);
                  saveConfig('embeddingModel', firstModel);
                }
              }}
              options={Object.keys(config.embeddingModelProviders).map(
                (provider) => ({
                  value: provider,
                  label:
                    (
                      PROVIDER_METADATA as Record<
                        string,
                        { displayName?: string }
                      >
                    )[provider]?.displayName ||
                    provider.charAt(0).toUpperCase() + provider.slice(1),
                }),
              )}
            />
          </Field>

          {selectedEmbeddingModelProvider && (
            <Field label="Embedding Model">
              <Select
                value={selectedEmbeddingModel ?? undefined}
                onChange={(e) => {
                  const value = e.target.value;
                  setSelectedEmbeddingModel(value);
                  saveConfig('embeddingModel', value);
                }}
                options={(() => {
                  const embeddingModelProvider =
                    config.embeddingModelProviders[
                      selectedEmbeddingModelProvider
                    ];
                  return embeddingModelProvider
                    ? embeddingModelProvider.length > 0
                      ? embeddingModelProvider.map((model) => ({
                          value: model.name,
                          label: model.displayName,
                        }))
                      : [
                          {
                            value: '',
                            label: 'No models available',
                            disabled: true,
                          },
                        ]
                    : [
                        {
                          value: '',
                          label: 'Invalid provider, please check backend logs',
                          disabled: true,
                        },
                      ];
                })()}
              />
            </Field>
          )}
        </div>
      )}
    </SettingsSection>
  );
}
