'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { LoaderCircle } from 'lucide-react';
import MarkdownRenderer from '@/components/MarkdownRenderer';
import DocEditActions from './DocEditActions';
import { useWorkspace, usePatchWorkspace } from '@/lib/hooks/api/useWorkspaces';

// CodeMirror touches window/document at module load, so load it client-only.
const CodeEditor = dynamic(() => import('@/components/dashboard/CodeEditor'), {
  ssr: false,
});

export default function InstructionsEditor({
  workspaceId,
  startEditing = false,
}: {
  workspaceId: string;
  startEditing?: boolean;
}) {
  const { data: workspace } = useWorkspace(workspaceId);
  const patch = usePatchWorkspace(workspaceId);

  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(startEditing);
  // The stored text the draft was forked from; null until the workspace loads.
  const [base, setBase] = useState<string | null>(null);

  // Follow the stored value while the draft is disposable — unsaved edits are
  // never overwritten by a background refetch.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!workspace) return;
    const remote = workspace.instructions ?? '';
    if (remote === base || (base !== null && editing && draft !== base)) return;
    setBase(remote);
    setDraft(remote);
  }, [workspace, base, editing, draft]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!workspace) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoaderCircle size={24} className="animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-end gap-2">
        <DocEditActions
          editing={editing}
          saving={patch.isPending}
          onEdit={() => setEditing(true)}
          onCancel={() => {
            setDraft(base ?? '');
            setEditing(false);
          }}
          onSave={() =>
            patch.mutate(
              { instructions: draft },
              {
                onSuccess: () => {
                  setBase(draft);
                  setEditing(false);
                },
              },
            )
          }
        />
      </header>

      {editing ? (
        <CodeEditor
          value={draft}
          onChange={setDraft}
          filename="instructions.md"
          height="60vh"
          ariaLabel="Workspace instructions"
        />
      ) : draft ? (
        <div className="prose-sm bg-surface rounded-floating border border-surface-2 p-6">
          <MarkdownRenderer content={draft} />
        </div>
      ) : (
        <p className="text-fg/50 text-sm bg-surface rounded-floating border border-surface-2 p-6">
          No instructions yet. These are appended to the system prompt for every
          chat in this workspace.
        </p>
      )}
    </div>
  );
}
