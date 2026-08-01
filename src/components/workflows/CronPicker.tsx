'use client';

import { useState } from 'react';
import {
  cronToPreset,
  presetToCron,
  describeCron,
} from '@/lib/scheduledTasks/presets';
import type { Preset } from '@/lib/scheduledTasks/presets';
import { Input } from '@/components/ui/Input';
import Select from '@/components/ui/Select';

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/** Hourly/daily/weekly/advanced cron builder. Emits a cron expression string. */
export default function CronPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (cron: string) => void;
}) {
  const preset = cronToPreset(value);
  const [kind, setKind] = useState<Preset['kind']>(preset.kind);

  const update = (next: Partial<Preset>) => {
    const current = cronToPreset(value);
    const k = next.kind ?? kind;
    let merged: Preset;
    if (k === 'hourly') {
      merged = {
        kind: 'hourly',
        minute:
          'minute' in next
            ? (next as { minute: number }).minute
            : current.kind === 'hourly'
              ? current.minute
              : 0,
      };
    } else if (k === 'daily') {
      merged = {
        kind: 'daily',
        hour:
          'hour' in next
            ? (next as { hour: number }).hour
            : current.kind === 'daily'
              ? current.hour
              : 8,
        minute:
          'minute' in next
            ? (next as { minute: number }).minute
            : current.kind === 'daily'
              ? current.minute
              : 0,
      };
    } else if (k === 'weekly') {
      merged = {
        kind: 'weekly',
        day:
          'day' in next
            ? (next as { day: 0 | 1 | 2 | 3 | 4 | 5 | 6 }).day
            : current.kind === 'weekly'
              ? current.day
              : 1,
        hour:
          'hour' in next
            ? (next as { hour: number }).hour
            : current.kind === 'weekly'
              ? current.hour
              : 8,
        minute:
          'minute' in next
            ? (next as { minute: number }).minute
            : current.kind === 'weekly'
              ? current.minute
              : 0,
      };
    } else {
      merged = {
        kind: 'advanced',
        expression:
          'expression' in next
            ? (next as { expression: string }).expression
            : value,
      };
    }
    setKind(k);
    try {
      onChange(presetToCron(merged));
    } catch {
      if (merged.kind === 'advanced') onChange(merged.expression);
    }
  };

  const current = cronToPreset(value);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Select
          aria-label="Schedule kind"
          value={kind}
          onChange={(e) => update({ kind: e.target.value as Preset['kind'] })}
        >
          <option value="hourly">Hourly</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="advanced">Advanced (cron)</option>
        </Select>

        {kind === 'hourly' && (
          <div className="flex items-center gap-1">
            <span className="text-sm text-fg/60">at minute</span>
            <Input
              type="number"
              aria-label="Minute"
              min={0}
              max={59}
              value={current.kind === 'hourly' ? current.minute : 0}
              onChange={(e) =>
                update({ minute: parseInt(e.target.value, 10) || 0 })
              }
              className="w-16"
            />
          </div>
        )}

        {kind === 'daily' && (
          <div className="flex items-center gap-1">
            <span className="text-sm text-fg/60">at</span>
            <Input
              type="number"
              aria-label="Hour"
              min={0}
              max={23}
              value={current.kind === 'daily' ? current.hour : 8}
              onChange={(e) =>
                update({ hour: parseInt(e.target.value, 10) || 0 })
              }
              className="w-16"
            />
            <span className="text-sm text-fg/60">:</span>
            <Input
              type="number"
              aria-label="Minute"
              min={0}
              max={59}
              value={current.kind === 'daily' ? current.minute : 0}
              onChange={(e) =>
                update({ minute: parseInt(e.target.value, 10) || 0 })
              }
              className="w-16"
            />
          </div>
        )}

        {kind === 'weekly' && (
          <div className="flex items-center gap-1 flex-wrap">
            <Select
              aria-label="Day of week"
              value={current.kind === 'weekly' ? current.day : 1}
              onChange={(e) =>
                update({
                  day: parseInt(e.target.value, 10) as
                    0 | 1 | 2 | 3 | 4 | 5 | 6,
                })
              }
            >
              {DAY_NAMES.map((d, i) => (
                <option key={i} value={i}>
                  {d}
                </option>
              ))}
            </Select>
            <span className="text-sm text-fg/60">at</span>
            <Input
              type="number"
              aria-label="Hour"
              min={0}
              max={23}
              value={current.kind === 'weekly' ? current.hour : 8}
              onChange={(e) =>
                update({ hour: parseInt(e.target.value, 10) || 0 })
              }
              className="w-16"
            />
            <span className="text-sm text-fg/60">:</span>
            <Input
              type="number"
              aria-label="Minute"
              min={0}
              max={59}
              value={current.kind === 'weekly' ? current.minute : 0}
              onChange={(e) =>
                update({ minute: parseInt(e.target.value, 10) || 0 })
              }
              className="w-16"
            />
          </div>
        )}

        {kind === 'advanced' && (
          <Input
            type="text"
            aria-label="Cron expression"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="*/5 * * * *"
            className="flex-1 font-mono"
          />
        )}
      </div>
      <p className="text-xs text-fg/50">{describeCron(value)}</p>
    </div>
  );
}
