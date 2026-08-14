// src/components/Workspaces/AppearancePicker.tsx
'use client';

import { cn } from '@/lib/utils';
import {
  WORKSPACE_COLOR_TOKENS,
  workspaceColorClasses,
} from '@/lib/workspaces/appearance';
import WorkspaceIcon, {
  CURATED_WORKSPACE_ICONS,
  isValidIcon,
} from './WorkspaceIcon';
import IconAutocomplete from '../IconAutocomplete';
import { useEffect, useRef, useState } from 'react';

interface Props {
  color: string | null;
  icon: string | null;
  onChange: (next: { color: string | null; icon: string | null }) => void;
}

const AppearancePicker = ({ color, icon, onChange }: Props) => {
  const isCurated = icon
    ? (CURATED_WORKSPACE_ICONS as readonly string[]).includes(icon)
    : false;

  const [inputValue, setInputValue] = useState(!isCurated && icon ? icon : '');
  const onChangeRef = useRef(onChange);
  const colorRef = useRef(color);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    colorRef.current = color;
  }, [color]);

  // Sync when an external/curated icon is selected (adjust state during render)
  const [prevIcon, setPrevIcon] = useState(icon);
  if (prevIcon !== icon) {
    setPrevIcon(icon);
    if (isCurated || !icon) {
      setInputValue('');
    } else if (inputValue.trim() !== icon) {
      setInputValue(icon);
    }
  }

  // Cleanup debounce timeout on unmount
  useEffect(() => {
    return () => clearTimeout(debounceRef.current);
  }, []);

  // Debounce pushing typed icon names up; skip invalid names.
  const handleIconChange = (v: string) => {
    setInputValue(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = undefined;
      const next = v.trim() || null;
      if (next && !isValidIcon(next)) return;
      onChangeRef.current({ color: colorRef.current, icon: next });
    }, 300);
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-xs text-fg-muted">Color</label>
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
                  'h-6 w-6 rounded-pill border border-transparent transition-transform duration-150 focus-border-neutral',
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
        <label className="text-xs text-fg-muted">Icon</label>
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
                  'flex items-center justify-center h-8 w-8 rounded-surface border transition-colors duration-150 focus-border-neutral',
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

        {/* Custom icon input with preview and autocomplete */}
        <div className="mt-1">
          <IconAutocomplete
            value={inputValue}
            onChange={handleIconChange}
            color={color}
            applyColor
            id="appearance-picker-icon"
            ariaLabel="Custom icon name"
            placeholder="Or enter a Lucide icon name…"
          />
        </div>
      </div>
    </div>
  );
};

export default AppearancePicker;
