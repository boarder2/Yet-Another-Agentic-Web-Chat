'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import { LoaderCircle, TriangleAlert } from 'lucide-react';
import MarkdownRenderer from '@/components/MarkdownRenderer';
import DocEditActions from './DocEditActions';

// CodeMirror touches window/document at module load, so load it client-only.
const CodeEditor = dynamic(() => import('@/components/dashboard/CodeEditor'), {
  ssr: false,
});
import { ApiError } from '@/lib/api/client';
import {
  useWorkspaceFileContent,
  useSaveWorkspaceFileContent,
} from '@/lib/hooks/api/useWorkspaceFiles';

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

export default function FileViewer({
  workspaceId,
  fileId,
  startEditing = false,
}: {
  workspaceId: string;
  fileId: string;
  startEditing?: boolean;
}) {
  const { data, isLoading, refetch } = useWorkspaceFileContent(
    workspaceId,
    fileId,
  );
  const saveContent = useSaveWorkspaceFileContent(workspaceId, fileId);

  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(startEditing);
  // The version the draft was forked from. Sent back on save as the CAS token.
  const [base, setBase] = useState<{ sha: string; content: string } | null>(
    null,
  );
  const [conflict, setConflict] = useState(false);

  const adopt = useCallback((sha: string, content: string) => {
    setBase({ sha, content });
    setDraft(content);
    setConflict(false);
  }, []);

  // The agent writes to workspace files too, and any file it touches invalidates
  // this query. Follow the remote version only while the draft is disposable —
  // an unsaved edit is never overwritten, it raises a conflict instead.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!data?.file || data.content === undefined || data.content === null)
      return;
    const remoteSha = data.file.sha256;
    if (!base) {
      adopt(remoteSha, data.content);
      return;
    }
    if (remoteSha === base.sha) return;
    if (editing && draft !== base.content) setConflict(true);
    else adopt(remoteSha, data.content);
  }, [data?.file, data?.content, base, editing, draft, adopt]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function save(expectedSha: string) {
    saveContent.mutate(
      { content: draft, expectedSha },
      {
        onSuccess: (res) => {
          setBase({ sha: res.file.sha256, content: draft });
          setConflict(false);
          setEditing(false);
        },
        onError: (e) => {
          if (e instanceof ApiError && e.status === 409) {
            setConflict(true);
            // Pull the winning version in so "Overwrite anyway" swaps against it
            // rather than re-sending the sha that just lost.
            refetch();
          }
        },
      },
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoaderCircle size={24} className="animate-spin text-accent" />
      </div>
    );
  }

  if (!data?.file) {
    return <p className="text-fg/50 text-sm">File not found.</p>;
  }

  const { file: meta, content, isBinary } = data;

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{meta.name}</h1>
          {meta.mime && <span className="text-xs text-fg/40">{meta.mime}</span>}
        </div>
        <div className="flex gap-2">
          {!isBinary && (
            <DocEditActions
              editing={editing}
              saving={saveContent.isPending}
              canSave={!conflict}
              onEdit={() => setEditing(true)}
              onCancel={() => {
                adopt(meta.sha256, content);
                setEditing(false);
              }}
              onSave={() => save(base?.sha ?? meta.sha256)}
            />
          )}
        </div>
      </header>

      {conflict && (
        <div className="flex flex-wrap items-center gap-3 rounded-floating border border-warning bg-warning-soft px-4 py-3 text-sm">
          <TriangleAlert size={16} className="text-warning shrink-0" />
          <p className="flex-1 min-w-60">
            This file changed since you started editing. Your unsaved changes
            are still here — saving now would overwrite the newer version.
          </p>
          <button
            type="button"
            onClick={() => {
              adopt(meta.sha256, content);
              setEditing(false);
            }}
            className="px-3 py-1.5 rounded-surface border border-surface-2 bg-surface hover:bg-surface-2 transition"
          >
            Discard mine
          </button>
          <button
            type="button"
            onClick={() => save(meta.sha256)}
            disabled={saveContent.isPending}
            className="px-3 py-1.5 rounded-surface bg-accent text-accent-fg hover:bg-accent/90 transition disabled:opacity-50"
          >
            Overwrite anyway
          </button>
        </div>
      )}

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
        <CodeEditor
          value={draft}
          onChange={setDraft}
          filename={meta.name}
          height="60vh"
          ariaLabel="File content"
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
