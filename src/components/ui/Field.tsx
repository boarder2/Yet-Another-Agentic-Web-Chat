'use client';

import { createContext, useContext, useId } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type FieldControl = { describedBy?: string; invalid?: boolean };

const FieldContext = createContext<FieldControl>({});

/** Read by Input/Textarea/Select so a Field's hint or error is announced with the control. */
export const useFieldControl = () => useContext(FieldContext);

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  /** Replaces `hint` when set, and marks the control `aria-invalid`. */
  error?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * The label wraps the control, so association is implicit and works for any
 * child — Input, Select, ModelField, AppSwitch. The caption sits outside it, or
 * it would be concatenated into the control's accessible name.
 */
const Field = ({ label, hint, error, className, children }: FieldProps) => {
  const captionId = `${useId()}-caption`;
  const caption = error ?? hint;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-fg">{label}</span>
        <FieldContext.Provider
          value={{
            describedBy: caption ? captionId : undefined,
            invalid: !!error,
          }}
        >
          {children}
        </FieldContext.Provider>
      </label>
      {caption && (
        <p
          id={captionId}
          className={cn('text-xs', error ? 'text-danger' : 'text-fg/60')}
        >
          {caption}
        </p>
      )}
    </div>
  );
};

export { Field };
export default Field;
