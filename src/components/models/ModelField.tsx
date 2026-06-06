import { useEffect, useState } from 'react';
import {
  Cpu,
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverButton,
  PopoverPanel,
  Transition,
} from '@headlessui/react';
import { Fragment } from 'react';
import { useModels } from '@/lib/hooks/api/useModels';
import { useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/api/keys';

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
  const qc = useQueryClient();
  const { data: modelsData, isLoading: loading } = useModels();
  const [providerModels, setProviderModels] = useState<ProviderModelMap>({});
  const [providersList, setProvidersList] = useState<string[]>([]);
  const [selectedModelDisplay, setSelectedModelDisplay] = useState<string>('');
  const [selectedProviderDisplay, setSelectedProviderDisplay] =
    useState<string>('');
  const [expandedProviders, setExpandedProviders] = useState<
    Record<string, boolean>
  >({});
  const [refreshing, setRefreshing] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!modelsData?.chatModelProviders) return;
    const providersData: ProviderModelMap = {};

    Object.entries(modelsData.chatModelProviders).forEach(
      ([provider, models]) => {
        const providerDisplayName =
          provider.charAt(0).toUpperCase() + provider.slice(1);
        providersData[provider] = {
          displayName: providerDisplayName,
          models: [],
        };

        Object.entries(models).forEach(([modelKey, modelData]) => {
          providersData[provider].models.push({
            provider,
            model: modelKey,
            displayName: modelData.displayName || modelKey,
          });
        });
      },
    );

    Object.keys(providersData).forEach((provider) => {
      if (providersData[provider].models.length === 0)
        delete providersData[provider];
    });

    const sortedProviders = Object.keys(providersData).sort();
    setProvidersList(sortedProviders);
    setProviderModels(providersData);
  }, [modelsData]);
  useEffect(() => {
    if (
      !selectedModel?.provider ||
      !selectedModel?.model ||
      !providerModels ||
      Object.keys(providerModels).length === 0
    )
      return;

    const provider = providerModels[selectedModel.provider];
    if (!provider) return;

    const currentModel = provider.models.find(
      (option) => option.model === selectedModel.model,
    );

    if (currentModel) {
      setExpandedProviders((prev) => ({
        ...prev,
        [provider.displayName]: !prev[provider.displayName],
      }));
      setSelectedModelDisplay(currentModel.displayName);
      setSelectedProviderDisplay(provider.displayName);
    }
  }, [providerModels, selectedModel]);

  useEffect(() => {
    if (!selectedModel?.provider) return;
    setExpandedProviders((prev) => ({
      ...prev,
      [selectedModel.provider]: true,
    }));
  }, [selectedModel?.provider]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await fetch('/api/models?refresh=true');
      await qc.invalidateQueries({ queryKey: qk.models });
    } finally {
      setRefreshing(false);
    }
  }

  const toggleProviderExpanded = (provider: string) => {
    setExpandedProviders((prev) => ({
      ...prev,
      [provider]: !prev[provider],
    }));
  };

  const handleSelectModel = (option: ModelOption) => {
    setSelectedModel({ provider: option.provider, model: option.model });
    setSelectedModelDisplay(option.displayName);
    setSelectedProviderDisplay(
      providerModels[option.provider]?.displayName || option.provider,
    );
  };

  const getDisplayText = () => {
    if (loading) return 'Loading...';
    if (!selectedModel || !selectedModelDisplay) return 'Select Model';
    return `${selectedModelDisplay} (${selectedProviderDisplay})`;
  };

  return (
    <Popover className="relative">
      {({ open }) => (
        <>
          <div className="relative">
            <PopoverButton
              type="button"
              className="p-2 group flex text-fg/50 rounded-floating hover:bg-surface-2 active:scale-95 transition duration-200 hover:text-fg"
            >
              <Cpu size={18} />
              {showModelName && (
                <span
                  className={cn(
                    'ml-2 text-xs font-medium overflow-hidden text-ellipsis whitespace-nowrap',
                    { 'max-w-44': truncateModelName },
                  )}
                >
                  {getDisplayText()}
                </span>
              )}
              <ChevronDown
                size={16}
                className={cn(
                  'transition-transform',
                  open ? 'rotate-180' : 'rotate-0',
                )}
              />
            </PopoverButton>
          </div>

          <Transition
            as={Fragment}
            enter="transition ease-out duration-200"
            enterFrom="opacity-0 translate-y-1"
            enterTo="opacity-100 translate-y-0"
            leave="transition ease-in duration-150"
            leaveFrom="opacity-100 translate-y-0"
            leaveTo="opacity-0 translate-y-1"
          >
            <PopoverPanel
              className={cn(
                'absolute z-10 w-72 transform',
                panelPosition === 'below'
                  ? 'top-full mt-1'
                  : 'bottom-full mb-2',
              )}
            >
              <div className="overflow-hidden rounded-surface shadow-raised bg-surface border border-surface-2 divide-y divide-surface-2">
                <div className="px-4 py-3 flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-fg/90">
                      {role === 'system'
                        ? 'Select System Model'
                        : 'Select Chat Model'}
                    </h3>
                    <p className="text-xs text-fg/60 mt-1">
                      {role === 'system'
                        ? 'Choose the model used for tools and internal summarization'
                        : 'Choose the model used for agent decisions and final responses'}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="p-1.5 rounded-control hover:bg-surface-2 text-fg/60 hover:text-fg transition"
                    title="Refresh models"
                    disabled={refreshing || loading}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRefresh();
                    }}
                  >
                    {refreshing ? (
                      <LoaderCircle
                        size={14}
                        className="animate-spin text-accent"
                      />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                  </button>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {loading ? (
                    <div className="px-4 py-3 text-sm text-fg/70">
                      Loading available models...
                    </div>
                  ) : providersList.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-fg/70">
                      No models available
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
                                'w-full flex items-center justify-between px-4 py-2 text-sm text-left',
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
                                <Cpu size={14} className="mr-2 text-fg/70" />
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
                                  'transition-transform',
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
                                      'w-full text-left px-4 py-2 text-sm flex items-center',
                                      selectedModel?.provider ===
                                        modelOption.provider &&
                                        selectedModel?.model ===
                                          modelOption.model
                                        ? 'bg-surface-2 text-fg'
                                        : 'text-fg/70 hover:bg-surface-2',
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
              </div>
            </PopoverPanel>
          </Transition>
        </>
      )}
    </Popover>
  );
};

export default ModelField;
