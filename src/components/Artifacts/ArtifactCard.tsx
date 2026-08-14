'use client';

import { FileCode2 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useArtifactViewer } from '@/lib/artifacts/ArtifactViewerContext';
import type { ArtifactPayload } from '@/lib/widgets/envelope';

/**
 * The in-message re-entry point for an artifact: the panel can be closed, or
 * the chat reopened days later, and this card is how the user gets back to the
 * document.
 */
export default function ArtifactCard({
  id,
  title,
  version,
  action,
}: ArtifactPayload) {
  const { openArtifact } = useArtifactViewer();

  return (
    <Card
      className="my-3 flex items-center gap-3 p-3"
      data-testid="artifact-card"
      data-artifact-id={id}
    >
      <FileCode2 size={20} className="shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{title}</div>
        <div className="text-xs text-fg-subtle">
          {action === 'create' ? 'Created' : 'Updated'} · v{version}
        </div>
      </div>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => openArtifact(id, version)}
      >
        Open
      </Button>
    </Card>
  );
}
