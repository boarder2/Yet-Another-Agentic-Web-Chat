'use client';

import { cn } from '@/lib/utils';
import { Switch } from '@headlessui/react';
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
        <div className="flex items-center justify-between p-3 bg-surface rounded-lg hover:bg-surface-2 transition-colors">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-surface-2 rounded-lg">
              <Layers3 size={18} />
            </div>
            <div>
              <p className="text-sm font-medium">Automatic Suggestions</p>
              <p className="text-xs mt-0.5">
                Automatically show related suggestions after responses
              </p>
            </div>
          </div>
          <Switch
            checked={automaticSuggestions}
            onChange={onToggle}
            className={cn(
              automaticSuggestions ? 'bg-accent' : 'bg-surface-2',
              'relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none',
            )}
          >
            <span
              className={cn(
                automaticSuggestions ? 'translate-x-6' : 'translate-x-1',
                'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
              )}
            />
          </Switch>
        </div>
      </div>
    </SettingsSection>
  );
}
