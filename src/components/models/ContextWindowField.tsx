import { useState } from 'react';
import Select from '@/app/settings/components/Select';
import {
  DEFAULT_CONTEXT_WINDOW,
  PREDEFINED_CONTEXT_SIZES,
} from '@/lib/models/presets';

/**
 * Context-window control: a predefined-size dropdown plus a "Custom…" option
 * that reveals a number input (min 512). Controlled via `value` / `onChange`.
 * Shared by the chat ModelPicker and Settings → Model Presets.
 */
export default function ContextWindowField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const [customMode, setCustomMode] = useState(
    !PREDEFINED_CONTEXT_SIZES.includes(value),
  );
  const options = [
    ...PREDEFINED_CONTEXT_SIZES.map((s) => ({
      value: s.toString(),
      label: `${s.toLocaleString()} tokens`,
    })),
    { value: 'custom', label: 'Custom…' },
  ];
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-fg/60">{label}</span>
      <div className="flex items-center gap-2">
        {customMode && (
          <input
            type="number"
            min={512}
            aria-label="Custom context window size"
            value={value}
            onChange={(e) =>
              onChange(Math.max(512, parseInt(e.target.value) || 512))
            }
            className="w-28 text-xs bg-bg border border-surface-2 rounded-control px-2 py-1.5 text-fg outline-none focus:border-accent"
          />
        )}
        <Select
          value={customMode ? 'custom' : value.toString()}
          onChange={(e) => {
            if (e.target.value === 'custom') {
              setCustomMode(true);
            } else {
              setCustomMode(false);
              onChange(parseInt(e.target.value) || DEFAULT_CONTEXT_WINDOW);
            }
          }}
          options={options}
        />
      </div>
    </div>
  );
}
