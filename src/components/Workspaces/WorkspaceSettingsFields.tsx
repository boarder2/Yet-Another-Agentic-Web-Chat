'use client';

import { cn } from '@/lib/utils';
import { Description, Field, Label } from '@headlessui/react';
import AppSwitch from '@/components/ui/AppSwitch';
import AppearancePicker from './AppearancePicker';

interface WorkspaceSettingsFieldsProps {
  name: string;
  onNameChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  color: string | null;
  icon: string | null;
  onAppearanceChange: (next: {
    color: string | null;
    icon: string | null;
  }) => void;
  autoMemory: boolean;
  onAutoMemoryChange: (enabled: boolean) => void;
  autoAcceptFileEdits: boolean;
  onAutoAcceptFileEditsChange: (enabled: boolean) => void;
  autoFocusName?: boolean;
  variant?: 'modal' | 'settings';
}

export default function WorkspaceSettingsFields({
  name,
  onNameChange,
  description,
  onDescriptionChange,
  color,
  icon,
  onAppearanceChange,
  autoMemory,
  onAutoMemoryChange,
  autoAcceptFileEdits,
  onAutoAcceptFileEditsChange,
  autoFocusName,
  variant = 'modal',
}: WorkspaceSettingsFieldsProps) {
  const isSettings = variant === 'settings';
  const inputClass = cn(
    'px-3 py-2 text-sm rounded-surface border border-surface-2 focus:outline-none focus:border-accent',
    isSettings ? 'w-full bg-surface' : 'bg-bg',
  );

  return (
    <>
      {isSettings ? (
        <div className="space-y-2">
          <label className="text-xs text-fg/60">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            className={inputClass}
          />
        </div>
      ) : (
        <input
          type="text"
          placeholder="Workspace name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          className={inputClass}
          autoFocus={autoFocusName}
        />
      )}

      {isSettings ? (
        <div className="space-y-2">
          <label className="text-xs text-fg/60">Description</label>
          <textarea
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            rows={3}
            className={cn(inputClass, 'resize-none')}
          />
        </div>
      ) : (
        <textarea
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          rows={2}
          className={cn(inputClass, 'resize-none')}
        />
      )}

      {isSettings ? (
        <div className="space-y-2">
          <label className="text-xs text-fg/60">Appearance</label>
          <AppearancePicker
            color={color}
            icon={icon}
            onChange={onAppearanceChange}
          />
        </div>
      ) : (
        <div>
          <label className="text-xs text-fg/60">Appearance</label>
          <div className="mt-1">
            <AppearancePicker
              color={color}
              icon={icon}
              onChange={onAppearanceChange}
            />
          </div>
        </div>
      )}

      <Field className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium">Auto-memory</Label>
          <Description className="text-xs text-fg/60">
            Automatically extract memories from chats in this workspace
          </Description>
        </div>
        <AppSwitch checked={autoMemory} onChange={onAutoMemoryChange} />
      </Field>

      <Field className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium">Auto-accept file edits</Label>
          <Description className="text-xs text-fg/60">
            When on, the agent can edit and create files in this workspace
            without asking. Per-file overrides still apply.
          </Description>
        </div>
        <AppSwitch
          checked={autoAcceptFileEdits}
          onChange={onAutoAcceptFileEditsChange}
        />
      </Field>
    </>
  );
}
