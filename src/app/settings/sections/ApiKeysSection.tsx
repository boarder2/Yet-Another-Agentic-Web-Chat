'use client';

import { LoaderCircle, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import SettingsSection from '../components/SettingsSection';
import InputComponent from '../components/InputComponent';
import { SettingsType } from '../types';

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
  const [refreshing, setRefreshing] = useState(false);

  const handleRefreshModels = async () => {
    try {
      setRefreshing(true);
      const res = await fetch('/api/models?refresh=true&include_hidden=true');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success('Model list refreshed.');
    } catch (err) {
      console.error('Failed to refresh models:', err);
      toast.error('Failed to refresh models');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <SettingsSection
      title="API Keys"
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
      <p className="text-xs text-fg/60">
        Values are also editable directly in{' '}
        <code className="font-mono">config.toml</code>.
      </p>
      <div className="flex flex-col space-y-4">
        <div className="flex flex-col space-y-1">
          <p className="text-sm">OpenAI API Key</p>
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
        </div>

        <div className="flex flex-col space-y-1">
          <p className="text-sm">Ollama API URL</p>
          <InputComponent
            type="text"
            placeholder="Ollama API URL"
            value={config.ollamaApiUrl}
            isSaving={savingStates['ollamaApiUrl']}
            onChange={(e) => {
              setConfig((prev) => ({
                ...prev!,
                ollamaApiUrl: e.target.value,
              }));
            }}
            onSave={(value) => saveConfig('ollamaApiUrl', value)}
          />
        </div>

        <div className="flex flex-col space-y-1">
          <p className="text-sm">GROQ API Key</p>
          <InputComponent
            type="password"
            placeholder="GROQ API Key"
            value={config.groqApiKey}
            isSaving={savingStates['groqApiKey']}
            onChange={(e) => {
              setConfig((prev) => ({
                ...prev!,
                groqApiKey: e.target.value,
              }));
            }}
            onSave={(value) => saveConfig('groqApiKey', value)}
          />
        </div>

        <div className="flex flex-col space-y-1">
          <p className="text-sm">OpenRouter API Key</p>
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
        </div>

        <div className="flex flex-col space-y-1">
          <p className="text-sm">Anthropic API Key</p>
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
        </div>

        <div className="flex flex-col space-y-1">
          <p className="text-sm">Gemini API Key</p>
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
        </div>

        <div className="flex flex-col space-y-1">
          <p className="text-sm">Deepseek API Key</p>
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
        </div>

        <div className="flex flex-col space-y-1">
          <p className="text-sm">AI/ML API Key</p>
          <InputComponent
            type="text"
            placeholder="AI/ML API Key"
            value={config.aimlApiKey}
            isSaving={savingStates['aimlApiKey']}
            onChange={(e) => {
              setConfig((prev) => ({
                ...prev!,
                aimlApiKey: e.target.value,
              }));
            }}
            onSave={(value) => saveConfig('aimlApiKey', value)}
          />
        </div>

        <div className="flex flex-col space-y-1">
          <p className="text-sm">LM Studio API URL</p>
          <InputComponent
            type="text"
            placeholder="LM Studio API URL"
            value={config.lmStudioApiUrl}
            isSaving={savingStates['lmStudioApiUrl']}
            onChange={(e) => {
              setConfig((prev) => ({
                ...prev!,
                lmStudioApiUrl: e.target.value,
              }));
            }}
            onSave={(value) => saveConfig('lmStudioApiUrl', value)}
          />
        </div>
      </div>
    </SettingsSection>
  );
}
