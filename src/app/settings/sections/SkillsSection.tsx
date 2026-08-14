'use client';

import { useState } from 'react';
import { PlusCircle, Edit3, Trash2, BookOpen } from 'lucide-react';
import SettingsSection from '../components/SettingsSection';
import SkillForm, { type SkillFormValue } from '../components/SkillForm';
import AppSwitch from '@/components/ui/AppSwitch';
import { Button } from '@/components/ui/Button';
import ConfirmModal from '@/components/ui/ConfirmModal';
import { IconButton } from '@/components/ui/IconButton';
import Badge from '@/components/ui/Badge';
import { ListEmptyState, ListLoading } from '@/components/ui/List';
import { toast } from 'sonner';
import {
  useSkills,
  useCreateSkill,
  useUpdateSkill,
  useDeleteSkill,
  useToggleSkill,
  type UserSkill,
} from '@/lib/hooks/api/useSkills';
import { useWorkspacesList } from '@/lib/hooks/api/useWorkspaces';
import { SKILL_NAME_PATTERN, isValidSkillName } from '@/lib/skills/validation';

const EMPTY_SKILL: SkillFormValue = {
  name: '',
  description: '',
  content: '',
  workspaceId: null,
  disableModelInvocation: false,
};

const toFormValue = (skill: UserSkill): SkillFormValue => ({
  name: skill.name,
  description: skill.description,
  content: skill.content,
  workspaceId: skill.workspaceId,
  disableModelInvocation: skill.disableModelInvocation,
});

export default function SkillsSection() {
  const { data: skills = [], isLoading: loading } = useSkills();
  const { data: workspaces = [] } = useWorkspacesList();
  const createSkill = useCreateSkill();
  const updateSkill = useUpdateSkill();
  const deleteSkill = useDeleteSkill();
  const toggleSkill = useToggleSkill();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SkillFormValue | null>(null);
  const [pendingDelete, setPendingDelete] = useState<UserSkill | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);

  const closeForm = () => {
    setIsAddingNew(false);
    setEditingId(null);
    setForm(null);
  };

  const isValid = (value: SkillFormValue) => {
    if (!value.name || !value.description || !value.content) {
      toast.error('Name, description, and content are required');
      return false;
    }
    if (!isValidSkillName(value.name)) {
      toast.error(`Name must match pattern: ${SKILL_NAME_PATTERN}`);
      return false;
    }
    return true;
  };

  const handleCreate = () => {
    if (!form || !isValid(form)) return;
    createSkill.mutate(form, {
      onSuccess: () => {
        toast.success(`Skill "${form.name}" created`);
        closeForm();
      },
      onError: (err) => toast.error(err.message ?? 'Failed to create skill'),
    });
  };

  const handleUpdate = () => {
    if (!form || !editingId || !isValid(form)) return;
    updateSkill.mutate(
      { id: editingId, data: form },
      {
        onSuccess: () => {
          toast.success('Skill updated');
          closeForm();
        },
        onError: (err) => toast.error(err.message ?? 'Failed to update skill'),
      },
    );
  };

  const handleDelete = (skill: UserSkill) => {
    setPendingDelete(skill);
  };

  const handleToggle = (skill: UserSkill, enabled: boolean) => {
    toggleSkill.mutate(
      { id: skill.id, enabled },
      { onError: () => toast.error('Failed to update skill') },
    );
  };

  const getScopeBadge = (skill: UserSkill) => {
    if (!skill.workspaceId) return 'Global';
    return (
      workspaces.find((w) => w.id === skill.workspaceId)?.name ?? 'Workspace'
    );
  };

  return (
    <SettingsSection
      title="Skills"
      headerAction={
        <Button
          variant="primary"
          icon={PlusCircle}
          onClick={() => {
            setEditingId(null);
            setForm(EMPTY_SKILL);
            setIsAddingNew(true);
          }}
        >
          New skill
        </Button>
      }
    >
      <p className="text-xs text-fg-muted">
        Skills provide on-demand instructions to the agent. Create global skills
        or workspace-scoped skills that the agent can load when needed.
      </p>

      {isAddingNew && form && (
        <div className="p-3 border border-accent-border rounded-control bg-surface-2">
          <SkillForm
            title="New Skill"
            value={form}
            workspaces={workspaces}
            submitLabel="Create"
            pending={createSkill.isPending}
            onChange={setForm}
            onSubmit={handleCreate}
            onCancel={closeForm}
          />
        </div>
      )}

      {loading ? (
        <ListLoading layout="compact" size={20} status="Loading skills…" />
      ) : skills.length === 0 && !isAddingNew ? (
        <ListEmptyState
          layout="compact"
          icon={BookOpen}
          body="No skills yet. Create one to get started."
        />
      ) : (
        <div className="flex flex-col space-y-2">
          {skills.map((skill) => (
            <div
              key={skill.id}
              className={`p-3 border border-surface-2 rounded-control bg-surface-2 transition-opacity duration-150 ${
                !skill.enabled ? 'opacity-50' : ''
              }`}
            >
              {editingId === skill.id && form ? (
                <SkillForm
                  title={`Edit ${skill.name}`}
                  value={form}
                  workspaces={workspaces}
                  submitLabel="Save"
                  pending={updateSkill.isPending}
                  onChange={setForm}
                  onSubmit={handleUpdate}
                  onCancel={closeForm}
                />
              ) : (
                <div className="flex justify-between items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="text-xs font-mono text-fg-muted">
                        {skill.name}
                      </code>
                      <Badge>{getScopeBadge(skill)}</Badge>
                      {skill.disableModelInvocation && (
                        <Badge>Slash-only</Badge>
                      )}
                    </div>
                    <p className="text-xs text-fg-muted mt-0.5 truncate">
                      {skill.description}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <AppSwitch
                      checked={skill.enabled}
                      onChange={(val: boolean) => handleToggle(skill, val)}
                    />
                    <IconButton
                      icon={Edit3}
                      label="Edit"
                      onClick={() => {
                        setIsAddingNew(false);
                        setEditingId(skill.id);
                        setForm(toFormValue(skill));
                      }}
                    />
                    <IconButton
                      icon={Trash2}
                      label="Delete"
                      tone="danger"
                      onClick={() => handleDelete(skill)}
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        open={!!pendingDelete}
        onClose={() => setPendingDelete(null)}
        title="Delete skill"
        body={
          <p>
            {`Are you sure you want to delete the skill "${pendingDelete?.name}"?`}
          </p>
        }
        loading={deleteSkill.isPending}
        onConfirm={() => {
          if (!pendingDelete) return;
          deleteSkill.mutate(pendingDelete.id, {
            onSuccess: () => {
              toast.success(`Skill "${pendingDelete.name}" deleted`);
              setPendingDelete(null);
            },
            onError: () => toast.error('Failed to delete skill'),
          });
        }}
      />
    </SettingsSection>
  );
}
