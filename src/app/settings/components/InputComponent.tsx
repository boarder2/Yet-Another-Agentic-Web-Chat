'use client';

import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  isSaving?: boolean;
  onSave?: (value: string) => void;
}

const InputComponent = ({
  className,
  isSaving,
  onSave,
  ...restProps
}: InputProps) => {
  return (
    <div className="relative">
      <input
        {...restProps}
        className={cn(
          'bg-surface w-full px-3 py-2 flex items-center overflow-hidden rounded-lg text-sm',
          isSaving && 'pr-10',
          className,
        )}
        onBlur={(e) => onSave?.(e.target.value)}
      />
      {isSaving && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          <Loader2 size={16} className="animate-spin" />
        </div>
      )}
    </div>
  );
};

export default InputComponent;
