import { useEffect, useMemo, useState } from 'react';
import { Cpu, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  CloseButton,
  Popover,
  PopoverButton,
  PopoverPanel,
  Transition,
} from '@headlessui/react';
import { Fragment } from 'react';
import { useModels, useRefreshModels } from '@/lib/hooks/api/useModels';
import { useSettingsModal } from '@/components/settings/SettingsModalProvider';
import ComposerActionButton from '@/components/MessageInputActions/ComposerActionButton';
import ComposerPopover from '@/components/MessageInputActions/ComposerPopover';
import { IconButton } from '@/components/ui/IconButton';

interface ModelOption {
  provider: string;
  model: string;
  displayName: string;
}

interface ProviderModelMap {
  [provider: string]: {
    displayName: string;
    models: ModelOption[];
  };
}

const OPENAI_COMPATIBLE_PROVIDER_KEY_PREFIX = 'openai-compatible:';

/**
 * Grouped-by-provider model picker for a single role (chat or system). This is
 * the shared primitive behind the unified `ModelPicker` and every surface that
 * needs to choose one model. It is fully controlled via `selectedModel` /
 * `setSelectedModel` and owns no persistence.
 */
const ModelField = ({
  selectedModel,
  setSelectedModel,
  truncateModelName = true,
  showModelName = true,
  role = 'chat',
  panelPosition = 'above',
}: {
  selectedModel: { provider: string; model: string } | null;
  setSelectedModel: (model: { provider: string; model: string }) => void;
  truncateModelName?: boolean;
  showModelName?: boolean;
  role?: 'chat' | 'system';
  panelPosition?: 'above' | 'below';
}) => {
  const { openSettings } = useSettingsModal();
  const { data: modelsData, isLoading: loading } = useModels();
  const { refresh, refreshing } = useRefreshModels();
  const { providerModels, providersList } = useMemo<{
    providerModels: ProviderModelMap;
    providersList: string[];
  }>(() => {
    if (!modelsData?.chatModelProviders) {
      return { providerModels: {}, providersList: [] };
    }

    const providersData: ProviderModelMap = {};
    Object.entries(modelsData.chatModelProviders).forEach(
      ([provider, models]) => {
        const providerDisplayName =
          modelsData.providerMetadata?.[provider]?.displayName ||
          provider.charAt(0).toUpperCase() + provider.slice(1);
        providersData[provider] = {
          displayName: providerDisplayName,
          models: Object.entries(models).map(([model, modelData]) => ({
            provider,
            model,
            displayName: modelData.displayName || model,
          })),
        };
      },
    );

    Object.keys(providersData).forEach((provider) => {
      if (providersData[provider].models.length === 0) {
        delete providersData[provider];
      }
    });

    const providerKeys = Object.keys(providersData);
    const staticProviders = providerKeys
      .filter(
        (provider) =>
          !provider.startsWith(OPENAI_COMPATIBLE_PROVIDER_KEY_PREFIX),
      )
      .sort();
    const compatibleProviders = providerKeys
      .filter((provider) =>
        provider.startsWith(OPENAI_COMPATIBLE_PROVIDER_KEY_PREFIX),
      )
      .sort((a, b) =>
        providersData[a].displayName.localeCompare(
          providersData[b].displayName,
        ),
      );

    return {
      providerModels: providersData,
      providersList: [...staticProviders, ...compatibleProviders],
    };
  }, [modelsData]);
  const [expandedProviders, setExpandedProviders] = useState<
    Record<string, boolean>
  >({});

  useEffect(() => {
    if (!selectedModel?.provider) return;
    // The selected provider is expanded when its controlled value changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpandedProviders((prev) => ({
      ...prev,
      [selectedModel.provider]: true,
    }));
  }, [selectedModel?.provider]);

  async function handleRefresh() {
    await refresh({ silent: true });
  }

  const toggleProviderExpanded = (provider: string) => {
    setExpandedProviders((prev) => ({
      ...prev,
      [provider]: !prev[provider],
    }));
  };

  const handleSelectModel = (option: ModelOption) => {
    setSelectedModel({ provider: option.provider, model: option.model });
  };

  const selectedProvider = selectedModel
    ? providerModels[selectedModel.provider]
    : undefined;
  const selectedModelOption = selectedProvider?.models.find(
    (option) => option.model === selectedModel?.model,
  );
  const currentModelDisplay = selectedModelOption?.displayName ?? '';
  const currentProviderDisplay =
    selectedProvider?.displayName ??
    (selectedModel
      ? (modelsData?.providerMetadata?.[selectedModel.provider]?.displayName ??
        selectedModel.provider)
      : '');
  const selectedModelUnavailable =
    !loading && !!selectedModel && !selectedModelOption;

  const getDisplayText = () => {
    if (loading) return 'Loading...';
    if (!selectedModel) return 'Select Model';
    if (selectedModelUnavailable) return 'Unavailable';
    return `${currentModelDisplay} (${currentProviderDisplay})`;
  };

  return (
    <Popover className="relative">
      {({ open }) => (
        <>
          <div className="relative">
            <PopoverButton
              as={ComposerActionButton}
              type="button"
              geometry="content"
              configured={Boolean(selectedModel)}
              open={open}
            >
              <Cpu size={18} />
              {showModelName && (
                <span
                  className={cn(
                    'text-xs font-medium overflow-hidden text-ellipsis whitespace-nowrap',
                    { 'max-w-44': truncateModelName },
                  )}
                >
                  {getDisplayText()}
                </span>
              )}
              <ChevronDown
                size={16}
                className={cn(
                  'transition-transform duration-150',
                  open ? 'rotate-180' : 'rotate-0',
                )}
              />
            </PopoverButton>
          </div>

          <Transition
            as={Fragment}
            enter="transition-[opacity,transform] ease-out duration-200"
            enterFrom="opacity-0 translate-y-1"
            enterTo="opacity-100 translate-y-0"
            leave="transition-[opacity,transform] ease-in duration-150"
            leaveFrom="opacity-100 translate-y-0"
            leaveTo="opacity-0 translate-y-1"
          >
            <PopoverPanel
              anchor={{
                to: panelPosition === 'below' ? 'bottom end' : 'top end',
                gap: panelPosition === 'below' ? '4px' : '8px',
                padding: '16px',
              }}
              className="z-50 w-72 overflow-hidden"
            >
              <ComposerPopover
                title={
                  role === 'system'
                    ? 'Select System Model'
                    : 'Select Chat Model'
                }
                description={
                  role === 'system'
                    ? 'Choose the model used for tools and internal summarization'
                    : 'Choose the model used for agent decisions and final responses'
                }
                action={
                  <IconButton
                    icon={RefreshCw}
                    label="Refresh models"
                    loading={refreshing}
                    disabled={loading}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRefresh();
                    }}
                  />
                }
              >
                <div className="max-h-72 overflow-y-auto">
                  {selectedModelUnavailable && selectedModel && (
                    <div className="border-b border-surface-2 bg-warning-soft px-4 py-3 text-xs text-warning">
                      <p className="font-medium">Unavailable</p>
                      <p className="mt-1 break-all">
                        {selectedModel.model} · {currentProviderDisplay}
                      </p>
                      <CloseButton
                        type="button"
                        onClick={() =>
                          openSettings(
                            selectedModel.provider.startsWith(
                              OPENAI_COMPATIBLE_PROVIDER_KEY_PREFIX,
                            )
                              ? 'openai-compatible-providers'
                              : 'model-settings',
                          )
                        }
                        className="mt-2 border border-transparent text-accent hover:underline focus-border-neutral"
                      >
                        Open settings
                      </CloseButton>
                    </div>
                  )}
                  {loading ? (
                    <div className="px-4 py-3 text-sm text-fg-muted">
                      Loading available models...
                    </div>
                  ) : providersList.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-fg-muted">
                      No models available.{' '}
                      <CloseButton
                        type="button"
                        onClick={() => openSettings('api-keys')}
                        className="border border-transparent text-accent hover:underline focus-border-neutral"
                      >
                        Add an API key
                      </CloseButton>{' '}
                      to get started.
                    </div>
                  ) : (
                    <div className="py-1">
                      {providersList.map((providerKey) => {
                        const provider = providerModels[providerKey];
                        const isExpanded = expandedProviders[providerKey];

                        return (
                          <div
                            key={providerKey}
                            className="border-t border-surface-2 first:border-t-0"
                          >
                            <button
                              type="button"
                              className={cn(
                                'w-full flex items-center justify-between border border-transparent px-4 py-2 text-sm text-left focus-border-neutral',
                                'hover:bg-surface-2',
                                selectedModel?.provider === providerKey
                                  ? 'bg-surface-2'
                                  : '',
                              )}
                              onClick={() =>
                                toggleProviderExpanded(providerKey)
                              }
                            >
                              <div className="font-medium flex items-center">
                                <Cpu size={14} className="mr-2 text-fg-muted" />
                                {provider.displayName}
                                {selectedModel?.provider === providerKey && (
                                  <span className="ml-2 text-xs text-accent">
                                    (active)
                                  </span>
                                )}
                              </div>
                              <ChevronRight
                                size={14}
                                className={cn(
                                  'transition-transform duration-150',
                                  isExpanded ? 'rotate-90' : '',
                                )}
                              />
                            </button>

                            {isExpanded && (
                              <div className="pl-6">
                                {provider.models.map((modelOption) => (
                                  <PopoverButton
                                    key={`${modelOption.provider}-${modelOption.model}`}
                                    className={cn(
                                      'w-full border border-transparent text-left px-4 py-2 text-sm flex items-center focus-border-neutral',
                                      selectedModel?.provider ===
                                        modelOption.provider &&
                                        selectedModel?.model ===
                                          modelOption.model
                                        ? 'bg-surface-2 text-fg'
                                        : 'text-fg-muted hover:bg-surface-2',
                                    )}
                                    onClick={() =>
                                      handleSelectModel(modelOption)
                                    }
                                  >
                                    <div className="flex flex-col flex-1">
                                      <span className="font-medium">
                                        {modelOption.displayName}
                                      </span>
                                    </div>
                                    {selectedModel?.provider ===
                                      modelOption.provider &&
                                      selectedModel?.model ===
                                        modelOption.model && (
                                        <div className="ml-auto bg-accent text-accent-fg text-xs px-1.5 py-0.5 rounded-control">
                                          Active
                                        </div>
                                      )}
                                  </PopoverButton>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </ComposerPopover>
            </PopoverPanel>
          </Transition>
        </>
      )}
    </Popover>
  );
};

export default ModelField;
