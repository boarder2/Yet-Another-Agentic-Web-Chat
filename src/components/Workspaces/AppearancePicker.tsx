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
  getIconSuggestions,
} from './WorkspaceIcon';
import { useEffect, useRef, useState } from 'react';
import { AlertCircle } from 'lucide-react';

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
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [blurred, setBlurred] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const colorRef = useRef(color);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pendingIconRef = useRef<string | null>(null);

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
      setSuggestions([]);
      setDropdownOpen(false);
    } else if (inputValue.trim() !== icon) {
      setInputValue(icon);
    }
  }

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
        setActiveIndex(-1);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Cleanup debounce timeout on unmount
  useEffect(() => {
    return () => clearTimeout(debounceRef.current);
  }, []);

  const trimmed = inputValue.trim();
  const hasInput = trimmed.length > 0;
  const isValid = !hasInput || isValidIcon(trimmed);
  const showError = blurred && hasInput && !isValid;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setInputValue(v);
    const t = v.trim();
    const next = t ? getIconSuggestions(t) : [];
    setSuggestions(next);
    setDropdownOpen(next.length > 0);
    setActiveIndex(-1);

    pendingIconRef.current = t || null;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = undefined;
      const next = pendingIconRef.current;
      if (next && !isValidIcon(next)) return;
      onChangeRef.current({ color: colorRef.current, icon: next });
    }, 300);
  };

  const handleBlur = () => {
    setBlurred(true);
    if (debounceRef.current !== undefined) {
      clearTimeout(debounceRef.current);
      debounceRef.current = undefined;
      const next = pendingIconRef.current;
      if (next && !isValidIcon(next)) return;
      onChangeRef.current({ color: colorRef.current, icon: next });
    }
  };

  const selectSuggestion = (name: string) => {
    setInputValue(name);
    setSuggestions([]);
    setDropdownOpen(false);
    setActiveIndex(-1);
    onChange({ color, icon: name });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!dropdownOpen) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      selectSuggestion(suggestions[activeIndex]);
    } else if (e.key === 'Escape') {
      setDropdownOpen(false);
      setActiveIndex(-1);
    }
  };

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
                  'h-6 w-6 rounded-pill transition-transform',
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
                  'flex items-center justify-center h-8 w-8 rounded-surface border transition-colors',
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
        <div ref={containerRef} className="relative mt-1">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onFocus={() => {
                setBlurred(false);
                if (suggestions.length > 0) setDropdownOpen(true);
              }}
              onBlur={handleBlur}
              placeholder="Or enter a Lucide icon name…"
              aria-label="Custom icon name"
              aria-autocomplete="list"
              aria-expanded={dropdownOpen}
              className={cn(
                'flex-1 px-2.5 py-1.5 text-xs bg-bg rounded-control border focus:outline-none transition-colors duration-150',
                showError
                  ? 'border-danger focus:border-danger'
                  : 'border-surface-2 focus:border-accent',
              )}
            />
            <div
              className={cn(
                'flex items-center justify-center w-8 h-8 rounded-control border shrink-0 transition-colors duration-150',
                showError
                  ? 'border-danger/40 bg-danger-soft'
                  : 'border-surface-2 bg-surface',
              )}
            >
              {hasInput &&
                (isValid ? (
                  <WorkspaceIcon name={trimmed} color={color} size={18} />
                ) : (
                  <AlertCircle size={16} className="text-danger" />
                ))}
            </div>
          </div>

          {showError && (
            <p className="mt-1 text-xs text-danger">
              Icon &quot;{trimmed}&quot; not found
            </p>
          )}

          {dropdownOpen && suggestions.length > 0 && (
            <ul
              role="listbox"
              className="absolute z-50 left-0 right-9 mt-1 bg-surface border border-surface-2 rounded-surface shadow-floating max-h-52 overflow-y-auto"
            >
              {suggestions.map((name, i) => (
                <li key={name} role="option" aria-selected={i === activeIndex}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectSuggestion(name);
                    }}
                    className={cn(
                      'w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left transition-colors duration-100',
                      i === activeIndex ? 'bg-surface-2' : 'hover:bg-surface-2',
                    )}
                  >
                    <WorkspaceIcon name={name} color={color} size={16} />
                    <span className="font-mono text-fg/80">{name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default AppearancePicker;
