'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  FileText,
  Upload,
  Plus,
  Trash2,
  LoaderCircle,
  FilePen,
} from 'lucide-react';
import {
  useWorkspaceFiles,
  useUploadWorkspaceFile,
  useDeleteWorkspaceFile,
  usePatchWorkspaceFile,
  type FileMeta,
} from '@/lib/hooks/api/useWorkspaceFiles';

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
    activeClass: 'bg-surface-2 text-fg/80',
  },
  {
    value: 1,
    label: 'Auto',
    title: 'Always auto-accept edits',
    activeClass: 'bg-accent/20 text-accent',
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
      <FilePen size={11} className="text-fg/30 shrink-0" />
      <div
        className={`inline-flex items-center rounded-pill border border-surface-2 bg-bg overflow-hidden transition-opacity ${patch.isPending ? 'opacity-50 pointer-events-none' : ''}`}
      >
        {AUTO_ACCEPT_SEGMENTS.map((seg, i) => {
          const isActive = current === seg.value;
          return (
            <button
              type="button"
              key={String(seg.value)}
              onClick={() => select(seg.value)}
              title={seg.title}
              className={`px-2 py-0.5 text-xs font-medium transition-colors whitespace-nowrap ${
                isActive ? seg.activeClass : 'text-fg/35 hover:text-fg/60'
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
  onOpenFile?: (fileId: string) => void;
  onCountChange?: (n: number) => void;
  compact?: boolean;
}) {
  const { data: files = [], isLoading } = useWorkspaceFiles(workspaceId);
  const upload = useUploadWorkspaceFile(workspaceId);
  const del = useDeleteWorkspaceFile(workspaceId);

  const [creatingNote, setCreatingNote] = useState(false);
  const [noteName, setNoteName] = useState('note.md');

  useEffect(() => {
    onCountChange?.(files.length);
  }, [files.length, onCountChange]);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    upload.mutate(f, {
      onSettled: () => {
        e.target.value = '';
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

  function remove(id: string) {
    if (!confirm('Delete file?')) return;
    del.mutate(id);
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center flex-wrap">
        <label className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-surface border border-surface-2 bg-surface hover:bg-surface-2 cursor-pointer transition">
          {upload.isPending ? (
            <LoaderCircle size={14} className="animate-spin text-accent" />
          ) : (
            <Upload size={14} />
          )}
          Upload
          <input
            type="file"
            aria-label="Upload file"
            className="hidden"
            onChange={onUpload}
          />
        </label>
        {creatingNote ? (
          <span
            className={
              compact ? 'flex flex-col gap-2 w-full' : 'flex gap-2 items-center'
            }
          >
            <input
              aria-label="Note name"
              className="min-w-0 w-full border border-surface-2 rounded-surface px-2 py-1.5 text-sm bg-bg focus:outline-none focus:border-accent"
              value={noteName}
              onChange={(e) => setNoteName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') createNote();
                if (e.key === 'Escape') setCreatingNote(false);
              }}
            />
            <span className={compact ? 'flex gap-2' : 'contents'}>
              <button
                type="button"
                onClick={createNote}
                className={`px-3 py-1.5 text-sm rounded-surface bg-accent text-accent-fg hover:bg-accent/90 transition ${compact ? 'flex-1' : ''}`}
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => setCreatingNote(false)}
                className={`px-3 py-1.5 text-sm rounded-surface border border-surface-2 hover:bg-surface-2 transition ${compact ? 'flex-1' : ''}`}
              >
                Cancel
              </button>
            </span>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setCreatingNote(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-surface border border-surface-2 bg-surface hover:bg-surface-2 transition"
          >
            <Plus size={14} />
            New file
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <LoaderCircle size={20} className="animate-spin text-accent" />
        </div>
      ) : files.length === 0 ? (
        <div className="text-center py-8">
          <FileText className="mx-auto mb-2 text-fg/20" size={32} />
          <p className="text-sm text-fg/50">No files yet.</p>
        </div>
      ) : (
        <ul className="divide-y divide-surface-2 border border-surface-2 rounded-floating overflow-hidden">
          {files.map((f) => {
            const inner = (
              <>
                <FileText size={14} className="text-fg/40 shrink-0" />
                <span className="truncate">{f.name}</span>
              </>
            );
            if (compact) {
              return (
                <li
                  key={f.id}
                  className="flex flex-col gap-1.5 px-3 py-2 bg-surface hover:bg-surface-2 transition"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {onOpenFile ? (
                      <button
                        type="button"
                        onClick={() => onOpenFile(f.id)}
                        className="text-sm text-left hover:underline flex items-center gap-2 min-w-0 flex-1"
                      >
                        {inner}
                      </button>
                    ) : (
                      <Link
                        href={`/workspaces/${workspaceId}/files/${f.id}`}
                        className="text-sm hover:underline flex items-center gap-2 min-w-0 flex-1"
                      >
                        {inner}
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={() => remove(f.id)}
                      className="p-1 rounded-control hover:bg-danger-soft text-danger transition shrink-0"
                      title="Delete"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs text-fg/40">
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
                className="flex items-center justify-between px-4 py-2.5 bg-surface hover:bg-surface-2 transition"
              >
                {onOpenFile ? (
                  <button
                    type="button"
                    onClick={() => onOpenFile(f.id)}
                    className="text-sm text-left hover:underline flex items-center gap-2 min-w-0 flex-1 mr-3"
                  >
                    {inner}
                  </button>
                ) : (
                  <Link
                    href={`/workspaces/${workspaceId}/files/${f.id}`}
                    className="text-sm hover:underline flex items-center gap-2 min-w-0 flex-1 mr-4"
                  >
                    {inner}
                  </Link>
                )}
                <span className="flex items-center gap-3 text-xs text-fg/40 shrink-0">
                  {isEditableFile(f) && (
                    <AutoAcceptPill
                      workspaceId={workspaceId}
                      fileId={f.id}
                      value={f.autoAcceptEdits}
                    />
                  )}
                  <span>{f.mime ?? '—'}</span>
                  <span>{(f.size / 1024).toFixed(1)}KB</span>
                  <button
                    type="button"
                    onClick={() => remove(f.id)}
                    className="p-1 rounded-control hover:bg-danger-soft text-danger transition"
                    title="Delete"
                  >
                    <Trash2 size={12} />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
