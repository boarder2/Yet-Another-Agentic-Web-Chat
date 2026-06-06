'use client';

import { useRef, useState } from 'react';
import { ChevronDown, ExternalLink, BookMarked } from 'lucide-react';
import {
  Popover,
  PopoverButton,
  PopoverPanel,
  Transition,
} from '@headlessui/react';
import { Fragment } from 'react';
import { toast } from 'sonner';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import {
  useLocalStorageBoolean,
  useLocalStorageString,
  useLocalStorageJSON,
} from '@/lib/hooks/useLocalStorage';
import {
  PRESETS_KEY,
  SELECTION_KEYS,
  PRESET_MAX,
  PRESET_NAME_MAX,
  type ModelPreset,
  type ModelPresetList,
  type ActiveSelection,
  createPreset,
  findMatchingPreset,
  applyPresetToStorage,
  captureCurrentSelection,
  isPresetAvailable,
} from '@/lib/models/presets';
import { useModels } from '@/lib/hooks/api/useModels';
import PresetOption from './PresetOption';

const EMPTY_PRESETS: ModelPresetList = [];

function buildActiveSelection(
  chatProvider: string,
  chatModel: string,
  systemProvider: string,
  systemModel: string,
  imageCapable: boolean,
  contextWindowSize: string,
): ActiveSelection {
  const cwParsed = parseInt(contextWindowSize, 10);
  return {
    chatProvider,
    chatModel,
    systemProvider,
    systemModel,
    imageCapable,
    contextWindowSize: isNaN(cwParsed) ? 32768 : cwParsed,
  };
}

export default function PresetSwitcher({
  currentChatModel,
}: {
  currentChatModel: { provider: string; model: string } | null;
}) {
  const [presets, setPresetsState] = useLocalStorageJSON<ModelPresetList>(
    PRESETS_KEY,
    EMPTY_PRESETS,
  );
  const [chatProvider] = useLocalStorageString(SELECTION_KEYS.chatProvider, '');
  const [chatModelKey] = useLocalStorageString(SELECTION_KEYS.chatModel, '');
  const [systemProvider] = useLocalStorageString(
    SELECTION_KEYS.systemProvider,
    '',
  );
  const [systemModelKey] = useLocalStorageString(
    SELECTION_KEYS.systemModel,
    '',
  );
  const [imageCapable] = useLocalStorageBoolean(
    SELECTION_KEYS.imageCapable,
    false,
  );
  const [contextWindowSizeStr] = useLocalStorageString(
    SELECTION_KEYS.contextWindowSize,
    '32768',
  );

  const { data: modelsData } = useModels();
  const chatProviders = (modelsData?.chatModelProviders ?? {}) as Record<
    string,
    Record<string, { displayName: string }>
  >;

  const [namingPreset, setNamingPreset] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const savingRef = useRef(false);

  const activeSelection = buildActiveSelection(
    chatProvider,
    chatModelKey,
    systemProvider,
    systemModelKey,
    imageCapable,
    contextWindowSizeStr,
  );
  const matchingPreset = findMatchingPreset(presets, activeSelection);

  const saveNewPreset = (close: () => void) => {
    if (savingRef.current) return;
    savingRef.current = true;
    const trimmedName = nameInput.trim().slice(0, PRESET_NAME_MAX);
    if (!trimmedName) {
      toast.error('Preset name cannot be empty');
      savingRef.current = false;
      return;
    }
    if (presets.length >= PRESET_MAX) {
      toast.error(`You can have at most ${PRESET_MAX} presets`);
      savingRef.current = false;
      return;
    }
    const sel = captureCurrentSelection();
    const newPreset = createPreset({
      name: trimmedName,
      chatProvider: sel.chatProvider,
      chatModel: sel.chatModel,
      systemProvider: sel.systemProvider,
      systemModel: sel.systemModel,
      imageCapable: sel.imageCapable,
      contextWindowSize: sel.contextWindowSize,
    });
    const updated = [...presets, newPreset];
    setPresetsState(updated);
    setNameInput('');
    setNamingPreset(false);
    toast.success(`Preset "${trimmedName}" saved`);
    savingRef.current = false;
    close();
  };

  const applyPreset = (preset: ModelPreset, close: () => void) => {
    applyPresetToStorage(preset);
    toast.success(`Applied preset "${preset.name}"`);
    close();
  };

  const canSave = !!currentChatModel;

  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-fg/80">Presets</span>
      <div className="flex items-center gap-2">
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
                aria-label="Select preset"
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
                <PopoverPanel className="absolute right-0 z-50 mt-1 w-72 rounded-floating bg-surface border border-surface-2 shadow-floating overflow-hidden">
                  <div className="max-h-64 overflow-y-auto">
                    {presets.length === 0 ? (
                      <div className="px-3 py-4 text-center text-xs text-fg/50">
                        No presets yet. Save the current selection to create
                        one.
                      </div>
                    ) : (
                      presets.map((preset) => (
                        <PresetOption
                          key={preset.id}
                          preset={preset}
                          isActive={matchingPreset?.id === preset.id}
                          available={isPresetAvailable(preset, chatProviders)}
                          onClick={() => applyPreset(preset, close)}
                        />
                      ))
                    )}
                  </div>

                  <div className="border-t border-surface-2 px-3 py-2 flex items-center justify-between">
                    {namingPreset ? (
                      <div className="flex items-center gap-1.5 w-full">
                        <input
                          autoFocus
                          type="text"
                          aria-label="Preset name"
                          maxLength={PRESET_NAME_MAX}
                          placeholder="Preset name…"
                          value={nameInput}
                          onChange={(e) => setNameInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveNewPreset(close);
                            if (e.key === 'Escape') {
                              setNamingPreset(false);
                              setNameInput('');
                            }
                          }}
                          className="flex-1 min-w-0 text-xs bg-bg border border-surface-2 rounded-control px-2 py-1 text-fg outline-none focus:border-accent"
                        />
                        <button
                          type="button"
                          onClick={() => saveNewPreset(close)}
                          className="shrink-0 text-xs px-2 py-1 rounded-control bg-accent text-accent-fg hover:bg-accent-700 transition-colors duration-150"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setNamingPreset(false);
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
                          disabled={!canSave}
                          onClick={() => setNamingPreset(true)}
                          className="text-xs text-fg/60 hover:text-fg transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
                          title={
                            canSave
                              ? 'Save current selection as preset'
                              : 'Select a chat model first'
                          }
                        >
                          Save current…
                        </button>
                        <Link
                          href="/settings?section=model-presets"
                          onClick={() => close()}
                          className="flex items-center gap-1 text-xs text-fg/40 hover:text-fg/70 transition-colors duration-150"
                        >
                          Manage
                          <ExternalLink size={10} />
                        </Link>
                      </>
                    )}
                  </div>
                </PopoverPanel>
              </Transition>
            </>
          )}
        </Popover>
      </div>
    </div>
  );
}
