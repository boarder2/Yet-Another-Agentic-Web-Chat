import { Fragment, useRef, useState } from 'react';
import { Layers, X, Plus, ChevronDown, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import {
  Popover,
  PopoverButton,
  PopoverPanel,
  Transition,
} from '@headlessui/react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import AppSwitch from '@/components/ui/AppSwitch';
import ComposerActionButton from '@/components/MessageInputActions/ComposerActionButton';
import ComposerPopover from '@/components/MessageInputActions/ComposerPopover';
import { useSettingsModal } from '@/components/settings/SettingsModalProvider';
import { useLocalStorageJSON } from '@/lib/hooks/useLocalStorage';
import { useModels } from '@/lib/hooks/api/useModels';
import ModelField from '@/components/models/ModelField';
import PresetOption from '@/components/models/PresetOption';
import PresetPopover from '@/components/models/PresetPopover';
import ReasoningEffortField from '@/components/models/ReasoningEffortField';
import { DEFAULT_CONTEXT_WINDOW } from '@/lib/models/presets';
import {
  REASONING_EFFORT_LABELS,
  type ReasoningEffort,
} from '@/lib/providers/reasoningEffort';
import {
  PANEL_SELECTION_KEY,
  EMPTY_PANEL_SELECTION,
  PANEL_MIN,
  PANEL_MAX,
  hasValidExecutors,
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

const UNSUPPORTED_LABEL =
  'Agent Panel is only available in Web Search and Local Research';

/**
 * Composer control to toggle the agent panel and pick its executor models
 * (2–4). Split control: the icon half toggles the panel in one click, the
 * chevron half opens configuration. The turn's chat model synthesizes the
 * executors' results, so there is no separate model to pick here. Orthogonal
 * to focus mode; the panel only applies in research focus modes (webSearch /
 * localResearch), so it is disabled in the conversational-only modes where
 * multi-agent research adds nothing.
 *
 * Below sm the split collapses to the chevron alone (restyled as a single
 * Layers button) and the popover header carries an on/off switch — one
 * trigger on every viewport, which headlessui requires: the panel anchors to
 * the last-mounted PopoverButton, so an extra hidden one would anchor it to
 * an invisible element.
 *
 * `enabled` is only ever set while the selection holds 2–4 executors
 * (`hasValidExecutors`), so the engaged state always matches what the turn
 * will send (ChatWindow gates on `isPanelSelectionReady`) — until models are
 * chosen there is nothing to toggle, so the split collapses to the single
 * popover trigger, and removing executors below the minimum clears `enabled`.
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [savingName, setSavingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const { openSettings } = useSettingsModal();
  const { data: modelsData, isFetched } = useModels();
  const capabilitiesLoaded = isFetched || modelsData !== undefined;
  const providers = (modelsData?.chatModelProviders ?? {}) as Record<
    string,
    Record<
      string,
      {
        displayName: string;
        supportedReasoningEfforts?: ReasoningEffort[];
      }
    >
  >;

  const supported = focusMode === 'webSearch' || focusMode === 'localResearch';
  const configured = hasValidExecutors(selection);
  const active = supported && isPanelSelectionReady(selection);

  const displayName = (m: PanelModelEntry): string =>
    providers[m.provider]?.[m.name]?.displayName ?? m.name;

  const update = (patch: Partial<PanelSelection>) =>
    setSelection({ ...selection, ...patch });

  const label = active
    ? `Agent Panel: on · ${selection.executors
        .map(
          (executor) =>
            `${displayName(executor)}${
              executor.reasoningEffort
                ? ` (${REASONING_EFFORT_LABELS[executor.reasoningEffort]})`
                : ''
            }`,
        )
        .join(', ')}`
    : configured
      ? 'Agent Panel: off'
      : `Agent Panel: add ${PANEL_MIN}–${PANEL_MAX} models`;

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

  const removeExecutor = (entry: PanelModelEntry) => {
    const executors = selection.executors.filter((e) => !sameModel(e, entry));
    update({
      executors,
      enabled: executors.length >= PANEL_MIN ? selection.enabled : false,
    });
  };

  const updateExecutorEffort = (
    entry: PanelModelEntry,
    reasoningEffort: PanelModelEntry['reasoningEffort'],
  ) => {
    update({
      executors: selection.executors.map((executor) =>
        sameModel(executor, entry)
          ? reasoningEffort
            ? { ...executor, reasoningEffort }
            : (() => {
                const { reasoningEffort: _removed, ...withoutEffort } =
                  executor;
                return withoutEffort;
              })()
          : executor,
      ),
    });
  };

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
    if (!configured) {
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

  const toggleProps = {
    role: 'switch' as const,
    title: supported ? label : UNSUPPORTED_LABEL,
    'aria-label': supported ? label : UNSUPPORTED_LABEL,
    'aria-checked': active,
    disabled: !supported,
  };

  return (
    <Popover className="relative">
      {({ open }) => (
        <>
          {/* Split control: the icon half toggles in one click, the chevron
              half opens configuration. Below sm the icon half hides and the
              chevron becomes the whole button — one trigger on every
              viewport, so the panel's anchor (the PopoverButton) stays
              visible. Only the chevron is a PopoverButton (headlessui
              supports exactly one per Popover); before executors exist there
              is nothing to toggle, so the icon half forwards its click to
              that trigger instead. */}
          <div className="flex items-center rounded-control">
            <ComposerActionButton
              type="button"
              {...toggleProps}
              geometry="compact"
              configured={active}
              className="hidden sm:inline-flex rounded-r-none"
              onClick={() =>
                configured
                  ? update({ enabled: !selection.enabled })
                  : triggerRef.current?.click()
              }
            >
              <Layers size={18} />
            </ComposerActionButton>
            <PopoverButton
              ref={triggerRef}
              as={ComposerActionButton}
              type="button"
              geometry="compact"
              configured={active}
              open={open}
              title={supported ? 'Configure agent panel' : UNSUPPORTED_LABEL}
              aria-label="Configure agent panel"
              disabled={!supported}
              className="sm:rounded-l-none"
            >
              <Layers className="sm:hidden" size={18} />
              <ChevronDown
                size={12}
                className={cn(
                  'hidden sm:block transition-transform duration-150',
                  open ? 'rotate-180' : '',
                )}
              />
            </PopoverButton>
          </div>
          <Transition
            as={Fragment}
            enter="transition-[opacity,transform] ease-out duration-200"
            enterFrom="opacity-0 translate-y-1"
            enterTo="opacity-100 translate-y-0"
            leave="transition-[opacity,transform] ease-in duration-150"
            leaveFrom="opacity-100 translate-y-0"
            leaveTo="opacity-0 translate-y-1"
          >
            <PopoverPanel className="absolute left-0 z-20 w-80 transform bottom-full mb-2">
              {/* No overflow-hidden: the executor model picker renders its own
                  popover and must not be clipped by this container. */}
              <ComposerPopover
                title="Agent Panel"
                description={`Run ${PANEL_MIN}–${PANEL_MAX} models in parallel, then synthesize`}
                action={
                  <>
                    {/* Read-only on desktop: the composer's toggle half owns
                        on/off. Below sm it is a real switch. */}
                    <span
                      className={cn(
                        'hidden sm:inline-flex shrink-0 text-xs font-medium px-2 py-0.5 rounded-pill',
                        active
                          ? 'bg-accent-soft text-accent'
                          : 'bg-surface-2 text-fg-muted',
                      )}
                    >
                      {active ? 'On' : 'Off'}
                    </span>
                    <div className="sm:hidden">
                      <AppSwitch
                        checked={active}
                        onChange={() => update({ enabled: !selection.enabled })}
                        disabled={!supported || !configured}
                        aria-label={supported ? label : UNSUPPORTED_LABEL}
                      />
                    </div>
                  </>
                }
              >
                {!supported ? (
                  <div className="px-4 py-4 text-xs text-fg-muted">
                    The agent panel is only available in Web Search and Local
                    Research focus modes.
                  </div>
                ) : (
                  <div className="px-4 py-3 space-y-4">
                    {/* Presets — dropdown switcher (mirrors the model presets popover) */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-fg-muted uppercase tracking-wide">
                        Presets
                      </span>
                      <PresetPopover
                        triggerLabel={
                          matchingPreset ? matchingPreset.name : 'Custom'
                        }
                        ariaLabel="Select panel preset"
                        hasPresets={presets.length > 0}
                        emptyBody="No presets yet. Save the current panel to create one."
                        footer={({ close }) =>
                          savingName ? (
                            <div className="flex w-full items-center gap-1.5">
                              <Input
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
                                className="min-w-0 flex-1 text-xs px-2 py-1"
                              />
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={saveCurrentPreset}
                                className="shrink-0"
                              >
                                Save
                              </Button>
                              <Button
                                size="sm"
                                onClick={() => {
                                  setSavingName(false);
                                  setNameInput('');
                                }}
                                className="shrink-0"
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={!configured}
                                onClick={() => setSavingName(true)}
                                className="px-0 py-0"
                                title={
                                  configured
                                    ? 'Save the current panel as a preset'
                                    : 'Configure a valid panel first'
                                }
                              >
                                Save current…
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                icon={ExternalLink}
                                onClick={() => {
                                  close();
                                  openSettings('panel-presets');
                                }}
                                className="px-0 py-0"
                              >
                                Manage
                              </Button>
                            </>
                          )
                        }
                      >
                        {({ close }) =>
                          presets.map((preset) => (
                            <PresetOption
                              key={preset.id}
                              name={preset.name}
                              summary={panelPresetSummary(preset)}
                              isActive={matchingPreset?.id === preset.id}
                              available={isPanelPresetAvailable(
                                preset,
                                providers,
                              )}
                              aria-label={`Apply panel preset ${preset.name}`}
                              onClick={() => {
                                applyPreset(preset.id);
                                close();
                              }}
                            />
                          ))
                        }
                      </PresetPopover>
                    </div>

                    {/* Executors */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-fg-muted uppercase tracking-wide">
                          Executors ({selection.executors.length}/{PANEL_MAX})
                        </span>
                      </div>
                      {!configured && (
                        <p className="text-xs text-fg-muted">
                          Add at least {PANEL_MIN} models to enable the panel.
                        </p>
                      )}
                      <div className="flex flex-col gap-1.5">
                        {selection.executors.map((e) => {
                          const modelInfo = providers[e.provider]?.[e.name];
                          return (
                            <div
                              key={`${e.provider}/${e.name}`}
                              className="rounded-control bg-surface-2 px-2.5 py-1.5 text-xs"
                            >
                              <div className="flex items-center gap-1">
                                <span className="min-w-0 flex-1 truncate">
                                  {displayName(e)}
                                </span>
                                <IconButton
                                  icon={X}
                                  label={`Remove ${displayName(e)}`}
                                  tone="danger"
                                  onClick={() => removeExecutor(e)}
                                  className="p-0.5"
                                />
                              </div>
                              <ReasoningEffortField
                                label="Reasoning effort"
                                ariaLabel={`${displayName(e)} reasoning effort`}
                                value={e.reasoningEffort}
                                supported={modelInfo?.supportedReasoningEfforts}
                                capabilityKnown={capabilitiesLoaded}
                                showStoredState
                                onChange={(reasoningEffort) =>
                                  updateExecutorEffort(e, reasoningEffort)
                                }
                              />
                            </div>
                          );
                        })}
                      </div>
                      {selection.executors.length < PANEL_MAX && (
                        <div className="flex items-center gap-1 text-fg-muted">
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
                    <div className="rounded-control bg-surface-2/60 px-3 py-2 text-xs text-fg-muted">
                      Your chat model reads every model&apos;s answer and writes
                      the single final response.
                    </div>
                  </div>
                )}
              </ComposerPopover>
            </PopoverPanel>
          </Transition>
        </>
      )}
    </Popover>
  );
};

export default PanelSelector;
