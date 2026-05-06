'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  FileText,
  Upload,
  Plus,
  Trash2,
  LoaderCircle,
  FilePen,
} from 'lucide-react';

type FileRow = {
  id: string;
  name: string;
  mime?: string | null;
  size: number;
  isBinary?: boolean;
  autoAcceptEdits?: number | null;
  updatedAt: number;
};

// Authoritative: server-side NUL-byte sniff. Default to editable when the
// flag is missing (older API responses).
function isEditableFile(f: FileRow): boolean {
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
  onChange,
}: {
  workspaceId: string;
  fileId: string;
  value: number | null | undefined;
  onChange: (next: number | null) => void;
}) {
  const [saving, setSaving] = useState(false);
  const current = value === undefined ? null : value;

  async function select(next: number | null) {
    if (next === current || saving) return;
    setSaving(true);
    try {
      await fetch(`/api/workspaces/${workspaceId}/files/${fileId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ autoAcceptEdits: next }),
      });
      onChange(next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="inline-flex items-center gap-1.5">
      <FilePen size={11} className="text-fg/30 shrink-0" />
      <div
        className={`inline-flex items-center rounded-pill border border-surface-2 bg-bg overflow-hidden transition-opacity ${saving ? 'opacity-50 pointer-events-none' : ''}`}
      >
        {AUTO_ACCEPT_SEGMENTS.map((seg, i) => {
          const isActive = current === seg.value;
          return (
            <button
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
  const [files, setFiles] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingNote, setCreatingNote] = useState(false);
  const [noteName, setNoteName] = useState('note.md');
  const [uploading, setUploading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const data = await fetch(`/api/workspaces/${workspaceId}/files`).then((r) =>
      r.json(),
    );
    const list = data.files ?? [];
    setFiles(list);
    onCountChange?.(list.length);
    setLoading(false);
  }, [workspaceId, onCountChange]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ workspaceId: string }>).detail;
      if (detail?.workspaceId === workspaceId) refresh();
    };
    window.addEventListener('workspace-updated', handler);
    return () => window.removeEventListener('workspace-updated', handler);
  }, [workspaceId, refresh]);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    const fd = new FormData();
    fd.append('file', f);
    await fetch(`/api/workspaces/${workspaceId}/files`, {
      method: 'POST',
      body: fd,
    });
    e.target.value = '';
    setUploading(false);
    refresh();
  }

  async function createNote() {
    await fetch(`/api/workspaces/${workspaceId}/files`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: noteName,
        content: '',
        mime: 'text/markdown',
      }),
    });
    setCreatingNote(false);
    setNoteName('note.md');
    refresh();
  }

  async function remove(id: string) {
    if (!confirm('Delete file?')) return;
    await fetch(`/api/workspaces/${workspaceId}/files/${id}`, {
      method: 'DELETE',
    });
    refresh();
  }

  function updateFileAutoAccept(fileId: string, next: number | null) {
    setFiles((prev) =>
      prev.map((f) => (f.id === fileId ? { ...f, autoAcceptEdits: next } : f)),
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center flex-wrap">
        <label className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-surface border border-surface-2 bg-surface hover:bg-surface-2 cursor-pointer transition">
          {uploading ? (
            <LoaderCircle size={14} className="animate-spin text-accent" />
          ) : (
            <Upload size={14} />
          )}
          Upload
          <input type="file" className="hidden" onChange={onUpload} />
        </label>
        {creatingNote ? (
          <span
            className={
              compact ? 'flex flex-col gap-2 w-full' : 'flex gap-2 items-center'
            }
          >
            <input
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
                onClick={createNote}
                className={`px-3 py-1.5 text-sm rounded-surface bg-accent text-accent-fg hover:bg-accent/90 transition ${compact ? 'flex-1' : ''}`}
              >
                Create
              </button>
              <button
                onClick={() => setCreatingNote(false)}
                className={`px-3 py-1.5 text-sm rounded-surface border border-surface-2 hover:bg-surface-2 transition ${compact ? 'flex-1' : ''}`}
              >
                Cancel
              </button>
            </span>
          </span>
        ) : (
          <button
            onClick={() => setCreatingNote(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-surface border border-surface-2 bg-surface hover:bg-surface-2 transition"
          >
            <Plus size={14} />
            New file
          </button>
        )}
      </div>

      {loading ? (
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
                        onChange={(next) => updateFileAutoAccept(f.id, next)}
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
                      onChange={(next) => updateFileAutoAccept(f.id, next)}
                    />
                  )}
                  <span>{f.mime ?? '—'}</span>
                  <span>{(f.size / 1024).toFixed(1)}KB</span>
                  <button
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
