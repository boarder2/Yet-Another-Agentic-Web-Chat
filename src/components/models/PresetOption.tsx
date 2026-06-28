import { AlertTriangle, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type ModelPreset, presetSummary } from '@/lib/models/presets';

/**
 * Compact, clickable preset row used in the popover preset switchers (the chat
 * ModelConfigurator button and the in-dialog PresetBar). The active preset is
 * marked with the left accent bar; unavailable presets show a warning badge.
 * The richer Settings → Model Presets list uses its own layout.
 */
export default function PresetOption({
  preset,
  isActive,
  available,
  onClick,
}: {
  preset: ModelPreset;
  isActive: boolean;
  available: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left pl-2 pr-3 py-2.5 flex items-start gap-2 hover:bg-surface-2 transition-colors duration-100"
    >
      <span
        className={cn(
          'w-1 self-stretch rounded-full shrink-0 transition-colors duration-150',
          isActive ? 'bg-accent' : 'bg-transparent',
        )}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-fg truncate">
            {preset.name}
          </span>
          {!available && (
            <span className="flex items-center gap-0.5 text-[10px] text-warning bg-warning-soft px-1 py-0.5 rounded-control shrink-0">
              <AlertTriangle size={10} />
              unavailable
            </span>
          )}
        </div>
        <p className="text-[10px] text-fg/50 mt-0.5 truncate">
          {presetSummary(preset)}
        </p>
      </div>
      {preset.imageCapable && (
        <Eye size={12} className="text-fg/40 mt-0.5 shrink-0" />
      )}
    </button>
  );
}
