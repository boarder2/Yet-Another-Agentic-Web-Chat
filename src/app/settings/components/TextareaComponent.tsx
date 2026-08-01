'use client';

import { LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Textarea } from '@/components/ui/Textarea';

interface TextareaComponentProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  isSaving?: boolean;
  onSave?: (value: string) => void;
}

const TextareaComponent = ({
  className,
  isSaving,
  onSave,
  ...restProps
}: TextareaComponentProps) => {
  return (
    <div className="relative">
      <Textarea
        placeholder="Any special instructions for the LLM"
        className={cn('p-3', isSaving && 'pr-10', className)}
        rows={4}
        onBlur={(e) => onSave?.(e.target.value)}
        {...restProps}
      />
      {isSaving && (
        <div className="absolute right-3 top-3">
          <LoaderCircle size={16} className="animate-spin text-accent" />
        </div>
      )}
    </div>
  );
};

export default TextareaComponent;
