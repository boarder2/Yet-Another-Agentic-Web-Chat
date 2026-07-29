'use client';

import { Edit3, Save, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';

/** Edit / Cancel+Save switch shared by the workspace document editors. */
export default function DocEditActions({
  editing,
  saving,
  canSave = true,
  onEdit,
  onCancel,
  onSave,
}: {
  editing: boolean;
  saving: boolean;
  canSave?: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  if (!editing) {
    return (
      <button
        type="button"
        onClick={onEdit}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-surface border border-surface-2 bg-surface hover:bg-surface-2 transition-colors duration-150"
      >
        <Edit3 size={14} />
        Edit
      </button>
    );
  }
  return (
    <>
      <Button variant="ghost" icon={X} onClick={onCancel}>
        Cancel
      </Button>
      <Button
        variant="primary"
        icon={Save}
        onClick={onSave}
        loading={saving}
        disabled={!canSave}
      >
        Save
      </Button>
    </>
  );
}
