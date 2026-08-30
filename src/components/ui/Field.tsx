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
  /** Place a single control beside its label and hint on wider surfaces. */
  layout?: 'stacked' | 'horizontal';
  className?: string;
  children: ReactNode;
}

/**
 * Stacked single-control fields use an implicit label. Horizontal fields expose
 * the label through FieldContext so the control can sit beside its label and
 * hint. Composite fields use a fieldset/legend instead. Captions are exposed
 * through FieldContext for every layout.
 */
const Field = ({
  label,
  hint,
  error,
  grouped = false,
  layout = 'stacked',
  className,
  children,
}: FieldProps) => {
  const fieldId = useId();
  const horizontal = !grouped && layout === 'horizontal';
  const labelId = `${fieldId}-label`;
  const captionId = `${fieldId}-caption`;
  const caption = error ?? hint;
  const contextValue = {
    describedBy: caption ? captionId : undefined,
    invalid: !!error,
    labelId: grouped || horizontal ? labelId : undefined,
    grouped,
  };
  const captionElement = caption ? (
    <p
      id={captionId}
      className={cn('text-xs', error ? 'text-danger' : 'text-fg-muted')}
    >
      {caption}
    </p>
  ) : null;

  return (
    <div
      className={cn(
        horizontal
          ? 'flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-2'
          : 'flex flex-col gap-1.5',
        !grouped && className,
      )}
    >
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
      ) : horizontal ? (
        <>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span id={labelId} className="text-sm font-medium text-fg">
              {label}
            </span>
            {captionElement}
          </div>
          <FieldContext.Provider value={contextValue}>
            {children}
          </FieldContext.Provider>
        </>
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
      {!horizontal && captionElement}
    </div>
  );
};

export { Field };
export default Field;
