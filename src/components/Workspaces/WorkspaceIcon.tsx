// src/components/Workspaces/WorkspaceIcon.tsx
'use client';

import React from 'react';
import * as Icons from 'lucide-react';
import { FolderOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { workspaceColorClasses } from '@/lib/workspaces/appearance';

export const CURATED_WORKSPACE_ICONS = [
  'FolderOpen',
  'Briefcase',
  'BookOpen',
  'Code',
  'Beaker',
  'Compass',
  'Lightbulb',
  'Target',
  'Rocket',
  'Heart',
  'Music',
  'Palette',
  'Camera',
  'Globe',
  'GraduationCap',
  'Hammer',
  'Leaf',
  'ShoppingCart',
  'Coffee',
  'Star',
] as const;

interface Props {
  name: string | null | undefined;
  color?: string | null;
  size?: number;
  className?: string;
  /** When true, applies the color's stroke class; otherwise inherits text color. */
  applyColor?: boolean;
}

const WorkspaceIcon = ({
  name,
  color,
  size = 16,
  className,
  applyColor = true,
}: Props) => {
  const lookup = (name ?? '').trim();
  const Component =
    (lookup &&
      (
        Icons as unknown as Record<
          string,
          React.ComponentType<{ size?: number; className?: string }>
        >
      )[lookup]) ||
    FolderOpen;
  const colorClass = applyColor ? workspaceColorClasses(color).stroke : '';
  return React.createElement(
    Component as React.ComponentType<{ size?: number; className?: string }>,
    { size, className: cn(colorClass, className) },
  );
};

export default WorkspaceIcon;
