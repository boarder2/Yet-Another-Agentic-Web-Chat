'use client';

import { Workflow } from 'lucide-react';
import WorkspaceIcon from '@/components/Workspaces/WorkspaceIcon';

/** Lucide icon by name, falling back to the Workflow glyph and inheriting text color. */
export default function DynamicIcon({
  name,
  size = 20,
  className,
}: {
  name?: string | null;
  size?: number;
  className?: string;
}) {
  return (
    <WorkspaceIcon
      name={name}
      size={size}
      className={className}
      applyColor={false}
      fallback={Workflow}
    />
  );
}
