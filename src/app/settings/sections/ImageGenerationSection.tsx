'use client';

import { useState } from 'react';
import SettingsSection from '../components/SettingsSection';
import Select from '../components/Select';
import { SettingsType } from '../types';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useModels } from '@/lib/hooks/api/useModels';
import { useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/api/keys';

const ASPECT_RATIOS = [
  { value: '1:1', label: '1:1 (Square)' },
  { value: '3:2', label: '3:2' },
  { value: '4:3', label: '4:3' },
  { value: '16:9', label: '16:9 (Widescreen)' },
  { value: '9:16', label: '9:16 (Portrait)' },
  { value: '21:9', label: '21:9 (Ultrawide)' },
];

const IMAGE_SIZES = [
  { value: '1K', label: '1K (Standard)' },
  { value: '2K', label: '2K (High)' },
  { value: '4K', label: '4K (Ultra High)' },
];

type ConfigRecord = Record<string, unknown>;

export default function ImageGenerationSection({
  config,
  saveConfig,
  setConfig,
}: {
  config: SettingsType;
  savingStates: Record<string, boolean>;
  setConfig: React.Dispatch<React.SetStateAction<SettingsType | null>>;
  saveConfig: (key: string, value: string | boolean) => Promise<void>;
}) {
  const qc = useQueryClient();
  const { data: modelsData, isLoading: loadingModels } = useModels();
  const [refreshing, setRefreshing] = useState(false);

  const enabled =
    ((config as unknown as ConfigRecord).imageGenerationEnabled as boolean) ??
    false;
  const model =
    ((config as unknown as ConfigRecord).imageGenerationModel as string) || '';
  const aspectRatio =
    ((config as unknown as ConfigRecord)
      .imageGenerationAspectRatio as string) || '1:1';
  const imageSize =
    ((config as unknown as ConfigRecord).imageGenerationImageSize as string) ||
    '1K';

  const imageGenModels = modelsData?.imageGenerationModels ?? [];
  const modelOptions = imageGenModels.map((m) => ({
    value: m.id,
    label: m.name,
  }));

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await fetch('/api/models?refresh=true');
      await qc.invalidateQueries({ queryKey: qk.models });
    } finally {
      setRefreshing(false);
    }
  }

  const handleChange =
    (key: string) => (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      setConfig((prev) =>
        prev ? ({ ...prev, [key]: value } as unknown as SettingsType) : prev,
      );
      saveConfig(key, value);
    };

  const handleToggle = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setConfig((prev) =>
      prev
        ? ({
            ...prev,
            imageGenerationEnabled: checked,
          } as unknown as SettingsType)
        : prev,
    );
    await saveConfig('imageGenerationEnabled', checked);
    if (checked) {
      toast.success('Image generation enabled. Configure your model below.');
    }
  };

  return (
    <SettingsSection
      title="Image Generation"
      headerAction={
        <button
          type="button"
          className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-control border border-surface-2 hover:bg-surface-2 transition disabled:opacity-60"
          onClick={handleRefresh}
          disabled={refreshing}
          title="Refresh image generation models from OpenRouter"
        >
          {refreshing ? (
            <LoaderCircle size={12} className="animate-spin text-accent" />
          ) : (
            <RefreshCw size={12} />
          )}
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      }
    >
      <div className="flex flex-col space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Enable Image Generation</p>
            <p className="text-xs text-fg/50">
              Allow the agent to generate images from text prompts via
              OpenRouter
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={enabled}
              onChange={handleToggle}
              aria-label="Enable image generation"
              title="Enable image generation"
            />
            <div className="w-9 h-5 bg-fg/20 rounded-full peer peer-checked:bg-accent peer-focus:ring-2 peer-focus:ring-accent/30 after:content-[''] after:absolute after:top-0.5 after:inset-s-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
          </label>
        </div>

        {enabled && (
          <>
            <div className="flex flex-col space-y-1">
              <p className="text-sm">Image Generation Model</p>
              <p className="text-xs text-fg/50">
                Choose an OpenRouter model that supports image output. Requires
                a valid OpenRouter API key.
              </p>
              <Select
                value={model}
                options={modelOptions}
                onChange={handleChange('imageGenerationModel')}
              />
              {loadingModels && (
                <p className="text-xs text-fg/50">Loading models...</p>
              )}
              {!loadingModels && imageGenModels.length === 0 && (
                <p className="text-xs text-fg/50">
                  No models available — check your API key.
                </p>
              )}
            </div>

            <div className="flex flex-col space-y-1">
              <p className="text-sm">Default Aspect Ratio</p>
              <p className="text-xs text-fg/50">
                The agent will use this unless the user specifies otherwise.
              </p>
              <Select
                value={aspectRatio}
                options={ASPECT_RATIOS}
                onChange={handleChange('imageGenerationAspectRatio')}
              />
            </div>

            <div className="flex flex-col space-y-1">
              <p className="text-sm">Default Resolution</p>
              <p className="text-xs text-fg/50">
                Higher resolutions produce more detail but may be slower.
              </p>
              <Select
                value={imageSize}
                options={IMAGE_SIZES}
                onChange={handleChange('imageGenerationImageSize')}
              />
            </div>
          </>
        )}
      </div>
    </SettingsSection>
  );
}
