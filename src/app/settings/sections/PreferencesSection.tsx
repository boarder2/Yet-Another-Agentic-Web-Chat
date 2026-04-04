'use client';

import ThemeSwitcher from '@/components/theme/Switcher';
import SettingsSection from '../components/SettingsSection';

export default function PreferencesSection() {
  return (
    <SettingsSection title="Preferences">
      <div className="flex flex-col space-y-1">
        <p className="text-sm">Theme</p>
        <ThemeSwitcher />
      </div>
    </SettingsSection>
  );
}
