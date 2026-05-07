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

const focusModes = focusModeDefinitions.map((mode) => ({
  ...mode,
  icon:
    mode.key === 'webSearch' ? (
      <Globe size={20} className="text-accent" />
    ) : mode.key === 'chat' ? (
      <MessageCircle size={20} className="text-[#10B981]" />
    ) : (
      <Pencil size={20} className="text-[#8B5CF6]" />
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
      <PopoverButton
        className={cn(
          'p-2 rounded-control hover:bg-surface-2 transition duration-200',
          focusMode !== 'webSearch'
            ? 'text-accent'
            : 'text-fg/60 hover:text-fg/40',
        )}
        title="Focus Mode"
      >
        {currentMode?.icon ?? <Globe size={18} />}
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
        <PopoverPanel className="absolute left-0 z-20 w-72 transform bottom-full mb-2">
          <div className="overflow-hidden rounded-surface shadow-raised ring-1 ring-surface-2 bg-surface">
            <div className="px-4 py-3 border-b border-surface-2">
              <h3 className="text-sm font-medium text-fg/90">Focus Mode</h3>
              <p className="text-xs text-fg/60 mt-0.5">Choose how to search</p>
            </div>
            <div className="max-h-60 overflow-y-auto p-1.5">
              {focusModes.map((mode) => (
                <div
                  key={mode.key}
                  onClick={() => setFocusMode(mode.key)}
                  className={cn(
                    'flex items-center gap-3 p-2.5 rounded-control hover:bg-surface-2 cursor-pointer',
                    focusMode === mode.key ? 'text-accent' : 'text-fg/70',
                  )}
                >
                  <div className="flex-shrink-0">{mode.icon}</div>
                  <div>
                    <p className="text-sm font-medium">{mode.title}</p>
                    <p className="text-xs text-fg/50">{mode.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </PopoverPanel>
      </Transition>
    </Popover>
  );
};

export default Focus;
