'use client';

import { createContext, useContext, useId } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type FieldControl = {
  describedBy?: string;
  invalid?: boolean;
  labelId?: string;
  grouped?: boolean;
};

const FieldContext = createContext<FieldControl>({});

/** Read by Input/Textarea/Select so a Field's hint or error is announced with the control. */
export const useFieldControl = () => useContext(FieldContext);

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  /** Replaces `hint` when set, and marks the control `aria-invalid`. */
  error?: ReactNode;
  /** Use a fieldset when the children contain more than one control. */
  grouped?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Single-control fields use an implicit label. Composite fields use a
 * fieldset/legend instead, so several controls are never nested in one label.
 * Captions stay outside the label and are exposed through FieldContext.
 */
const Field = ({
  label,
  hint,
  error,
  grouped = false,
  className,
  children,
}: FieldProps) => {
  const fieldId = useId();
  const labelId = `${fieldId}-label`;
  const captionId = `${fieldId}-caption`;
  const caption = error ?? hint;
  const contextValue = {
    describedBy: caption ? captionId : undefined,
    invalid: !!error,
    labelId: grouped ? labelId : undefined,
    grouped,
  };

  return (
    <div className={cn('flex flex-col gap-1.5', !grouped && className)}>
      {grouped ? (
        <fieldset
          className={cn(
            'flex min-w-0 flex-col gap-1.5 border-0 p-0',
            className,
          )}
          aria-describedby={caption ? captionId : undefined}
          aria-invalid={error ? true : undefined}
        >
          <legend id={labelId} className="text-sm font-medium text-fg">
            {label}
          </legend>
          <FieldContext.Provider value={contextValue}>
            {children}
          </FieldContext.Provider>
        </fieldset>
      ) : (
        <label className="flex flex-col gap-1.5">
          <span id={labelId} className="text-sm font-medium text-fg">
            {label}
          </span>
          <FieldContext.Provider value={contextValue}>
            {children}
          </FieldContext.Provider>
        </label>
      )}
      {caption && (
        <p
          id={captionId}
          className={cn('text-xs', error ? 'text-danger' : 'text-fg-muted')}
        >
          {caption}
        </p>
      )}
    </div>
  );
};

export { Field };
export default Field;
