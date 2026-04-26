'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FileText, Upload, Plus, Trash2, Loader2 } from 'lucide-react';

type FileRow = {
  id: string;
  name: string;
  mime?: string | null;
  size: number;
  updatedAt: number;
};

export default function FilesTab({ workspaceId }: { workspaceId: string }) {
  const [files, setFiles] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingNote, setCreatingNote] = useState(false);
  const [noteName, setNoteName] = useState('note.md');
  const [uploading, setUploading] = useState(false);

  async function refresh() {
    setLoading(true);
    const data = await fetch(`/api/workspaces/${workspaceId}/files`).then((r) =>
      r.json(),
    );
    setFiles(data.files ?? []);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

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

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center flex-wrap">
        <label className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-surface-2 bg-surface hover:bg-surface-2 cursor-pointer transition">
          {uploading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Upload size={14} />
          )}
          Upload
          <input type="file" className="hidden" onChange={onUpload} />
        </label>
        {creatingNote ? (
          <span className="flex gap-2 items-center">
            <input
              className="border border-surface-2 rounded-lg px-2 py-1.5 text-sm bg-bg focus:outline-none focus:border-accent"
              value={noteName}
              onChange={(e) => setNoteName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') createNote();
                if (e.key === 'Escape') setCreatingNote(false);
              }}
            />
            <button
              onClick={createNote}
              className="px-3 py-1.5 text-sm rounded-lg bg-accent text-white hover:bg-accent/90 transition"
            >
              Create
            </button>
            <button
              onClick={() => setCreatingNote(false)}
              className="px-3 py-1.5 text-sm rounded-lg hover:bg-surface-2 transition"
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            onClick={() => setCreatingNote(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-surface-2 bg-surface hover:bg-surface-2 transition"
          >
            <Plus size={14} />
            New file
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 size={20} className="animate-spin text-fg/40" />
        </div>
      ) : files.length === 0 ? (
        <div className="text-center py-8">
          <FileText className="mx-auto mb-2 text-fg/20" size={32} />
          <p className="text-sm text-fg/50">No files yet.</p>
        </div>
      ) : (
        <ul className="divide-y divide-surface-2 border border-surface-2 rounded-xl overflow-hidden">
          {files.map((f) => (
            <li
              key={f.id}
              className="flex items-center justify-between px-4 py-2.5 bg-surface hover:bg-surface-2 transition"
            >
              <Link
                href={`/workspaces/${workspaceId}/files/${f.id}`}
                className="text-sm hover:underline flex items-center gap-2"
              >
                <FileText size={14} className="text-fg/40" />
                {f.name}
              </Link>
              <span className="flex items-center gap-3 text-xs text-fg/40">
                <span>{f.mime ?? '—'}</span>
                <span>{(f.size / 1024).toFixed(1)}KB</span>
                <button
                  onClick={() => remove(f.id)}
                  className="p-1 rounded hover:bg-red-500/10 text-red-400 transition"
                  title="Delete"
                >
                  <Trash2 size={12} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
