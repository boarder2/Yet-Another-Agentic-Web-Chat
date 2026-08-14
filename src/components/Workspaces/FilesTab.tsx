'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { FileText, Upload, Plus, Trash2, FilePen, Edit3 } from 'lucide-react';
import {
  useWorkspaceFiles,
  useUploadWorkspaceFile,
  useDeleteWorkspaceFile,
  usePatchWorkspaceFile,
  type FileMeta,
} from '@/lib/hooks/api/useWorkspaceFiles';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import ConfirmModal from '@/components/ui/ConfirmModal';
import { Input } from '@/components/ui/Input';
import { ListEmptyState, ListLoading } from '@/components/ui/List';

function isEditableFile(f: FileMeta): boolean {
  return !f.isBinary;
}

const AUTO_ACCEPT_SEGMENTS: {
  value: number | null;
  label: string;
  title: string;
  activeClass: string;
}[] = [
  {
    value: null,
    label: 'Default',
    title: 'Use workspace default',
    activeClass: 'bg-surface-2 text-fg',
  },
  {
    value: 1,
    label: 'Auto',
    title: 'Always auto-accept edits',
    activeClass: 'bg-accent-soft text-accent',
  },
  {
    value: 0,
    label: 'Prompt',
    title: 'Always prompt before editing',
    activeClass: 'bg-warning-soft text-warning',
  },
];

function AutoAcceptPill({
  workspaceId,
  fileId,
  value,
}: {
  workspaceId: string;
  fileId: string;
  value: number | null | undefined;
}) {
  const patch = usePatchWorkspaceFile(workspaceId);
  const current = value === undefined ? null : value;

  function select(next: number | null) {
    if (next === current || patch.isPending) return;
    patch.mutate({ fileId, data: { autoAcceptEdits: next } });
  }

  return (
    <div className="inline-flex items-center gap-1.5">
      <FilePen size={11} className="text-fg-subtle shrink-0" />
      <div
        className={`inline-flex items-center rounded-pill border border-surface-2 bg-bg overflow-hidden transition-opacity duration-150 ${patch.isPending ? 'opacity-50 pointer-events-none' : ''}`}
      >
        {AUTO_ACCEPT_SEGMENTS.map((seg, i) => {
          const isActive = current === seg.value;
          return (
            <button
              type="button"
              key={String(seg.value)}
              onClick={() => select(seg.value)}
              title={seg.title}
              className={`border border-transparent px-2 py-0.5 text-xs font-medium transition-colors duration-150 whitespace-nowrap focus-border-neutral ${
                isActive
                  ? seg.activeClass
                  : 'text-fg-subtle hover:text-fg-muted'
              } ${i > 0 ? 'border-l border-surface-2' : ''}`}
            >
              {seg.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function FilesTab({
  workspaceId,
  onOpenFile,
  onCountChange,
  compact = false,
}: {
  workspaceId: string;
  onOpenFile?: (fileId: string, edit?: boolean) => void;
  onCountChange?: (n: number) => void;
  compact?: boolean;
}) {
  const { data: files = [], isLoading } = useWorkspaceFiles(workspaceId);
  const upload = useUploadWorkspaceFile(workspaceId);
  const del = useDeleteWorkspaceFile(workspaceId);

  const [creatingNote, setCreatingNote] = useState(false);
  const [noteName, setNoteName] = useState('note.md');
  const [pendingDelete, setPendingDelete] = useState<FileMeta | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onCountChange?.(files.length);
  }, [files.length, onCountChange]);

  function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (upload.isPending) return;
    const f = e.target.files?.[0];
    if (!f) return;
    upload.mutate(f, {
      onSettled: () => {
        if (uploadInputRef.current) uploadInputRef.current.value = '';
      },
    });
  }

  function createNote() {
    upload.mutate(
      { name: noteName, content: '', mime: 'text/markdown' },
      {
        onSuccess: () => {
          setCreatingNote(false);
          setNoteName('note.md');
        },
      },
    );
  }

  function remove(file: FileMeta) {
    setPendingDelete(file);
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center flex-wrap">
        <Button
          size="sm"
          icon={Upload}
          loading={upload.isPending}
          onClick={() => {
            if (!upload.isPending) uploadInputRef.current?.click();
          }}
        >
          Upload
        </Button>
        <input
          ref={uploadInputRef}
          type="file"
          aria-label="Upload file"
          className="hidden"
          onChange={onUpload}
        />
        {creatingNote ? (
          <span
            className={
              compact ? 'flex flex-col gap-2 w-full' : 'flex gap-2 items-center'
            }
          >
            <Input
              aria-label="Note name"
              className="min-w-0 rounded-surface px-2 py-1.5"
              value={noteName}
              onChange={(e) => setNoteName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') createNote();
                if (e.key === 'Escape') setCreatingNote(false);
              }}
            />
            <span className={compact ? 'flex gap-2' : 'contents'}>
              <Button
                variant="primary"
                size="sm"
                onClick={createNote}
                className={`rounded-surface px-3 py-1.5 text-sm ${compact ? 'flex-1' : ''}`}
              >
                Create
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCreatingNote(false)}
                className={`rounded-surface border border-surface-2 px-3 py-1.5 text-sm ${compact ? 'flex-1' : ''}`}
              >
                Cancel
              </Button>
            </span>
          </span>
        ) : (
          <Button
            size="sm"
            icon={Plus}
            onClick={() => setCreatingNote(true)}
            className="rounded-surface border border-surface-2 px-3 py-1.5 text-sm"
          >
            New file
          </Button>
        )}
      </div>

      {isLoading ? (
        <ListLoading layout="section" size={20} />
      ) : files.length === 0 ? (
        <ListEmptyState
          layout="section"
          icon={FileText}
          title="No files yet."
        />
      ) : (
        <ul className="divide-y divide-surface-2 border border-surface-2 rounded-floating overflow-hidden">
          {files.map((f) => {
            const inner = (
              <>
                <FileText size={14} className="text-fg-subtle shrink-0" />
                <span className="truncate">{f.name}</span>
              </>
            );
            const editButton =
              isEditableFile(f) &&
              (onOpenFile ? (
                <IconButton
                  icon={Edit3}
                  label="Edit"
                  onClick={() => onOpenFile(f.id, true)}
                  className="shrink-0"
                />
              ) : (
                <IconButton
                  href={`/workspaces/${workspaceId}/files/${f.id}?edit=1`}
                  icon={Edit3}
                  label="Edit"
                  className="shrink-0"
                />
              ));
            if (compact) {
              return (
                <li
                  key={f.id}
                  className="flex flex-col gap-1.5 px-3 py-2 bg-surface hover:bg-surface-2 transition-colors duration-150"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {onOpenFile ? (
                      <button
                        type="button"
                        onClick={() => onOpenFile(f.id)}
                        className="text-sm text-left hover:underline flex items-center gap-2 min-w-0 flex-1 border border-transparent focus-border-neutral"
                      >
                        {inner}
                      </button>
                    ) : (
                      <Link
                        href={`/workspaces/${workspaceId}/files/${f.id}`}
                        className="text-sm hover:underline flex items-center gap-2 min-w-0 flex-1 border border-transparent focus-border-neutral"
                      >
                        {inner}
                      </Link>
                    )}
                    {editButton}
                    <IconButton
                      icon={Trash2}
                      label="Delete"
                      tone="danger"
                      onClick={() => remove(f)}
                      className="shrink-0"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs text-fg-subtle">
                    {isEditableFile(f) && (
                      <AutoAcceptPill
                        workspaceId={workspaceId}
                        fileId={f.id}
                        value={f.autoAcceptEdits}
                      />
                    )}
                    <span>{(f.size / 1024).toFixed(1)}KB</span>
                  </div>
                </li>
              );
            }
            return (
              <li
                key={f.id}
                className="flex items-center justify-between px-4 py-2.5 bg-surface hover:bg-surface-2 transition-colors duration-150"
              >
                {onOpenFile ? (
                  <button
                    type="button"
                    onClick={() => onOpenFile(f.id)}
                    className="text-sm text-left hover:underline flex items-center gap-2 min-w-0 flex-1 mr-3 border border-transparent focus-border-neutral"
                  >
                    {inner}
                  </button>
                ) : (
                  <Link
                    href={`/workspaces/${workspaceId}/files/${f.id}`}
                    className="text-sm hover:underline flex items-center gap-2 min-w-0 flex-1 mr-4 border border-transparent focus-border-neutral"
                  >
                    {inner}
                  </Link>
                )}
                <span className="flex items-center gap-3 text-xs text-fg-subtle shrink-0">
                  {isEditableFile(f) && (
                    <AutoAcceptPill
                      workspaceId={workspaceId}
                      fileId={f.id}
                      value={f.autoAcceptEdits}
                    />
                  )}
                  <span>{f.mime ?? '—'}</span>
                  <span>{(f.size / 1024).toFixed(1)}KB</span>
                  {editButton}
                  <IconButton
                    icon={Trash2}
                    label="Delete"
                    tone="danger"
                    onClick={() => remove(f)}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmModal
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        title="Delete file"
        body={<p>Delete file?</p>}
        loading={del.isPending}
        onConfirm={() => {
          if (!pendingDelete) return;
          del.mutate(pendingDelete.id, {
            onSuccess: () => setPendingDelete(null),
          });
        }}
      />
    </div>
  );
}
