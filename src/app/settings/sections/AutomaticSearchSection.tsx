'use client';

import AppSwitch from '@/components/ui/AppSwitch';
import { Layers3 } from 'lucide-react';
import SettingsSection from '../components/SettingsSection';

export default function AutomaticSearchSection({
  automaticSuggestions,
  onToggle,
}: {
  automaticSuggestions: boolean;
  onToggle: (checked: boolean) => void;
}) {
  return (
    <SettingsSection title="Automatic Search">
      <div className="flex flex-col space-y-4">
        <div className="flex items-center justify-between p-3 bg-surface rounded-surface hover:bg-surface-2 transition-colors">
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
      </div>
    </SettingsSection>
  );
}
