import Link from 'next/link';
import { FolderOpen } from 'lucide-react';

interface Props {
  id: string;
  name: string;
  icon: string | null;
  muted?: boolean;
}

const WorkspaceChip = ({ id, name, icon, muted }: Props) => (
  <Link
    href={`/workspaces/${id}`}
    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-colors ${muted ? 'bg-surface text-fg/30 hover:text-fg/50' : 'bg-surface-2 hover:bg-surface-3 text-fg/60 hover:text-fg'}`}
    onClick={(e) => e.stopPropagation()}
  >
    {icon ? (
      <span className={muted ? 'opacity-50' : ''}>{icon}</span>
    ) : (
      <FolderOpen size={11} className={muted ? 'opacity-30' : 'opacity-70'} />
    )}
    <span>{name}</span>
  </Link>
);

export default WorkspaceChip;
