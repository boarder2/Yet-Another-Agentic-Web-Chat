'use client';

import { cn } from '@/lib/utils';
import { Switch } from '@headlessui/react';
import { PROVIDER_METADATA } from '@/lib/providers';
import SettingsSection from '../components/SettingsSection';
import Select from '../components/Select';
import InputComponent from '../components/InputComponent';
import { SettingsType } from '../types';

const predefinedContextSizes = [
  1024, 2048, 3072, 4096, 8192, 16384, 32768, 65536, 131072,
];

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
  return (
    <SettingsSection title="Model Settings">
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
                {selectedChatModelProvider === 'ollama' && (
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm">Chat Context Window Size</p>
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
                            ollamaContextWindow: numValue,
                          }));
                          saveConfig('ollamaContextWindow', numValue);
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
                          isSaving={savingStates['ollamaContextWindow']}
                          onChange={(e) => {
                            const value =
                              parseInt(e.target.value) || contextWindowSize;
                            setContextWindowSize(value);
                          }}
                          onSave={(value) => {
                            const numValue = Math.max(
                              512,
                              parseInt(value) || 2048,
                            );
                            setContextWindowSize(numValue);
                            setConfig((prev) => ({
                              ...prev!,
                              ollamaContextWindow: numValue,
                            }));
                            saveConfig('ollamaContextWindow', numValue);
                          }}
                        />
                      </div>
                    )}
                    <p className="text-xs mt-0.5">
                      {isCustomContextWindow
                        ? 'Adjust the context window size for Ollama models (minimum 512 tokens)'
                        : 'Adjust the context window size for Ollama models'}
                    </p>
                  </div>
                )}
                <p className="text-xs mt-0.5">
                  Used for chat responses and agentic tasks.
                </p>
              </div>
            )}
        </div>
      )}

      {/* System Model selection (internal tasks) */}
      {config.chatModelProviders && (
        <div className="flex flex-col space-y-4 mt-6">
          <div className="flex items-center justify-between p-3 bg-surface rounded-lg border border-surface-2">
            <div>
              <p className="text-sm font-medium">Link System to Chat</p>
              <p className="text-xs mt-0.5 text-fg/60">
                When enabled, the System model mirrors the Chat model and is
                disabled below.
              </p>
            </div>
            <Switch
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
              className={cn(
                linkSystemToChat ? 'bg-accent' : 'bg-surface-2',
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none',
              )}
            >
              <span
                className={cn(
                  linkSystemToChat ? 'translate-x-6' : 'translate-x-1',
                  'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                )}
              />
            </Switch>
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
