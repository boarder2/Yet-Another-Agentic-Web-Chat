import type { ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';

type ComposerPopoverProps = {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  loading?: boolean;
  children: ReactNode;
};

const ComposerPopover = ({
  title,
  description,
  action,
  loading = false,
  children,
}: ComposerPopoverProps) => {
  const hasHeader =
    title !== undefined || description !== undefined || action !== undefined;

  return (
    <div
      data-composer-popover="true"
      className="bg-surface border border-surface-2 rounded-floating shadow-floating"
    >
      {hasHeader && (
        <div className="flex items-start justify-between gap-2 border-b border-surface-2 px-4 py-3">
          <div className="min-w-0">
            {title !== undefined && (
              <h3 className="text-sm font-medium text-fg/90">{title}</h3>
            )}
            {description !== undefined && (
              <p className="mt-0.5 text-xs text-fg/60">{description}</p>
            )}
          </div>
          {action !== undefined && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {loading ? (
        <div className="px-4 py-3">
          <LoaderCircle size={20} className="animate-spin text-accent" />
        </div>
      ) : (
        children
      )}
    </div>
  );
};

export default ComposerPopover;
