'use client';

import SettingToggleRow from '@/components/ui/SettingToggleRow';
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
        <SettingToggleRow
          icon={Layers3}
          className="p-3 rounded-surface bg-surface transition-colors duration-150 hover:bg-surface-2"
          label="Automatic Suggestions"
          description="Automatically show related suggestions after responses"
          checked={automaticSuggestions}
          onChange={onToggle}
        />
        <SettingToggleRow
          icon={Type}
          className="p-3 rounded-surface bg-surface transition-colors duration-150 hover:bg-surface-2"
          label="Auto-generate chat titles"
          description="Automatically summarize new chats into a title. When off, a chat keeps its first message as its title."
          checked={autoTitleEnabled}
          onChange={onToggleAutoTitle}
        />
      </div>
    </SettingsSection>
  );
}
