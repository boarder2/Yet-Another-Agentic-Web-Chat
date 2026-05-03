// src/components/Workspaces/WorkspacePicker.tsx
'use client';

import { cn } from '@/lib/utils';
import { workspaceColorClasses } from '@/lib/workspaces/appearance';
import WorkspaceIcon from './WorkspaceIcon';
import { Check, ChevronDown, FolderOpen, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface WorkspaceOption {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
}

interface Props {
  value: string | null;
  onChange: (id: string | null) => void;
}

const WorkspacePicker = ({ value, onChange }: Props) => {
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch('/api/workspaces')
      .then((r) => r.json())
      .then((d) => setWorkspaces(d.workspaces ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClickAway = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, [open]);

  if (workspaces.length === 0) return null;

  const selected = workspaces.find((w) => w.id === value) ?? null;
  const filtered = workspaces.filter((w) =>
    w.name.toLowerCase().includes(filter.toLowerCase()),
  );
  // List entries: index 0 is "No workspace", then filtered workspaces.
  const entries: Array<{
    id: string | null;
    label: string;
    ws?: WorkspaceOption;
  }> = [
    { id: null, label: 'No workspace' },
    ...filtered.map((w) => ({ id: w.id, label: w.name, ws: w })),
  ];

  const c = selected
    ? workspaceColorClasses(selected.color)
    : workspaceColorClasses(null);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, entries.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const entry = entries[activeIndex];
      if (entry) {
        onChange(entry.id);
        setOpen(false);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 h-8 rounded-pill border text-sm transition-colors',
          selected
            ? cn(c.bgTint, c.border, c.text)
            : 'bg-surface border-surface-2 text-fg/60 hover:text-fg hover:border-fg/30',
        )}
      >
        {selected ? (
          <WorkspaceIcon
            name={selected.icon}
            color={selected.color}
            size={13}
          />
        ) : (
          <FolderOpen size={13} className="text-fg/50" />
        )}
        <span>{selected ? selected.name : 'Workspace'}</span>
        <ChevronDown size={13} className="opacity-60" />
      </button>

      {open && (
        <div
          className="absolute z-30 mt-2 w-64 rounded-floating border border-surface-2 bg-surface shadow-floating overflow-hidden"
          onKeyDown={onKeyDown}
        >
          <div className="relative border-b border-surface-2">
            <Search
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg/40"
              size={13}
            />
            <input
              autoFocus
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setActiveIndex(0);
              }}
              placeholder="Search workspaces…"
              className="w-full pl-8 pr-2 py-2 text-xs bg-transparent focus:outline-none"
            />
          </div>
          <ul className="max-h-64 overflow-y-auto py-1" role="listbox">
            {entries.map((entry, idx) => {
              const active = idx === activeIndex;
              const isSelected =
                entry.id === value || (entry.id === null && value === null);
              return (
                <li key={entry.id ?? 'none'}>
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => {
                      onChange(entry.id);
                      setOpen(false);
                    }}
                    className={cn(
                      'w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left',
                      active ? 'bg-surface-2' : '',
                    )}
                  >
                    {entry.ws ? (
                      <>
                        <WorkspaceIcon
                          name={entry.ws.icon}
                          color={entry.ws.color}
                          size={13}
                        />
                        <span
                          className={cn(
                            'h-2 w-2 rounded-pill',
                            workspaceColorClasses(entry.ws.color).swatch,
                          )}
                        />
                      </>
                    ) : (
                      <FolderOpen size={13} className="text-fg/40" />
                    )}
                    <span className="flex-1 truncate">{entry.label}</span>
                    {isSelected && <Check size={12} className="text-accent" />}
                  </button>
                </li>
              );
            })}
            {entries.length === 1 && filter && (
              <li className="px-3 py-2 text-xs text-fg/40">No matches.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
};

export default WorkspacePicker;
