'use client';

import { FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useArtifact } from '@/lib/hooks/api/useArtifacts';
import { useArtifactViewer } from '@/lib/artifacts/ArtifactViewerContext';

/**
 * An `@[Title](artifact:<id>)` mention, rendered from the markdown `a`
 * override. The label comes from the token rather than the lookup, so history
 * stays readable even for a document that has since been deleted — that case
 * resolves to a dimmed, inert chip instead of a dead link.
 */
export default function ArtifactMention({
  artifactId,
  children,
}: {
  artifactId: string;
  children?: React.ReactNode;
}) {
  const { openArtifact } = useArtifactViewer();
  const { isError } = useArtifact(artifactId);

  const base =
    'inline-flex items-baseline gap-1 rounded px-1 py-0.5 align-baseline';
  if (isError) {
    return (
      <span
        className={cn(base, 'bg-surface-2 text-fg/40 line-through')}
        title="This artifact no longer exists"
      >
        <FileText size={12} className="self-center shrink-0" />
        {children}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => openArtifact(artifactId)}
      className={cn(
        base,
        'bg-surface-2 text-accent hover:bg-surface transition cursor-pointer',
      )}
    >
      <FileText size={12} className="self-center shrink-0" />
      {children}
    </button>
  );
}
