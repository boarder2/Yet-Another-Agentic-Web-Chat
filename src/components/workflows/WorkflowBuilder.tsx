'use client';

import { focusModes } from '@/lib/focusModes';
import ModelPicker from '@/components/models/ModelPicker';
import type { ModelSelection } from '@/lib/models/presets';
import FillForm from '@/components/workflows/FillForm';
import PromptSyntaxHelp from '@/components/workflows/PromptSyntaxHelp';
import IconAutocomplete from '@/components/IconAutocomplete';
import {
  useCreateWorkflow,
  usePatchWorkflow,
  type Workflow,
  type WorkflowInput,
} from '@/lib/hooks/api/useWorkflows';
import { useSystemPrompts } from '@/lib/hooks/api/useSystemPrompts';
import { parseWorkflowTemplate } from '@/lib/workflows/template';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Button, buttonClasses } from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import { cn } from '@/lib/utils';
import { ArrowLeft, Workflow as WorkflowIcon } from 'lucide-react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

// CodeMirror touches window/document at module load, so load it client-only.
const PromptEditor = dynamic(
  () => import('@/components/workflows/PromptEditor'),
  { ssr: false },
);

export default function WorkflowBuilder({ workflow }: { workflow?: Workflow }) {
  const router = useRouter();
  const create = useCreateWorkflow();
  const patch = usePatchWorkflow();
  const { data: systemPrompts = [] } = useSystemPrompts();
  const [error, setError] = useState('');

  const [name, setName] = useState(workflow?.name ?? '');
  const [description, setDescription] = useState(workflow?.description ?? '');
  const [icon, setIcon] = useState(workflow?.icon ?? '');
  const [prompt, setPrompt] = useState(workflow?.prompt ?? '');
  const [focusMode, setFocusMode] = useState(
    workflow?.focusMode ?? 'webSearch',
  );
  const [chatModel, setChatModel] = useState(workflow?.chatModel ?? null);
  const [systemModel, setSystemModel] = useState(workflow?.systemModel ?? null);
  const [selectedSystemPromptIds, setSelectedSystemPromptIds] = useState<
    string[]
  >(workflow?.selectedSystemPromptIds ?? []);
  const [selectedMethodologyId, setSelectedMethodologyId] = useState<
    string | null
  >(workflow?.selectedMethodologyId ?? null);

  const parse = useMemo(() => parseWorkflowTemplate(prompt), [prompt]);
  const hasErrors = parse.errors.length > 0;

  const modelValue: ModelSelection = {
    chatProvider: chatModel?.provider ?? '',
    chatModel: chatModel?.name ?? '',
    systemProvider: systemModel?.provider ?? chatModel?.provider ?? '',
    systemModel: systemModel?.name ?? chatModel?.name ?? '',
  };

  const handleModelChange = (next: ModelSelection) => {
    setChatModel(
      next.chatProvider && next.chatModel
        ? { provider: next.chatProvider, name: next.chatModel }
        : null,
    );
    setSystemModel(
      next.systemProvider && next.systemModel
        ? { provider: next.systemProvider, name: next.systemModel }
        : null,
    );
  };

  const personas = systemPrompts.filter((p) => p.type === 'persona');
  const methodologies = systemPrompts.filter((p) => p.type === 'methodology');
  const saving = create.isPending || patch.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!chatModel) return setError('Please select a chat model');
    if (hasErrors) return setError('Fix the prompt errors before saving');

    const data: WorkflowInput = {
      name,
      description: description || null,
      icon: icon || null,
      prompt,
      focusMode,
      chatModel,
      systemModel,
      selectedSystemPromptIds,
      selectedMethodologyId,
    };

    try {
      if (workflow) await patch.mutateAsync({ id: workflow.id, data });
      else await create.mutateAsync(data);
      router.push('/automations');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save workflow');
    }
  };

  return (
    <div className="flex flex-col pt-4 max-w-7xl">
      <div className="flex items-center gap-3 px-1 mb-6">
        <Link
          href="/automations"
          className="text-fg/60 hover:text-fg transition-colors duration-150"
        >
          <ArrowLeft size={20} />
        </Link>
        <WorkflowIcon className="text-accent" />
        <h2 className="text-2xl font-medium">
          {workflow ? 'Edit Workflow' : 'New Workflow'}
        </h2>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4">
          <Field label="Name">
            <Input
              type="text"
              aria-label="Workflow name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Competitor Report"
              required
            />
          </Field>
          <Field label="Icon (lucide name)" className="sm:w-52">
            <IconAutocomplete
              value={icon}
              onChange={setIcon}
              ariaLabel="Workflow icon"
              placeholder="bar-chart"
            />
          </Field>
        </div>

        <Field label="Description">
          <Input
            type="text"
            aria-label="Workflow description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Shown on the workflow card"
          />
        </Field>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5 lg:items-start">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-fg/70">
                Prompt
                <span className="ml-2 text-xs font-normal text-fg/40">
                  Define inputs in frontmatter, reference with {'{{name}}'}
                </span>
              </label>
              <PromptEditor
                value={prompt}
                onChange={setPrompt}
                minHeight="60vh"
              />
              <PromptSyntaxHelp />
              {(hasErrors || parse.warnings.length > 0) && (
                <ul className="flex flex-col gap-1 mt-1">
                  {parse.errors.map((err, i) => (
                    <li key={`e${i}`} className="text-xs text-danger">
                      {err.message}
                    </li>
                  ))}
                  {parse.warnings.map((warn, i) => (
                    <li key={`w${i}`} className="text-xs text-fg/50">
                      {warn.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-fg/70">
                Fill-form preview
              </label>
              <div className="rounded-surface border border-surface-2 bg-surface/50 p-4">
                {hasErrors ? (
                  <p className="text-sm text-fg/50">
                    Resolve the prompt errors to preview the inputs.
                  </p>
                ) : (
                  <FillForm
                    key={prompt}
                    prompt={prompt}
                    hideSubmit
                    onSubmit={() => {}}
                  />
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-5 lg:sticky lg:top-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-fg/70">
                Focus Mode
              </label>
              <Select
                value={focusMode}
                onChange={(e) => setFocusMode(e.target.value)}
              >
                {focusModes.map((mode) => (
                  <option key={mode.key} value={mode.key}>
                    {mode.title} — {mode.description}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-fg/70">Models</label>
              <ModelPicker
                value={modelValue}
                onChange={handleModelChange}
                fields={{ system: true }}
                presets="apply-save"
              />
            </div>

            {personas.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-fg/70">
                  Personas (optional)
                </label>
                <div className="flex flex-wrap gap-2">
                  {personas.map((p) => {
                    const on = selectedSystemPromptIds.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() =>
                          setSelectedSystemPromptIds((ids) =>
                            on
                              ? ids.filter((id) => id !== p.id)
                              : [...ids, p.id],
                          )
                        }
                        className={`px-3 py-1 rounded-pill text-xs font-medium transition-colors duration-150 border ${
                          on
                            ? 'bg-accent/10 border-accent text-accent'
                            : 'bg-surface border-surface-2 text-fg/60'
                        }`}
                      >
                        {p.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {methodologies.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-fg/70">
                  Methodology (optional)
                </label>
                <Select
                  value={selectedMethodologyId || ''}
                  onChange={(e) =>
                    setSelectedMethodologyId(e.target.value || null)
                  }
                >
                  <option value="">None</option>
                  {methodologies.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>
        </div>

        <div className="sticky bottom-0 flex flex-col gap-3 bg-bg border-t border-surface-2 py-4">
          {error && (
            <div className="px-4 py-2 rounded-surface bg-danger-soft border border-danger text-danger text-sm">
              {error}
            </div>
          )}
          <div className="flex items-center gap-3">
            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={saving}
              disabled={hasErrors}
            >
              {saving
                ? 'Saving…'
                : workflow
                  ? 'Update Workflow'
                  : 'Create Workflow'}
            </Button>
            <Link
              href="/automations"
              className={cn(buttonClasses('ghost', 'md'), 'text-fg/60')}
            >
              Cancel
            </Link>
          </div>
        </div>
      </form>
    </div>
  );
}
