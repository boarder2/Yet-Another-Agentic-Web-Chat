'use client';

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import AppSwitch from '@/components/ui/AppSwitch';

export interface SettingToggleRowProps {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  icon?: LucideIcon;
  nested?: boolean;
  mutedLabel?: boolean;
  ariaLabel?: string;
  title?: string;
  className?: string;
}

const SettingToggleRow = ({
  label,
  description,
  checked,
  onChange,
  disabled,
  icon: Icon,
  nested = false,
  mutedLabel = false,
  ariaLabel,
  title,
  className,
}: SettingToggleRowProps) => (
  <div
    className={cn(
      'flex items-center justify-between gap-3',
      nested && 'border-l-2 border-surface-2 pl-4',
      className,
    )}
  >
    <div className="flex min-w-0 flex-1 items-center gap-3">
      {Icon && (
        <span className="flex shrink-0 items-center justify-center rounded-surface bg-surface-2 p-2">
          <Icon size={18} />
        </span>
      )}
      <div className="min-w-0">
        <p
          className={
            mutedLabel ? 'text-xs text-fg-muted' : 'text-sm font-medium'
          }
        >
          {label}
        </p>
        {description !== undefined && (
          <p className="mt-0.5 text-xs text-fg-muted">{description}</p>
        )}
      </div>
    </div>
    <AppSwitch
      checked={checked}
      onChange={onChange}
      disabled={disabled}
      aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
      title={title}
    />
  </div>
);

export { SettingToggleRow };
export default SettingToggleRow;
