'use client';

import { useEffect, useState } from 'react';
import {
  Plus,
  ChevronUp,
  ChevronDown,
  Trash2,
  CheckCircle2,
  AlertCircle,
  LoaderCircle,
  Link2,
} from 'lucide-react';

type Reach = 'unknown' | 'ok' | 'warn' | 'checking';

export default function UrlsTab({
  workspaceId,
  onCountChange,
  compact = false,
}: {
  workspaceId: string;
  onCountChange?: (n: number) => void;
  compact?: boolean;
}) {
  const [urls, setUrls] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [reach, setReach] = useState<Record<string, Reach>>({});

  async function load() {
    const data = await fetch(`/api/workspaces/${workspaceId}/urls`).then((r) =>
      r.json(),
    );
    const list = data.urls ?? [];
    setUrls(list);
    onCountChange?.(list.length);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  async function persist(next: string[]) {
    setUrls(next);
    await fetch(`/api/workspaces/${workspaceId}/urls`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ urls: next }),
    });
  }

  async function addUrl() {
    if (!draft.trim()) return;
    if (urls.length >= 20) return void alert('Maximum of 20 URLs.');
    const url = draft.trim();
    const next = [...urls, url];
    await persist(next);
    setDraft('');
    setReach((m) => ({ ...m, [url]: 'checking' }));
    const r = await fetch(`/api/workspaces/${workspaceId}/urls/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    }).then((r) => r.json());
    setReach((m) => ({ ...m, [url]: r.ok ? 'ok' : 'warn' }));
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= urls.length) return;
    const next = [...urls];
    [next[i], next[j]] = [next[j], next[i]];
    persist(next);
  }

  function remove(i: number) {
    persist(urls.filter((_, k) => k !== i));
  }

  const ReachIcon = ({ url }: { url: string }) => {
    const s = reach[url] ?? 'unknown';
    if (s === 'checking')
      return <LoaderCircle size={14} className="animate-spin text-accent" />;
    if (s === 'ok') return <CheckCircle2 size={14} className="text-success" />;
    if (s === 'warn') return <AlertCircle size={14} className="text-warning" />;
    return (
      <span className="w-3.5 h-3.5 rounded-pill border border-fg/20 inline-block" />
    );
  };

  return (
    <div className="space-y-4">
      <div className={compact ? 'flex flex-col gap-2' : 'flex gap-2'}>
        <input
          className="flex-1 min-w-0 border border-surface-2 rounded-surface px-3 py-2 text-sm bg-bg focus:outline-none focus:border-accent"
          placeholder="https://…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addUrl()}
        />
        <button
          onClick={addUrl}
          className={`flex items-center justify-center gap-1.5 px-3 py-2 text-sm rounded-surface bg-accent text-accent-fg hover:bg-accent/90 transition shrink-0 ${compact ? 'w-full' : ''}`}
        >
          <Plus size={14} />
          Add
        </button>
      </div>

      <p className="text-xs text-fg/40">{urls.length} / 20</p>

      {urls.length === 0 ? (
        <div className="text-center py-8">
          <Link2 className="mx-auto mb-2 text-fg/20" size={32} />
          <p className="text-sm text-fg/50">No source URLs yet.</p>
        </div>
      ) : (
        <ul className="divide-y divide-surface-2 border border-surface-2 rounded-floating overflow-hidden">
          {urls.map((u, i) => (
            <li
              key={u}
              className="flex items-center justify-between px-4 py-2.5 bg-surface hover:bg-surface-2 transition"
            >
              <div className="flex items-center gap-2 min-w-0">
                <ReachIcon url={u} />
                <a
                  href={u}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-sm hover:underline"
                >
                  {u}
                </a>
              </div>
              <span className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="p-1.5 rounded-control hover:bg-surface-2 disabled:opacity-30 transition"
                  title="Move up"
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === urls.length - 1}
                  className="p-1.5 rounded-control hover:bg-surface-2 disabled:opacity-30 transition"
                  title="Move down"
                >
                  <ChevronDown size={14} />
                </button>
                <button
                  onClick={() => remove(i)}
                  className="p-1.5 rounded-control hover:bg-danger-soft text-danger transition"
                  title="Remove"
                >
                  <Trash2 size={14} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
