'use client';

import { LoaderCircle } from 'lucide-react';

interface TextareaProps extends React.InputHTMLAttributes<HTMLTextAreaElement> {
  isSaving?: boolean;
  onSave?: (value: string) => void;
}

const TextareaComponent = ({
  className: _className,
  isSaving,
  onSave,
  ...restProps
}: TextareaProps) => {
  return (
    <div className="relative">
      <textarea
        placeholder="Any special instructions for the LLM"
        className="placeholder:text-sm text-sm w-full flex items-center justify-between p-3 bg-surface rounded-surface hover:bg-surface-2 transition-colors"
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
