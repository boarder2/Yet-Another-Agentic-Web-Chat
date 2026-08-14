'use client';

import { cn } from '@/lib/utils';
import { workspaceColorClasses } from '@/lib/workspaces/appearance';
import WorkspaceIcon from './WorkspaceIcon';
import { useWorkspacesList } from '@/lib/hooks/api/useWorkspaces';

const chipClasses = (selected: boolean, tint?: string) =>
  cn(
    'flex items-center gap-1 whitespace-nowrap rounded-pill border px-2.5 py-1 text-xs font-medium transition-colors duration-150 focus-border-neutral',
    selected
      ? (tint ?? 'bg-accent/10 border-accent/30 text-accent')
      : 'bg-surface border-surface-2 text-fg-muted hover:text-fg hover:border-fg/30',
  );

interface Props {
  /** Selected workspace IDs; `none` means "no workspace". Empty means all. */
  selected: string[];
  onChange: (next: string[]) => void;
}

/** Workspace scoping chips shared by the conversation and artifact browsers. */
const WorkspaceFilterChips = ({ selected, onChange }: Props) => {
  const { data: workspaces = [] } = useWorkspacesList(false);
  if (workspaces.length === 0) return null;

  const toggle = (id: string) =>
    onChange(
      selected.includes(id)
        ? selected.filter((x) => x !== id)
        : [...selected, id],
    );

  return (
    <div className="mb-3 flex items-center gap-2 overflow-x-auto pb-1">
      <button
        type="button"
        onClick={() => onChange([])}
        className={chipClasses(selected.length === 0)}
      >
        All
      </button>
      {workspaces.map((ws) => {
        const c = workspaceColorClasses(ws.color);
        const isSelected = selected.includes(ws.id);
        return (
          <button
            type="button"
            key={ws.id}
            onClick={() => toggle(ws.id)}
            className={chipClasses(isSelected, cn(c.bgTint, c.border, c.text))}
          >
            <WorkspaceIcon
              name={ws.icon}
              color={ws.color}
              size={11}
              applyColor={isSelected}
            />
            {ws.name}
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => toggle('none')}
        className={chipClasses(selected.includes('none'))}
      >
        No workspace
      </button>
    </div>
  );
};

export default WorkspaceFilterChips;
