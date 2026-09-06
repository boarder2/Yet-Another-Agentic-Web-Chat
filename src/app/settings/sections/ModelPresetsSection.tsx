'use client';

import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  Pencil,
  Plus,
  Trash2,
  Check,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useModels } from '@/lib/hooks/api/useModels';
import {
  useLocalStorageBoolean,
  useLocalStorageJSON,
} from '@/lib/hooks/useLocalStorage';
import {
  type ModelPreset,
  type ModelPresetList,
  type ModelSelection,
  createPreset,
  findMatchingPreset,
  applyPresetToStorage,
  captureCurrentSelection,
  isPresetAvailable,
  presetSummary,
  PRESET_MAX,
  PRESET_NAME_MAX,
  PRESETS_KEY,
  PREDEFINED_CONTEXT_SIZES,
  SELECTION_KEYS,
} from '@/lib/models/presets';
import SettingsSection from '../components/SettingsSection';
import ModelPicker from '@/components/models/ModelPicker';
import { Button } from '@/components/ui/Button';
import ConfirmModal from '@/components/ui/ConfirmModal';
import { Input } from '@/components/ui/Input';
import { IconButton } from '@/components/ui/IconButton';
import { ListEmptyState } from '@/components/ui/List';
import Badge from '@/components/ui/Badge';
import type { ReasoningEffort } from '@/lib/providers/reasoningEffort';

const EMPTY_PRESETS: ModelPresetList = [];

/** Convert a preset edit-state to the controlled `ModelPicker` value. */
function editToSelection(s: EditState): ModelSelection {
  return {
    chatProvider: s.chatProvider,
    chatModel: s.chatModel,
    systemProvider: s.systemProvider,
    systemModel: s.systemModel,
    imageCapable: s.imageCapable,
    contextWindowSize: s.contextWindowSize,
    ...(s.chatReasoningEffort
      ? { chatReasoningEffort: s.chatReasoningEffort }
      : {}),
    ...(s.systemReasoningEffort
      ? { systemReasoningEffort: s.systemReasoningEffort }
      : {}),
  };
}

interface ModelPresetsProps {
  selectedChatModelProvider: string | null;
  selectedChatModel: string | null;
  selectedSystemModelProvider: string | null;
  selectedSystemModel: string | null;
  selectedChatReasoningEffort?: ReasoningEffort;
  selectedSystemReasoningEffort?: ReasoningEffort;
  contextWindowSize: number;
  setSelectedChatModelProvider: (v: string | null) => void;
  setSelectedChatModel: (v: string | null) => void;
  setSelectedSystemModelProvider: (v: string | null) => void;
  setSelectedSystemModel: (v: string | null) => void;
  setSelectedChatReasoningEffort: (v: ReasoningEffort | undefined) => void;
  setSelectedSystemReasoningEffort: (v: ReasoningEffort | undefined) => void;
  setContextWindowSize: (v: number) => void;
  setIsCustomContextWindow: (v: boolean) => void;
}

type EditState = {
  id: string;
  name: string;
  chatProvider: string;
  chatModel: string;
  systemProvider: string;
  systemModel: string;
  imageCapable: boolean;
  contextWindowSize: number;
  chatReasoningEffort?: ReasoningEffort;
  systemReasoningEffort?: ReasoningEffort;
};

export default function ModelPresetsSection({
  selectedChatModelProvider,
  selectedChatModel,
  selectedSystemModelProvider,
  selectedSystemModel,
  selectedChatReasoningEffort,
  selectedSystemReasoningEffort,
  contextWindowSize,
  setSelectedChatModelProvider,
  setSelectedChatModel,
  setSelectedSystemModelProvider,
  setSelectedSystemModel,
  setSelectedChatReasoningEffort,
  setSelectedSystemReasoningEffort,
  setContextWindowSize,
  setIsCustomContextWindow,
}: ModelPresetsProps) {
  const [imageCapable] = useLocalStorageBoolean(
    SELECTION_KEYS.imageCapable,
    false,
  );
  const [presets, setPresetsState] = useLocalStorageJSON<ModelPresetList>(
    PRESETS_KEY,
    EMPTY_PRESETS,
  );
  const { data: modelsData } = useModels();
  const chatProviders = modelsData?.chatModelProviders as
    Record<string, Record<string, { displayName: string }>> | undefined;

  const [addingNew, setAddingNew] = useState(false);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ModelPreset | null>(null);
  const [savingCurrentName, setSavingCurrentName] = useState(false);
  const [currentNameInput, setCurrentNameInput] = useState('');

  // Build active selection from settings state (live, for matching indicator)
  const activeSelection = {
    chatProvider: selectedChatModelProvider ?? '',
    chatModel: selectedChatModel ?? '',
    systemProvider: selectedSystemModelProvider ?? '',
    systemModel: selectedSystemModel ?? '',
    imageCapable,
    contextWindowSize,
    ...(selectedChatReasoningEffort
      ? { chatReasoningEffort: selectedChatReasoningEffort }
      : {}),
    ...(selectedSystemReasoningEffort
      ? { systemReasoningEffort: selectedSystemReasoningEffort }
      : {}),
  };
  const matchingPreset = findMatchingPreset(presets, activeSelection);

  const updatePresets = (updated: ModelPresetList) => {
    setPresetsState(updated);
  };

  const handleApply = (preset: ModelPreset) => {
    // Settings-side apply: reflect the preset in local display state, then write
    // it to the (DB-backed) localStorage selection via applyPresetToStorage.
    setSelectedChatModelProvider(preset.chatProvider);
    setSelectedChatModel(preset.chatModel);
    setSelectedSystemModelProvider(preset.systemProvider);
    setSelectedSystemModel(preset.systemModel);
    setSelectedChatReasoningEffort(preset.chatReasoningEffort);
    setSelectedSystemReasoningEffort(preset.systemReasoningEffort);
    setContextWindowSize(preset.contextWindowSize);
    setIsCustomContextWindow(
      !PREDEFINED_CONTEXT_SIZES.includes(preset.contextWindowSize),
    );
    // The chat + system model and context window are localStorage-only (the chat
    // picker's selection, DB-backed); applyPresetToStorage writes them. They are
    // NOT config.toml settings, so don't route them through saveConfig — doing so
    // previously clobbered the independent memory-processing model in config.toml.
    applyPresetToStorage(preset);

    toast.success(`Applied preset "${preset.name}"`);
  };

  const handleDelete = (id: string) => {
    updatePresets(presets.filter((p) => p.id !== id));
    setDeleteTarget(null);
    toast.success('Preset deleted');
  };

  const handleDuplicate = (preset: ModelPreset) => {
    if (presets.length >= PRESET_MAX) {
      toast.error(`You can have at most ${PRESET_MAX} presets`);
      return;
    }
    const copy = createPreset({
      ...preset,
      name: `${preset.name} (copy)`.slice(0, PRESET_NAME_MAX),
    });
    updatePresets([...presets, copy]);
    toast.success('Preset duplicated');
  };

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    const updated = [...presets];
    [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
    updatePresets(updated);
  };

  const handleMoveDown = (index: number) => {
    if (index === presets.length - 1) return;
    const updated = [...presets];
    [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
    updatePresets(updated);
  };

  const handleSaveCurrentAsPreset = () => {
    const trimmed = currentNameInput.trim().slice(0, PRESET_NAME_MAX);
    if (!trimmed) {
      toast.error('Preset name cannot be empty');
      return;
    }
    if (presets.length >= PRESET_MAX) {
      toast.error(`You can have at most ${PRESET_MAX} presets`);
      return;
    }
    const sel = captureCurrentSelection();
    // Use settings state for better accuracy if available
    const preset = createPreset({
      name: trimmed,
      chatProvider: selectedChatModelProvider ?? sel.chatProvider,
      chatModel: selectedChatModel ?? sel.chatModel,
      systemProvider: selectedSystemModelProvider ?? sel.systemProvider,
      systemModel: selectedSystemModel ?? sel.systemModel,
      imageCapable: sel.imageCapable,
      contextWindowSize,
      ...((sel.chatReasoningEffort ?? selectedChatReasoningEffort)
        ? {
            chatReasoningEffort:
              sel.chatReasoningEffort ?? selectedChatReasoningEffort,
          }
        : {}),
      ...((sel.systemReasoningEffort ?? selectedSystemReasoningEffort)
        ? {
            systemReasoningEffort:
              sel.systemReasoningEffort ?? selectedSystemReasoningEffort,
          }
        : {}),
    });
    updatePresets([...presets, preset]);
    setCurrentNameInput('');
    setSavingCurrentName(false);
    toast.success(`Preset "${trimmed}" saved`);
  };

  const handleSaveEdit = () => {
    if (!editState) return;
    const trimmed = editState.name.trim().slice(0, PRESET_NAME_MAX);
    if (!trimmed) {
      toast.error('Preset name cannot be empty');
      return;
    }
    if (!editState.chatModel) {
      toast.error('Select a chat model');
      return;
    }
    if (!editState.systemModel) {
      toast.error('Select a system model');
      return;
    }
    updatePresets(
      presets.map((p) =>
        p.id === editState.id
          ? {
              ...p,
              name: trimmed,
              chatProvider: editState.chatProvider,
              chatModel: editState.chatModel,
              systemProvider: editState.systemProvider,
              systemModel: editState.systemModel,
              imageCapable: editState.imageCapable,
              contextWindowSize: Math.max(512, editState.contextWindowSize),
              // Explicitly replace these optional fields so clearing an old
              // preset's effort does not retain the value from `p`.
              chatReasoningEffort: editState.chatReasoningEffort,
              systemReasoningEffort: editState.systemReasoningEffort,
            }
          : p,
      ),
    );
    setEditState(null);
    toast.success('Preset updated');
  };

  const startEdit = (preset: ModelPreset) => {
    setEditState({
      id: preset.id,
      name: preset.name,
      chatProvider: preset.chatProvider,
      chatModel: preset.chatModel,
      systemProvider: preset.systemProvider,
      systemModel: preset.systemModel,
      imageCapable: preset.imageCapable,
      contextWindowSize: preset.contextWindowSize,
      ...(preset.chatReasoningEffort
        ? { chatReasoningEffort: preset.chatReasoningEffort }
        : {}),
      ...(preset.systemReasoningEffort
        ? { systemReasoningEffort: preset.systemReasoningEffort }
        : {}),
    });
    setAddingNew(false);
    setDeleteTarget(null);
  };

  return (
    <SettingsSection
      title="Model Presets"
      headerAction={
        <span className="text-xs text-fg-subtle">
          {presets.length}/{PRESET_MAX}
        </span>
      }
    >
      <p className="text-xs text-fg-muted">
        Save named combinations of chat model, system model, vision, and context
        window. Switch between them from the chat input or here.
      </p>

      {/* Save current selection shortcut */}
      <div className="flex items-center gap-2 p-3 bg-bg rounded-surface border border-surface-2">
        {savingCurrentName ? (
          <div className="flex items-center gap-2 w-full">
            <Input
              autoFocus
              type="text"
              aria-label="Preset name"
              maxLength={PRESET_NAME_MAX}
              placeholder="Preset name…"
              value={currentNameInput}
              onChange={(e) => setCurrentNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveCurrentAsPreset();
                if (e.key === 'Escape') {
                  setSavingCurrentName(false);
                  setCurrentNameInput('');
                }
              }}
              className="flex-1 text-xs px-2 py-1.5"
            />
            <Button
              variant="primary"
              size="sm"
              icon={Check}
              onClick={handleSaveCurrentAsPreset}
            >
              Save
            </Button>
            <Button
              size="sm"
              icon={X}
              aria-label="Cancel"
              onClick={() => {
                setSavingCurrentName(false);
                setCurrentNameInput('');
              }}
            />
          </div>
        ) : (
          <>
            <p className="flex-1 text-xs text-fg-muted">
              Current:{' '}
              <span className="font-medium text-fg-muted">
                {matchingPreset ? matchingPreset.name : 'Custom'}
              </span>
            </p>
            <Button
              size="sm"
              icon={Plus}
              disabled={!selectedChatModel}
              onClick={() => {
                setSavingCurrentName(true);
                setAddingNew(false);
                setEditState(null);
                setDeleteTarget(null);
              }}
              title={
                selectedChatModel
                  ? 'Save current selection as a new preset'
                  : 'Select a chat model first'
              }
            >
              Save current as preset
            </Button>
          </>
        )}
      </div>

      {/* Preset list */}
      {presets.length === 0 && !addingNew ? (
        <ListEmptyState
          layout="compact"
          body="No presets yet. Save the current selection or create one below."
        />
      ) : (
        <div className="flex flex-col gap-2">
          {presets.map((preset, idx) => {
            const isActive = matchingPreset?.id === preset.id;
            const available = isPresetAvailable(preset, chatProviders);
            const isEditing = editState?.id === preset.id;

            return (
              <div
                key={preset.id}
                className={cn(
                  'rounded-surface border p-3 transition-colors duration-150',
                  isActive
                    ? 'border-accent bg-surface-2'
                    : 'border-surface-2 bg-surface',
                )}
              >
                {isEditing ? (
                  <div className="flex flex-col gap-3">
                    <Input
                      autoFocus
                      type="text"
                      aria-label="Preset name"
                      maxLength={PRESET_NAME_MAX}
                      value={editState.name}
                      onChange={(e) =>
                        setEditState((s) => s && { ...s, name: e.target.value })
                      }
                      className="px-2 py-1.5"
                      placeholder="Preset name"
                    />
                    <ModelPicker
                      value={editToSelection(editState)}
                      onChange={(next) =>
                        setEditState((s) =>
                          s
                            ? {
                                ...s,
                                chatProvider: next.chatProvider,
                                chatModel: next.chatModel,
                                systemProvider: next.systemProvider,
                                systemModel: next.systemModel,
                                imageCapable: next.imageCapable ?? false,
                                contextWindowSize:
                                  next.contextWindowSize ?? s.contextWindowSize,
                                chatReasoningEffort: next.chatReasoningEffort,
                                systemReasoningEffort:
                                  next.systemReasoningEffort,
                              }
                            : s,
                        )
                      }
                      fields={{
                        system: true,
                        vision: true,
                        contextWindow: true,
                      }}
                      showStoredEffortState
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        icon={Check}
                        onClick={handleSaveEdit}
                      >
                        Save
                      </Button>
                      <Button size="sm" onClick={() => setEditState(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2">
                    {/* Reorder buttons */}
                    <div className="flex flex-col gap-0.5 shrink-0 pt-0.5">
                      <IconButton
                        icon={ChevronUp}
                        label="Move preset up"
                        disabled={idx === 0}
                        onClick={() => handleMoveUp(idx)}
                        className="p-0.5"
                      />
                      <IconButton
                        icon={ChevronDown}
                        label="Move preset down"
                        disabled={idx === presets.length - 1}
                        onClick={() => handleMoveDown(idx)}
                        className="p-0.5"
                      />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-medium text-fg">
                          {preset.name}
                        </span>
                        {isActive && (
                          <Badge tone="accent">
                            <Check size={10} />
                            active
                          </Badge>
                        )}
                        {!available && (
                          <Badge tone="warning">
                            <AlertTriangle size={10} />
                            model unavailable
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1 mt-0.5">
                        <p className="text-xs text-fg-subtle truncate">
                          {presetSummary(preset)}
                        </p>
                        {preset.imageCapable && (
                          <Eye size={10} className="text-fg-subtle shrink-0" />
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="sm"
                        onClick={() => handleApply(preset)}
                        disabled={isActive}
                        aria-label="Apply preset"
                      >
                        Apply
                      </Button>
                      <IconButton
                        icon={Pencil}
                        label="Edit preset"
                        onClick={() => startEdit(preset)}
                        className="p-1.5"
                      />
                      <IconButton
                        icon={Copy}
                        label="Duplicate preset"
                        onClick={() => handleDuplicate(preset)}
                        className="p-1.5"
                      />
                      <IconButton
                        icon={Trash2}
                        label="Delete preset"
                        tone="danger"
                        onClick={() => setDeleteTarget(preset)}
                        className="p-1.5"
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* New preset form */}
      {addingNew ? (
        <div className="border border-surface-2 rounded-surface p-3 flex flex-col gap-3 bg-bg">
          <p className="text-xs font-medium text-fg-muted">New Preset</p>
          <Input
            autoFocus
            type="text"
            aria-label="New preset name"
            maxLength={PRESET_NAME_MAX}
            placeholder="Preset name"
            value={editState?.name ?? ''}
            onChange={(e) =>
              setEditState((s) =>
                s
                  ? { ...s, name: e.target.value }
                  : {
                      id: '',
                      name: e.target.value,
                      chatProvider: selectedChatModelProvider ?? '',
                      chatModel: selectedChatModel ?? '',
                      systemProvider: selectedSystemModelProvider ?? '',
                      systemModel: selectedSystemModel ?? '',
                      imageCapable: false,
                      contextWindowSize: contextWindowSize,
                      ...(selectedChatReasoningEffort
                        ? { chatReasoningEffort: selectedChatReasoningEffort }
                        : {}),
                      ...(selectedSystemReasoningEffort
                        ? {
                            systemReasoningEffort:
                              selectedSystemReasoningEffort,
                          }
                        : {}),
                    },
              )
            }
            className="px-2 py-1.5"
          />
          {editState && (
            <ModelPicker
              value={editToSelection(editState)}
              onChange={(next) =>
                setEditState((s) =>
                  s
                    ? {
                        ...s,
                        chatProvider: next.chatProvider,
                        chatModel: next.chatModel,
                        systemProvider: next.systemProvider,
                        systemModel: next.systemModel,
                        imageCapable: next.imageCapable ?? false,
                        contextWindowSize:
                          next.contextWindowSize ?? s.contextWindowSize,
                        chatReasoningEffort: next.chatReasoningEffort,
                        systemReasoningEffort: next.systemReasoningEffort,
                      }
                    : s,
                )
              }
              fields={{ system: true, vision: true, contextWindow: true }}
              showStoredEffortState
            />
          )}
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              icon={Check}
              disabled={
                !editState?.name?.trim() ||
                !editState?.chatModel ||
                !editState?.systemModel
              }
              onClick={() => {
                if (
                  !editState ||
                  !editState.name.trim() ||
                  !editState.chatModel ||
                  !editState.systemModel
                )
                  return;
                if (presets.length >= PRESET_MAX) {
                  toast.error(`You can have at most ${PRESET_MAX} presets`);
                  return;
                }
                const preset = createPreset({
                  name: editState.name.trim().slice(0, PRESET_NAME_MAX),
                  chatProvider: editState.chatProvider,
                  chatModel: editState.chatModel,
                  systemProvider: editState.systemProvider,
                  systemModel: editState.systemModel,
                  imageCapable: editState.imageCapable,
                  contextWindowSize: Math.max(512, editState.contextWindowSize),
                  ...(editState.chatReasoningEffort
                    ? { chatReasoningEffort: editState.chatReasoningEffort }
                    : {}),
                  ...(editState.systemReasoningEffort
                    ? { systemReasoningEffort: editState.systemReasoningEffort }
                    : {}),
                });
                updatePresets([...presets, preset]);
                setAddingNew(false);
                setEditState(null);
                toast.success(`Preset "${preset.name}" created`);
              }}
            >
              Create preset
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setAddingNew(false);
                setEditState(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          icon={Plus}
          disabled={presets.length >= PRESET_MAX}
          onClick={() => {
            setAddingNew(true);
            setSavingCurrentName(false);
            setDeleteTarget(null);
            setEditState({
              id: '',
              name: '',
              chatProvider: selectedChatModelProvider ?? '',
              chatModel: selectedChatModel ?? '',
              systemProvider: selectedSystemModelProvider ?? '',
              systemModel: selectedSystemModel ?? '',
              imageCapable: false,
              contextWindowSize: contextWindowSize,
              ...(selectedChatReasoningEffort
                ? { chatReasoningEffort: selectedChatReasoningEffort }
                : {}),
              ...(selectedSystemReasoningEffort
                ? { systemReasoningEffort: selectedSystemReasoningEffort }
                : {}),
            });
          }}
          className="w-full border-dashed border-surface-2"
        >
          New preset from scratch
        </Button>
      )}

      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete preset"
        body={
          <p>
            Delete <span className="font-medium">{deleteTarget?.name}</span>?
            This cannot be undone.
          </p>
        }
        onConfirm={() => {
          if (deleteTarget) handleDelete(deleteTarget.id);
        }}
      />
    </SettingsSection>
  );
}
