// src/components/Workspaces/WorkspaceHeaderChip.tsx
'use client';

import { useEffect, useState } from 'react';
import WorkspaceChip from './WorkspaceChip';

interface Workspace {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  archivedAt: string | null;
}

const WorkspaceHeaderChip = ({ workspaceId }: { workspaceId: string }) => {
  const [ws, setWs] = useState<Workspace | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.workspace) setWs(d.workspace);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  if (!ws) return null;

  return (
    <WorkspaceChip
      id={ws.id}
      name={ws.name}
      icon={ws.icon}
      color={ws.color}
      muted={!!ws.archivedAt}
    />
  );
};

export default WorkspaceHeaderChip;
