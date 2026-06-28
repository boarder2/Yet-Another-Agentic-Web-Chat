import { Fragment, useState } from 'react';
import {
  Layers,
  X,
  Plus,
  BookMarked,
  ChevronDown,
  ExternalLink,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Popover,
  PopoverButton,
  PopoverPanel,
  Transition,
} from '@headlessui/react';
import { cn } from '@/lib/utils';
import { useSettingsModal } from '@/components/settings/SettingsModalProvider';
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
  isPanelPresetAvailable,
  panelPresetSummary,
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
  const { openSettings } = useSettingsModal();
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
                {/* Presets — dropdown switcher (mirrors the model presets popover) */}
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-fg/70 uppercase tracking-wide">
                    Presets
                  </span>
                  <Popover className="relative">
                    {({ open, close }) => (
                      <>
                        <PopoverButton
                          type="button"
                          className={cn(
                            'flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-control border transition-colors duration-150',
                            open
                              ? 'bg-surface-2 border-border-strong text-fg'
                              : 'bg-surface border-surface-2 text-fg/70 hover:bg-surface-2 hover:text-fg',
                          )}
                          aria-label="Select panel preset"
                        >
                          <BookMarked size={12} />
                          <span className="max-w-28 truncate">
                            {matchingPreset ? matchingPreset.name : 'Custom'}
                          </span>
                          <ChevronDown
                            size={12}
                            className={cn(
                              'transition-transform duration-150',
                              open ? 'rotate-180' : '',
                            )}
                          />
                        </PopoverButton>

                        <Transition
                          as={Fragment}
                          enter="transition ease-out duration-100"
                          enterFrom="opacity-0 scale-95"
                          enterTo="opacity-100 scale-100"
                          leave="transition ease-in duration-75"
                          leaveFrom="opacity-100 scale-100"
                          leaveTo="opacity-0 scale-95"
                        >
                          <PopoverPanel className="absolute right-0 z-50 mt-1 w-64 rounded-floating bg-surface border border-surface-2 shadow-floating overflow-hidden">
                            <div className="max-h-64 overflow-y-auto">
                              {presets.length === 0 ? (
                                <div className="px-3 py-4 text-center text-xs text-fg/50">
                                  No presets yet. Save the current panel to
                                  create one.
                                </div>
                              ) : (
                                presets.map((p) => {
                                  const isActive = matchingPreset?.id === p.id;
                                  const available = isPanelPresetAvailable(
                                    p,
                                    providers,
                                  );
                                  return (
                                    <button
                                      key={p.id}
                                      type="button"
                                      aria-label={`Apply panel preset ${p.name}`}
                                      onClick={() => {
                                        applyPreset(p.id);
                                        close();
                                      }}
                                      className="w-full text-left pl-2 pr-3 py-2.5 flex items-start gap-2 hover:bg-surface-2 transition-colors duration-100"
                                    >
                                      <span
                                        className={cn(
                                          'w-1 self-stretch rounded-full shrink-0 transition-colors duration-150',
                                          isActive
                                            ? 'bg-accent'
                                            : 'bg-transparent',
                                        )}
                                      />
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-xs font-medium text-fg truncate">
                                            {p.name}
                                          </span>
                                          {!available && (
                                            <span className="flex items-center gap-0.5 text-[10px] text-warning bg-warning-soft px-1 py-0.5 rounded-control shrink-0">
                                              <AlertTriangle size={10} />
                                              unavailable
                                            </span>
                                          )}
                                        </div>
                                        <p className="text-[10px] text-fg/50 mt-0.5 truncate">
                                          {panelPresetSummary(p)}
                                        </p>
                                      </div>
                                    </button>
                                  );
                                })
                              )}
                            </div>

                            <div className="border-t border-surface-2 px-3 py-2 flex items-center justify-between">
                              {savingName ? (
                                <div className="flex items-center gap-1.5 w-full">
                                  <input
                                    autoFocus
                                    type="text"
                                    aria-label="Panel preset name"
                                    maxLength={PANEL_PRESET_NAME_MAX}
                                    placeholder="Preset name…"
                                    value={nameInput}
                                    onChange={(e) =>
                                      setNameInput(e.target.value)
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter')
                                        saveCurrentPreset();
                                      if (e.key === 'Escape') {
                                        setSavingName(false);
                                        setNameInput('');
                                      }
                                    }}
                                    className="flex-1 min-w-0 text-xs bg-bg border border-surface-2 rounded-control px-2 py-1 text-fg outline-none focus:border-accent"
                                  />
                                  <button
                                    type="button"
                                    onClick={saveCurrentPreset}
                                    className="shrink-0 text-xs px-2 py-1 rounded-control bg-accent text-accent-fg hover:bg-accent-700 transition-colors duration-150"
                                  >
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSavingName(false);
                                      setNameInput('');
                                    }}
                                    className="shrink-0 text-xs px-2 py-1 rounded-control bg-surface-2 text-fg/70 hover:bg-surface-2/80 transition-colors duration-150"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    disabled={!ready}
                                    onClick={() => setSavingName(true)}
                                    className="text-xs text-fg/60 hover:text-fg transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
                                    title={
                                      ready
                                        ? 'Save the current panel as a preset'
                                        : 'Configure a valid panel first'
                                    }
                                  >
                                    Save current…
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      close();
                                      openSettings('panel-presets');
                                    }}
                                    className="flex items-center gap-1 text-xs text-fg/40 hover:text-fg/70 transition-colors duration-150"
                                  >
                                    Manage
                                    <ExternalLink size={10} />
                                  </button>
                                </>
                              )}
                            </div>
                          </PopoverPanel>
                        </Transition>
                      </>
                    )}
                  </Popover>
                </div>

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
              </div>
            )}
          </div>
        </PopoverPanel>
      </Transition>
    </Popover>
  );
};

export default PanelSelector;
