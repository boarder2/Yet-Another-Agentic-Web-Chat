'use client';

import { FilterChip } from '@/components/ui/FilterChip';

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
          <FilterChip
            key={type}
            selected={selected}
            data-testid={`artifact-type-${type}`}
            onClick={() => onChange(type)}
          >
            {labels[type]}
          </FilterChip>
        );
      })}
    </div>
  );
}
