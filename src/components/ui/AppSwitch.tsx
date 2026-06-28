'use client';

import { Switch } from '@headlessui/react';

type AppSwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  'aria-label'?: string;
};

export default function AppSwitch({
  checked,
  onChange,
  disabled,
  'aria-label': ariaLabel,
}: AppSwitchProps) {
  return (
    <Switch
      checked={checked}
      onChange={onChange}
      disabled={disabled}
      aria-label={ariaLabel}
      className="group relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer rounded-pill border-2 border-transparent bg-surface-2 transition-colors duration-200 ease-in-out focus:outline-none data-checked:bg-accent data-disabled:cursor-not-allowed data-disabled:opacity-40"
    >
      <span className="pointer-events-none inline-block h-4 w-4 translate-x-0 rounded-pill bg-bg shadow ring-0 transition duration-200 ease-in-out group-data-checked:translate-x-5" />
    </Switch>
  );
}
