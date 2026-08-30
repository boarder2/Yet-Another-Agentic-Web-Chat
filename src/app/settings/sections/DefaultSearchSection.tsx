'use client';

import { RotateCcw } from 'lucide-react';
import ModelPicker from '@/components/models/ModelPicker';
import type { ModelSelection } from '@/lib/models/presets';
import SettingsSection from '../components/SettingsSection';
import { IconButton } from '@/components/ui/IconButton';

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
  const value: ModelSelection = {
    chatProvider: searchChatModelProvider,
    chatModel: searchChatModel,
    systemProvider: searchChatModelProvider,
    systemModel: searchChatModel,
  };

  return (
    <SettingsSection title="Default Search Settings">
      <p className="text-xs text-fg-muted">
        Settings used when navigating to the site with a search query (e.g.{' '}
        <code className="font-mono">?q=your+query</code>). These override global
        settings for that search. If not specified, global settings are used.
      </p>
      <div className="flex flex-col space-y-4">
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <ModelPicker
              fields={{ reasoningEffort: false }}
              value={value}
              onChange={(next) =>
                onModelChange(next.chatProvider, next.chatModel)
              }
            />
          </div>
          {(searchChatModelProvider || searchChatModel) && (
            <IconButton
              icon={RotateCcw}
              label="Reset chat model"
              onClick={onReset}
              className="self-start mt-5"
            />
          )}
        </div>
      </div>
    </SettingsSection>
  );
}
