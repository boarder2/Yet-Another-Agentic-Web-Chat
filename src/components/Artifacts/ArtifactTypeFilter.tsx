'use client';

import { cn } from '@/lib/utils';

export const ARTIFACT_TYPES = ['all', 'pages', 'images'] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

const labels: Record<ArtifactType, string> = {
  all: 'All',
  pages: 'Pages',
  images: 'Images',
};

export default function ArtifactTypeFilter({
  value,
  onChange,
}: {
  value: ArtifactType;
  onChange: (value: ArtifactType) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Artifact type"
      className="mb-3 flex items-center gap-2 overflow-x-auto pb-1"
    >
      {ARTIFACT_TYPES.map((type) => {
        const selected = value === type;
        return (
          <button
            key={type}
            type="button"
            aria-pressed={selected}
            data-testid={`artifact-type-${type}`}
            onClick={() => onChange(type)}
            className={cn(
              'shrink-0 rounded-pill border px-2.5 py-1 text-xs font-medium transition-colors duration-150',
              'border border-transparent focus-border-neutral',
              selected
                ? 'border-accent/30 bg-accent/10 text-accent'
                : 'border-surface-2 bg-surface text-fg-muted hover:border-fg/30 hover:text-fg',
            )}
          >
            {labels[type]}
          </button>
        );
      })}
    </div>
  );
}
