'use client';

import { useEffect, useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import { Edit3, Save, X, LoaderCircle } from 'lucide-react';
import MarkdownRenderer from '@/components/MarkdownRenderer';

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

function isMarkdownFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return ext === 'md' || ext === 'markdown';
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
        <LoaderCircle size={24} className="animate-spin text-accent" />
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
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-surface hover:bg-surface-2 transition"
              >
                <X size={14} />
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-surface bg-accent text-accent-fg hover:bg-accent/90 transition disabled:opacity-50"
              >
                {saving ? (
                  <LoaderCircle size={14} className="animate-spin" />
                ) : (
                  <Save size={14} />
                )}
                Save
              </button>
            </>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-surface border border-surface-2 bg-surface hover:bg-surface-2 transition"
            >
              <Edit3 size={14} />
              Edit
            </button>
          )}
        </div>
      </header>

      {isBinary ? (
        meta.mime?.startsWith('image/') ? (
          <div className="bg-surface rounded-floating border border-surface-2 p-4 flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/workspaces/${workspaceId}/files/${fileId}?raw=true`}
              alt={meta.name}
              className="max-w-full max-h-[70vh] rounded-surface object-contain"
            />
          </div>
        ) : (
          <p className="text-fg/50 text-sm bg-surface rounded-floating border border-surface-2 p-4">
            Binary file ({meta.mime ?? 'unknown'}). Editing not supported.
            Replace by deleting and re-uploading with the same name.
          </p>
        )
      ) : editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="w-full min-h-[60vh] font-mono text-sm border border-surface-2 rounded-floating p-4 bg-surface focus:outline-none focus:border-accent resize-y"
        />
      ) : isMarkdownFile(meta.name) ? (
        <div className="prose-sm bg-surface rounded-floating border border-surface-2 p-6">
          <MarkdownRenderer content={content} />
        </div>
      ) : (
        <div className="rounded-floating overflow-hidden">
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
