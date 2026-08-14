import React from 'react';
import { cn } from '@/lib/utils';

export type BadgeTone =
  'default' | 'accent' | 'danger' | 'success' | 'warning' | 'info';
export type BadgeSize = 'standard' | 'compact';

const tones: Record<BadgeTone, string> = {
  default: 'bg-surface text-fg-subtle',
  accent: 'bg-accent-soft text-accent',
  danger: 'bg-danger-soft text-danger',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  info: 'bg-info-soft text-info',
};

const sizes: Record<BadgeSize, string> = {
  standard: 'rounded-pill px-2 py-0.5 text-xs',
  compact: 'rounded-control px-1 py-0.5 text-2xs',
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  size?: BadgeSize;
}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ tone = 'default', size = 'standard', className, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 border border-transparent',
        sizes[size],
        tones[tone],
        className,
      )}
      {...props}
    />
  ),
);
Badge.displayName = 'Badge';

export { Badge };
export default Badge;
