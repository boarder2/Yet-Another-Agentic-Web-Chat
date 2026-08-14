'use client';

import { useEffect, useState } from 'react';
import { Info, Edit3 } from 'lucide-react';
import { useWorkspace } from '@/lib/hooks/api/useWorkspaces';
import { useSystemPrompts } from '@/lib/hooks/api/useSystemPrompts';
import {
  useWorkspaceSystemPrompts,
  useSaveWorkspaceSystemPromptLinks,
} from '@/lib/hooks/api/useWorkspaceSystemPrompts';
import Modal from '@/components/ui/Modal';
import { IconButton } from '@/components/ui/IconButton';
import InstructionsEditor from './InstructionsEditor';

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
  const saveLinks = useSaveWorkspaceSystemPromptLinks(workspaceId);

  const [open, setOpen] = useState<{ edit: boolean } | null>(null);

  const instructions = workspace?.instructions ?? '';

  useEffect(() => {
    onSummaryChange?.({
      length: instructions.length,
      linkedCount: linkedIds.length,
    });
  }, [instructions.length, linkedIds.length, onSummaryChange]);

  function toggleLink(id: string) {
    const next = linkedIds.includes(id)
      ? linkedIds.filter((x) => x !== id)
      : [...linkedIds, id];
    saveLinks.mutate(next);
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium flex-1">
            Workspace instructions
          </label>
          <IconButton
            icon={Edit3}
            label="Edit"
            onClick={() => setOpen({ edit: true })}
          />
        </div>
        <button
          type="button"
          onClick={() => setOpen({ edit: !instructions })}
          aria-label="Open workspace instructions"
          className="w-full border border-surface-2 text-left text-sm whitespace-pre-wrap line-clamp-6 rounded-surface p-3 bg-surface hover:bg-surface-2 transition-colors duration-150 focus-border-neutral"
        >
          {instructions || (
            <span className="text-fg-muted">
              Free-text instructions appended to the system prompt for every
              chat in this workspace.
            </span>
          )}
        </button>
      </section>
      {allPrompts.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-1.5">
            <label className="text-sm font-medium">Linked system prompts</label>
            <div className="group relative">
              <Info size={14} className="text-fg-subtle cursor-help" />
              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block w-64 p-2 bg-surface border border-surface-2 rounded-surface text-xs text-fg-muted shadow-xl z-50 pointer-events-none">
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
                  className="accent-accent border border-transparent focus-border-neutral"
                  checked={linkedIds.includes(p.id)}
                  onChange={() => toggleLink(p.id)}
                />
                <span className="flex-1">{p.name}</span>
                {p.type && (
                  <span className="text-xs text-fg-subtle">{p.type}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Modal
        open={!!open}
        onClose={() => setOpen(null)}
        title="Workspace instructions"
        size="lg"
      >
        {open && (
          <InstructionsEditor
            workspaceId={workspaceId}
            startEditing={open.edit}
          />
        )}
      </Modal>
    </div>
  );
}
