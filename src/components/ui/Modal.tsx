'use client';

import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from '@headlessui/react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IconButton } from '@/components/ui/IconButton';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

/**
 * The one modal shell. headlessui supplies the focus trap, role="dialog",
 * Escape and background inerting; `xl`/`full` go edge-to-edge below `lg`
 * because those sizes have nowhere to fit on a phone.
 */
const sizes: Record<ModalSize, string> = {
  sm: 'w-full max-w-md max-h-[85vh] rounded-floating border border-surface-2 shadow-floating',
  md: 'w-full max-w-2xl max-h-[85vh] rounded-floating border border-surface-2 shadow-floating',
  lg: 'w-full max-w-4xl max-h-[85vh] rounded-floating border border-surface-2 shadow-floating',
  xl: 'w-full max-w-5xl lg:max-h-[85vh] lg:rounded-floating lg:border lg:border-surface-2 lg:shadow-floating',
  full: 'w-full lg:w-[95vw] lg:max-w-[95vw] h-full lg:h-[92vh] lg:rounded-floating lg:border lg:border-surface-2 lg:shadow-floating',
};

const gutters: Record<ModalSize, string> = {
  sm: 'p-4',
  md: 'p-4',
  lg: 'p-4',
  xl: 'lg:p-4',
  full: 'lg:p-4',
};

export default function Modal({
  open,
  onClose,
  size = 'md',
  title,
  footer,
  className,
  bodyClassName,
  children,
}: {
  open: boolean;
  onClose: () => void;
  size?: ModalSize;
  title?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  const bleeds = size === 'xl' || size === 'full';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      className="fixed inset-0 z-50 overflow-y-auto"
    >
      {/* Enter-only motion via @starting-style. Headless UI transitions
          deadlock when open flips mid-enter, leaving an invisible overlay
          that swallows clicks (tailwindlabs/headlessui#3892). */}
      <DialogBackdrop className="fixed inset-0 bg-overlay transition-opacity duration-200 starting:opacity-0" />
      <div
        className={cn(
          // `relative` keeps the panel above the positioned backdrop, which
          // would otherwise paint over this static container and swallow clicks.
          'relative flex min-h-full justify-center',
          bleeds ? 'items-stretch lg:items-center' : 'items-center',
          gutters[size],
        )}
      >
        <DialogPanel
          className={cn(
            'flex flex-col overflow-hidden bg-surface transition-[opacity,transform] duration-200 ease-standard starting:opacity-0 starting:scale-95',
            sizes[size],
            className,
          )}
        >
          {title && (
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-surface-2 px-5 py-3">
              <DialogTitle className="flex min-w-0 items-center gap-2 truncate font-medium">
                {title}
              </DialogTitle>
              <IconButton icon={X} label="Close" onClick={onClose} />
            </div>
          )}
          <div
            className={cn('min-h-0 flex-1 overflow-y-auto p-5', bodyClassName)}
          >
            {children}
          </div>
          {footer && (
            <div className="flex shrink-0 items-center justify-end gap-3 border-t border-surface-2 px-5 py-3">
              {footer}
            </div>
          )}
        </DialogPanel>
      </div>
    </Dialog>
  );
}
