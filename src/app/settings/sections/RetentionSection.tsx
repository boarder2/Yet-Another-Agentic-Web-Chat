'use client';

import SettingsSection from '../components/SettingsSection';
import Select from '../components/Select';
import InputComponent from '../components/InputComponent';
import { SettingsType } from '../types';

const MODES = [
  { value: 'days', label: 'Keep for N days' },
  { value: 'count', label: 'Keep N most recent' },
  { value: 'disabled', label: 'Disabled (keep everything)' },
];

export default function RetentionSection({
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
  const panel = (
    label: string,
    modeKey: 'retentionChatsMode' | 'retentionScheduledRunsMode',
    valueKey: 'retentionChatsValue' | 'retentionScheduledRunsValue',
    valueLabel: string,
  ) => (
    <div className="flex flex-col space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <Select
        value={config[modeKey]}
        onChange={(e) => {
          const mode = e.target.value as 'days' | 'count' | 'disabled';
          setConfig((prev) => ({ ...prev!, [modeKey]: mode }));
          saveConfig(modeKey, mode);
        }}
        options={MODES}
      />
      {config[modeKey] !== 'disabled' && (
        <InputComponent
          type="number"
          min={1}
          value={String(config[valueKey])}
          placeholder={valueLabel}
          isSaving={savingStates[valueKey]}
          onChange={(e) => {
            const n = parseInt(e.target.value);
            if (!isNaN(n)) {
              setConfig((prev) => ({ ...prev!, [valueKey]: n }));
            }
          }}
          onSave={(value) => {
            const n = Math.max(1, parseInt(value) || 1);
            setConfig((prev) => ({ ...prev!, [valueKey]: n }));
            saveConfig(valueKey, n);
          }}
        />
      )}
    </div>
  );

  return (
    <SettingsSection title="Retention">
      <p className="text-xs text-fg/60">
        Automatically purge old chats and scheduled task runs. Pinned chats are
        never purged.
      </p>
      {panel(
        'Regular Chats',
        'retentionChatsMode',
        'retentionChatsValue',
        'Days or count',
      )}
      {panel(
        'Scheduled Task Runs (global default)',
        'retentionScheduledRunsMode',
        'retentionScheduledRunsValue',
        'Days or count',
      )}
    </SettingsSection>
  );
}
