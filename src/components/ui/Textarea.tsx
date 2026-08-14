'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { useFieldControl } from './Field';
import { controlClasses } from './Input';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
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
      <textarea
        ref={ref}
        aria-label={ariaLabel}
        aria-labelledby={
          ariaLabelledBy ?? (ariaLabel || grouped ? undefined : labelId)
        }
        aria-describedby={ariaDescribedBy ?? describedBy}
        aria-invalid={ariaInvalid ?? (invalid ? true : undefined)}
        className={cn('w-full resize-y', controlClasses, className)}
        {...props}
      />
    );
  },
);
Textarea.displayName = 'Textarea';

export { Textarea };
export default Textarea;
