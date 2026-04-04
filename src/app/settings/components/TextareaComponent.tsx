'use client';

import { Loader2 } from 'lucide-react';

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
        className="placeholder:text-sm text-sm w-full flex items-center justify-between p-3 bg-surface rounded-lg hover:bg-surface-2 transition-colors"
        rows={4}
        onBlur={(e) => onSave?.(e.target.value)}
        {...restProps}
      />
      {isSaving && (
        <div className="absolute right-3 top-3">
          <Loader2 size={16} className="animate-spin" />
        </div>
      )}
    </div>
  );
};

export default TextareaComponent;
