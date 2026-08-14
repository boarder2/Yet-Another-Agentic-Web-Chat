'use client';

import { X } from 'lucide-react';
import { IconButton } from '@/components/ui/IconButton';
import { Select } from '@/components/ui/Select';
import ArtifactViewer from './ArtifactViewer';
import { useArtifact, useArtifacts } from '@/lib/hooks/api/useArtifacts';

export { ARTIFACT_SANDBOX } from './ArtifactViewer';

interface ArtifactPanelProps {
  chatId: string;
  artifactId: string;
  /** Version to show; falls back to latest when absent or no longer present. */
  version?: number;
  /** Set in a workspace chat, where the sidebar's Artifacts list is the picker. */
  workspaceId?: string | null;
  onSelectArtifact: (artifactId: string, version?: number) => void;
  onClose: () => void;
}

export default function ArtifactPanel({
  chatId,
  artifactId,
  version,
  workspaceId,
  onSelectArtifact,
  onClose,
}: ArtifactPanelProps) {
  // A workspace chat browses artifacts from the sidebar, which lists the whole
  // workspace; a second, narrower picker in the panel header would only
  // disagree with it.
  const { data: artifacts } = useArtifacts(workspaceId ? null : chatId);
  const { data: artifact } = useArtifact(artifactId);

  const title =
    artifacts && artifacts.length > 1 ? (
      <Select
        aria-label="Select artifact"
        data-testid="artifact-selector"
        className="w-full bg-transparent font-medium"
        value={artifactId}
        onChange={(e) => onSelectArtifact(e.target.value)}
        options={artifacts.map((a) => ({ value: a.id, label: a.title }))}
      />
    ) : (
      <div className="truncate font-medium" data-testid="artifact-title">
        {artifact?.title ?? ''}
      </div>
    );

  return (
    <ArtifactViewer
      artifactId={artifactId}
      version={version}
      onSelectVersion={onSelectArtifact}
      title={title}
      testId="artifact-panel"
      className="flex h-full min-w-0 flex-col border-l border-surface-2 bg-bg"
      actions={
        <IconButton icon={X} label="Close artifact panel" onClick={onClose} />
      }
    />
  );
}
