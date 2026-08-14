'use client';

import { cn } from '@/lib/utils';
import { SelectHTMLAttributes, ReactNode } from 'react';
import { controlClasses } from './Input';
import { useFieldControl } from './Field';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options?: { value: string; label: string; disabled?: boolean }[];
  children?: ReactNode;
}

export const Select = ({
  className,
  options,
  children,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  ...restProps
}: SelectProps) => {
  const { describedBy, invalid, labelId, grouped } = useFieldControl();

  return (
    <select
      aria-label={ariaLabel}
      aria-labelledby={
        ariaLabelledBy ?? (ariaLabel || grouped ? undefined : labelId)
      }
      aria-describedby={ariaDescribedBy ?? describedBy}
      aria-invalid={ariaInvalid ?? (invalid ? true : undefined)}
      {...restProps}
      className={cn(controlClasses, className)}
    >
      {children ??
        options?.map(({ label, value, disabled }) => (
          <option key={value} value={value} disabled={disabled}>
            {label}
          </option>
        ))}
    </select>
  );
};

export default Select;
