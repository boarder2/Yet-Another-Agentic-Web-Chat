'use client';

import { RefreshCw } from 'lucide-react';
import SettingsSection from '../components/SettingsSection';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import InputComponent from '../components/InputComponent';
import { SettingsType } from '../types';
import { useRefreshModels } from '@/lib/hooks/api/useModels';

export default function ApiKeysSection({
  config,
  savingStates,
  setConfig,
  saveConfig,
}: {
  config: SettingsType;
  savingStates: Record<string, boolean>;
  setConfig: React.Dispatch<React.SetStateAction<SettingsType | null>>;
  saveConfig: (
    key: string,
    value: string | string[] | number | boolean,
  ) => void;
}) {
  const { refresh, refreshing } = useRefreshModels();
  return (
    <SettingsSection
      title="API Keys"
      headerAction={
        <Button
          size="sm"
          icon={RefreshCw}
          loading={refreshing}
          onClick={() => refresh()}
          title="Refresh models from providers"
        >
          {refreshing ? 'Refreshing…' : 'Refresh models'}
        </Button>
      }
    >
      <p className="text-xs text-fg-muted">
        API keys are encrypted at rest in the database.
      </p>
      <div className="flex flex-col space-y-4">
        <Field label="OpenAI API Key">
          <InputComponent
            type="password"
            placeholder="OpenAI API Key"
            value={config.openaiApiKey}
            isSaving={savingStates['openaiApiKey']}
            onChange={(e) => {
              setConfig((prev) => ({
                ...prev!,
                openaiApiKey: e.target.value,
              }));
            }}
            onSave={(value) => saveConfig('openaiApiKey', value)}
          />
        </Field>

        <Field label="OpenRouter API Key">
          <InputComponent
            type="password"
            placeholder="OpenRouter API Key"
            value={config.openrouterApiKey}
            isSaving={savingStates['openrouterApiKey']}
            onChange={(e) => {
              setConfig((prev) => ({
                ...prev!,
                openrouterApiKey: e.target.value,
              }));
            }}
            onSave={(value) => saveConfig('openrouterApiKey', value)}
          />
        </Field>

        <Field label="Anthropic API Key">
          <InputComponent
            type="password"
            placeholder="Anthropic API key"
            value={config.anthropicApiKey}
            isSaving={savingStates['anthropicApiKey']}
            onChange={(e) => {
              setConfig((prev) => ({
                ...prev!,
                anthropicApiKey: e.target.value,
              }));
            }}
            onSave={(value) => saveConfig('anthropicApiKey', value)}
          />
        </Field>

        <Field label="Gemini API Key">
          <InputComponent
            type="password"
            placeholder="Gemini API key"
            value={config.geminiApiKey}
            isSaving={savingStates['geminiApiKey']}
            onChange={(e) => {
              setConfig((prev) => ({
                ...prev!,
                geminiApiKey: e.target.value,
              }));
            }}
            onSave={(value) => saveConfig('geminiApiKey', value)}
          />
        </Field>

        <Field label="Deepseek API Key">
          <InputComponent
            type="password"
            placeholder="Deepseek API Key"
            value={config.deepseekApiKey}
            isSaving={savingStates['deepseekApiKey']}
            onChange={(e) => {
              setConfig((prev) => ({
                ...prev!,
                deepseekApiKey: e.target.value,
              }));
            }}
            onSave={(value) => saveConfig('deepseekApiKey', value)}
          />
        </Field>
      </div>
    </SettingsSection>
  );
}
