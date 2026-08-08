'use client';

import { cn } from '@/lib/utils';

export interface TokenPopoverChoice {
  key: string;
  primary: string;
  secondary?: string;
  onSelect: () => void;
}

/** The completion list shared by the composer's `/skill` and `@artifact` triggers. */
export default function TokenPopover({
  choices,
  activeIndex,
  monospace = false,
}: {
  choices: TokenPopoverChoice[];
  activeIndex: number;
  monospace?: boolean;
}) {
  if (choices.length === 0) return null;
  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 border border-surface-2 rounded-control bg-surface shadow-raised overflow-hidden z-50">
      {choices.map((choice, idx) => (
        <button
          key={choice.key}
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            choice.onSelect();
          }}
          className={cn(
            'w-full text-left px-3 py-2 text-sm flex flex-col gap-0.5 hover:bg-surface-2 transition-colors',
            idx === activeIndex && 'bg-surface-2',
          )}
        >
          <span className={cn('text-accent', monospace && 'font-mono')}>
            {choice.primary}
          </span>
          {choice.secondary && (
            <span className="text-xs text-fg/50">{choice.secondary}</span>
          )}
        </button>
      ))}
    </div>
  );
}
