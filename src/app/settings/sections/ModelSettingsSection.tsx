'use client';

import { PROVIDER_METADATA } from '@/lib/providers/metadata';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import SettingsSection from '../components/SettingsSection';
import Select from '../components/Select';
import InputComponent from '../components/InputComponent';
import { SettingsType } from '../types';
import { useLocalStorageString } from '@/lib/hooks/useLocalStorage';
import { useRefreshModels } from '@/lib/hooks/api/useModels';

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
        <button
          type="button"
          className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-control border border-surface-2 hover:bg-surface-2 transition disabled:opacity-60"
          onClick={() => refresh({ reload: true })}
          disabled={refreshing}
          title="Refresh models from providers"
        >
          {refreshing ? (
            <LoaderCircle size={12} className="animate-spin text-accent" />
          ) : (
            <RefreshCw size={12} />
          )}
          {refreshing ? 'Refreshing…' : 'Refresh models'}
        </button>
      }
    >
      <p className="text-xs text-fg/60">
        The chat and system models are chosen from the chat input&apos;s model
        picker. These settings configure the embedding model and custom OpenAI
        credentials. The memory-processing model lives in the Memory section.
      </p>

      {/* Custom OpenAI credentials (provider configuration) */}
      <div className="flex flex-col space-y-4 pt-4 border-t border-surface-2">
        <p className="text-sm font-medium">Custom OpenAI</p>
        <div className="flex flex-col space-y-1">
          <p className="text-sm">Model Name</p>
          <InputComponent
            type="text"
            placeholder="Model name"
            value={customOpenaiModelName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setCustomOpenaiModelName(e.target.value)
            }
            onSave={() => refresh({ reload: true })}
          />
        </div>
        <div className="flex flex-col space-y-1">
          <p className="text-sm">Custom OpenAI API Key</p>
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
        </div>
        <div className="flex flex-col space-y-1">
          <p className="text-sm">Custom OpenAI Base URL</p>
          <InputComponent
            type="text"
            placeholder="Custom OpenAI Base URL"
            value={customOpenaiApiUrl}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setCustomOpenaiApiUrl(e.target.value)
            }
            onSave={() => refresh({ reload: true })}
          />
        </div>
      </div>

      {config.embeddingModelProviders && (
        <div className="flex flex-col space-y-4 mt-4 pt-4 border-t border-surface-2">
          <div className="flex flex-col space-y-1">
            <p className="text-sm">Embedding Model Provider</p>
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
          </div>

          {selectedEmbeddingModelProvider && (
            <div className="flex flex-col space-y-1">
              <p className="text-sm">Embedding Model</p>
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
            </div>
          )}
        </div>
      )}
    </SettingsSection>
  );
}
