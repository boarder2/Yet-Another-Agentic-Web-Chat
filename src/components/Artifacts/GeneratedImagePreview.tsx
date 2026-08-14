'use client';

import Link from 'next/link';
import { Download, MessageCircle } from 'lucide-react';
import { buttonClasses } from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import WorkspaceChip from '@/components/Workspaces/WorkspaceChip';
import type { HistoryImageItem } from '@/lib/hooks/api/useArtifacts';

export interface GeneratedImageWorkspace {
  name: string;
  icon: string | null;
  color: string | null;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
}

function chatHref(image: HistoryImageItem): string | undefined {
  if (!image.chatId || !image.chatTitle) return undefined;
  return image.workspaceId
    ? `/workspaces/${image.workspaceId}/c/${image.chatId}`
    : `/c/${image.chatId}`;
}

export default function GeneratedImagePreview({
  image,
  workspace,
  onClose,
}: {
  image: HistoryImageItem | null;
  workspace?: GeneratedImageWorkspace | null;
  onClose: () => void;
}) {
  if (!image) return null;

  const originatingChatHref = chatHref(image);
  const downloadName = `generated-image-${image.id}.${image.extension}`;

  return (
    <Modal
      open
      onClose={onClose}
      title={image.title}
      size="lg"
      footer={
        <a
          href={image.imageUrl}
          download={downloadName}
          className={buttonClasses('secondary', 'sm')}
        >
          <Download size={14} />
          Download image
        </a>
      }
    >
      <div className="space-y-5">
        <div className="overflow-hidden rounded-surface border border-surface-2 bg-well">
          {/* Generated images are local API resources, so a regular image keeps the preview unoptimized. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.imageUrl}
            alt={image.title}
            className="mx-auto max-h-[60vh] max-w-full object-contain"
          />
        </div>

        <section aria-labelledby="generated-image-prompt" className="space-y-2">
          <h2
            id="generated-image-prompt"
            className="text-xs font-medium uppercase tracking-wide text-fg-subtle"
          >
            Prompt
          </h2>
          <p
            data-testid="generated-image-prompt"
            className="whitespace-pre-wrap break-words text-sm text-fg"
          >
            {image.prompt}
          </p>
        </section>

        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-fg-subtle">Created</dt>
            <dd className="text-fg">
              <time dateTime={image.createdAt}>
                {formatTimestamp(image.createdAt)}
              </time>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-fg-subtle">Workspace</dt>
            <dd className="text-fg">
              {image.workspaceId ? (
                workspace ? (
                  <WorkspaceChip
                    id={image.workspaceId}
                    name={workspace.name}
                    icon={workspace.icon}
                    color={workspace.color}
                  />
                ) : (
                  image.workspaceId
                )
              ) : (
                <span className="text-fg-subtle">None</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-fg-subtle">Originating chat</dt>
            <dd className="text-fg">
              {originatingChatHref ? (
                <Link
                  href={originatingChatHref}
                  className="inline-flex items-center gap-1 text-accent hover:underline"
                >
                  <MessageCircle size={14} />
                  <span>{image.chatTitle}</span>
                </Link>
              ) : (
                <span
                  data-testid="generated-image-chat-unavailable"
                  className="text-fg-subtle"
                >
                  Unavailable
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-fg-subtle">Format</dt>
            <dd className="uppercase text-fg">{image.extension}</dd>
          </div>
        </dl>
      </div>
    </Modal>
  );
}
