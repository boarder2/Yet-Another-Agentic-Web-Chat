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

const PREDEFINED_DURATIONS = [
  { label: '5 minutes', value: 5 },
  { label: '15 minutes', value: 15 },
  { label: '30 minutes', value: 30 },
  { label: '1 hour', value: 60 },
  { label: '8 hours', value: 480 },
  { label: '24 hours', value: 1440 },
  { label: '3 days', value: 4320 },
  { label: '7 days', value: 10080 },
  { label: 'Custom', value: -1 },
];

export default function RetentionSection({
  config,
  savingStates,
  setConfig,
  saveConfig,
  privateSessionDurationMinutes,
  isCustomPrivateDuration,
  customPrivateDurationInput,
  setPrivateSessionDurationMinutes,
  setIsCustomPrivateDuration,
  setCustomPrivateDurationInput,
}: {
  config: SettingsType;
  savingStates: Record<string, boolean>;
  setConfig: React.Dispatch<React.SetStateAction<SettingsType | null>>;
  saveConfig: (
    key: string,
    value: string | string[] | number | boolean,
  ) => void;
  privateSessionDurationMinutes: number;
  isCustomPrivateDuration: boolean;
  customPrivateDurationInput: string;
  setPrivateSessionDurationMinutes: (val: number) => void;
  setIsCustomPrivateDuration: (val: boolean) => void;
  setCustomPrivateDurationInput: (val: string) => void;
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
      <div className="flex flex-col space-y-2">
        <p className="text-sm font-medium">Private Session Duration</p>
        <p className="text-xs text-fg/60">
          Private sessions are automatically deleted after the configured
          duration.
        </p>
        <Select
          value={
            isCustomPrivateDuration
              ? '-1'
              : String(privateSessionDurationMinutes)
          }
          onChange={(e) => {
            const val = parseInt(e.target.value);
            if (val === -1) {
              setIsCustomPrivateDuration(true);
              setCustomPrivateDurationInput(
                String(privateSessionDurationMinutes),
              );
            } else {
              setIsCustomPrivateDuration(false);
              setPrivateSessionDurationMinutes(val);
              setConfig((prev) => ({
                ...prev!,
                privateSessionDurationMinutes: val,
              }));
              saveConfig('privateSessionDurationMinutes', val);
            }
          }}
          options={PREDEFINED_DURATIONS.map((d) => ({
            value: String(d.value),
            label: d.label,
          }))}
        />
        {isCustomPrivateDuration && (
          <div className="flex flex-col space-y-1">
            <p className="text-sm">Custom duration (minutes)</p>
            <InputComponent
              type="number"
              min={1}
              value={customPrivateDurationInput}
              placeholder="Duration in minutes"
              isSaving={savingStates['privateSessionDurationMinutes']}
              onChange={(e) => {
                setCustomPrivateDurationInput(e.target.value);
              }}
              onSave={(value) => {
                const numValue = Math.max(1, parseInt(value) || 1440);
                setPrivateSessionDurationMinutes(numValue);
                setCustomPrivateDurationInput(String(numValue));
                setConfig((prev) => ({
                  ...prev!,
                  privateSessionDurationMinutes: numValue,
                }));
                saveConfig('privateSessionDurationMinutes', numValue);
              }}
            />
            <p className="text-xs text-fg/60">
              Enter a custom duration in minutes (minimum 1).
            </p>
          </div>
        )}
      </div>
    </SettingsSection>
  );
}
