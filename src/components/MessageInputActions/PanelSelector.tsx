import { Fragment, useState } from 'react';
import { Layers, X, Plus, Check, Save } from 'lucide-react';
import { toast } from 'sonner';
import {
  Popover,
  PopoverButton,
  PopoverPanel,
  Transition,
} from '@headlessui/react';
import { cn } from '@/lib/utils';
import { useLocalStorageJSON } from '@/lib/hooks/useLocalStorage';
import { useModels } from '@/lib/hooks/api/useModels';
import ModelField from '@/components/models/ModelField';
import { DEFAULT_CONTEXT_WINDOW } from '@/lib/models/presets';
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
  findMatchingPanelPreset,
  type PanelPresetList,
} from '@/lib/panel/panelPresets';

const EMPTY_PRESETS: PanelPresetList = [];

/**
 * Composer control to enable the agent panel and pick its executor models
 * (2–4). The turn's chat model synthesizes their results, so there is no
 * separate model to pick here. Orthogonal to focus mode; the panel only applies
 * in research focus modes (webSearch / localResearch), so it is disabled in the
 * conversational-only modes where multi-agent research adds nothing.
 */

const PanelSelector = ({ focusMode }: { focusMode: string }) => {
  const [selection, setSelection] = useLocalStorageJSON<PanelSelection>(
    PANEL_SELECTION_KEY,
    EMPTY_PANEL_SELECTION,
  );
  const [presets, setPresets] = useLocalStorageJSON<PanelPresetList>(
    PANEL_PRESETS_KEY,
    EMPTY_PRESETS,
  );
  const [savingName, setSavingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const { data: modelsData } = useModels();
  const providers = (modelsData?.chatModelProviders ?? {}) as Record<
    string,
    Record<string, { displayName: string }>
  >;

  const supported = focusMode === 'webSearch' || focusMode === 'localResearch';
  const active = supported && selection.enabled;
  const ready = isPanelSelectionReady(selection);

  const displayName = (m: PanelModelEntry): string =>
    providers[m.provider]?.[m.name]?.displayName ?? m.name;

  const update = (patch: Partial<PanelSelection>) =>
    setSelection({ ...selection, ...patch });

  const addExecutor = (provider: string, name: string) => {
    const entry: PanelModelEntry = {
      provider,
      name,
      contextWindowSize: DEFAULT_CONTEXT_WINDOW,
    };
    if (selection.executors.some((e) => sameModel(e, entry))) return;
    if (selection.executors.length >= PANEL_MAX) return;
    update({ executors: [...selection.executors, entry] });
  };

  const removeExecutor = (entry: PanelModelEntry) =>
    update({
      executors: selection.executors.filter((e) => !sameModel(e, entry)),
    });

  const matchingPreset = findMatchingPanelPreset(presets, selection.executors);

  const applyPreset = (id: string) => {
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    setSelection({
      enabled: true,
      executors: p.executors,
    });
  };

  const saveCurrentPreset = () => {
    const name = nameInput.trim().slice(0, PANEL_PRESET_NAME_MAX);
    if (!name) {
      toast.error('Preset name cannot be empty');
      return;
    }
    if (!ready) {
      toast.error(`Select ${PANEL_MIN}–${PANEL_MAX} executors`);
      return;
    }
    if (presets.length >= PANEL_PRESET_MAX) {
      toast.error(`You can have at most ${PANEL_PRESET_MAX} presets`);
      return;
    }
    setPresets([
      ...presets,
      createPanelPreset({
        name,
        executors: selection.executors,
      }),
    ]);
    setNameInput('');
    setSavingName(false);
    toast.success(`Panel preset "${name}" saved`);
  };

  return (
    <Popover className="relative">
      <PopoverButton
        type="button"
        title="Agent Panel"
        disabled={!supported}
        className={cn(
          'p-2 rounded-control transition duration-200',
          !supported
            ? 'text-fg/25 cursor-not-allowed'
            : active
              ? 'text-accent hover:bg-surface-2'
              : 'text-fg/60 hover:text-fg/80 hover:bg-surface-2',
        )}
      >
        <Layers size={18} />
      </PopoverButton>
      <Transition
        as={Fragment}
        enter="transition ease-out duration-200"
        enterFrom="opacity-0 translate-y-1"
        enterTo="opacity-100 translate-y-0"
        leave="transition ease-in duration-150"
        leaveFrom="opacity-100 translate-y-0"
        leaveTo="opacity-0 translate-y-1"
      >
        <PopoverPanel className="absolute left-0 z-20 w-80 transform bottom-full mb-2">
          {/* No overflow-hidden: the executor model picker renders its own
              popover and must not be clipped by this container. */}
          <div className="rounded-surface shadow-raised ring-1 ring-surface-2 bg-surface">
            <div className="px-4 py-3 border-b border-surface-2 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-medium text-fg/90">Agent Panel</h3>
                <p className="text-xs text-fg/60 mt-0.5">
                  Run {PANEL_MIN}–{PANEL_MAX} models in parallel, then
                  synthesize
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-label="Enable agent panel"
                aria-checked={selection.enabled}
                onClick={() => update({ enabled: !selection.enabled })}
                className={cn(
                  'relative inline-flex h-5 w-9 shrink-0 items-center rounded-pill transition-colors duration-150',
                  selection.enabled ? 'bg-accent' : 'bg-surface-2',
                )}
              >
                <span
                  className={cn(
                    'inline-block h-4 w-4 transform rounded-pill bg-bg transition-transform duration-150',
                    selection.enabled ? 'translate-x-4' : 'translate-x-0.5',
                  )}
                />
              </button>
            </div>

            {!supported ? (
              <div className="px-4 py-4 text-xs text-fg/60">
                The agent panel is only available in Web Search and Local
                Research focus modes.
              </div>
            ) : (
              <div className="px-4 py-3 space-y-4">
                {/* Presets */}
                {presets.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="text-xs font-semibold text-fg/70 uppercase tracking-wide">
                      Presets
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {presets.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => applyPreset(p.id)}
                          className={cn(
                            'inline-flex items-center gap-1 px-2.5 py-1 rounded-control text-xs transition-colors duration-150',
                            matchingPreset?.id === p.id
                              ? 'bg-accent text-accent-fg'
                              : 'bg-surface-2 text-fg/70 hover:text-fg',
                          )}
                        >
                          {matchingPreset?.id === p.id && <Check size={11} />}
                          <span className="truncate max-w-[140px]">
                            {p.name}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Executors */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-fg/70 uppercase tracking-wide">
                      Executors ({selection.executors.length}/{PANEL_MAX})
                    </span>
                  </div>
                  {selection.executors.length === 0 && (
                    <p className="text-xs text-fg/50">
                      Add {PANEL_MIN}–{PANEL_MAX} models to run in parallel.
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {selection.executors.map((e) => (
                      <span
                        key={`${e.provider}/${e.name}`}
                        className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-control bg-surface-2 text-xs"
                      >
                        <span className="truncate max-w-[140px]">
                          {displayName(e)}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeExecutor(e)}
                          className="p-0.5 rounded-control hover:bg-surface text-fg/60 hover:text-danger transition-colors duration-150"
                          title="Remove"
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                  {selection.executors.length < PANEL_MAX && (
                    <div className="flex items-center gap-1 text-fg/70">
                      <Plus size={14} className="text-accent" />
                      <ModelField
                        role="chat"
                        showModelName
                        panelPosition="below"
                        selectedModel={null}
                        setSelectedModel={(m) =>
                          addExecutor(m.provider, m.model)
                        }
                      />
                    </div>
                  )}
                </div>

                {/* The synthesizer is the turn's chat model, not chosen here —
                    make that explicit so users don't go hunting for it. */}
                <div className="rounded-control bg-surface-2/60 px-3 py-2 text-xs text-fg/60">
                  Your chat model reads every model&apos;s answer and writes the
                  single final response.
                </div>

                {selection.enabled && !ready && (
                  <p className="text-xs text-warning">
                    Select {PANEL_MIN}–{PANEL_MAX} executors to use the panel.
                  </p>
                )}

                {/* Save current as preset */}
                <div className="border-t border-surface-2 pt-3">
                  {savingName ? (
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        type="text"
                        aria-label="Panel preset name"
                        maxLength={PANEL_PRESET_NAME_MAX}
                        placeholder="Preset name…"
                        value={nameInput}
                        onChange={(e) => setNameInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveCurrentPreset();
                          if (e.key === 'Escape') {
                            setSavingName(false);
                            setNameInput('');
                          }
                        }}
                        className="flex-1 min-w-0 text-xs bg-bg border border-surface-2 rounded-control px-2 py-1.5 text-fg outline-none focus:border-accent"
                      />
                      <button
                        type="button"
                        onClick={saveCurrentPreset}
                        className="text-xs px-2 py-1.5 rounded-control bg-accent text-accent-fg hover:bg-accent-700 transition-colors duration-150 flex items-center gap-1"
                      >
                        <Check size={12} />
                        Save
                      </button>
                      <button
                        type="button"
                        aria-label="Cancel"
                        onClick={() => {
                          setSavingName(false);
                          setNameInput('');
                        }}
                        className="text-xs px-2 py-1.5 rounded-control bg-surface-2 text-fg/70 hover:bg-surface-2/80 transition-colors duration-150"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={!ready}
                      onClick={() => setSavingName(true)}
                      title={
                        ready
                          ? 'Save the current panel as a preset'
                          : 'Configure a valid panel first'
                      }
                      className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-control bg-surface-2 text-fg/70 hover:text-fg transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Save size={12} />
                      Save current as preset
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </PopoverPanel>
      </Transition>
    </Popover>
  );
};

export default PanelSelector;
