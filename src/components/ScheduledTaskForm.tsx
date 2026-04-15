'use client';

import { focusModes } from '@/lib/focusModes';
import {
  cronToPreset,
  presetToCron,
  describeCron,
} from '@/lib/scheduledTasks/presets';
import type { Preset } from '@/lib/scheduledTasks/presets';
import ModelSelector from '@/components/MessageInputActions/ModelSelector';
import { ArrowLeft, CalendarClock, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

interface TaskFormData {
  name: string;
  prompt: string;
  focusMode: string;
  sourceUrls: string[];
  chatModel: { provider: string; name: string } | null;
  systemModel: { provider: string; name: string } | null;
  embeddingModel: { provider: string; name: string } | null;
  selectedSystemPromptIds: string[];
  selectedMethodologyId: string | null;
  cronExpression: string;
  timezone: string;
  enabled: boolean;
}

interface SystemPrompt {
  id: string;
  name: string;
  type: string;
}

export default function TaskForm({
  taskId,
  initialData,
}: {
  taskId?: string;
  initialData?: TaskFormData;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [systemPrompts, setSystemPrompts] = useState<SystemPrompt[]>([]);

  const [form, setForm] = useState<TaskFormData>(
    initialData || {
      name: '',
      prompt: '',
      focusMode: 'webSearch',
      sourceUrls: [],
      chatModel: null,
      systemModel: null,
      embeddingModel: null,
      selectedSystemPromptIds: [],
      selectedMethodologyId: null,
      cronExpression: '0 8 * * *',
      timezone: '',
      enabled: true,
    },
  );

  const preset = cronToPreset(form.cronExpression);
  const [scheduleKind, setScheduleKind] = useState<Preset['kind']>(preset.kind);

  useEffect(() => {
    fetch('/api/system-prompts')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setSystemPrompts(data);
      })
      .catch(() => {});
  }, []);

  const updateField = <K extends keyof TaskFormData>(
    key: K,
    value: TaskFormData[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const updatePreset = (newPreset: Partial<Preset>) => {
    const current = cronToPreset(form.cronExpression);
    let merged: Preset;

    const kind = newPreset.kind ?? scheduleKind;

    if (kind === 'hourly') {
      merged = {
        kind: 'hourly',
        minute:
          'minute' in newPreset
            ? (newPreset as { minute: number }).minute
            : current.kind === 'hourly'
              ? current.minute
              : 0,
      };
    } else if (kind === 'daily') {
      merged = {
        kind: 'daily',
        hour:
          'hour' in newPreset
            ? (newPreset as { hour: number }).hour
            : current.kind === 'daily'
              ? current.hour
              : 8,
        minute:
          'minute' in newPreset
            ? (newPreset as { minute: number }).minute
            : current.kind === 'daily'
              ? current.minute
              : 0,
      };
    } else if (kind === 'weekly') {
      merged = {
        kind: 'weekly',
        day:
          'day' in newPreset
            ? (newPreset as { day: 0 | 1 | 2 | 3 | 4 | 5 | 6 }).day
            : current.kind === 'weekly'
              ? current.day
              : 1,
        hour:
          'hour' in newPreset
            ? (newPreset as { hour: number }).hour
            : current.kind === 'weekly'
              ? current.hour
              : 8,
        minute:
          'minute' in newPreset
            ? (newPreset as { minute: number }).minute
            : current.kind === 'weekly'
              ? current.minute
              : 0,
      };
    } else {
      merged = {
        kind: 'advanced',
        expression:
          'expression' in newPreset
            ? (newPreset as { expression: string }).expression
            : form.cronExpression,
      };
    }

    setScheduleKind(kind);
    try {
      updateField('cronExpression', presetToCron(merged));
    } catch {
      // Invalid cron, keep as-is until user fixes it
      if (merged.kind === 'advanced') {
        updateField(
          'cronExpression',
          (merged as { kind: 'advanced'; expression: string }).expression,
        );
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);

    if (!form.chatModel) {
      setError('Please select a chat model');
      setSaving(false);
      return;
    }

    if (!form.embeddingModel) {
      setError('Please select an embedding model');
      setSaving(false);
      return;
    }

    const payload = {
      ...form,
      chatModel: form.chatModel
        ? { provider: form.chatModel.provider, name: form.chatModel.name }
        : undefined,
      systemModel: form.systemModel
        ? { provider: form.systemModel.provider, name: form.systemModel.name }
        : undefined,
      embeddingModel: form.embeddingModel
        ? {
            provider: form.embeddingModel.provider,
            name: form.embeddingModel.name,
          }
        : undefined,
      enabled: form.enabled ? 1 : 0,
      timezone: form.timezone || undefined,
    };

    try {
      const url = taskId
        ? `/api/scheduled-tasks/${taskId}`
        : '/api/scheduled-tasks';
      const method = taskId ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to save task');
        setSaving(false);
        return;
      }

      router.push('/scheduled-tasks/manage');
    } catch {
      setError('Failed to save task');
    } finally {
      setSaving(false);
    }
  };

  const personas = systemPrompts.filter((p) => p.type === 'persona');
  const methodologies = systemPrompts.filter((p) => p.type === 'methodology');
  const currentPreset = cronToPreset(form.cronExpression);

  const DAY_NAMES = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];

  return (
    <div className="flex flex-col pt-4 max-w-2xl">
      <div className="flex items-center gap-3 px-1 mb-6">
        <Link
          href="/scheduled-tasks/manage"
          className="text-fg/60 hover:text-fg transition"
        >
          <ArrowLeft size={20} />
        </Link>
        <CalendarClock />
        <h2 className="text-3xl font-medium">
          {taskId ? 'Edit Task' : 'New Task'}
        </h2>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {error && (
          <div className="px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Name */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-fg/70">Name</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => updateField('name', e.target.value)}
            placeholder="Daily AI News Briefing"
            required
            className="px-3 py-2 rounded-lg bg-surface border border-surface-2 text-fg placeholder:text-fg/40 focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        {/* Prompt */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-fg/70">Prompt</label>
          <textarea
            value={form.prompt}
            onChange={(e) => updateField('prompt', e.target.value)}
            placeholder="Summarize the top AI and machine learning news from today..."
            required
            rows={4}
            className="px-3 py-2 rounded-lg bg-surface border border-surface-2 text-fg placeholder:text-fg/40 focus:outline-none focus:ring-2 focus:ring-accent resize-y"
          />
        </div>

        {/* Source URLs */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-fg/70">
            Source URLs (optional)
          </label>
          {form.sourceUrls.map((url, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                type="url"
                value={url}
                onChange={(e) =>
                  updateField(
                    'sourceUrls',
                    form.sourceUrls.map((u, i) =>
                      i === idx ? e.target.value : u,
                    ),
                  )
                }
                placeholder="https://example.com"
                className="flex-1 px-3 py-2 rounded-lg bg-surface border border-surface-2 text-fg placeholder:text-fg/40 focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <button
                type="button"
                onClick={() =>
                  updateField(
                    'sourceUrls',
                    form.sourceUrls.filter((_, i) => i !== idx),
                  )
                }
                className="p-1.5 rounded-lg hover:bg-surface-2 text-fg/60 hover:text-red-500 transition"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => updateField('sourceUrls', [...form.sourceUrls, ''])}
            className="flex items-center gap-1 text-sm text-accent hover:underline self-start"
          >
            <Plus size={14} /> Add URL
          </button>
        </div>

        {/* Focus Mode */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-fg/70">Focus Mode</label>
          <select
            value={form.focusMode}
            onChange={(e) => updateField('focusMode', e.target.value)}
            className="px-3 py-2 rounded-lg bg-surface border border-surface-2 text-fg focus:outline-none focus:ring-2 focus:ring-accent"
          >
            {focusModes.map((mode) => (
              <option key={mode.key} value={mode.key}>
                {mode.title} — {mode.description}
              </option>
            ))}
          </select>
        </div>

        {/* Schedule */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-fg/70">Schedule</label>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={scheduleKind}
              onChange={(e) =>
                updatePreset({
                  kind: e.target.value as Preset['kind'],
                })
              }
              className="px-3 py-2 rounded-lg bg-surface border border-surface-2 text-fg focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="hourly">Hourly</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="advanced">Advanced (cron)</option>
            </select>

            {scheduleKind === 'hourly' && (
              <div className="flex items-center gap-1">
                <span className="text-sm text-fg/60">at minute</span>
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={
                    currentPreset.kind === 'hourly' ? currentPreset.minute : 0
                  }
                  onChange={(e) =>
                    updatePreset({
                      minute: parseInt(e.target.value, 10) || 0,
                    })
                  }
                  className="w-16 px-2 py-2 rounded-lg bg-surface border border-surface-2 text-fg focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            )}

            {scheduleKind === 'daily' && (
              <div className="flex items-center gap-1">
                <span className="text-sm text-fg/60">at</span>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={
                    currentPreset.kind === 'daily' ? currentPreset.hour : 8
                  }
                  onChange={(e) =>
                    updatePreset({
                      hour: parseInt(e.target.value, 10) || 0,
                    })
                  }
                  className="w-16 px-2 py-2 rounded-lg bg-surface border border-surface-2 text-fg focus:outline-none focus:ring-2 focus:ring-accent"
                />
                <span className="text-sm text-fg/60">:</span>
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={
                    currentPreset.kind === 'daily' ? currentPreset.minute : 0
                  }
                  onChange={(e) =>
                    updatePreset({
                      minute: parseInt(e.target.value, 10) || 0,
                    })
                  }
                  className="w-16 px-2 py-2 rounded-lg bg-surface border border-surface-2 text-fg focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            )}

            {scheduleKind === 'weekly' && (
              <div className="flex items-center gap-1 flex-wrap">
                <select
                  value={
                    currentPreset.kind === 'weekly' ? currentPreset.day : 1
                  }
                  onChange={(e) =>
                    updatePreset({
                      day: parseInt(e.target.value, 10) as
                        | 0
                        | 1
                        | 2
                        | 3
                        | 4
                        | 5
                        | 6,
                    })
                  }
                  className="px-3 py-2 rounded-lg bg-surface border border-surface-2 text-fg focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  {DAY_NAMES.map((d, i) => (
                    <option key={i} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
                <span className="text-sm text-fg/60">at</span>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={
                    currentPreset.kind === 'weekly' ? currentPreset.hour : 8
                  }
                  onChange={(e) =>
                    updatePreset({
                      hour: parseInt(e.target.value, 10) || 0,
                    })
                  }
                  className="w-16 px-2 py-2 rounded-lg bg-surface border border-surface-2 text-fg focus:outline-none focus:ring-2 focus:ring-accent"
                />
                <span className="text-sm text-fg/60">:</span>
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={
                    currentPreset.kind === 'weekly' ? currentPreset.minute : 0
                  }
                  onChange={(e) =>
                    updatePreset({
                      minute: parseInt(e.target.value, 10) || 0,
                    })
                  }
                  className="w-16 px-2 py-2 rounded-lg bg-surface border border-surface-2 text-fg focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
            )}

            {scheduleKind === 'advanced' && (
              <input
                type="text"
                value={form.cronExpression}
                onChange={(e) => {
                  updateField('cronExpression', e.target.value);
                }}
                placeholder="*/5 * * * *"
                className="flex-1 px-3 py-2 rounded-lg bg-surface border border-surface-2 text-fg placeholder:text-fg/40 focus:outline-none focus:ring-2 focus:ring-accent font-mono"
              />
            )}
          </div>
          <p className="text-xs text-fg/50">
            {describeCron(form.cronExpression)}
          </p>
        </div>

        {/* Timezone */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-fg/70">
            Timezone (optional)
          </label>
          <input
            type="text"
            value={form.timezone}
            onChange={(e) => updateField('timezone', e.target.value)}
            placeholder="e.g. America/New_York (leave empty for system timezone)"
            className="px-3 py-2 rounded-lg bg-surface border border-surface-2 text-fg placeholder:text-fg/40 focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </div>

        {/* Chat Model */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-fg/70">Chat Model</label>
          <ModelSelector
            selectedModel={
              form.chatModel
                ? {
                    provider: form.chatModel.provider,
                    model: form.chatModel.name,
                  }
                : null
            }
            setSelectedModel={(m) =>
              updateField('chatModel', {
                provider: m.provider,
                name: m.model,
              })
            }
            truncateModelName={false}
            role="chat"
          />
        </div>

        {/* System Model */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-fg/70">
            System Model (optional, defaults to chat model)
          </label>
          <ModelSelector
            selectedModel={
              form.systemModel
                ? {
                    provider: form.systemModel.provider,
                    model: form.systemModel.name,
                  }
                : null
            }
            setSelectedModel={(m) =>
              updateField('systemModel', {
                provider: m.provider,
                name: m.model,
              })
            }
            truncateModelName={false}
            role="system"
          />
        </div>

        {/* Embedding Model */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-fg/70">
            Embedding Model
          </label>
          <EmbeddingModelSelector
            selectedModel={form.embeddingModel}
            setSelectedModel={(m) => updateField('embeddingModel', m)}
          />
        </div>

        {/* Personas */}
        {personas.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-fg/70">
              Personas (optional)
            </label>
            <div className="flex flex-wrap gap-2">
              {personas.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    const ids = form.selectedSystemPromptIds.includes(p.id)
                      ? form.selectedSystemPromptIds.filter((id) => id !== p.id)
                      : [...form.selectedSystemPromptIds, p.id];
                    updateField('selectedSystemPromptIds', ids);
                  }}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition border ${
                    form.selectedSystemPromptIds.includes(p.id)
                      ? 'bg-accent/10 border-accent/30 text-accent'
                      : 'bg-surface border-surface-2 text-fg/60'
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Methodology */}
        {methodologies.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-fg/70">
              Methodology (optional)
            </label>
            <select
              value={form.selectedMethodologyId || ''}
              onChange={(e) =>
                updateField('selectedMethodologyId', e.target.value || null)
              }
              className="px-3 py-2 rounded-lg bg-surface border border-surface-2 text-fg focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="">None</option>
              {methodologies.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Enabled */}
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-fg/70">Enabled</label>
          <button
            type="button"
            onClick={() => updateField('enabled', !form.enabled)}
            className={`relative w-11 h-6 rounded-full transition ${
              form.enabled ? 'bg-accent' : 'bg-surface-2'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                form.enabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Submit */}
        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2 rounded-lg bg-accent text-white font-medium transition hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving...' : taskId ? 'Update Task' : 'Create Task'}
          </button>
          <Link
            href="/scheduled-tasks/manage"
            className="px-4 py-2 rounded-lg text-fg/60 hover:text-fg transition"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}

function EmbeddingModelSelector({
  selectedModel,
  setSelectedModel,
}: {
  selectedModel: { provider: string; name: string } | null;
  setSelectedModel: (m: { provider: string; name: string }) => void;
}) {
  const [models, setModels] = useState<
    { provider: string; name: string; displayName: string }[]
  >([]);

  useEffect(() => {
    fetch('/api/models')
      .then((r) => r.json())
      .then((data) => {
        const embeddingModels: {
          provider: string;
          name: string;
          displayName: string;
        }[] = [];
        if (data.embeddingModelProviders) {
          for (const [provider, models] of Object.entries(
            data.embeddingModelProviders as Record<
              string,
              Record<string, { displayName: string }>
            >,
          )) {
            for (const [name, info] of Object.entries(models)) {
              embeddingModels.push({
                provider,
                name,
                displayName: info.displayName || `${provider}/${name}`,
              });
            }
          }
        }
        setModels(embeddingModels);
        if (!selectedModel && embeddingModels.length > 0) {
          setSelectedModel({
            provider: embeddingModels[0].provider,
            name: embeddingModels[0].name,
          });
        }
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <select
      value={
        selectedModel ? `${selectedModel.provider}:${selectedModel.name}` : ''
      }
      onChange={(e) => {
        const [provider, name] = e.target.value.split(':');
        setSelectedModel({ provider, name });
      }}
      className="px-3 py-2 rounded-lg bg-surface border border-surface-2 text-fg focus:outline-none focus:ring-2 focus:ring-accent"
    >
      {models.map((m) => (
        <option
          key={`${m.provider}:${m.name}`}
          value={`${m.provider}:${m.name}`}
        >
          {m.displayName}
        </option>
      ))}
    </select>
  );
}
