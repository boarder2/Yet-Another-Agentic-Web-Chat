import React from 'react';
import { LoaderCircle, LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-1.5 rounded-control border border-transparent transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed';

/* Hover text colors are pinned because globals.css sets `color: accent` on every enabled button:hover. */
const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-accent-fg enabled:hover:bg-accent-700 enabled:hover:text-accent-fg focus-border-contrast',
  /* surface-2, not surface: these sit on bg-bg pages *and* on bg-surface cards. */
  secondary:
    'bg-surface-2 text-fg enabled:hover:bg-surface enabled:hover:text-fg focus-border-neutral',
  ghost:
    'text-fg enabled:hover:bg-surface-2 enabled:hover:text-fg focus-border-neutral',
  danger:
    'bg-danger text-danger-fg enabled:hover:bg-danger-700 enabled:hover:text-danger-fg focus-border-contrast',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'px-2 py-1 text-xs',
  md: 'px-3 py-2 text-sm',
  lg: 'px-5 py-2 text-sm font-medium',
};

const iconSizes: Record<ButtonSize, number> = { sm: 14, md: 16, lg: 16 };

export const buttonClasses = (
  variant: ButtonVariant = 'secondary',
  size: ButtonSize = 'md',
) => cn(base, variants[variant], sizes[size]);

export interface ButtonProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'type'
> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  loading?: boolean;
  type?: 'button' | 'submit';
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'secondary',
      size = 'md',
      icon: Icon,
      loading = false,
      className,
      disabled,
      children,
      type = 'button',
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      type={type === 'submit' ? 'submit' : 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonClasses(variant, size), className)}
      {...props}
    >
      {loading ? (
        <LoaderCircle size={iconSizes[size]} className="animate-spin" />
      ) : (
        Icon && <Icon size={iconSizes[size]} />
      )}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';

export { Button };
