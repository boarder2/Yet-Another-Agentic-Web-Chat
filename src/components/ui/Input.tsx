'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { useFieldControl } from './Field';

/* Focus flips the border in place rather than drawing an outline, so the control never shifts. */
export const controlClasses =
  'px-3 py-2 rounded-control bg-well border border-surface-2 text-sm text-fg placeholder:text-fg/40 transition-colors duration-150 focus-visible:outline-none focus-visible:border-accent disabled:opacity-50 disabled:cursor-not-allowed';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => {
    const { describedBy, invalid } = useFieldControl();

    return (
      <input
        ref={ref}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        className={cn('w-full', controlClasses, className)}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };
export default Input;
