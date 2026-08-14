import React from 'react';
import { cn } from '@/lib/utils';

export type ComposerActionButtonGeometry = 'compact' | 'content';

export interface ComposerActionButtonProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'type'
> {
  geometry?: ComposerActionButtonGeometry;
  configured?: boolean;
  open?: boolean;
  type?: 'button' | 'submit';
}

const ComposerActionButton = React.forwardRef<
  HTMLButtonElement,
  ComposerActionButtonProps
>(
  (
    {
      geometry = 'compact',
      configured = false,
      open = false,
      className,
      disabled,
      type = 'button',
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      type={type === 'submit' ? 'submit' : 'button'}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-control border border-transparent transition-colors duration-150 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 focus-border-neutral',
        geometry === 'compact' ? 'h-8 w-8' : 'min-h-8 px-2',
        open
          ? 'bg-surface-2 text-accent hover:text-accent'
          : configured
            ? 'text-accent hover:bg-surface-2 hover:text-accent'
            : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
        'disabled:text-fg-subtle disabled:hover:bg-transparent disabled:hover:text-fg-subtle',
        className,
      )}
      {...props}
    />
  ),
);

ComposerActionButton.displayName = 'ComposerActionButton';

export default ComposerActionButton;
