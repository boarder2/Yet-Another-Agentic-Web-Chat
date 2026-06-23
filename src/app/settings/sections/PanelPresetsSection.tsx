'use client';

import { AlertTriangle, Check, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useModels } from '@/lib/hooks/api/useModels';
import { useLocalStorageJSON } from '@/lib/hooks/useLocalStorage';
import { DEFAULT_CONTEXT_WINDOW } from '@/lib/models/presets';
import ModelField from '@/components/models/ModelField';
import SettingsSection from '../components/SettingsSection';
import {
  PANEL_SELECTION_KEY,
  EMPTY_PANEL_SELECTION,
  PANEL_MIN,
  PANEL_MAX,
  isPanelSelectionReady,
  sameModel,
  type PanelSelection,
  type PanelModelEntry,
} from '@/lib/panel/panelSelection';
import {
  PANEL_PRESETS_KEY,
  PANEL_PRESET_MAX,
  PANEL_PRESET_NAME_MAX,
  createPanelPreset,
  isPanelPresetAvailable,
  panelPresetSummary,
  type PanelPreset,
  type PanelPresetList,
} from '@/lib/panel/panelPresets';

const EMPTY_PRESETS: PanelPresetList = [];

type Draft = {
  name: string;
  executors: PanelModelEntry[];
};

const EMPTY_DRAFT: Draft = { name: '', executors: [] };

export default function PanelPresetsSection() {
  const [presets, setPresets] = useLocalStorageJSON<PanelPresetList>(
    PANEL_PRESETS_KEY,
    EMPTY_PRESETS,
  );
  const [selection, setSelection] = useLocalStorageJSON<PanelSelection>(
    PANEL_SELECTION_KEY,
    EMPTY_PANEL_SELECTION,
  );
  const { data: modelsData } = useModels();
  const providers = (modelsData?.chatModelProviders ?? {}) as Record<
    string,
    Record<string, { displayName: string }>
  >;
  const displayName = (m: PanelModelEntry): string =>
    providers[m.provider]?.[m.name]?.displayName ?? m.name;

  const [draft, setDraft] = useState<Draft | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const entry = (provider: string, name: string): PanelModelEntry => ({
    provider,
    name,
    contextWindowSize: DEFAULT_CONTEXT_WINDOW,
  });

  const applyPreset = (p: PanelPreset) => {
    setSelection({
      enabled: true,
      executors: p.executors,
    });
    toast.success(`Applied panel preset "${p.name}"`);
  };

  const deletePreset = (id: string) => {
    setPresets(presets.filter((p) => p.id !== id));
    setDeletingId(null);
    toast.success('Panel preset deleted');
  };

  const saveDraft = () => {
    if (!draft) return;
    const name = draft.name.trim().slice(0, PANEL_PRESET_NAME_MAX);
    if (!name) {
      toast.error('Preset name cannot be empty');
      return;
    }
    if (draft.executors.length < PANEL_MIN) {
      toast.error(`Add at least ${PANEL_MIN} executors`);
      return;
    }
    if (presets.length >= PANEL_PRESET_MAX) {
      toast.error(`You can have at most ${PANEL_PRESET_MAX} presets`);
      return;
    }
    const preset = createPanelPreset({
      name,
      executors: draft.executors,
    });
    setPresets([...presets, preset]);
    setDraft(null);
    toast.success(`Panel preset "${name}" saved`);
  };

  const saveCurrent = () => {
    if (!isPanelSelectionReady(selection)) {
      toast.error('Configure an enabled panel in the composer first');
      return;
    }
    setDraft({
      name: '',
      executors: selection.executors,
    });
  };

  const addDraftExecutor = (provider: string, name: string) => {
    setDraft((d) => {
      if (!d) return d;
      const e = entry(provider, name);
      if (d.executors.some((x) => sameModel(x, e))) return d;
      if (d.executors.length >= PANEL_MAX) return d;
      return { ...d, executors: [...d.executors, e] };
    });
  };

  const removeDraftExecutor = (e: PanelModelEntry) =>
    setDraft((d) =>
      d ? { ...d, executors: d.executors.filter((x) => !sameModel(x, e)) } : d,
    );

  return (
    <SettingsSection
      title="Agent Panel Presets"
      headerAction={
        <span className="text-xs text-fg/50">
          {presets.length}/{PANEL_PRESET_MAX}
        </span>
      }
    >
      <p className="text-xs text-fg/60">
        Save named panel configurations — a set of {PANEL_MIN}–{PANEL_MAX}{' '}
        executor models. Apply them here or from the composer.
      </p>

      <div className="flex items-center gap-2 p-3 bg-bg rounded-surface border border-surface-2">
        <p className="flex-1 text-xs text-fg/60">
          Save the panel currently configured in the composer.
        </p>
        <button
          type="button"
          onClick={saveCurrent}
          className="text-xs px-2.5 py-1.5 rounded-control bg-surface-2 text-fg/70 hover:bg-surface-2/80 hover:text-fg transition-colors duration-150 flex items-center gap-1"
        >
          <Plus size={12} />
          Save current panel
        </button>
      </div>

      {presets.length === 0 && !draft ? (
        <div className="text-center py-6 text-xs text-fg/40">
          No panel presets yet.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {presets.map((preset) => {
            const available = isPanelPresetAvailable(preset, providers);
            const isDeleting = deletingId === preset.id;
            return (
              <div
                key={preset.id}
                className="rounded-surface border border-surface-2 bg-surface p-3"
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-medium text-fg">
                        {preset.name}
                      </span>
                      {!available && (
                        <span className="flex items-center gap-0.5 text-[10px] text-warning bg-warning-soft px-1.5 py-0.5 rounded-control">
                          <AlertTriangle size={10} />
                          model unavailable
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-fg/50 truncate mt-0.5">
                      {panelPresetSummary(preset)}
                    </p>
                  </div>
                  {isDeleting ? (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-xs text-fg/60">Delete?</span>
                      <button
                        type="button"
                        onClick={() => deletePreset(preset.id)}
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
                        onClick={() => applyPreset(preset)}
                        className="text-xs px-2 py-1 rounded-control bg-surface-2 text-fg/70 hover:bg-accent hover:text-accent-fg transition-colors duration-150"
                      >
                        Apply
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
              </div>
            );
          })}
        </div>
      )}

      {draft ? (
        <div className="border border-surface-2 rounded-surface p-3 flex flex-col gap-3 bg-bg">
          <p className="text-xs font-medium text-fg/70">New Panel Preset</p>
          <input
            autoFocus
            type="text"
            aria-label="Panel preset name"
            maxLength={PANEL_PRESET_NAME_MAX}
            placeholder="Preset name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="text-sm bg-surface border border-surface-2 rounded-control px-2 py-1.5 text-fg outline-none focus:border-accent w-full"
          />

          <div className="space-y-2">
            <span className="text-xs font-semibold text-fg/70 uppercase tracking-wide">
              Executors ({draft.executors.length}/{PANEL_MAX})
            </span>
            <div className="flex flex-wrap gap-1.5">
              {draft.executors.map((e) => (
                <span
                  key={`${e.provider}/${e.name}`}
                  className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-control bg-surface-2 text-xs"
                >
                  <span className="truncate max-w-[140px]">
                    {displayName(e)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeDraftExecutor(e)}
                    className="p-0.5 rounded-control hover:bg-surface text-fg/60 hover:text-danger transition-colors duration-150"
                    aria-label="Remove executor"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
            {draft.executors.length < PANEL_MAX && (
              <div className="flex items-center gap-1 text-fg/70">
                <Plus size={14} className="text-accent" />
                <ModelField
                  role="chat"
                  showModelName
                  panelPosition="below"
                  selectedModel={null}
                  setSelectedModel={(m) =>
                    addDraftExecutor(m.provider, m.model)
                  }
                />
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={saveDraft}
              className="text-xs px-2.5 py-1.5 rounded-control bg-accent text-accent-fg hover:bg-accent-700 transition-colors duration-150 flex items-center gap-1"
            >
              <Check size={12} />
              Save preset
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="text-xs px-2.5 py-1.5 rounded-control bg-surface-2 text-fg/70 hover:bg-surface-2/80 transition-colors duration-150"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={presets.length >= PANEL_PRESET_MAX}
          onClick={() => setDraft(EMPTY_DRAFT)}
          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-control border border-dashed border-surface-2 text-fg/50 hover:border-border-strong hover:text-fg/70 transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed w-full justify-center"
        >
          <Plus size={13} />
          New panel preset
        </button>
      )}
    </SettingsSection>
  );
}
