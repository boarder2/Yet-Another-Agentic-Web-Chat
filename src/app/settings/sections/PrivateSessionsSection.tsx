'use client';

import SettingsSection from '../components/SettingsSection';

export default function PrivateSessionsSection() {
  return (
    <SettingsSection title="Private Sessions">
      <p className="text-xs text-fg/60">
        Private sessions are automatically deleted after a configured duration.
        Personalization and memories are disabled in private sessions. Configure
        the session duration in the Retention settings.
      </p>
    </SettingsSection>
  );
}
