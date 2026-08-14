'use client';

import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useModels } from '@/lib/hooks/api/useModels';
import { useLocalStorageJSON } from '@/lib/hooks/useLocalStorage';
import { DEFAULT_CONTEXT_WINDOW } from '@/lib/models/presets';
import ModelField from '@/components/models/ModelField';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import SettingsSection from '../components/SettingsSection';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { ListEmptyState } from '@/components/ui/List';
import {
  PANEL_SELECTION_KEY,
  EMPTY_PANEL_SELECTION,
  PANEL_MIN,
  PANEL_MAX,
  hasValidExecutors,
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
  /** null while creating a new preset; the preset id while editing. */
  id: string | null;
  name: string;
  executors: PanelModelEntry[];
};

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
    if (draft?.id === id) setDraft(null);
    toast.success('Panel preset deleted');
  };

  const duplicatePreset = (p: PanelPreset) => {
    if (presets.length >= PANEL_PRESET_MAX) {
      toast.error(`You can have at most ${PANEL_PRESET_MAX} presets`);
      return;
    }
    const copy = createPanelPreset({
      name: `${p.name} (copy)`.slice(0, PANEL_PRESET_NAME_MAX),
      executors: p.executors,
    });
    setPresets([...presets, copy]);
    toast.success('Panel preset duplicated');
  };

  const movePreset = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= presets.length) return;
    const updated = [...presets];
    [updated[index], updated[target]] = [updated[target], updated[index]];
    setPresets(updated);
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
    if (draft.id) {
      setPresets(
        presets.map((p) =>
          p.id === draft.id ? { ...p, name, executors: draft.executors } : p,
        ),
      );
      setDraft(null);
      toast.success(`Panel preset "${name}" updated`);
      return;
    }
    if (presets.length >= PANEL_PRESET_MAX) {
      toast.error(`You can have at most ${PANEL_PRESET_MAX} presets`);
      return;
    }
    const preset = createPanelPreset({ name, executors: draft.executors });
    setPresets([...presets, preset]);
    setDraft(null);
    toast.success(`Panel preset "${name}" saved`);
  };

  const startEdit = (p: PanelPreset) => {
    setDeletingId(null);
    setDraft({ id: p.id, name: p.name, executors: p.executors });
  };

  const saveCurrent = () => {
    if (!hasValidExecutors(selection)) {
      toast.error('Configure a panel in the composer first');
      return;
    }
    setDeletingId(null);
    setDraft({ id: null, name: '', executors: selection.executors });
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

  const draftForm = (
    <div className="border border-surface-2 rounded-surface p-3 flex flex-col gap-3 bg-bg">
      <p className="text-xs font-medium text-fg-muted">
        {draft?.id ? 'Edit Panel Preset' : 'New Panel Preset'}
      </p>
      <Input
        autoFocus
        type="text"
        aria-label="Panel preset name"
        maxLength={PANEL_PRESET_NAME_MAX}
        placeholder="Preset name"
        value={draft?.name ?? ''}
        onChange={(e) =>
          setDraft((d) => (d ? { ...d, name: e.target.value } : d))
        }
        className="px-2 py-1.5"
      />

      <div className="space-y-2">
        <span className="text-xs font-semibold text-fg-muted uppercase tracking-wide">
          Executors ({draft?.executors.length ?? 0}/{PANEL_MAX})
        </span>
        <div className="flex flex-wrap gap-1.5">
          {draft?.executors.map((e) => (
            <span
              key={`${e.provider}/${e.name}`}
              className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-control bg-surface-2 text-xs"
            >
              <span className="truncate max-w-[140px]">{displayName(e)}</span>
              <IconButton
                icon={X}
                label="Remove executor"
                tone="danger"
                onClick={() => removeDraftExecutor(e)}
                className="p-0.5"
              />
            </span>
          ))}
        </div>
        {(draft?.executors.length ?? 0) < PANEL_MAX && (
          <div className="flex items-center gap-1 text-fg-muted">
            <Plus size={14} className="text-accent" />
            <ModelField
              role="chat"
              showModelName
              panelPosition="below"
              selectedModel={null}
              setSelectedModel={(m) => addDraftExecutor(m.provider, m.model)}
            />
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" icon={Check} onClick={saveDraft}>
          {draft?.id ? 'Save changes' : 'Save preset'}
        </Button>
        <Button size="sm" onClick={() => setDraft(null)}>
          Cancel
        </Button>
      </div>
    </div>
  );

  return (
    <SettingsSection
      title="Agent Panel Presets"
      headerAction={
        <span className="text-xs text-fg-subtle">
          {presets.length}/{PANEL_PRESET_MAX}
        </span>
      }
    >
      <p className="text-xs text-fg-muted">
        Save named panel configurations — a set of {PANEL_MIN}–{PANEL_MAX}{' '}
        executor models. Apply them here or from the composer.
      </p>

      <div className="flex items-center gap-2 p-3 bg-bg rounded-surface border border-surface-2">
        <p className="flex-1 text-xs text-fg-muted">
          Save the panel currently configured in the composer.
        </p>
        <Button size="sm" icon={Plus} onClick={saveCurrent}>
          Save current panel
        </Button>
      </div>

      {presets.length === 0 && (!draft || draft.id) ? (
        <ListEmptyState layout="compact">No panel presets yet.</ListEmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {presets.map((preset, idx) => {
            if (draft?.id === preset.id) {
              return <div key={preset.id}>{draftForm}</div>;
            }
            const available = isPanelPresetAvailable(preset, providers);
            const isDeleting = deletingId === preset.id;
            return (
              <Card key={preset.id} className="p-3">
                <div className="flex items-start gap-2">
                  <div className="flex flex-col gap-0.5 shrink-0 pt-0.5">
                    <IconButton
                      icon={ChevronUp}
                      label="Move preset up"
                      disabled={idx === 0}
                      onClick={() => movePreset(idx, -1)}
                      className="p-0.5"
                    />
                    <IconButton
                      icon={ChevronDown}
                      label="Move preset down"
                      disabled={idx === presets.length - 1}
                      onClick={() => movePreset(idx, 1)}
                      className="p-0.5"
                    />
                  </div>

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
                    <p className="text-xs text-fg-subtle truncate mt-0.5">
                      {panelPresetSummary(preset)}
                    </p>
                  </div>
                  {isDeleting ? (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-xs text-fg-muted">Delete?</span>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => deletePreset(preset.id)}
                      >
                        Yes
                      </Button>
                      <Button size="sm" onClick={() => setDeletingId(null)}>
                        No
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="sm" onClick={() => applyPreset(preset)}>
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
                        onClick={() => duplicatePreset(preset)}
                        className="p-1.5"
                      />
                      <IconButton
                        icon={Trash2}
                        label="Delete preset"
                        tone="danger"
                        onClick={() => setDeletingId(preset.id)}
                        className="p-1.5"
                      />
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {draft && !draft.id ? (
        draftForm
      ) : !draft ? (
        <Button
          variant="ghost"
          size="sm"
          icon={Plus}
          disabled={presets.length >= PANEL_PRESET_MAX}
          onClick={() => setDraft({ id: null, name: '', executors: [] })}
          className="w-full border-dashed border-surface-2"
        >
          New panel preset
        </Button>
      ) : null}
    </SettingsSection>
  );
}
