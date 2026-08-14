import { useMemo, useState } from 'react';
import { Cpu, Eye, SlidersHorizontal } from 'lucide-react';
import {
  Popover,
  PopoverButton,
  PopoverPanel,
  Transition,
} from '@headlessui/react';
import { Fragment } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import {
  useLocalStorageBoolean,
  useLocalStorageString,
  useLocalStorageJSON,
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
  presetSummary,
  selectionToActiveSelection,
  isPresetAvailable,
} from '@/lib/models/presets';
import { toast } from 'sonner';
import ModelPicker from '@/components/models/ModelPicker';
import PresetOption from '@/components/models/PresetOption';
import type { WorkspaceModelOverride } from '@/lib/workspaces/types';
import ComposerActionButton from '@/components/MessageInputActions/ComposerActionButton';
import ComposerPopover from '@/components/MessageInputActions/ComposerPopover';

const EMPTY_PRESETS: ModelPresetList = [];

export default function ModelConfigurator({
  showModelName,
  truncateModelName = true,
  modelOverride,
}: {
  showModelName?: boolean;
  truncateModelName?: boolean;
  modelOverride?: WorkspaceModelOverride | null;
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

  // Controlled value for ModelPicker.
  const value: ModelSelection = {
    chatProvider,
    chatModel: chatModelKey,
    systemProvider,
    systemModel: systemModelKey,
    imageCapable,
    contextWindowSize,
  };

  // Responsive default for showing model text on the main button
  const computedShowName = useMemo(() => {
    if (typeof window === 'undefined') return false;
    if (typeof showModelName === 'boolean') return showModelName;
    return window.matchMedia('(min-width: 640px)').matches;
  }, [showModelName]);

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
            'text-xs font-medium overflow-hidden text-ellipsis whitespace-nowrap',
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

  if (modelOverride) {
    const chatName =
      chatProviders[modelOverride.chatProvider]?.[modelOverride.chatModel]
        ?.displayName ?? modelOverride.chatModel;
    const systemName =
      chatProviders[modelOverride.systemProvider]?.[modelOverride.systemModel]
        ?.displayName ?? modelOverride.systemModel;
    return (
      <Popover className="relative">
        {({ open }) => (
          <>
            <PopoverButton
              as={ComposerActionButton}
              type="button"
              geometry={computedShowName ? 'content' : 'compact'}
              configured
              open={open}
              aria-label="Models set by workspace"
            >
              <Cpu size={18} />
              {computedShowName && (
                <span
                  className={cn(
                    'text-xs font-medium overflow-hidden text-ellipsis whitespace-nowrap',
                    { 'max-w-44': truncateModelName },
                  )}
                >
                  Set by workspace
                </span>
              )}
            </PopoverButton>

            <Transition
              as={Fragment}
              enter="transition-[opacity,transform] ease-out duration-100"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="transition-[opacity,transform] ease-in duration-100"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <PopoverPanel className="absolute right-0 bottom-full z-50 mb-2 w-72 overflow-hidden">
                <ComposerPopover title="Models · set by workspace">
                  <div className="px-3 py-2 space-y-1 text-xs">
                    <div className="flex justify-between gap-3">
                      <span className="text-fg-subtle">Chat</span>
                      <span className="text-fg/90 text-right truncate">
                        {chatName} · {modelOverride.chatProvider}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-fg-subtle">System</span>
                      <span className="text-fg/90 text-right truncate">
                        {systemName} · {modelOverride.systemProvider}
                      </span>
                    </div>
                  </div>
                  <div className="border-t border-surface-2 px-3 py-2 text-xs text-fg-subtle">
                    Change this in the workspace&apos;s settings.
                  </div>
                </ComposerPopover>
              </PopoverPanel>
            </Transition>
          </>
        )}
      </Popover>
    );
  }

  return (
    <>
      {hasPresets ? (
        <Popover className="relative">
          {({ close, open }) => (
            <>
              <PopoverButton
                as={ComposerActionButton}
                type="button"
                geometry={computedShowName ? 'content' : 'compact'}
                configured={Boolean(matchingPreset)}
                open={open}
                aria-label="Choose model preset"
              >
                {buttonInner}
              </PopoverButton>

              <Transition
                as={Fragment}
                enter="transition-[opacity,transform] ease-out duration-100"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="transition-[opacity,transform] ease-in duration-100"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <PopoverPanel className="absolute right-0 bottom-full z-50 mb-2 w-72 overflow-hidden">
                  <ComposerPopover title="Model Presets">
                    <div className="max-h-64 overflow-y-auto">
                      {presets.map((preset) => (
                        <PresetOption
                          key={preset.id}
                          name={preset.name}
                          summary={presetSummary(preset)}
                          isActive={matchingPreset?.id === preset.id}
                          available={isPresetAvailable(preset, chatProviders)}
                          trailing={
                            preset.imageCapable ? (
                              <Eye
                                size={12}
                                className="mt-0.5 shrink-0 text-fg-subtle"
                              />
                            ) : undefined
                          }
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
                        className="flex items-center gap-1.5 border border-transparent text-xs text-fg-muted hover:text-fg transition-colors duration-150 focus-border-neutral"
                      >
                        <SlidersHorizontal size={12} />
                        Configure models…
                      </button>
                    </div>
                  </ComposerPopover>
                </PopoverPanel>
              </Transition>
            </>
          )}
        </Popover>
      ) : (
        <ComposerActionButton
          geometry={computedShowName ? 'content' : 'compact'}
          onClick={() => setOpen(true)}
          aria-label="Configure models"
        >
          {buttonInner}
        </ComposerActionButton>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Model Configuration"
        footer={
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Close
          </Button>
        }
      >
        <p className="text-xs text-fg-muted mb-4">
          Choose the Chat and System models, or apply a preset.
        </p>
        <ModelPicker
          value={value}
          onChange={handleChange}
          fields={{ system: true, vision: true, contextWindow: true }}
          presets="full"
          layout="dialog"
        />
      </Modal>
    </>
  );
}
