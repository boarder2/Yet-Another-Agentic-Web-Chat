import { AlertTriangle } from 'lucide-react';
import { type ReactNode } from 'react';
import Badge from '@/components/ui/Badge';

/**
 * Compact, clickable preset row used in preset popovers. The active preset is
 * marked with the left accent bar; unavailable presets show a warning badge.
 */
export default function PresetOption({
  name,
  summary,
  isActive,
  available,
  trailing,
  onClick,
  'aria-label': ariaLabel,
}: {
  name: ReactNode;
  summary: ReactNode;
  isActive: boolean;
  available: boolean;
  trailing?: ReactNode;
  onClick: () => void;
  'aria-label'?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="flex w-full items-start gap-2 border border-transparent py-2.5 pl-2 pr-3 text-left transition-colors duration-100 hover:bg-surface-2 focus-border-neutral"
    >
      <span
        className={`w-1 shrink-0 self-stretch rounded-pill transition-colors duration-150 ${
          isActive ? 'bg-accent' : 'bg-transparent'
        }`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs font-medium text-fg">{name}</span>
          {!available && (
            <Badge tone="warning" size="compact" className="gap-0.5">
              <AlertTriangle size={10} />
              unavailable
            </Badge>
          )}
        </div>
        <p className="mt-0.5 truncate text-2xs text-fg-subtle">{summary}</p>
      </div>
      {trailing}
    </button>
  );
}
