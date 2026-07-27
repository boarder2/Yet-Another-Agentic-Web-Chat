'use client';

import { Edit3, Save, X, LoaderCircle } from 'lucide-react';

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
      <button
        type="button"
        onClick={onCancel}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-surface hover:bg-surface-2 transition-colors duration-150"
      >
        <X size={14} />
        Cancel
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={saving || !canSave}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-surface bg-accent text-accent-fg hover:bg-accent-700 transition-colors duration-150 disabled:opacity-50"
      >
        {saving ? (
          <LoaderCircle size={14} className="animate-spin" />
        ) : (
          <Save size={14} />
        )}
        Save
      </button>
    </>
  );
}
