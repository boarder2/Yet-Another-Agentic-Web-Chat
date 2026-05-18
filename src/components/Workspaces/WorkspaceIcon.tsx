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

const iconRegistry = Icons as unknown as Record<
  string,
  React.ComponentType<{ size?: number; className?: string }>
>;

// Lowercase → PascalCase lookup and kebab-case list — built in a single pass
const iconNameMap: Record<string, string> = {};
const allIconKebabNames: string[] = [];
for (const k of Object.keys(iconRegistry)) {
  if (!/^[A-Z]/.test(k)) continue;
  iconNameMap[k.toLowerCase()] = k;
  allIconKebabNames.push(
    k.replace(/([A-Z])/g, (c, _, i) =>
      i === 0 ? c.toLowerCase() : `-${c.toLowerCase()}`,
    ),
  );
}

function toPascal(raw: string): string {
  return raw
    .split('-')
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join('');
}

function lookupComponent(
  name: string | null | undefined,
): React.ComponentType<{ size?: number; className?: string }> | null {
  const raw = (name ?? '').trim();
  if (!raw) return null;
  const pascal = toPascal(raw);
  return (
    iconRegistry[pascal] ??
    iconRegistry[iconNameMap[pascal.toLowerCase()]] ??
    null
  );
}

export function isValidIcon(name: string): boolean {
  return lookupComponent(name) !== null;
}

export function getIconSuggestions(query: string, limit = 20): string[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const ceiling = limit * 3;
  const matches: string[] = [];
  for (const n of allIconKebabNames) {
    if (n.includes(q)) {
      matches.push(n);
      if (matches.length >= ceiling) break;
    }
  }
  return matches
    .sort((a, b) => {
      const aPrefix = a.startsWith(q);
      const bPrefix = b.startsWith(q);
      if (aPrefix !== bPrefix) return aPrefix ? -1 : 1;
      return a.localeCompare(b);
    })
    .slice(0, limit);
}

function resolveIcon(name: string | null | undefined) {
  return lookupComponent(name) ?? FolderOpen;
}

const WorkspaceIcon = ({
  name,
  color,
  size = 16,
  className,
  applyColor = true,
}: Props) => {
  const Component = resolveIcon(name);
  const colorClass = applyColor ? workspaceColorClasses(color).stroke : '';
  return React.createElement(
    Component as React.ComponentType<{ size?: number; className?: string }>,
    { size, className: cn(colorClass, className) },
  );
};

export default WorkspaceIcon;
