'use client';

import SettingsSection from '../components/SettingsSection';
import Select from '../components/Select';
import InputComponent from '../components/InputComponent';
import { SettingsType } from '../types';
import { useLocalStorageString } from '@/lib/hooks/useLocalStorage';

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

function RetentionPanel({
  label,
  valueLabel,
  mode,
  setMode,
  value,
  setValue,
}: {
  label: string;
  valueLabel: string;
  mode: string;
  setMode: (v: string) => void;
  value: string;
  setValue: (v: string) => void;
}) {
  return (
    <div className="flex flex-col space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <Select
        value={mode}
        onChange={(e) => setMode(e.target.value)}
        options={MODES}
      />
      {mode !== 'disabled' && (
        <InputComponent
          type="number"
          min={1}
          value={value}
          placeholder={valueLabel}
          onChange={(e) => setValue(e.target.value)}
          onSave={(next) => setValue(String(Math.max(1, parseInt(next) || 1)))}
        />
      )}
    </div>
  );
}

export default function RetentionSection({
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
  // Retention policies are DB-backed (app_settings, synced from localStorage).
  const [chatsMode, setChatsMode] = useLocalStorageString(
    'retentionChatsMode',
    'disabled',
  );
  const [chatsValue, setChatsValue] = useLocalStorageString(
    'retentionChatsValue',
    '365',
  );
  const [schedMode, setSchedMode] = useLocalStorageString(
    'retentionScheduledRunsMode',
    'disabled',
  );
  const [schedValue, setSchedValue] = useLocalStorageString(
    'retentionScheduledRunsValue',
    '10',
  );

  return (
    <SettingsSection title="Retention">
      <p className="text-xs text-fg/60">
        Automatically purge old chats and scheduled task runs. Pinned chats are
        never purged.
      </p>
      <RetentionPanel
        label="Regular Chats"
        valueLabel="Days or count"
        mode={chatsMode}
        setMode={setChatsMode}
        value={chatsValue}
        setValue={setChatsValue}
      />
      <RetentionPanel
        label="Scheduled Task Runs (global default)"
        valueLabel="Days or count"
        mode={schedMode}
        setMode={setSchedMode}
        value={schedValue}
        setValue={setSchedValue}
      />
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
