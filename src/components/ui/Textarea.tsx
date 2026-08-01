'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { useFieldControl } from './Field';
import { controlClasses } from './Input';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    const { describedBy, invalid } = useFieldControl();

    return (
      <textarea
        ref={ref}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        className={cn('w-full resize-y', controlClasses, className)}
        {...props}
      />
    );
  },
);
Textarea.displayName = 'Textarea';

export { Textarea };
export default Textarea;
