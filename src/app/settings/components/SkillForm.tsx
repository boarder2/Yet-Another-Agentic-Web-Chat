'use client';

import { X, Save } from 'lucide-react';
import InputComponent from './InputComponent';
import TextareaComponent from './TextareaComponent';
import AppSwitch from '@/components/ui/AppSwitch';
import { Button } from '@/components/ui/Button';

export type SkillFormValue = {
  name: string;
  description: string;
  content: string;
  workspaceId: string | null;
  disableModelInvocation: boolean;
};

export default function SkillForm({
  title,
  value,
  workspaces,
  submitLabel,
  pending,
  onChange,
  onSubmit,
  onCancel,
}: {
  title: string;
  value: SkillFormValue;
  workspaces: { id: string; name: string }[];
  submitLabel: string;
  pending?: boolean;
  onChange: (value: SkillFormValue) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const patch = (fields: Partial<SkillFormValue>) =>
    onChange({ ...value, ...fields });

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">{title}</p>
      <InputComponent
        type="text"
        aria-label="Skill name"
        value={value.name}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          patch({ name: e.target.value })
        }
        placeholder="skill-name (lowercase, hyphens ok)"
      />
      <InputComponent
        type="text"
        aria-label="Skill description"
        value={value.description}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          patch({ description: e.target.value })
        }
        placeholder="One-line description shown in autocomplete"
      />
      <TextareaComponent
        aria-label="Skill content"
        value={value.content}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
          patch({ content: e.target.value })
        }
        placeholder="Full skill body (markdown supported)"
      />
      <div className="flex items-center gap-2">
        <label htmlFor="skill-scope" className="text-xs text-fg/60">
          Scope:
        </label>
        <select
          id="skill-scope"
          value={value.workspaceId ?? ''}
          onChange={(e) => patch({ workspaceId: e.target.value || null })}
          className="text-sm bg-surface border border-surface-2 rounded-control px-2 py-1 focus:outline-none focus:border-accent"
        >
          <option value="">Global</option>
          {workspaces.map((ws) => (
            <option key={ws.id} value={ws.id}>
              {ws.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium">Disable model auto-invocation</p>
          <p className="text-xs text-fg/50">
            Slash-command only — hidden from model&apos;s available skills list
          </p>
        </div>
        <AppSwitch
          checked={value.disableModelInvocation}
          onChange={(val: boolean) => patch({ disableModelInvocation: val })}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button icon={X} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          icon={Save}
          onClick={onSubmit}
          disabled={pending}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
