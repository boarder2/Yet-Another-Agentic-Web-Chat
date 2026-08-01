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
  ...restProps
}: SelectProps) => {
  const { describedBy, invalid } = useFieldControl();

  return (
    <select
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
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
