'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { useFieldControl } from './Field';

/* Focus flips the border in place rather than drawing an outline, so the control never shifts. */
export const controlClasses =
  'px-3 py-2 rounded-control bg-well border border-surface-2 text-sm text-fg placeholder:text-fg-subtle transition-colors duration-150 focus-border-neutral disabled:opacity-50 disabled:cursor-not-allowed';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      'aria-label': ariaLabel,
      'aria-labelledby': ariaLabelledBy,
      'aria-describedby': ariaDescribedBy,
      'aria-invalid': ariaInvalid,
      ...props
    },
    ref,
  ) => {
    const { describedBy, invalid, labelId, grouped } = useFieldControl();

    return (
      <input
        ref={ref}
        aria-label={ariaLabel}
        aria-labelledby={
          ariaLabelledBy ?? (ariaLabel || grouped ? undefined : labelId)
        }
        aria-describedby={ariaDescribedBy ?? describedBy}
        aria-invalid={ariaInvalid ?? (invalid ? true : undefined)}
        className={cn('w-full', controlClasses, className)}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };
export default Input;
