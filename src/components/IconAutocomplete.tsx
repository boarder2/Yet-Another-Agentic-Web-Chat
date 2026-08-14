'use client';

import { cn } from '@/lib/utils';
import { useEffect, useRef, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import WorkspaceIcon, {
  isValidIcon,
  getIconSuggestions,
} from './Workspaces/WorkspaceIcon';

interface Props {
  value: string;
  /** Fired on every keystroke and on suggestion select, with the raw text. */
  onChange: (value: string) => void;
  color?: string | null;
  /** When true, the preview/suggestion icons use the color's stroke. */
  applyColor?: boolean;
  placeholder?: string;
  /** Distinguishes the listbox for a11y when several pickers share a page. */
  id?: string;
  ariaLabel?: string;
  inputClassName?: string;
}

/** Lucide icon-name text input with live preview, validation, and autocomplete. */
const IconAutocomplete = ({
  value,
  onChange,
  color = null,
  applyColor = false,
  placeholder = 'Enter a Lucide icon name…',
  id = 'icon-autocomplete',
  ariaLabel = 'Icon name',
  inputClassName,
}: Props) => {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [blurred, setBlurred] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  const trimmed = value.trim();
  const hasInput = trimmed.length > 0;
  const isValid = !hasInput || isValidIcon(trimmed);
  const showError = blurred && hasInput && !isValid;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    onChange(v);
    const next = v.trim() ? getIconSuggestions(v.trim()) : [];
    setSuggestions(next);
    setDropdownOpen(next.length > 0);
    setActiveIndex(-1);
  };

  const selectSuggestion = (name: string) => {
    onChange(name);
    setSuggestions([]);
    setDropdownOpen(false);
    setActiveIndex(-1);
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
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-2">
        <Input
          type="text"
          role="combobox"
          id={id}
          value={value}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            setBlurred(false);
            if (suggestions.length > 0) setDropdownOpen(true);
          }}
          onBlur={() => setBlurred(true)}
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-expanded={dropdownOpen}
          aria-controls={`${id}-listbox`}
          className={cn(
            'flex-1 px-2.5 py-1.5 text-xs',
            showError && 'border-danger',
            inputClassName,
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
              <WorkspaceIcon
                name={trimmed}
                color={color}
                applyColor={applyColor}
                size={18}
              />
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
          id={`${id}-listbox`}
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
                  'w-full border border-transparent flex items-center gap-2 px-2.5 py-1.5 text-xs text-left transition-colors duration-100 focus-border-neutral',
                  i === activeIndex ? 'bg-surface-2' : 'hover:bg-surface-2',
                )}
              >
                <WorkspaceIcon
                  name={name}
                  color={color}
                  applyColor={applyColor}
                  size={16}
                />
                <span className="font-mono text-fg">{name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default IconAutocomplete;
