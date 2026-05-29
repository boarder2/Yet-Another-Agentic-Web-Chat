'use client';

import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { useWorkspace, usePatchWorkspace } from '@/lib/hooks/api/useWorkspaces';
import { useSystemPrompts } from '@/lib/hooks/api/useSystemPrompts';
import {
  useWorkspaceSystemPrompts,
  useSaveWorkspaceSystemPromptLinks,
} from '@/lib/hooks/api/useWorkspaceSystemPrompts';

export default function InstructionsTab({
  workspaceId,
  onSummaryChange,
}: {
  workspaceId: string;
  onSummaryChange?: (info: { length: number; linkedCount: number }) => void;
}) {
  const { data: workspace } = useWorkspace(workspaceId);
  const { data: allPrompts = [] } = useSystemPrompts();
  const { data: linkedIds = [] } = useWorkspaceSystemPrompts(workspaceId);
  const patch = usePatchWorkspace(workspaceId);
  const saveLinks = useSaveWorkspaceSystemPromptLinks(workspaceId);

  const [instructions, setInstructions] = useState('');
  const [saved, setSaved] = useState(true);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (workspace?.instructions !== undefined) {
      setInstructions(workspace.instructions ?? '');
      setSaved(true);
    }
  }, [workspace?.instructions]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    onSummaryChange?.({
      length: instructions.length,
      linkedCount: linkedIds.length,
    });
  }, [instructions.length, linkedIds.length, onSummaryChange]);

  function saveInstructions() {
    patch.mutate({ instructions }, { onSuccess: () => setSaved(true) });
  }

  function toggleLink(id: string) {
    const next = linkedIds.includes(id)
      ? linkedIds.filter((x) => x !== id)
      : [...linkedIds, id];
    saveLinks.mutate(next);
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <label className="text-sm font-medium">Workspace instructions</label>
        <textarea
          aria-label="Workspace instructions"
          value={instructions}
          onChange={(e) => {
            setInstructions(e.target.value);
            setSaved(false);
          }}
          className="w-full min-h-[200px] font-mono text-sm border border-surface-2 rounded-surface p-3 bg-surface focus:outline-none focus:border-accent resize-y"
          placeholder="Free-text instructions appended to the system prompt for every chat in this workspace."
        />
        <div className="flex justify-end gap-2 text-sm">
          {saved ? (
            <span className="text-fg/40">Saved</span>
          ) : (
            <button
              type="button"
              onClick={saveInstructions}
              className="px-3 py-1 rounded-surface bg-accent text-accent-fg hover:opacity-90 transition-opacity"
            >
              Save
            </button>
          )}
        </div>
      </section>
      {allPrompts.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-1.5">
            <label className="text-sm font-medium">Linked system prompts</label>
            <div className="group relative">
              <Info size={14} className="text-fg/40 cursor-help" />
              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block w-64 p-2 bg-surface border border-surface-2 rounded-surface text-xs text-fg/70 shadow-xl z-50 pointer-events-none">
                These are pre-defined global prompts that are appended to the
                system prompt for every chat in this workspace. They are added
                in addition to any prompts selected directly in the message
                input.
              </div>
            </div>
          </div>
          <ul className="divide-y divide-surface-2 border border-surface-2 rounded-surface">
            {allPrompts.map((p) => (
              <li key={p.id} className="flex items-center gap-2 p-3">
                <input
                  type="checkbox"
                  aria-label={`Link system prompt: ${p.name}`}
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
