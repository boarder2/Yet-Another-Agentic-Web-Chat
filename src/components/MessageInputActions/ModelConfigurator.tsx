import { useEffect, useMemo, useState } from 'react';
import { Cpu, Link, SlidersHorizontal } from 'lucide-react';
import {
  Dialog,
  DialogPanel,
  Popover,
  PopoverButton,
  PopoverPanel,
  Transition,
  TransitionChild,
} from '@headlessui/react';
import { Fragment } from 'react';
import ModelSelector from './ModelSelector';
import PresetSwitcher from './PresetSwitcher';
import { cn } from '@/lib/utils';
import {
  useLocalStorageBoolean,
  useLocalStorageString,
  useLocalStorageJSON,
  writeLocalStorage,
} from '@/lib/hooks/useLocalStorage';
import { useModels } from '@/lib/hooks/api/useModels';
import {
  PRESETS_KEY,
  SELECTION_KEYS,
  type ModelPreset,
  type ModelPresetList,
  applyPresetToStorage,
  findMatchingPreset,
  isPresetAvailable,
} from '@/lib/models/presets';
import { toast } from 'sonner';
import PresetOption from './PresetOption';

type SelectedModel = { provider: string; model: string } | null;

const EMPTY_PRESETS: ModelPresetList = [];

export default function ModelConfigurator({
  showModelName,
  truncateModelName = true,
}: {
  showModelName?: boolean;
  truncateModelName?: boolean;
}) {
  const [open, setOpen] = useState(false);

  // Reactive localStorage reads — updates immediately when presets apply
  const [chatProvider, setChatProvider] = useLocalStorageString(
    SELECTION_KEYS.chatProvider,
    '',
  );
  const [chatModelKey, setChatModelKey] = useLocalStorageString(
    SELECTION_KEYS.chatModel,
    '',
  );
  const [systemProvider, setSystemProvider] = useLocalStorageString(
    SELECTION_KEYS.systemProvider,
    '',
  );
  const [systemModelKey, setSystemModelKey] = useLocalStorageString(
    SELECTION_KEYS.systemModel,
    '',
  );
  const [linkSystemToChat, setLinkSystemToChat] = useLocalStorageBoolean(
    SELECTION_KEYS.link,
    true,
  );
  const [imageCapable, setImageCapable] = useLocalStorageBoolean(
    SELECTION_KEYS.imageCapable,
    false,
  );
  const [contextWindowSizeStr] = useLocalStorageString(
    SELECTION_KEYS.contextWindowSize,
    '32768',
  );
  const [presets] = useLocalStorageJSON<ModelPresetList>(
    PRESETS_KEY,
    EMPTY_PRESETS,
  );

  const { data: modelsData } = useModels();
  const chatProviders = (modelsData?.chatModelProviders ?? {}) as Record<
    string,
    Record<string, { displayName: string }>
  >;

  // Prevent post-mount effects from using pre-hydration default values
  const [hydrated, setHydrated] = useState(false);

  const chatModel: SelectedModel =
    chatProvider && chatModelKey
      ? { provider: chatProvider, model: chatModelKey }
      : null;

  const systemModel: SelectedModel =
    systemProvider && systemModelKey
      ? { provider: systemProvider, model: systemModelKey }
      : null;

  // Responsive default for showing model text on the main button
  const computedShowName = useMemo(() => {
    if (typeof window === 'undefined') return false;
    if (typeof showModelName === 'boolean') return showModelName;
    return window.matchMedia('(min-width: 640px)').matches;
  }, [showModelName]);

  // Hydrate defaults once on mount without conflicting with SSR
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const linkStored = localStorage.getItem(SELECTION_KEYS.link);
      if (linkStored === null) {
        // Write default ON for new users; the reactive hook will pick it up
        writeLocalStorage(SELECTION_KEYS.link, 'true');
      }

      const storedChatProvider = localStorage.getItem(
        SELECTION_KEYS.chatProvider,
      );
      const storedChat = localStorage.getItem(SELECTION_KEYS.chatModel);
      const storedSystemProvider = localStorage.getItem(
        SELECTION_KEYS.systemProvider,
      );
      const storedSystem = localStorage.getItem(SELECTION_KEYS.systemModel);
      const isLinked = linkStored === null ? true : linkStored === 'true';

      if (
        (!storedSystemProvider || !storedSystem) &&
        isLinked &&
        storedChatProvider &&
        storedChat
      ) {
        // Mirror chat → system for new users who haven't set system explicitly
        writeLocalStorage(SELECTION_KEYS.systemProvider, storedChatProvider);
        writeLocalStorage(SELECTION_KEYS.systemModel, storedChat);
      }

      setHydrated(true);
    } catch (e) {
      console.error('ModelConfigurator: error loading model selection', e);
      setHydrated(true);
    }
  }, []);

  // When linking is enabled, mirror system to chat (after hydration)
  useEffect(() => {
    if (!hydrated) return;
    if (linkSystemToChat && chatProvider && chatModelKey) {
      setSystemProvider(chatProvider);
      setSystemModelKey(chatModelKey);
    }
  }, [
    hydrated,
    linkSystemToChat,
    chatProvider,
    chatModelKey,
    setSystemProvider,
    setSystemModelKey,
  ]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleSelectChat = (m: { provider: string; model: string }) => {
    setChatProvider(m.provider);
    setChatModelKey(m.model);
    if (linkSystemToChat) {
      setSystemProvider(m.provider);
      setSystemModelKey(m.model);
    }
  };

  const handleSelectSystem = (m: { provider: string; model: string }) => {
    if (linkSystemToChat) return;
    setSystemProvider(m.provider);
    setSystemModelKey(m.model);
  };

  const mainButtonText = useMemo(() => {
    if (!computedShowName) return null;
    if (!chatModelKey) return 'Loading...';
    return `Chat: ${chatModelKey} (${chatProvider})`;
  }, [computedShowName, chatModelKey, chatProvider]);

  const matchingPreset = useMemo(() => {
    const cwParsed = parseInt(contextWindowSizeStr, 10);
    return findMatchingPreset(presets, {
      chatProvider,
      chatModel: chatModelKey,
      systemProvider,
      systemModel: systemModelKey,
      imageCapable,
      contextWindowSize: isNaN(cwParsed) ? 32768 : cwParsed,
    });
  }, [
    presets,
    chatProvider,
    chatModelKey,
    systemProvider,
    systemModelKey,
    imageCapable,
    contextWindowSizeStr,
  ]);

  const applyPreset = (preset: ModelPreset, close: () => void) => {
    applyPresetToStorage(preset);
    toast.success(`Applied preset "${preset.name}"`);
    close();
  };

  const hasPresets = presets.length > 0;

  const buttonInner = (
    <>
      <Cpu size={18} />
      {computedShowName && (
        <span
          className={cn(
            'ml-2 text-xs font-medium overflow-hidden text-ellipsis whitespace-nowrap',
            {
              'max-w-44': truncateModelName,
            },
          )}
        >
          {mainButtonText}
        </span>
      )}
    </>
  );

  const buttonClass =
    'p-1 group flex items-center text-fg/50 rounded-floating hover:bg-surface-2 active:scale-95 transition duration-200 hover:text-fg';

  return (
    <>
      {hasPresets ? (
        <Popover className="relative">
          {({ close }) => (
            <>
              <PopoverButton
                type="button"
                className={buttonClass}
                aria-label="Choose model preset"
              >
                {buttonInner}
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
                <PopoverPanel className="absolute right-0 bottom-full z-50 mb-2 w-72 rounded-floating bg-surface border border-surface-2 shadow-floating overflow-hidden">
                  <div className="px-3 py-2 border-b border-surface-2">
                    <span className="text-xs font-semibold text-fg/80">
                      Model Presets
                    </span>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {presets.map((preset) => (
                      <PresetOption
                        key={preset.id}
                        preset={preset}
                        isActive={matchingPreset?.id === preset.id}
                        available={isPresetAvailable(preset, chatProviders)}
                        onClick={() => applyPreset(preset, close)}
                      />
                    ))}
                  </div>
                  <div className="border-t border-surface-2 px-3 py-2">
                    <button
                      type="button"
                      onClick={() => {
                        close();
                        setOpen(true);
                      }}
                      className="flex items-center gap-1.5 text-xs text-fg/60 hover:text-fg transition-colors duration-150"
                    >
                      <SlidersHorizontal size={12} />
                      Configure models…
                    </button>
                  </div>
                </PopoverPanel>
              </Transition>
            </>
          )}
        </Popover>
      ) : (
        <button
          type="button"
          className={buttonClass}
          onClick={() => setOpen(true)}
          aria-label="Configure models"
        >
          {buttonInner}
        </button>
      )}

      <Transition show={open} as={Fragment}>
        <Dialog onClose={() => setOpen(false)} className="relative z-50">
          <TransitionChild
            as={Fragment}
            enter="transition-opacity ease-out duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="transition-opacity ease-in duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-overlay" />
          </TransitionChild>

          <div className="fixed inset-0 flex items-center justify-center p-4">
            <TransitionChild
              as={Fragment}
              enter="transition ease-out duration-200"
              enterFrom="opacity-0 translate-y-1"
              enterTo="opacity-100 translate-y-0"
              leave="transition ease-in duration-150"
              leaveFrom="opacity-100 translate-y-0"
              leaveTo="opacity-0 translate-y-1"
            >
              <DialogPanel className="w-full max-w-lg rounded-surface bg-surface border border-surface-2 shadow-raised">
                <div className="px-5 py-4 border-b border-surface-2">
                  <h2 className="text-sm font-semibold text-fg/90">
                    Model Configuration
                  </h2>
                  <p className="text-xs text-fg/60 mt-1">
                    Choose the Chat and System models. Link them to keep System
                    in sync with Chat.
                  </p>
                </div>
                <div className="p-5 space-y-4">
                  {/* Preset switcher */}
                  <PresetSwitcher currentChatModel={chatModel} />

                  <div className="flex items-center justify-between">
                    <span className="text-xs text-fg/80">
                      Link System to Chat
                    </span>
                    <label className="inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        aria-label="Link System model to Chat model"
                        className="sr-only peer"
                        checked={linkSystemToChat}
                        onChange={(e) => setLinkSystemToChat(e.target.checked)}
                      />
                      <div className="w-10 h-5 bg-surface-2 rounded-pill peer peer-checked:bg-accent transition-colors relative">
                        <div
                          className={cn(
                            'absolute top-0.5 left-0.5 w-4 h-4 rounded-pill bg-bg transition-transform',
                            linkSystemToChat
                              ? 'translate-x-5'
                              : 'translate-x-0',
                          )}
                        />
                      </div>
                    </label>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs text-fg/80">Vision capable</span>
                      <p className="text-[10px] text-fg/50 mt-0.5">
                        Allow image attachments for the selected chat model
                      </p>
                    </div>
                    <label className="inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        aria-label="Vision capable"
                        className="sr-only peer"
                        checked={imageCapable}
                        onChange={(e) => setImageCapable(e.target.checked)}
                      />
                      <div className="w-10 h-5 bg-surface-2 rounded-pill peer peer-checked:bg-accent transition-colors relative">
                        <div
                          className={cn(
                            'absolute top-0.5 left-0.5 w-4 h-4 rounded-pill bg-bg transition-transform',
                            imageCapable ? 'translate-x-5' : 'translate-x-0',
                          )}
                        />
                      </div>
                    </label>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-fg/70">Chat Model</span>
                      <ModelSelector
                        role="chat"
                        selectedModel={chatModel}
                        setSelectedModel={handleSelectChat}
                        showModelName
                        truncateModelName
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-fg/70">System Model</span>
                        {linkSystemToChat && (
                          <span className="text-[10px] bg-surface px-2 py-0.5 rounded-control border border-surface-2 text-fg/60">
                            <Link size={14} />
                          </span>
                        )}
                      </div>
                      <div
                        className={cn(
                          'relative',
                          linkSystemToChat
                            ? 'opacity-60 pointer-events-none'
                            : '',
                        )}
                      >
                        <ModelSelector
                          role="system"
                          selectedModel={systemModel}
                          setSelectedModel={handleSelectSystem}
                          showModelName
                          truncateModelName
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="px-5 py-3 border-t border-surface-2 flex justify-end gap-2">
                  <button
                    type="button"
                    className="px-3 py-1.5 text-sm rounded-control bg-surface-2 hover:bg-surface-2/80 text-fg/80"
                    onClick={() => setOpen(false)}
                  >
                    Close
                  </button>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </Dialog>
      </Transition>
    </>
  );
}
