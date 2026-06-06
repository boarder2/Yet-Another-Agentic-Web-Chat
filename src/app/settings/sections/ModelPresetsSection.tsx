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

const EMPTY_PRESETS: ModelPresetList = [];

/** Convert a preset edit-state to the controlled `ModelPicker` value. */
function editToSelection(s: EditState): ModelSelection {
  const linked =
    s.chatProvider === s.systemProvider && s.chatModel === s.systemModel;
  return {
    chatProvider: s.chatProvider,
    chatModel: s.chatModel,
    systemProvider: s.systemProvider,
    systemModel: s.systemModel,
    linkSystemToChat: linked,
    imageCapable: s.imageCapable,
    contextWindowSize: s.contextWindowSize,
  };
}

interface ModelPresetsProps {
  selectedChatModelProvider: string | null;
  selectedChatModel: string | null;
  selectedSystemModelProvider: string | null;
  selectedSystemModel: string | null;
  contextWindowSize: number;
  saveConfig: (
    key: string,
    value: string | string[] | number | boolean,
  ) => void;
  setSelectedChatModelProvider: (v: string | null) => void;
  setSelectedChatModel: (v: string | null) => void;
  setSelectedSystemModelProvider: (v: string | null) => void;
  setSelectedSystemModel: (v: string | null) => void;
  setContextWindowSize: (v: number) => void;
  setIsCustomContextWindow: (v: boolean) => void;
  setLinkSystemToChat: (v: boolean) => void;
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
};

export default function ModelPresetsSection({
  selectedChatModelProvider,
  selectedChatModel,
  selectedSystemModelProvider,
  selectedSystemModel,
  contextWindowSize,
  saveConfig,
  setSelectedChatModelProvider,
  setSelectedChatModel,
  setSelectedSystemModelProvider,
  setSelectedSystemModel,
  setContextWindowSize,
  setIsCustomContextWindow,
  setLinkSystemToChat,
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
  const chatProviders = (modelsData?.chatModelProviders ?? {}) as Record<
    string,
    Record<string, { displayName: string }>
  >;

  const [addingNew, setAddingNew] = useState(false);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
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
  };
  const matchingPreset = findMatchingPreset(presets, activeSelection);

  const updatePresets = (updated: ModelPresetList) => {
    setPresetsState(updated);
  };

  const handleApply = (preset: ModelPreset) => {
    // Settings-side apply: update settings state + saveConfig (like changing selectors manually)
    setSelectedChatModelProvider(preset.chatProvider);
    setSelectedChatModel(preset.chatModel);
    setSelectedSystemModelProvider(preset.systemProvider);
    setSelectedSystemModel(preset.systemModel);
    setContextWindowSize(preset.contextWindowSize);
    setIsCustomContextWindow(
      !PREDEFINED_CONTEXT_SIZES.includes(preset.contextWindowSize),
    );
    const linked =
      preset.chatProvider === preset.systemProvider &&
      preset.chatModel === preset.systemModel;
    setLinkSystemToChat(linked);

    saveConfig('chatModelProvider', preset.chatProvider);
    saveConfig('chatModel', preset.chatModel);
    saveConfig('systemModelProvider', preset.systemProvider);
    saveConfig('systemModel', preset.systemModel);
    saveConfig('contextWindowSize', preset.contextWindowSize);
    saveConfig('linkSystemToChat', linked);

    // Also write to localStorage via writeLocalStorage so dialog reflects it
    applyPresetToStorage(preset);

    toast.success(`Applied preset "${preset.name}"`);
  };

  const handleDelete = (id: string) => {
    updatePresets(presets.filter((p) => p.id !== id));
    setDeletingId(null);
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
    });
    setAddingNew(false);
    setDeletingId(null);
  };

  return (
    <SettingsSection
      title="Model Presets"
      headerAction={
        <span className="text-xs text-fg/50">
          {presets.length}/{PRESET_MAX}
        </span>
      }
    >
      <p className="text-xs text-fg/60">
        Save named combinations of chat model, system model, vision, and context
        window. Switch between them from the chat input or here.
      </p>

      {/* Save current selection shortcut */}
      <div className="flex items-center gap-2 p-3 bg-bg rounded-surface border border-surface-2">
        {savingCurrentName ? (
          <div className="flex items-center gap-2 w-full">
            <input
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
              className="flex-1 text-xs bg-surface border border-surface-2 rounded-control px-2 py-1.5 text-fg outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={handleSaveCurrentAsPreset}
              className="text-xs px-2 py-1.5 rounded-control bg-accent text-accent-fg hover:bg-accent-700 transition-colors duration-150 flex items-center gap-1"
            >
              <Check size={12} />
              Save
            </button>
            <button
              type="button"
              aria-label="Cancel"
              onClick={() => {
                setSavingCurrentName(false);
                setCurrentNameInput('');
              }}
              className="text-xs px-2 py-1.5 rounded-control bg-surface-2 text-fg/70 hover:bg-surface-2/80 transition-colors duration-150"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <>
            <p className="flex-1 text-xs text-fg/60">
              Current:{' '}
              <span className="font-medium text-fg/80">
                {matchingPreset ? matchingPreset.name : 'Custom'}
              </span>
            </p>
            <button
              type="button"
              disabled={!selectedChatModel}
              onClick={() => {
                setSavingCurrentName(true);
                setAddingNew(false);
                setEditState(null);
                setDeletingId(null);
              }}
              title={
                selectedChatModel
                  ? 'Save current selection as a new preset'
                  : 'Select a chat model first'
              }
              className="text-xs px-2.5 py-1.5 rounded-control bg-surface-2 text-fg/70 hover:bg-surface-2/80 hover:text-fg transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <Plus size={12} />
              Save current as preset
            </button>
          </>
        )}
      </div>

      {/* Preset list */}
      {presets.length === 0 && !addingNew ? (
        <div className="text-center py-6 text-xs text-fg/40">
          No presets yet. Save the current selection or create one below.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {presets.map((preset, idx) => {
            const isActive = matchingPreset?.id === preset.id;
            const available = isPresetAvailable(preset, chatProviders);
            const isEditing = editState?.id === preset.id;
            const isDeleting = deletingId === preset.id;

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
                    <input
                      autoFocus
                      type="text"
                      aria-label="Preset name"
                      maxLength={PRESET_NAME_MAX}
                      value={editState.name}
                      onChange={(e) =>
                        setEditState((s) => s && { ...s, name: e.target.value })
                      }
                      className="text-sm bg-bg border border-surface-2 rounded-control px-2 py-1.5 text-fg outline-none focus:border-accent w-full"
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
                              }
                            : s,
                        )
                      }
                      fields={{
                        system: true,
                        vision: true,
                        contextWindow: true,
                      }}
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleSaveEdit}
                        className="text-xs px-2.5 py-1.5 rounded-control bg-accent text-accent-fg hover:bg-accent-700 transition-colors duration-150 flex items-center gap-1"
                      >
                        <Check size={12} />
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditState(null)}
                        className="text-xs px-2.5 py-1.5 rounded-control bg-surface-2 text-fg/70 hover:bg-surface-2/80 transition-colors duration-150"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2">
                    {/* Reorder buttons */}
                    <div className="flex flex-col gap-0.5 shrink-0 pt-0.5">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => handleMoveUp(idx)}
                        className="p-0.5 rounded text-fg/30 hover:text-fg/70 disabled:opacity-20 transition-colors duration-150"
                        aria-label="Move preset up"
                      >
                        <ChevronUp size={14} />
                      </button>
                      <button
                        type="button"
                        disabled={idx === presets.length - 1}
                        onClick={() => handleMoveDown(idx)}
                        className="p-0.5 rounded text-fg/30 hover:text-fg/70 disabled:opacity-20 transition-colors duration-150"
                        aria-label="Move preset down"
                      >
                        <ChevronDown size={14} />
                      </button>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-medium text-fg">
                          {preset.name}
                        </span>
                        {isActive && (
                          <span className="flex items-center gap-0.5 text-[10px] text-accent bg-surface px-1.5 py-0.5 rounded-pill border border-accent">
                            <Check size={10} />
                            active
                          </span>
                        )}
                        {!available && (
                          <span className="flex items-center gap-0.5 text-[10px] text-warning bg-warning-soft px-1.5 py-0.5 rounded-control">
                            <AlertTriangle size={10} />
                            model unavailable
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 mt-0.5">
                        <p className="text-xs text-fg/50 truncate">
                          {presetSummary(preset)}
                        </p>
                        {preset.imageCapable && (
                          <Eye size={10} className="text-fg/40 shrink-0" />
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    {isDeleting ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-xs text-fg/60">Delete?</span>
                        <button
                          type="button"
                          onClick={() => handleDelete(preset.id)}
                          className="text-xs px-2 py-1 rounded-control bg-danger text-danger-fg hover:bg-danger/80 transition-colors duration-150"
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingId(null)}
                          className="text-xs px-2 py-1 rounded-control bg-surface-2 text-fg/70 hover:bg-surface-2/80 transition-colors duration-150"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleApply(preset)}
                          disabled={isActive}
                          className="text-xs px-2 py-1 rounded-control bg-surface-2 text-fg/70 hover:bg-accent hover:text-accent-fg disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
                          aria-label="Apply preset"
                        >
                          Apply
                        </button>
                        <button
                          type="button"
                          onClick={() => startEdit(preset)}
                          className="p-1.5 rounded-control text-fg/40 hover:text-fg/70 hover:bg-surface-2 transition-colors duration-150"
                          aria-label="Edit preset"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDuplicate(preset)}
                          className="p-1.5 rounded-control text-fg/40 hover:text-fg/70 hover:bg-surface-2 transition-colors duration-150"
                          aria-label="Duplicate preset"
                        >
                          <Copy size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingId(preset.id)}
                          className="p-1.5 rounded-control text-fg/40 hover:text-danger hover:bg-danger-soft transition-colors duration-150"
                          aria-label="Delete preset"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
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
          <p className="text-xs font-medium text-fg/70">New Preset</p>
          <input
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
                    },
              )
            }
            className="text-sm bg-surface border border-surface-2 rounded-control px-2 py-1.5 text-fg outline-none focus:border-accent w-full"
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
                      }
                    : s,
                )
              }
              fields={{ system: true, vision: true, contextWindow: true }}
            />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
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
                });
                updatePresets([...presets, preset]);
                setAddingNew(false);
                setEditState(null);
                toast.success(`Preset "${preset.name}" created`);
              }}
              className="text-xs px-2.5 py-1.5 rounded-control bg-accent text-accent-fg hover:bg-accent-700 transition-colors duration-150 flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Check size={12} />
              Create preset
            </button>
            <button
              type="button"
              onClick={() => {
                setAddingNew(false);
                setEditState(null);
              }}
              className="text-xs px-2.5 py-1.5 rounded-control bg-surface-2 text-fg/70 hover:bg-surface-2/80 transition-colors duration-150"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={presets.length >= PRESET_MAX}
          onClick={() => {
            setAddingNew(true);
            setSavingCurrentName(false);
            setDeletingId(null);
            setEditState({
              id: '',
              name: '',
              chatProvider: selectedChatModelProvider ?? '',
              chatModel: selectedChatModel ?? '',
              systemProvider: selectedSystemModelProvider ?? '',
              systemModel: selectedSystemModel ?? '',
              imageCapable: false,
              contextWindowSize: contextWindowSize,
            });
          }}
          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-control border border-dashed border-surface-2 text-fg/50 hover:border-border-strong hover:text-fg/70 transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed w-full justify-center"
        >
          <Plus size={13} />
          New preset from scratch
        </button>
      )}
    </SettingsSection>
  );
}
