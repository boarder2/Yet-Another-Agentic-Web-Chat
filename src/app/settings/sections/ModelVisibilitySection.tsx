'use client';

import { cn } from '@/lib/utils';
import { Switch } from '@headlessui/react';
import { ChevronDown, ChevronRight, Eye, EyeOff } from 'lucide-react';
import { PROVIDER_METADATA } from '@/lib/providers';
import SettingsSection from '../components/SettingsSection';

export default function ModelVisibilitySection({
  allModels,
  hiddenModels,
  expandedProviders,
  onToggleModel,
  onToggleProvider,
  onToggleExpand,
}: {
  allModels: {
    chat: Record<string, Record<string, { displayName: string }>>;
    embedding: Record<string, Record<string, { displayName: string }>>;
  };
  hiddenModels: string[];
  expandedProviders: Set<string>;
  onToggleModel: (modelKey: string, isVisible: boolean) => void;
  onToggleProvider: (
    providerModels: Record<string, unknown>,
    showAll: boolean,
  ) => void;
  onToggleExpand: (providerId: string) => void;
}) {
  return (
    <SettingsSection title="Model Visibility">
      <p className="text-xs text-fg/60">
        Hide models from appearing in selection lists. Useful for disabling
        models that incur high costs or aren&apos;t compatible with this
        application.
      </p>
      <div className="flex flex-col space-y-3">
        {(() => {
          const allProviders: Record<
            string,
            Record<string, { displayName: string }>
          > = {};

          Object.entries(allModels.chat).forEach(([provider, models]) => {
            if (!allProviders[provider]) {
              allProviders[provider] = {};
            }
            Object.entries(models).forEach(([modelKey, model]) => {
              allProviders[provider][modelKey] = model;
            });
          });

          Object.entries(allModels.embedding).forEach(([provider, models]) => {
            if (!allProviders[provider]) {
              allProviders[provider] = {};
            }
            Object.entries(models).forEach(([modelKey, model]) => {
              allProviders[provider][modelKey] = model;
            });
          });

          return Object.keys(allProviders).length > 0 ? (
            Object.entries(allProviders).map(([provider, models]) => {
              const providerId = `provider-${provider}`;
              const isExpanded = expandedProviders.has(providerId);
              const modelEntries = Object.entries(models);
              const hiddenCount = modelEntries.filter(([modelKey]) =>
                hiddenModels.includes(modelKey),
              ).length;
              const totalCount = modelEntries.length;

              return (
                <div
                  key={providerId}
                  className="border border-surface-2 rounded-lg overflow-hidden"
                >
                  <button
                    onClick={() => onToggleExpand(providerId)}
                    className="w-full p-3 bg-surface hover:bg-surface-2 transition-colors flex items-center justify-between"
                  >
                    <div className="flex items-center space-x-3">
                      {isExpanded ? (
                        <ChevronDown size={16} />
                      ) : (
                        <ChevronRight size={16} />
                      )}
                      <h4 className="text-sm font-medium">
                        {(
                          PROVIDER_METADATA as Record<
                            string,
                            { displayName?: string }
                          >
                        )[provider]?.displayName ||
                          provider.charAt(0).toUpperCase() + provider.slice(1)}
                      </h4>
                    </div>
                    <div className="flex items-center space-x-2 text-xs">
                      <span>{totalCount - hiddenCount} visible</span>
                      {hiddenCount > 0 && (
                        <span className="px-2 py-1 bg-red-100 text-red-700 rounded">
                          {hiddenCount} hidden
                        </span>
                      )}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="p-3 bg-surface-2 border-t border-surface-2">
                      <div className="flex justify-end mb-3 space-x-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleProvider(models, true);
                          }}
                          className="px-3 py-1.5 text-xs rounded-md bg-green-100 hover:bg-green-200 text-green-700 flex items-center gap-1.5 transition-colors"
                          title="Show all models in this provider"
                        >
                          <Eye size={14} />
                          Show All
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleProvider(models, false);
                          }}
                          className="px-3 py-1.5 text-xs rounded-md bg-red-100 hover:bg-red-200 text-red-700 flex items-center gap-1.5 transition-colors"
                          title="Hide all models in this provider"
                        >
                          <EyeOff size={14} />
                          Hide All
                        </button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {modelEntries.map(([modelKey, model]) => (
                          <div
                            key={`${provider}-${modelKey}`}
                            className="flex items-center justify-between p-2 bg-surface rounded-md"
                          >
                            <span className="text-sm">
                              {model.displayName || modelKey}
                            </span>
                            <Switch
                              checked={!hiddenModels.includes(modelKey)}
                              onChange={(checked) => {
                                onToggleModel(modelKey, checked);
                              }}
                              className={cn(
                                !hiddenModels.includes(modelKey)
                                  ? 'bg-accent'
                                  : 'bg-surface-2',
                                'relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none',
                              )}
                            >
                              <span
                                className={cn(
                                  !hiddenModels.includes(modelKey)
                                    ? 'translate-x-5'
                                    : 'translate-x-1',
                                  'inline-block h-3 w-3 transform rounded-full bg-white transition-transform',
                                )}
                              />
                            </Switch>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <p className="text-sm italic">No models available</p>
          );
        })()}
      </div>
    </SettingsSection>
  );
}
