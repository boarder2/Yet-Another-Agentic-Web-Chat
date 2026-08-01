'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CalendarClock } from 'lucide-react';
import CronPicker from '@/components/workflows/CronPicker';
import FillForm from '@/components/workflows/FillForm';
import {
  missingRequired,
  parseWorkflowTemplate,
} from '@/lib/workflows/template';
import type { Workflow } from '@/lib/hooks/api/useWorkflows';
import {
  useCreateSchedule,
  usePatchSchedule,
  type Schedule,
} from '@/lib/hooks/api/useSchedules';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Button, buttonClasses } from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import { cn } from '@/lib/utils';

type Values = Record<string, string | string[]>;

export default function ScheduleEditor({
  workflow,
  schedule,
}: {
  workflow: Workflow;
  schedule?: Schedule;
}) {
  const router = useRouter();
  const create = useCreateSchedule(workflow.id);
  const patch = usePatchSchedule();

  const [label, setLabel] = useState(schedule?.label ?? '');
  const [cron, setCron] = useState(schedule?.cronExpression ?? '0 8 * * *');
  const [timezone, setTimezone] = useState(schedule?.timezone ?? '');
  const [enabled, setEnabled] = useState(schedule ? !!schedule.enabled : true);
  const [retentionMode, setRetentionMode] = useState<string | null>(
    schedule?.retentionMode ?? null,
  );
  const [retentionValue, setRetentionValue] = useState<number | null>(
    schedule?.retentionValue ?? null,
  );
  const [values, setValues] = useState<Values>(
    () => schedule?.inputValues ?? {},
  );
  const [error, setError] = useState('');

  const fields = parseWorkflowTemplate(workflow.prompt).fields;
  const missing = missingRequired(fields, values);
  const saving = create.isPending || patch.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!label.trim()) return setError('Please enter a label');
    if (missing.length > 0)
      return setError(`Fill required inputs: ${missing.join(', ')}`);

    const data = {
      label,
      cronExpression: cron,
      timezone: timezone || null,
      enabled: enabled ? 1 : 0,
      inputValues: values,
      retentionMode: retentionMode as Schedule['retentionMode'],
      retentionValue: retentionMode ? retentionValue : null,
    };

    try {
      if (schedule) await patch.mutateAsync({ id: schedule.id, data });
      else await create.mutateAsync(data);
      router.push('/automations/scheduled');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save schedule');
    }
  };

  return (
    <div className="flex flex-col pt-4 max-w-2xl">
      <div className="flex items-center gap-3 px-1 mb-6">
        <Link
          href="/automations/scheduled"
          className="text-fg/60 hover:text-fg transition-colors duration-150"
        >
          <ArrowLeft size={20} />
        </Link>
        <CalendarClock className="text-accent" />
        <div className="flex flex-col">
          <h2 className="text-2xl font-medium">
            {schedule ? 'Edit Schedule' : 'New Schedule'}
          </h2>
          <span className="text-sm text-fg/50">{workflow.name}</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {error && (
          <div className="px-4 py-2 rounded-surface bg-danger-soft border border-danger text-danger text-sm">
            {error}
          </div>
        )}

        {schedule?.disabledReason && (
          <div className="px-4 py-2 rounded-surface bg-warning-soft border border-warning text-warning text-sm">
            {schedule.disabledReason}
          </div>
        )}

        <Field label="Label">
          <Input
            type="text"
            aria-label="Schedule label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Acme — Mondays"
            required
          />
        </Field>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-fg/70">Schedule</label>
          <CronPicker value={cron} onChange={setCron} />
        </div>

        <Field label="Timezone (optional)">
          <Input
            type="text"
            aria-label="Timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="e.g. America/New_York (empty = system timezone)"
          />
        </Field>

        {fields.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-fg/70">Inputs</label>
            <div className="rounded-surface border border-surface-2 p-4">
              <FillForm
                prompt={workflow.prompt}
                initialValues={values}
                hideSubmit
                onSubmit={() => {}}
                onChange={setValues}
              />
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-fg/70">
            Retention (optional)
          </label>
          <Select
            value={retentionMode === null ? 'global' : 'override'}
            onChange={(e) => {
              if (e.target.value === 'global') {
                setRetentionMode(null);
                setRetentionValue(null);
              } else {
                setRetentionMode('count');
                setRetentionValue(10);
              }
            }}
          >
            <option value="global">Use global default</option>
            <option value="override">Override</option>
          </Select>
          {retentionMode !== null && (
            <div className="flex items-center gap-2">
              <Select
                value={retentionMode}
                onChange={(e) => setRetentionMode(e.target.value)}
              >
                <option value="days">Keep for N days</option>
                <option value="count">Keep N most recent</option>
                <option value="disabled">Disabled</option>
              </Select>
              {retentionMode !== 'disabled' && (
                <Input
                  type="number"
                  aria-label="Retention value"
                  min={1}
                  value={retentionValue ?? 10}
                  onChange={(e) =>
                    setRetentionValue(parseInt(e.target.value, 10) || 1)
                  }
                  className="w-24"
                />
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-fg/70">Enabled</label>
          <button
            type="button"
            aria-label="Toggle enabled"
            aria-pressed={enabled}
            onClick={() => setEnabled((v) => !v)}
            className={`relative w-11 h-6 rounded-pill transition-colors duration-150 ${
              enabled ? 'bg-accent' : 'bg-surface-2'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-pill bg-bg transition-transform ${
                enabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <Button type="submit" variant="primary" size="lg" loading={saving}>
            {saving
              ? 'Saving…'
              : schedule
                ? 'Update Schedule'
                : 'Create Schedule'}
          </Button>
          <Link
            href="/automations/scheduled"
            className={cn(buttonClasses('ghost', 'md'), 'text-fg/60')}
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
