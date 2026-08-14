'use client';

import { X, Save } from 'lucide-react';
import InputComponent from './InputComponent';
import TextareaComponent from './TextareaComponent';
import SettingToggleRow from '@/components/ui/SettingToggleRow';
import { Button } from '@/components/ui/Button';
import Select from '@/components/ui/Select';

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
        <label htmlFor="skill-scope" className="text-xs text-fg-muted">
          Scope:
        </label>
        <Select
          id="skill-scope"
          value={value.workspaceId ?? ''}
          onChange={(e) => patch({ workspaceId: e.target.value || null })}
        >
          <option value="">Global</option>
          {workspaces.map((ws) => (
            <option key={ws.id} value={ws.id}>
              {ws.name}
            </option>
          ))}
        </Select>
      </div>
      <SettingToggleRow
        label="Disable model auto-invocation"
        description="Slash-command only — hidden from model's available skills list"
        checked={value.disableModelInvocation}
        onChange={(val: boolean) => patch({ disableModelInvocation: val })}
      />
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
