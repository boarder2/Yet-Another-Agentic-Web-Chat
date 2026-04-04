'use client';

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
  return (
    <SettingsSection title="API Keys">
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
