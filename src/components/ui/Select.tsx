'use client';

import { cn } from '@/lib/utils';
import { SelectHTMLAttributes, ReactNode } from 'react';

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
  return (
    <select
      {...restProps}
      className={cn(
        'bg-surface px-3 py-2 border border-surface-2 rounded-control text-sm text-fg',
        className,
      )}
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
