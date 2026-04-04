'use client';

import { RotateCcw } from 'lucide-react';
import ModelSelector from '@/components/MessageInputActions/ModelSelector';
import SettingsSection from '../components/SettingsSection';

export default function DefaultSearchSection({
  searchChatModelProvider,
  searchChatModel,
  onModelChange,
  onReset,
}: {
  searchChatModelProvider: string;
  searchChatModel: string;
  onModelChange: (provider: string, model: string) => void;
  onReset: () => void;
}) {
  return (
    <SettingsSection title="Default Search Settings">
      <p className="text-xs text-fg/60">
        Settings used when navigating to the site with a search query (e.g.{' '}
        <code className="font-mono">?q=your+query</code>). These override global
        settings for that search. If not specified, global settings are used.
      </p>
      <div className="flex flex-col space-y-4">
        <div className="flex flex-col space-y-1">
          <p className="text-sm">Chat Model</p>
          <div className="flex justify-start items-center space-x-2">
            <ModelSelector
              selectedModel={{
                provider: searchChatModelProvider,
                model: searchChatModel,
              }}
              setSelectedModel={(model) => {
                onModelChange(model.provider, model.model);
              }}
              truncateModelName={false}
            />
            {(searchChatModelProvider || searchChatModel) && (
              <button
                onClick={onReset}
                className="p-1.5 rounded-md hover:bg-surface-2 transition-colors"
                title="Reset chat model"
              >
                <RotateCcw size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}
