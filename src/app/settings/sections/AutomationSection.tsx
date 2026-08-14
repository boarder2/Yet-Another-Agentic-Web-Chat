'use client';

import AppSwitch from '@/components/ui/AppSwitch';
import { Layers3, Type } from 'lucide-react';
import SettingsSection from '../components/SettingsSection';

export default function AutomationSection({
  automaticSuggestions,
  onToggle,
  autoTitleEnabled,
  onToggleAutoTitle,
}: {
  automaticSuggestions: boolean;
  onToggle: (checked: boolean) => void;
  autoTitleEnabled: boolean;
  onToggleAutoTitle: (checked: boolean) => void;
}) {
  return (
    <SettingsSection title="Automation">
      <div className="flex flex-col space-y-4">
        <div className="flex items-center justify-between p-3 bg-surface rounded-surface hover:bg-surface-2 transition-colors duration-150">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-surface-2 rounded-surface">
              <Layers3 size={18} />
            </div>
            <div>
              <p className="text-sm font-medium">Automatic Suggestions</p>
              <p className="text-xs mt-0.5">
                Automatically show related suggestions after responses
              </p>
            </div>
          </div>
          <AppSwitch checked={automaticSuggestions} onChange={onToggle} />
        </div>
        <div className="flex items-center justify-between p-3 bg-surface rounded-surface hover:bg-surface-2 transition-colors duration-150">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-surface-2 rounded-surface">
              <Type size={18} />
            </div>
            <div>
              <p className="text-sm font-medium">Auto-generate chat titles</p>
              <p className="text-xs mt-0.5">
                Automatically summarize new chats into a title. When off, a chat
                keeps its first message as its title.
              </p>
            </div>
          </div>
          <AppSwitch checked={autoTitleEnabled} onChange={onToggleAutoTitle} />
        </div>
      </div>
    </SettingsSection>
  );
}
