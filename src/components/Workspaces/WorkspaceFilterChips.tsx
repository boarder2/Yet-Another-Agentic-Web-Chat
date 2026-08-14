'use client';

import { cn } from '@/lib/utils';
import { FilterChip } from '@/components/ui/FilterChip';
import { workspaceColorClasses } from '@/lib/workspaces/appearance';
import WorkspaceIcon from './WorkspaceIcon';
import { useWorkspacesList } from '@/lib/hooks/api/useWorkspaces';

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
      <FilterChip selected={selected.length === 0} onClick={() => onChange([])}>
        All
      </FilterChip>
      {workspaces.map((ws) => {
        const c = workspaceColorClasses(ws.color);
        const isSelected = selected.includes(ws.id);
        return (
          <FilterChip
            key={ws.id}
            selected={isSelected}
            tint={cn(c.bgTint, c.border, c.text)}
            onClick={() => toggle(ws.id)}
          >
            <WorkspaceIcon
              name={ws.icon}
              color={ws.color}
              size={11}
              applyColor={isSelected}
            />
            {ws.name}
          </FilterChip>
        );
      })}
      <FilterChip
        selected={selected.includes('none')}
        onClick={() => toggle('none')}
      >
        No workspace
      </FilterChip>
    </div>
  );
};

export default WorkspaceFilterChips;
