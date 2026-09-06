'use client';

import AppSwitch from '@/components/ui/AppSwitch';
import { Button } from '@/components/ui/Button';
import { ChevronDown, ChevronRight, Eye, EyeOff } from 'lucide-react';
import { isHiddenModel, type HiddenModel } from '@/lib/models/hiddenModels';
import SettingsSection from '../components/SettingsSection';
import { ListEmptyState } from '@/components/ui/List';
import Badge from '@/components/ui/Badge';

export default function ModelVisibilitySection({
  allModels,
  hiddenModels,
  expandedProviders,
  onToggleModel,
  onToggleProvider,
  onToggleExpand,
  providerMetadata = {},
}: {
  allModels: {
    chat: Record<string, Record<string, { displayName: string }>>;
    embedding: Record<string, Record<string, { displayName: string }>>;
  };
  providerMetadata?: Record<string, { displayName: string }>;
  hiddenModels: HiddenModel[];
  expandedProviders: Set<string>;
  onToggleModel: (provider: string, model: string, isVisible: boolean) => void;
  onToggleProvider: (
    provider: string,
    providerModels: Record<string, unknown>,
    showAll: boolean,
  ) => void;
  onToggleExpand: (providerId: string) => void;
}) {
  return (
    <SettingsSection title="Model Visibility">
      <p className="text-xs text-fg-muted">
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
                isHiddenModel(hiddenModels, provider, modelKey),
              ).length;
              const totalCount = modelEntries.length;

              return (
                <div
                  key={providerId}
                  className="border border-surface-2 rounded-surface overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => onToggleExpand(providerId)}
                    className="w-full border border-transparent p-3 bg-surface hover:bg-surface-2 transition-colors duration-150 flex items-center justify-between focus-border-neutral"
                  >
                    <div className="flex items-center space-x-3">
                      {isExpanded ? (
                        <ChevronDown size={16} />
                      ) : (
                        <ChevronRight size={16} />
                      )}
                      <h4 className="text-sm font-medium">
                        {providerMetadata[provider]?.displayName ||
                          provider.charAt(0).toUpperCase() + provider.slice(1)}
                      </h4>
                    </div>
                    <div className="flex items-center space-x-2 text-xs">
                      <span>{totalCount - hiddenCount} visible</span>
                      {hiddenCount > 0 && (
                        <Badge tone="danger">{hiddenCount} hidden</Badge>
                      )}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="p-3 bg-surface-2 border-t border-surface-2">
                      <div className="flex justify-end mb-3 space-x-2">
                        <Button
                          variant="successSoft"
                          size="lg"
                          icon={Eye}
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleProvider(provider, models, true);
                          }}
                          title="Show all models in this provider"
                        >
                          Show All
                        </Button>
                        <Button
                          variant="dangerSoft"
                          size="lg"
                          icon={EyeOff}
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleProvider(provider, models, false);
                          }}
                          title="Hide all models in this provider"
                        >
                          Hide All
                        </Button>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {modelEntries.map(([modelKey, model]) => (
                          <div
                            key={`${provider}-${modelKey}`}
                            className="flex items-center justify-between p-2 bg-surface rounded-control"
                          >
                            <span className="text-sm">
                              {model.displayName || modelKey}
                            </span>
                            <AppSwitch
                              checked={
                                !isHiddenModel(hiddenModels, provider, modelKey)
                              }
                              onChange={(checked) => {
                                onToggleModel(provider, modelKey, checked);
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <ListEmptyState layout="compact">
              No models available
            </ListEmptyState>
          );
        })()}
      </div>
    </SettingsSection>
  );
}
