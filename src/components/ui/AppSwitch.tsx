'use client';

import { Switch } from '@headlessui/react';
import { cn } from '@/lib/utils';

type AppSwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  'aria-label'?: string;
  title?: string;
};

export default function AppSwitch({
  checked,
  onChange,
  disabled,
  'aria-label': ariaLabel,
  title,
}: AppSwitchProps) {
  return (
    <Switch
      checked={checked}
      onChange={onChange}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      className={cn(
        'group relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer rounded-pill border border-transparent bg-surface-2 transition-colors duration-150 data-checked:bg-accent data-checked:text-accent-fg data-disabled:cursor-not-allowed data-disabled:opacity-40',
        checked ? 'focus-border-contrast' : 'focus-border-neutral',
      )}
    >
      <span className="pointer-events-none inline-block h-4 w-4 translate-x-0 rounded-pill bg-bg shadow ring-0 transition-transform duration-200 ease-standard group-data-checked:translate-x-5" />
    </Switch>
  );
}
