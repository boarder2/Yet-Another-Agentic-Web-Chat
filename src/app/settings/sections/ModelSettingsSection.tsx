'use client';

import AppSwitch from '@/components/ui/AppSwitch';
import { PROVIDER_METADATA } from '@/lib/providers';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import SettingsSection from '../components/SettingsSection';
import Select from '../components/Select';
import InputComponent from '../components/InputComponent';
import { SettingsType } from '../types';

const predefinedContextSizes = [32768, 65536, 131072, 262144];

export default function ModelSettingsSection({
  config,
  selectedChatModelProvider,
  selectedChatModel,
  selectedSystemModelProvider,
  selectedSystemModel,
  selectedEmbeddingModelProvider,
  selectedEmbeddingModel,
  linkSystemToChat,
  contextWindowSize,
  isCustomContextWindow,
  savingStates,
  setSelectedChatModelProvider,
  setSelectedChatModel,
  setSelectedSystemModelProvider,
  setSelectedSystemModel,
  setSelectedEmbeddingModelProvider,
  setSelectedEmbeddingModel,
  setLinkSystemToChat,
  setContextWindowSize,
  setIsCustomContextWindow,
  setConfig,
  saveConfig,
}: {
  config: SettingsType;
  selectedChatModelProvider: string | null;
  selectedChatModel: string | null;
  selectedSystemModelProvider: string | null;
  selectedSystemModel: string | null;
  selectedEmbeddingModelProvider: string | null;
  selectedEmbeddingModel: string | null;
  linkSystemToChat: boolean;
  contextWindowSize: number;
  isCustomContextWindow: boolean;
  savingStates: Record<string, boolean>;
  setSelectedChatModelProvider: (val: string | null) => void;
  setSelectedChatModel: (val: string | null) => void;
  setSelectedSystemModelProvider: (val: string | null) => void;
  setSelectedSystemModel: (val: string | null) => void;
  setSelectedEmbeddingModelProvider: (val: string | null) => void;
  setSelectedEmbeddingModel: (val: string | null) => void;
  setLinkSystemToChat: (val: boolean) => void;
  setContextWindowSize: (val: number) => void;
  setIsCustomContextWindow: (val: boolean) => void;
  setConfig: React.Dispatch<React.SetStateAction<SettingsType | null>>;
  saveConfig: (
    key: string,
    value: string | string[] | number | boolean,
  ) => void;
}) {
  const [refreshing, setRefreshing] = useState(false);

  const handleRefreshModels = async () => {
    try {
      setRefreshing(true);
      const res = await fetch('/api/models?refresh=true&include_hidden=true');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Model list refreshed. Reloading…');
      setTimeout(() => window.location.reload(), 500);
    } catch (err) {
      console.error('Failed to refresh models:', err);
      toast.error('Failed to refresh models');
    } finally {
      setRefreshing(false);
    }
  };

  const chatModelLabel = selectedChatModel || 'Chat';

  return (
    <SettingsSection
      title="Model Settings"
      headerAction={
        <button
          type="button"
          className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-control border border-surface-2 hover:bg-surface-2 transition disabled:opacity-60"
          onClick={handleRefreshModels}
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
      {config.chatModelProviders && (
        <div className="flex flex-col space-y-4">
          <div className="flex flex-col space-y-1">
            <p className="text-sm">Chat Model Provider</p>
            <Select
              value={selectedChatModelProvider ?? undefined}
              onChange={(e) => {
                const value = e.target.value;
                setSelectedChatModelProvider(value);
                saveConfig('chatModelProvider', value);
                const firstModel = config.chatModelProviders[value]?.[0]?.name;
                if (firstModel) {
                  setSelectedChatModel(firstModel);
                  saveConfig('chatModel', firstModel);
                  if (linkSystemToChat) {
                    setSelectedSystemModelProvider(value);
                    setSelectedSystemModel(firstModel);
                    saveConfig('systemModelProvider', value);
                    saveConfig('systemModel', firstModel);
                  }
                }
              }}
              options={Object.keys(config.chatModelProviders).map(
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

          {selectedChatModelProvider &&
            selectedChatModelProvider != 'custom_openai' && (
              <div className="flex flex-col space-y-1">
                <p className="text-sm">Chat Model</p>
                <Select
                  value={selectedChatModel ?? undefined}
                  onChange={(e) => {
                    const value = e.target.value;
                    setSelectedChatModel(value);
                    saveConfig('chatModel', value);
                    if (linkSystemToChat && selectedChatModelProvider) {
                      setSelectedSystemModelProvider(selectedChatModelProvider);
                      setSelectedSystemModel(value);
                      saveConfig(
                        'systemModelProvider',
                        selectedChatModelProvider,
                      );
                      saveConfig('systemModel', value);
                    }
                  }}
                  options={(() => {
                    const chatModelProvider =
                      config.chatModelProviders[selectedChatModelProvider];
                    return chatModelProvider
                      ? chatModelProvider.length > 0
                        ? chatModelProvider.map((model) => ({
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
                            label:
                              'Invalid provider, please check backend logs',
                            disabled: true,
                          },
                        ];
                  })()}
                />
                <p className="text-xs mt-0.5">
                  Used for chat responses and agentic tasks.
                </p>
              </div>
            )}

          {/* Available Context Window */}
          <div className="flex flex-col space-y-1 pt-2 border-t border-surface-2">
            <p className="text-sm font-medium">Available Context Window</p>
            <div className="flex flex-col space-y-1">
              <p className="text-xs text-fg/60">{chatModelLabel}</p>
              <Select
                value={
                  isCustomContextWindow
                    ? 'custom'
                    : contextWindowSize.toString()
                }
                onChange={(e) => {
                  const value = e.target.value;
                  if (value === 'custom') {
                    setIsCustomContextWindow(true);
                  } else {
                    setIsCustomContextWindow(false);
                    const numValue = parseInt(value);
                    setContextWindowSize(numValue);
                    setConfig((prev) => ({
                      ...prev!,
                      contextWindowSize: numValue,
                    }));
                    saveConfig('contextWindowSize', numValue);
                  }
                }}
                options={[
                  ...predefinedContextSizes.map((size) => ({
                    value: size.toString(),
                    label: `${size.toLocaleString()} tokens`,
                  })),
                  { value: 'custom', label: 'Custom...' },
                ]}
              />
              {isCustomContextWindow && (
                <div className="mt-2">
                  <InputComponent
                    type="number"
                    min={512}
                    value={contextWindowSize}
                    placeholder="Custom context window size (minimum 512)"
                    isSaving={savingStates['contextWindowSize']}
                    onChange={(e) => {
                      const value =
                        parseInt(e.target.value) || contextWindowSize;
                      setContextWindowSize(value);
                    }}
                    onSave={(value) => {
                      const numValue = Math.max(512, parseInt(value) || 32768);
                      setContextWindowSize(numValue);
                      setConfig((prev) => ({
                        ...prev!,
                        contextWindowSize: numValue,
                      }));
                      saveConfig('contextWindowSize', numValue);
                    }}
                  />
                </div>
              )}
            </div>
            <p className="text-xs mt-1 text-fg/40">
              The maximum context size available to both your chat model and
              system model. Both models must support this context size. For
              non-Ollama providers, this acts as a compaction threshold.
            </p>
          </div>
        </div>
      )}

      {/* System Model selection (internal tasks) */}
      {config.chatModelProviders && (
        <div className="flex flex-col space-y-4 mt-6">
          <div className="flex items-center justify-between p-3 bg-surface rounded-surface border border-surface-2">
            <div>
              <p className="text-sm font-medium">Link System to Chat</p>
              <p className="text-xs mt-0.5 text-fg/60">
                When enabled, the System model mirrors the Chat model and is
                disabled below.
              </p>
            </div>
            <AppSwitch
              checked={linkSystemToChat}
              onChange={(checked) => {
                setLinkSystemToChat(checked);
                saveConfig('linkSystemToChat', checked);
                if (checked && selectedChatModelProvider && selectedChatModel) {
                  setSelectedSystemModelProvider(selectedChatModelProvider);
                  setSelectedSystemModel(selectedChatModel);
                  saveConfig('systemModelProvider', selectedChatModelProvider);
                  saveConfig('systemModel', selectedChatModel);
                }
              }}
            />
          </div>
          <div className="flex flex-col space-y-1">
            <p className="text-sm">System Model Provider</p>
            <Select
              value={selectedSystemModelProvider ?? undefined}
              onChange={(e) => {
                const value = e.target.value;
                setSelectedSystemModelProvider(value);
                saveConfig('systemModelProvider', value);
                const firstModel = config.chatModelProviders[value]?.[0]?.name;
                if (firstModel) {
                  setSelectedSystemModel(firstModel);
                  saveConfig('systemModel', firstModel);
                }
              }}
              disabled={linkSystemToChat}
              options={Object.keys(config.chatModelProviders).map(
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

          {selectedSystemModelProvider &&
            selectedSystemModelProvider != 'custom_openai' && (
              <div className="flex flex-col space-y-1">
                <p className="text-sm">System Model</p>
                <Select
                  value={selectedSystemModel ?? undefined}
                  onChange={(e) => {
                    const value = e.target.value;
                    setSelectedSystemModel(value);
                    saveConfig('systemModel', value);
                  }}
                  disabled={linkSystemToChat}
                  options={(() => {
                    const providerModels =
                      config.chatModelProviders[selectedSystemModelProvider];
                    return providerModels
                      ? providerModels.length > 0
                        ? providerModels.map((model) => ({
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
                            label:
                              'Invalid provider, please check backend logs',
                            disabled: true,
                          },
                        ];
                  })()}
                />
                <p className="text-xs mt-0.5">
                  Used for internal tasks like web summarization and query
                  generation. You may want to select a faster/cheaper/instruct
                  model rather than your main chat model.
                </p>
              </div>
            )}
        </div>
      )}

      {selectedChatModelProvider &&
        selectedChatModelProvider === 'custom_openai' && (
          <div className="flex flex-col space-y-4">
            <div className="flex flex-col space-y-1">
              <p className="text-sm">Model Name</p>
              <InputComponent
                type="text"
                placeholder="Model name"
                value={config.customOpenaiModelName}
                isSaving={savingStates['customOpenaiModelName']}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  setConfig((prev) => ({
                    ...prev!,
                    customOpenaiModelName: e.target.value,
                  }));
                }}
                onSave={(value) => saveConfig('customOpenaiModelName', value)}
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
                value={config.customOpenaiApiUrl}
                isSaving={savingStates['customOpenaiApiUrl']}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  setConfig((prev) => ({
                    ...prev!,
                    customOpenaiApiUrl: e.target.value,
                  }));
                }}
                onSave={(value) => saveConfig('customOpenaiApiUrl', value)}
              />
            </div>
          </div>
        )}

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
