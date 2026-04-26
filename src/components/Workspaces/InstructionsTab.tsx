'use client';

import { useEffect, useState } from 'react';

interface SystemPrompt {
  id: string;
  name: string;
  type?: string;
}

export default function InstructionsTab({
  workspaceId,
}: {
  workspaceId: string;
}) {
  const [instructions, setInstructions] = useState('');
  const [allPrompts, setAllPrompts] = useState<SystemPrompt[]>([]);
  const [linkedIds, setLinkedIds] = useState<string[]>([]);
  const [saved, setSaved] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`/api/workspaces/${workspaceId}`).then((r) => r.json()),
      fetch(`/api/system-prompts`).then((r) => r.json()),
      fetch(`/api/workspaces/${workspaceId}/system-prompts`).then((r) =>
        r.json(),
      ),
    ]).then(([ws, prompts, links]) => {
      setInstructions(ws.workspace?.instructions ?? '');
      setAllPrompts(
        Array.isArray(prompts)
          ? prompts
          : (prompts.systemPrompts ?? prompts.prompts ?? []),
      );
      setLinkedIds(
        (links.links ?? []).map(
          (l: { systemPromptId: string }) => l.systemPromptId,
        ),
      );
    });
  }, [workspaceId]);

  async function saveInstructions() {
    await fetch(`/api/workspaces/${workspaceId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instructions }),
    });
    setSaved(true);
  }

  async function toggleLink(id: string) {
    const next = linkedIds.includes(id)
      ? linkedIds.filter((x) => x !== id)
      : [...linkedIds, id];
    setLinkedIds(next);
    await fetch(`/api/workspaces/${workspaceId}/system-prompts`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: next }),
    });
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <label className="text-sm font-medium">Workspace instructions</label>
        <textarea
          value={instructions}
          onChange={(e) => {
            setInstructions(e.target.value);
            setSaved(false);
          }}
          className="w-full min-h-[200px] font-mono text-sm border border-surface-2 rounded-lg p-3 bg-surface focus:outline-none focus:border-accent resize-y"
          placeholder="Free-text instructions appended to the system prompt for every chat in this workspace."
        />
        <div className="flex justify-end gap-2 text-sm">
          {saved ? (
            <span className="text-fg/40">Saved</span>
          ) : (
            <button
              onClick={saveInstructions}
              className="px-3 py-1 rounded-lg bg-accent text-accent-fg hover:opacity-90 transition-opacity"
            >
              Save
            </button>
          )}
        </div>
      </section>
      {allPrompts.length > 0 && (
        <section className="space-y-2">
          <label className="text-sm font-medium">Linked system prompts</label>
          <ul className="divide-y divide-surface-2 border border-surface-2 rounded-lg">
            {allPrompts.map((p) => (
              <li key={p.id} className="flex items-center gap-2 p-3">
                <input
                  type="checkbox"
                  checked={linkedIds.includes(p.id)}
                  onChange={() => toggleLink(p.id)}
                  className="accent-accent"
                />
                <span className="flex-1">{p.name}</span>
                {p.type && <span className="text-xs text-fg/40">{p.type}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
