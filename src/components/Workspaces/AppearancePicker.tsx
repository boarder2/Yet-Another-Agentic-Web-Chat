// src/components/Workspaces/AppearancePicker.tsx
'use client';

import { cn } from '@/lib/utils';
import {
  WORKSPACE_COLOR_TOKENS,
  workspaceColorClasses,
} from '@/lib/workspaces/appearance';
import WorkspaceIcon, { CURATED_WORKSPACE_ICONS } from './WorkspaceIcon';

interface Props {
  color: string | null;
  icon: string | null;
  onChange: (next: { color: string | null; icon: string | null }) => void;
}

const AppearancePicker = ({ color, icon, onChange }: Props) => {
  const isCurated = icon
    ? (CURATED_WORKSPACE_ICONS as readonly string[]).includes(icon)
    : false;
  const customIconValue = !isCurated && icon ? icon : '';

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-xs text-fg/60">Color</label>
        <div className="flex flex-wrap gap-2">
          {WORKSPACE_COLOR_TOKENS.map((token) => {
            const c = workspaceColorClasses(token);
            const selected = color === token;
            return (
              <button
                key={token}
                type="button"
                aria-label={`Color ${token}`}
                onClick={() => onChange({ color: token, icon })}
                className={cn(
                  'h-6 w-6 rounded-full transition-transform',
                  c.swatch,
                  selected
                    ? 'ring-2 ring-offset-2 ring-offset-surface ring-fg/60 scale-110'
                    : 'hover:scale-105',
                )}
              />
            );
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-fg/60">Icon</label>
        <div className="grid grid-cols-10 gap-1.5">
          {CURATED_WORKSPACE_ICONS.map((name) => {
            const selected = icon === name;
            return (
              <button
                key={name}
                type="button"
                aria-label={`Icon ${name}`}
                onClick={() => onChange({ color, icon: name })}
                className={cn(
                  'flex items-center justify-center h-8 w-8 rounded-lg border transition-colors',
                  selected
                    ? cn(
                        workspaceColorClasses(color).bgTint,
                        workspaceColorClasses(color).border,
                      )
                    : 'border-surface-2 bg-surface hover:bg-surface-2',
                )}
              >
                <WorkspaceIcon name={name} color={color} size={16} />
              </button>
            );
          })}
        </div>
        <input
          type="text"
          value={customIconValue}
          onChange={(e) => {
            const v = e.target.value.trim();
            onChange({ color, icon: v || null });
          }}
          placeholder="Or enter a Lucide icon name…"
          className="w-full mt-1 px-2.5 py-1.5 text-xs bg-bg rounded-md border border-surface-2 focus:outline-none focus:border-accent"
        />
      </div>
    </div>
  );
};

export default AppearancePicker;
