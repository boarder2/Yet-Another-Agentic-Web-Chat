import { Globe, MessageCircle, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverButton,
  PopoverPanel,
  Transition,
} from '@headlessui/react';
import { Fragment } from 'react';
import { focusModes as focusModeDefinitions } from '@/lib/focusModes';
import ComposerActionButton from '@/components/MessageInputActions/ComposerActionButton';
import ComposerPopover from '@/components/MessageInputActions/ComposerPopover';

const focusModes = focusModeDefinitions.map((mode) => ({
  ...mode,
  icon:
    mode.key === 'webSearch' ? (
      <Globe size={20} className="text-accent" />
    ) : mode.key === 'chat' ? (
      <MessageCircle size={20} className="text-accent" />
    ) : (
      <Pencil size={20} className="text-accent" />
    ),
}));

const Focus = ({
  focusMode,
  setFocusMode,
}: {
  focusMode: string;
  setFocusMode: (mode: string) => void;
}) => {
  const currentMode = focusModes.find((mode) => mode.key === focusMode);

  return (
    <Popover className="relative">
      {({ open }) => (
        <>
          <PopoverButton
            as={ComposerActionButton}
            geometry="compact"
            configured={focusMode !== 'webSearch'}
            open={open}
            title="Focus Mode"
            aria-label="Focus mode"
          >
            {currentMode?.icon ?? <Globe size={18} />}
          </PopoverButton>
          <Transition
            as={Fragment}
            enter="transition-[opacity,transform] ease-out duration-200"
            enterFrom="opacity-0 translate-y-1"
            enterTo="opacity-100 translate-y-0"
            leave="transition-[opacity,transform] ease-in duration-150"
            leaveFrom="opacity-100 translate-y-0"
            leaveTo="opacity-0 translate-y-1"
          >
            <PopoverPanel className="absolute left-0 z-20 w-72 transform bottom-full mb-2 overflow-hidden">
              <ComposerPopover
                title="Focus Mode"
                description="Choose how to search"
              >
                <div className="max-h-60 overflow-y-auto p-1.5">
                  {focusModes.map((mode) => (
                    <div
                      key={mode.key}
                      onClick={() => setFocusMode(mode.key)}
                      className={cn(
                        'flex items-center gap-3 p-2.5 rounded-control hover:bg-surface-2 cursor-pointer',
                        focusMode === mode.key
                          ? 'text-accent'
                          : 'text-fg-muted',
                      )}
                    >
                      <div className="flex-shrink-0">{mode.icon}</div>
                      <div>
                        <p className="text-sm font-medium">{mode.title}</p>
                        <p className="text-xs text-fg-muted">
                          {mode.description}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </ComposerPopover>
            </PopoverPanel>
          </Transition>
        </>
      )}
    </Popover>
  );
};

export default Focus;
