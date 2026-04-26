'use client';

import { useEffect, useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import Link from 'next/link';
import { ArrowLeft, Edit3, Save, X, Loader2 } from 'lucide-react';

function langFromName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return (
    (
      {
        md: 'markdown',
        markdown: 'markdown',
        js: 'javascript',
        mjs: 'javascript',
        cjs: 'javascript',
        ts: 'typescript',
        tsx: 'typescript',
        py: 'python',
        json: 'json',
        yml: 'yaml',
        yaml: 'yaml',
        html: 'html',
        css: 'css',
        sh: 'bash',
        toml: 'toml',
      } as Record<string, string>
    )[ext] ?? 'text'
  );
}

interface FileMeta {
  id: string;
  name: string;
  mime: string | null;
  size: number;
}

export default function FileViewer({
  workspaceId,
  fileId,
}: {
  workspaceId: string;
  fileId: string;
}) {
  const [meta, setMeta] = useState<FileMeta | null>(null);
  const [content, setContent] = useState<string>('');
  const [draft, setDraft] = useState<string>('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isBinary, setIsBinary] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const data = await fetch(
      `/api/workspaces/${workspaceId}/files/${fileId}`,
    ).then((r) => r.json());
    setMeta(data.file);
    setContent(data.content ?? '');
    setDraft(data.content ?? '');
    setIsBinary(!!data.isBinary);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, fileId]);

  async function save() {
    setSaving(true);
    try {
      await fetch(`/api/workspaces/${workspaceId}/files/${fileId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: draft }),
      });
      setContent(draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={24} className="animate-spin text-fg/40" />
      </div>
    );
  }

  if (!meta) {
    return <p className="text-fg/50 text-sm">File not found.</p>;
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href={`/workspaces/${workspaceId}`}
            className="text-fg/50 hover:text-fg transition"
          >
            <ArrowLeft size={16} />
          </Link>
          <h1 className="text-xl font-semibold">{meta.name}</h1>
          {meta.mime && <span className="text-xs text-fg/40">{meta.mime}</span>}
        </div>
        <div className="flex gap-2">
          {isBinary ? null : editing ? (
            <>
              <button
                onClick={() => {
                  setDraft(content);
                  setEditing(false);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg hover:bg-surface-2 transition"
              >
                <X size={14} />
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-accent text-white hover:bg-accent/90 transition disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Save size={14} />
                )}
                Save
              </button>
            </>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-surface-2 bg-surface hover:bg-surface-2 transition"
            >
              <Edit3 size={14} />
              Edit
            </button>
          )}
        </div>
      </header>

      {isBinary ? (
        <p className="text-fg/50 text-sm bg-surface rounded-xl border border-surface-2 p-4">
          Binary file ({meta.mime ?? 'unknown'}). Editing not supported. Replace
          by deleting and re-uploading with the same name.
        </p>
      ) : editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="w-full min-h-[60vh] font-mono text-sm border border-surface-2 rounded-xl p-4 bg-surface focus:outline-none focus:border-accent resize-y"
        />
      ) : (
        <div className="rounded-xl overflow-hidden">
          <SyntaxHighlighter
            language={langFromName(meta.name)}
            style={oneDark}
            customStyle={{ margin: 0, borderRadius: '0.75rem' }}
          >
            {content || ' '}
          </SyntaxHighlighter>
        </div>
      )}
    </div>
  );
}
