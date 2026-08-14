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
      <Button size="sm" icon={Edit3} onClick={onEdit}>
        Edit
      </Button>
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
