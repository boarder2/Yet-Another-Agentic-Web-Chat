'use client';

import { useState } from 'react';
import SettingsSection from '../components/SettingsSection';
import Select from '@/components/ui/Select';
import { Field } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import AppSwitch from '@/components/ui/AppSwitch';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useModels } from '@/lib/hooks/api/useModels';
import { useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/api/keys';
import {
  useLocalStorageBoolean,
  useLocalStorageString,
} from '@/lib/hooks/useLocalStorage';

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

export default function ImageGenerationSection() {
  const qc = useQueryClient();
  const { data: modelsData, isLoading: loadingModels } = useModels();
  const [refreshing, setRefreshing] = useState(false);

  // Image generation settings are DB-backed (app_settings, synced from
  // localStorage). The OpenRouter API key is an encrypted DB credential.
  const [enabled, setEnabled] = useLocalStorageBoolean(
    'imageGenerationEnabled',
    false,
  );
  const [model, setModel] = useLocalStorageString('imageGenerationModel', '');
  const [aspectRatio, setAspectRatio] = useLocalStorageString(
    'imageGenerationAspectRatio',
    '1:1',
  );
  const [imageSize, setImageSize] = useLocalStorageString(
    'imageGenerationImageSize',
    '1K',
  );

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

  const handleToggle = (checked: boolean) => {
    setEnabled(checked);
    if (checked) {
      toast.success('Image generation enabled. Configure your model below.');
    }
  };

  return (
    <SettingsSection
      title="Image Generation"
      headerAction={
        <Button
          size="sm"
          icon={RefreshCw}
          loading={refreshing}
          onClick={handleRefresh}
          title="Refresh image generation models from OpenRouter"
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </Button>
      }
    >
      <div className="flex flex-col space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Enable Image Generation</p>
            <p className="text-xs text-fg-muted">
              Allow the agent to generate images from text prompts via
              OpenRouter
            </p>
          </div>
          <AppSwitch
            checked={enabled}
            onChange={handleToggle}
            aria-label="Enable image generation"
            title="Enable image generation"
          />
        </div>

        {enabled && (
          <>
            <Field
              label="Image Generation Model"
              hint="Choose an OpenRouter model that supports image output. Requires a valid OpenRouter API key."
            >
              <Select
                value={model}
                options={modelOptions}
                onChange={(e) => setModel(e.target.value)}
              />
            </Field>
            {loadingModels && (
              <p className="text-xs text-fg-muted">Loading models...</p>
            )}
            {!loadingModels && imageGenModels.length === 0 && (
              <p className="text-xs text-fg-muted">
                No models available — check your API key.
              </p>
            )}

            <Field
              label="Default Aspect Ratio"
              hint="The agent will use this unless the user specifies otherwise."
            >
              <Select
                value={aspectRatio}
                options={ASPECT_RATIOS}
                onChange={(e) => setAspectRatio(e.target.value)}
              />
            </Field>

            <Field
              label="Default Resolution"
              hint="Higher resolutions produce more detail but may be slower."
            >
              <Select
                value={imageSize}
                options={IMAGE_SIZES}
                onChange={(e) => setImageSize(e.target.value)}
              />
            </Field>
          </>
        )}
      </div>
    </SettingsSection>
  );
}
