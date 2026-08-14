'use client';

import { ImageOff } from 'lucide-react';
import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Card } from '@/components/ui/Card';
import { listRowInteractive } from '@/components/ui/List';
import WorkspaceChip from '@/components/Workspaces/WorkspaceChip';
import { formatTimeDifference } from '@/lib/utils';
import type { HistoryImageItem } from '@/lib/hooks/api/useArtifacts';
import type { GeneratedImageWorkspace } from './GeneratedImagePreview';

interface GeneratedImageHistoryMetadataProps {
  image: HistoryImageItem;
  workspace?: GeneratedImageWorkspace | null;
}

/** Provenance shared by the image gallery and mixed history list. */
export function GeneratedImageHistoryMetadata({
  image,
  workspace,
}: GeneratedImageHistoryMetadataProps) {
  return (
    <>
      <time dateTime={image.createdAt}>
        {formatTimeDifference(new Date(), image.createdAt)} ago
      </time>
      {image.chatTitle && (
        <span className="max-w-[16rem] truncate">{image.chatTitle}</span>
      )}
      {workspace && image.workspaceId && (
        <span
          className={listRowInteractive}
          onClick={(event) => event.stopPropagation()}
        >
          <WorkspaceChip
            id={image.workspaceId}
            name={workspace.name}
            icon={workspace.icon}
            color={workspace.color}
          />
        </span>
      )}
    </>
  );
}

function isInteractiveTarget(
  target: EventTarget | null,
  currentTarget: HTMLDivElement,
): boolean {
  if (!(target instanceof HTMLElement) || target === currentTarget)
    return false;
  const interactiveTarget = target.closest(
    'a, button, input, select, textarea, [role="button"]',
  );
  return interactiveTarget !== null && interactiveTarget !== currentTarget;
}

export default function GeneratedImageHistoryCard({
  image,
  workspace,
  onPreview,
}: GeneratedImageHistoryMetadataProps & {
  onPreview: (image: HistoryImageItem) => void;
}) {
  const [imageUnavailable, setImageUnavailable] = useState(false);

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (isInteractiveTarget(event.target, event.currentTarget)) return;
    onPreview(image);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onPreview(image);
  };

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={`Preview ${image.title}`}
      data-testid="generated-image-history-card"
      data-image-id={image.id}
      className="group flex h-full cursor-pointer flex-col overflow-hidden border border-transparent transition-colors duration-150 hover:bg-surface-2 focus-border-neutral"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <div
        data-testid="generated-image-stage"
        className="aspect-square w-full overflow-hidden bg-well"
      >
        {imageUnavailable ? (
          <div
            role="img"
            aria-label="Image unavailable"
            data-testid="generated-image-unavailable"
            className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-fg-muted"
          >
            <ImageOff size={24} aria-hidden="true" />
            <span>Image unavailable</span>
          </div>
        ) : (
          // Generated images are local API resources, so a regular image keeps the preview unoptimized.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image.imageUrl}
            alt={image.title}
            data-testid="generated-image-thumbnail"
            loading="lazy"
            decoding="async"
            onError={() => setImageUnavailable(true)}
            className="h-full w-full object-contain"
          />
        )}
      </div>

      <div className="min-w-0 space-y-1.5 p-3">
        <h3
          data-testid="generated-image-title"
          className="truncate text-sm font-medium"
        >
          {image.title}
        </h3>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-subtle">
          <GeneratedImageHistoryMetadata image={image} workspace={workspace} />
        </div>
      </div>
    </Card>
  );
}
