'use client';

import SettingsSection from '../components/SettingsSection';
import Select from '../components/Select';
import InputComponent from '../components/InputComponent';
import { SettingsType } from '../types';

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

export default function PrivateSessionsSection({
  privateSessionDurationMinutes,
  isCustomPrivateDuration,
  customPrivateDurationInput,
  savingStates,
  setPrivateSessionDurationMinutes,
  setIsCustomPrivateDuration,
  setCustomPrivateDurationInput,
  setConfig,
  saveConfig,
}: {
  privateSessionDurationMinutes: number;
  isCustomPrivateDuration: boolean;
  customPrivateDurationInput: string;
  savingStates: Record<string, boolean>;
  setPrivateSessionDurationMinutes: (val: number) => void;
  setIsCustomPrivateDuration: (val: boolean) => void;
  setCustomPrivateDurationInput: (val: string) => void;
  setConfig: React.Dispatch<React.SetStateAction<SettingsType | null>>;
  saveConfig: (
    key: string,
    value: string | string[] | number | boolean,
  ) => void;
}) {
  return (
    <SettingsSection title="Private Sessions">
      <p className="text-xs text-fg/60">
        Private sessions are automatically deleted after the configured
        duration. Personalization and memories are disabled in private sessions.
      </p>
      <div className="flex flex-col space-y-3">
        <div className="flex flex-col space-y-1">
          <p className="text-sm font-medium">Session Duration</p>
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
        </div>
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
