import React, { type ReactNode } from 'react';
import { CheckSquare, Circle, CircleDot, Square } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ComposerOptionRowMode = 'radio' | 'check' | 'none';

export interface ComposerOptionRowProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'type' | 'aria-pressed'
> {
  selected: boolean;
  mode: ComposerOptionRowMode;
  label: ReactNode;
  description?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
}

const ComposerOptionRow = React.forwardRef<
  HTMLButtonElement,
  ComposerOptionRowProps
>(
  (
    {
      selected,
      mode,
      label,
      description,
      leading,
      trailing,
      className,
      ...props
    },
    ref,
  ) => {
    const indicator =
      mode === 'radio' ? (
        selected ? (
          <CircleDot size={18} className="shrink-0 text-accent" />
        ) : (
          <Circle size={18} className="shrink-0 text-fg-subtle" />
        )
      ) : mode === 'check' ? (
        selected ? (
          <CheckSquare size={18} className="shrink-0 text-accent" />
        ) : (
          <Square size={18} className="shrink-0 text-fg-subtle" />
        )
      ) : null;

    return (
      <button
        ref={ref}
        type="button"
        aria-pressed={mode === 'none' ? undefined : selected}
        className={cn(
          'flex w-full items-start gap-2.5 rounded-control border border-transparent p-2.5 text-left transition-colors duration-150 hover:bg-surface-2 focus-border-neutral',
          className,
        )}
        {...props}
      >
        {indicator}
        {leading}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-fg">{label}</span>
          {description !== undefined && (
            <span className="mt-0.5 block text-xs text-fg-muted">
              {description}
            </span>
          )}
        </span>
        {trailing}
      </button>
    );
  },
);

ComposerOptionRow.displayName = 'ComposerOptionRow';

export default ComposerOptionRow;
