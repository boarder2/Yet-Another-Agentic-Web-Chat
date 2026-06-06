import { useEffect, useMemo, useState } from 'react';
import { Cpu, SlidersHorizontal } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import {
  useLocalStorageBoolean,
  useLocalStorageString,
  useLocalStorageJSON,
  writeLocalStorage,
  writeLocalStorageBatch,
} from '@/lib/hooks/useLocalStorage';
import { useModels } from '@/lib/hooks/api/useModels';
import {
  PRESETS_KEY,
  SELECTION_KEYS,
  DEFAULT_CONTEXT_WINDOW,
  type ModelPreset,
  type ModelPresetList,
  type ModelSelection,
  applyPresetToStorage,
  writeSelectionToStorage,
  findMatchingPreset,
  selectionToActiveSelection,
  isPresetAvailable,
} from '@/lib/models/presets';
import { toast } from 'sonner';
import ModelPicker from '@/components/models/ModelPicker';
import PresetOption from '@/components/models/PresetOption';

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
  const [linkSystemToChat] = useLocalStorageBoolean(SELECTION_KEYS.link, true);
  const [imageCapable] = useLocalStorageBoolean(
    SELECTION_KEYS.imageCapable,
    false,
  );
  const [contextWindowSizeStr] = useLocalStorageString(
    SELECTION_KEYS.contextWindowSize,
    String(DEFAULT_CONTEXT_WINDOW),
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

  const cwParsed = parseInt(contextWindowSizeStr, 10);
  const contextWindowSize = isNaN(cwParsed) ? DEFAULT_CONTEXT_WINDOW : cwParsed;

  // Controlled value for ModelPicker. When linked, mirror system to chat so the
  // (disabled) system field always reflects the chat model.
  const value: ModelSelection = {
    chatProvider,
    chatModel: chatModelKey,
    systemProvider: linkSystemToChat ? chatProvider : systemProvider,
    systemModel: linkSystemToChat ? chatModelKey : systemModelKey,
    linkSystemToChat,
    imageCapable,
    contextWindowSize,
  };

  // Responsive default for showing model text on the main button
  const computedShowName = useMemo(() => {
    if (typeof window === 'undefined') return false;
    if (typeof showModelName === 'boolean') return showModelName;
    return window.matchMedia('(min-width: 640px)').matches;
  }, [showModelName]);

  // Hydrate defaults once on mount without conflicting with SSR
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
    } catch (e) {
      console.error('ModelConfigurator: error loading model selection', e);
    }
  }, []);

  // When linked, keep the stored system model mirrored to chat. Chat requests
  // read systemModel directly from localStorage and don't re-check the link
  // flag, and chat-model fallback elsewhere can rewrite the chat keys without
  // touching system — so enforce consistency here. Writes only when out of sync
  // (the reactive reads then satisfy the guard, preventing a loop).
  useEffect(() => {
    if (!linkSystemToChat || !chatProvider || !chatModelKey) return;
    if (systemProvider !== chatProvider || systemModelKey !== chatModelKey) {
      writeLocalStorageBatch([
        [SELECTION_KEYS.systemProvider, chatProvider],
        [SELECTION_KEYS.systemModel, chatModelKey],
      ]);
    }
  }, [
    linkSystemToChat,
    chatProvider,
    chatModelKey,
    systemProvider,
    systemModelKey,
  ]);

  const handleChange = (next: ModelSelection) => {
    writeSelectionToStorage(next);
  };

  const mainButtonText = useMemo(() => {
    if (!computedShowName) return null;
    if (!chatModelKey) return 'Loading...';
    return `Chat: ${chatModelKey} (${chatProvider})`;
  }, [computedShowName, chatModelKey, chatProvider]);

  const matchingPreset = useMemo(
    () => findMatchingPreset(presets, selectionToActiveSelection(value)),
    // value is derived from the listed primitives; depend on them directly
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      presets,
      chatProvider,
      chatModelKey,
      systemProvider,
      systemModelKey,
      imageCapable,
      contextWindowSize,
    ],
  );

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
                <div className="p-5">
                  <ModelPicker
                    value={value}
                    onChange={handleChange}
                    fields={{ system: true, vision: true, contextWindow: true }}
                    presets="full"
                    layout="dialog"
                  />
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
