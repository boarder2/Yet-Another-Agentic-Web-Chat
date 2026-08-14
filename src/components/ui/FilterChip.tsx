import React from 'react';
import { cn } from '@/lib/utils';

export type FilterChipSize = 'sm' | 'md';

const sizeClasses: Record<FilterChipSize, string> = {
  sm: 'gap-1 px-2.5 py-1 text-xs',
  md: 'gap-1.5 px-3 py-1.5 text-sm',
};

export const filterChipClasses = (
  selected: boolean,
  size: FilterChipSize = 'sm',
  tint?: string,
) =>
  cn(
    'inline-flex items-center whitespace-nowrap rounded-pill border font-medium transition-colors duration-150 focus-border-neutral disabled:cursor-not-allowed disabled:opacity-50',
    sizeClasses[size],
    selected
      ? (tint ?? 'bg-accent-soft border-accent-border text-accent')
      : 'bg-surface border-surface-2 text-fg-muted hover:border-border-strong hover:text-fg',
  );

export interface FilterChipProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'type'
> {
  selected?: boolean;
  size?: FilterChipSize;
  tint?: string;
}

export const FilterChip = React.forwardRef<HTMLButtonElement, FilterChipProps>(
  ({ selected = false, size = 'sm', tint, className, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-pressed={selected}
      className={cn(filterChipClasses(selected, size, tint), className)}
      {...props}
    />
  ),
);
FilterChip.displayName = 'FilterChip';
