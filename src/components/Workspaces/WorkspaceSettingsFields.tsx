'use client';

import { Description, Field, Label } from '@headlessui/react';
import AppSwitch from '@/components/ui/AppSwitch';
import SettingToggleRow from '@/components/ui/SettingToggleRow';
import { Field as FormField } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import AppearancePicker from './AppearancePicker';
import ModelPicker from '@/components/models/ModelPicker';
import type { WorkspaceModelOverride } from '@/lib/workspaces/types';

interface WorkspaceSettingsFieldsProps {
  name: string;
  onNameChange: (value: string) => void;
  onNameBlur?: () => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  onDescriptionBlur?: () => void;
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
  onNameBlur,
  description,
  onDescriptionChange,
  onDescriptionBlur,
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

  return (
    <>
      {isSettings ? (
        <FormField label="Name">
          <Input
            type="text"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            onBlur={onNameBlur}
          />
        </FormField>
      ) : (
        <Input
          type="text"
          aria-label="Workspace name"
          placeholder="Workspace name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          onBlur={onNameBlur}
          autoFocus={autoFocusName}
        />
      )}

      {isSettings ? (
        <FormField label="Description">
          <Textarea
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            onBlur={onDescriptionBlur}
            rows={3}
            className="resize-none"
          />
        </FormField>
      ) : (
        <Textarea
          aria-label="Workspace description"
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          onBlur={onDescriptionBlur}
          rows={2}
          className="resize-none"
        />
      )}

      {isSettings ? (
        <div className="space-y-2">
          <label className="text-xs text-fg-muted">Appearance</label>
          <AppearancePicker
            color={color}
            icon={icon}
            onChange={onAppearanceChange}
          />
        </div>
      ) : (
        <div>
          <label className="text-xs text-fg-muted">Appearance</label>
          <div className="mt-1">
            <AppearancePicker
              color={color}
              icon={icon}
              onChange={onAppearanceChange}
            />
          </div>
        </div>
      )}

      <SettingToggleRow
        label="Auto-memory"
        description="Automatically extract memories from chats in this workspace"
        checked={autoMemory}
        onChange={onAutoMemoryChange}
      />

      <SettingToggleRow
        label="Auto-accept file edits"
        description="When on, the agent can edit and create files in this workspace without asking. Per-file overrides still apply."
        checked={autoAcceptFileEdits}
        onChange={onAutoAcceptFileEditsChange}
      />
    </>
  );
}

export function WorkspaceModelOverrideField({
  useCustomModels,
  onUseCustomModelsChange,
  modelOverride,
  onModelOverrideChange,
}: {
  useCustomModels: boolean;
  onUseCustomModelsChange: (enabled: boolean) => void;
  modelOverride: WorkspaceModelOverride | null;
  onModelOverrideChange: (next: WorkspaceModelOverride) => void;
}) {
  return (
    <>
      <Field className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium">
            Use custom models for this workspace
          </Label>
          <Description className="text-xs text-fg-muted">
            Pin a chat and system model for every chat in this workspace,
            overriding the global selection.
          </Description>
        </div>
        <AppSwitch
          checked={useCustomModels}
          onChange={onUseCustomModelsChange}
        />
      </Field>

      {useCustomModels && modelOverride && (
        <ModelPicker
          value={modelOverride}
          onChange={onModelOverrideChange}
          fields={{ system: true, vision: true, contextWindow: true }}
          presets="none"
          layout="inline"
          showStoredEffortState
        />
      )}
    </>
  );
}
