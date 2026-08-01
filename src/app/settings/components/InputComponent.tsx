'use client';

import { LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/Input';

interface InputComponentProps extends React.InputHTMLAttributes<HTMLInputElement> {
  isSaving?: boolean;
  onSave?: (value: string) => void;
}

const InputComponent = ({
  className,
  isSaving,
  onSave,
  ...restProps
}: InputComponentProps) => {
  return (
    <div className="relative">
      <Input
        {...restProps}
        className={cn(isSaving && 'pr-10', className)}
        onBlur={(e) => onSave?.(e.target.value)}
      />
      {isSaving && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          <LoaderCircle size={16} className="animate-spin text-accent" />
        </div>
      )}
    </div>
  );
};

export default InputComponent;
