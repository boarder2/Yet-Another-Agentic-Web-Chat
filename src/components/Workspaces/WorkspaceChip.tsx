// src/components/Workspaces/WorkspaceChip.tsx
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { workspaceColorClasses } from '@/lib/workspaces/appearance';
import WorkspaceIcon from './WorkspaceIcon';

interface Props {
  id: string;
  name: string;
  icon: string | null;
  color?: string | null;
  muted?: boolean;
  /** When true, do not stop propagation on click — let parent handle. */
  inert?: boolean;
}

const WorkspaceChip = ({ id, name, icon, color, muted, inert }: Props) => {
  const c = workspaceColorClasses(color);
  return (
    <Link
      href={`/workspaces/${id}`}
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-pill text-xs transition-colors',
        muted
          ? 'bg-surface text-fg/30 hover:text-fg/50'
          : cn(c.bgTint, c.text, 'hover:opacity-80'),
      )}
      onClick={inert ? undefined : (e) => e.stopPropagation()}
    >
      <WorkspaceIcon
        name={icon}
        color={color}
        size={11}
        applyColor={!muted}
        className={muted ? 'opacity-40' : ''}
      />
      <span>{name}</span>
    </Link>
  );
};

export default WorkspaceChip;
