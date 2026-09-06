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
import AppSwitch from '@/components/ui/AppSwitch';
import Select from '@/components/ui/Select';
import { cn } from '@/lib/utils';
import { IconButton } from '@/components/ui/IconButton';
import { useModels } from '@/lib/hooks/api/useModels';
import { ReasoningEffortSummary } from '@/components/models/ReasoningEffortField';

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
  const { data: modelsData, isFetched } = useModels();
  const capabilitiesLoaded = isFetched || modelsData !== undefined;

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
  const systemModel = workflow.systemModel ?? workflow.chatModel;
  const chatModelInfo =
    modelsData?.chatModelProviders[workflow.chatModel.provider]?.[
      workflow.chatModel.name
    ];
  const systemModelInfo =
    modelsData?.chatModelProviders[systemModel.provider]?.[systemModel.name];
  const providerDisplayName = (provider: string) =>
    modelsData?.providerMetadata?.[provider]?.displayName ||
    provider.charAt(0).toUpperCase() + provider.slice(1);
  const chatUnavailable = capabilitiesLoaded && !chatModelInfo;
  const systemUnavailable = capabilitiesLoaded && !systemModelInfo;

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
        <IconButton
          href="/automations/scheduled"
          icon={ArrowLeft}
          label="Back to scheduled tasks"
        />
        <CalendarClock className="text-accent" />
        <div className="flex flex-col">
          <h2 className="text-2xl font-medium">
            {schedule ? 'Edit Schedule' : 'New Schedule'}
          </h2>
          <span className="text-sm text-fg-subtle">{workflow.name}</span>
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
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Acme — Mondays"
            required
          />
        </Field>

        <Field grouped label="Schedule">
          <CronPicker value={cron} onChange={setCron} />
        </Field>

        <Field label="Timezone (optional)">
          <Input
            type="text"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="e.g. America/New_York (empty = system timezone)"
          />
        </Field>

        {fields.length > 0 && (
          <Field grouped label="Inputs">
            <div className="rounded-surface border border-surface-2 p-4">
              <FillForm
                prompt={workflow.prompt}
                initialValues={values}
                hideSubmit
                onSubmit={() => {}}
                onChange={setValues}
              />
            </div>
          </Field>
        )}

        <Field grouped label="Models">
          <div className="space-y-2 rounded-surface border border-surface-2 p-3">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-fg-subtle">Chat</span>
              <span
                className="truncate text-right text-fg/90"
                title={`${workflow.chatModel.provider}/${workflow.chatModel.name}`}
              >
                {chatUnavailable
                  ? 'Unavailable'
                  : (chatModelInfo?.displayName ??
                    workflow.chatModel.name)}{' '}
                · {providerDisplayName(workflow.chatModel.provider)}
              </span>
            </div>
            <ReasoningEffortSummary
              label="Chat effort"
              value={workflow.chatModel.reasoningEffort}
              supported={chatModelInfo?.supportedReasoningEfforts}
              capabilityKnown={capabilitiesLoaded}
            />
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-fg-subtle">
                {workflow.systemModel ? 'System' : 'System (Chat fallback)'}
              </span>
              <span
                className="truncate text-right text-fg/90"
                title={`${systemModel.provider}/${systemModel.name}`}
              >
                {systemUnavailable
                  ? 'Unavailable'
                  : (systemModelInfo?.displayName ?? systemModel.name)}{' '}
                · {providerDisplayName(systemModel.provider)}
              </span>
            </div>
            <ReasoningEffortSummary
              label="System effort"
              value={systemModel.reasoningEffort}
              supported={systemModelInfo?.supportedReasoningEfforts}
              capabilityKnown={capabilitiesLoaded}
            />
            <p className="text-xs text-fg-muted">
              This schedule uses the workflow&apos;s saved model settings. Edit
              the workflow to change them; any stale named effort is clamped at
              run time without rewriting the saved definition.
            </p>
          </div>
        </Field>

        <Field grouped label="Retention (optional)">
          <Select
            aria-label="Retention scope"
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
                aria-label="Retention mode"
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
        </Field>

        <Field
          grouped
          label="Enabled"
          className="flex-row items-center justify-between"
        >
          <AppSwitch
            checked={enabled}
            onChange={setEnabled}
            aria-label="Toggle enabled"
          />
        </Field>

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
            className={cn(buttonClasses('ghost', 'md'), 'text-fg-muted')}
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
