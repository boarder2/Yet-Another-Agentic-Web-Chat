import type { ReactNode } from 'react';
import { BookMarked, ChevronDown } from 'lucide-react';
import {
  Popover,
  PopoverButton,
  PopoverPanel,
  Transition,
} from '@headlessui/react';
import { Fragment } from 'react';
import { cn } from '@/lib/utils';
import { ListEmptyState } from '@/components/ui/List';

export interface PresetPopoverRenderProps {
  close: () => void;
}

interface PresetPopoverProps {
  triggerLabel: ReactNode;
  ariaLabel: string;
  hasPresets: boolean;
  emptyBody: ReactNode;
  children: (props: PresetPopoverRenderProps) => ReactNode;
  footer: (props: PresetPopoverRenderProps) => ReactNode;
}

const PresetPopover = ({
  triggerLabel,
  ariaLabel,
  hasPresets,
  emptyBody,
  children,
  footer,
}: PresetPopoverProps) => (
  <Popover className="relative">
    {({ open, close }) => {
      const renderProps = { close };

      return (
        <>
          <PopoverButton
            type="button"
            className={cn(
              'flex items-center gap-1.5 rounded-control border px-2.5 py-1.5 text-xs transition-colors duration-150 focus-border-neutral',
              open
                ? 'border-border-strong bg-surface-2 text-fg'
                : 'border-surface-2 bg-surface text-fg-muted hover:bg-surface-2 hover:text-fg',
            )}
            aria-label={ariaLabel}
          >
            <BookMarked size={12} />
            <span className="max-w-28 truncate">{triggerLabel}</span>
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
            enter="transition-[opacity,transform] ease-out duration-100"
            enterFrom="opacity-0 scale-95"
            enterTo="opacity-100 scale-100"
            leave="transition-[opacity,transform] ease-in duration-100"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95"
          >
            <PopoverPanel className="absolute right-0 z-50 mt-1 w-72 overflow-hidden rounded-floating border border-surface-2 bg-surface shadow-floating">
              <div className="max-h-64 overflow-y-auto">
                {hasPresets ? (
                  children(renderProps)
                ) : (
                  <ListEmptyState
                    layout="compact"
                    body={emptyBody}
                    className="px-3 py-4"
                  />
                )}
              </div>
              <div className="flex items-center justify-between border-t border-surface-2 px-3 py-2">
                {footer(renderProps)}
              </div>
            </PopoverPanel>
          </Transition>
        </>
      );
    }}
  </Popover>
);

export default PresetPopover;
