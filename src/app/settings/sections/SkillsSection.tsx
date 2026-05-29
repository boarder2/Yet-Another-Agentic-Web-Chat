'use client';

import { useState } from 'react';
import { PlusCircle, Edit3, Trash2, X, Save, BookOpen } from 'lucide-react';
import SettingsSection from '../components/SettingsSection';
import InputComponent from '../components/InputComponent';
import TextareaComponent from '../components/TextareaComponent';
import AppSwitch from '@/components/ui/AppSwitch';
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

const NAME_REGEX = /^[a-z0-9][a-z0-9_:-]*$/;

export default function SkillsSection() {
  const { data: skills = [], isLoading: loading } = useSkills();
  const { data: workspaces = [] } = useWorkspacesList();
  const createSkill = useCreateSkill();
  const updateSkill = useUpdateSkill();
  const deleteSkill = useDeleteSkill();
  const toggleSkill = useToggleSkill();

  const [editingSkill, setEditingSkill] = useState<UserSkill | null>(null);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newSkill, setNewSkill] = useState({
    name: '',
    description: '',
    content: '',
    workspaceId: '' as string | null,
    disableModelInvocation: false,
  });

  const handleCreate = () => {
    const { name, description, content, workspaceId } = newSkill;
    if (!name || !description || !content) {
      toast.error('Name, description, and content are required');
      return;
    }
    if (!NAME_REGEX.test(name)) {
      toast.error('Name must match pattern: [a-z0-9][a-z0-9_:-]*');
      return;
    }
    createSkill.mutate(
      {
        name,
        description,
        content,
        workspaceId: workspaceId || null,
        disableModelInvocation: newSkill.disableModelInvocation,
      },
      {
        onSuccess: () => {
          toast.success(`Skill "${name}" created`);
          setIsAddingNew(false);
          setNewSkill({
            name: '',
            description: '',
            content: '',
            workspaceId: '',
            disableModelInvocation: false,
          });
        },
        onError: (err) => {
          toast.error(err.message ?? 'Failed to create skill');
        },
      },
    );
  };

  const handleUpdate = () => {
    if (!editingSkill) return;
    updateSkill.mutate(
      {
        id: editingSkill.id,
        data: {
          description: editingSkill.description,
          content: editingSkill.content,
          disableModelInvocation: editingSkill.disableModelInvocation,
        },
      },
      {
        onSuccess: () => {
          toast.success('Skill updated');
          setEditingSkill(null);
        },
        onError: (err) => {
          toast.error(err.message ?? 'Failed to update skill');
        },
      },
    );
  };

  const handleDelete = (skill: UserSkill) => {
    if (
      !window.confirm(
        `Are you sure you want to delete the skill "${skill.name}"?`,
      )
    )
      return;
    deleteSkill.mutate(skill.id, {
      onSuccess: () => toast.success(`Skill "${skill.name}" deleted`),
      onError: () => toast.error('Failed to delete skill'),
    });
  };

  const handleToggle = (skill: UserSkill, enabled: boolean) => {
    toggleSkill.mutate(
      { id: skill.id, enabled },
      { onError: () => toast.error('Failed to update skill') },
    );
  };

  const getScopeBadge = (skill: UserSkill) => {
    if (!skill.workspaceId) return 'Global';
    const ws = workspaces.find((w) => w.id === skill.workspaceId);
    return ws ? ws.name : 'Workspace';
  };

  return (
    <SettingsSection
      title="Skills"
      headerAction={
        <button
          type="button"
          onClick={() => setIsAddingNew(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-control bg-accent text-accent-fg hover:bg-accent/90 transition-colors"
        >
          <PlusCircle size={14} />
          New skill
        </button>
      }
    >
      <p className="text-xs text-fg/60">
        Skills provide on-demand instructions to the agent. Create global skills
        or workspace-scoped skills that the agent can load when needed.
      </p>

      {isAddingNew && (
        <div className="p-3 border border-accent/40 rounded-control bg-surface-2 space-y-3">
          <p className="text-sm font-medium">New Skill</p>
          <InputComponent
            type="text"
            value={newSkill.name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setNewSkill({ ...newSkill, name: e.target.value })
            }
            placeholder="skill-name (lowercase, hyphens ok)"
          />
          <InputComponent
            type="text"
            value={newSkill.description}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setNewSkill({ ...newSkill, description: e.target.value })
            }
            placeholder="One-line description shown in autocomplete"
          />
          <TextareaComponent
            value={newSkill.content}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
              setNewSkill({ ...newSkill, content: e.target.value })
            }
            placeholder="Full skill body (markdown supported)"
            className="min-h-[120px]"
          />
          <div className="flex items-center gap-2">
            <label className="text-xs text-fg/60">Scope:</label>
            <select
              value={newSkill.workspaceId ?? ''}
              onChange={(e) =>
                setNewSkill({
                  ...newSkill,
                  workspaceId: e.target.value || null,
                })
              }
              className="text-sm bg-surface border border-surface-2 rounded-control px-2 py-1 focus:outline-none focus:border-accent"
            >
              <option value="">Global</option>
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium">
                Disable model auto-invocation
              </p>
              <p className="text-xs text-fg/50">
                Slash-command only — hidden from model&apos;s available skills
                list
              </p>
            </div>
            <AppSwitch
              checked={newSkill.disableModelInvocation}
              onChange={(val: boolean) =>
                setNewSkill({ ...newSkill, disableModelInvocation: val })
              }
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setIsAddingNew(false);
                setNewSkill({
                  name: '',
                  description: '',
                  content: '',
                  workspaceId: '',
                  disableModelInvocation: false,
                });
              }}
              className="px-3 py-2 text-sm rounded-control bg-surface hover:bg-surface-2 flex items-center gap-1.5"
            >
              <X size={14} />
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={createSkill.isPending}
              className="px-3 py-2 text-sm rounded-control bg-accent text-accent-fg flex items-center gap-1.5"
            >
              <Save size={14} />
              Create
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-fg/50">Loading skills…</p>
      ) : skills.length === 0 && !isAddingNew ? (
        <div className="flex items-center gap-2 text-sm text-fg/50 py-2">
          <BookOpen size={16} />
          No skills yet. Create one to get started.
        </div>
      ) : (
        <div className="flex flex-col space-y-2">
          {skills.map((skill) => (
            <div
              key={skill.id}
              className={`p-3 border border-surface-2 rounded-control bg-surface-2 transition-opacity ${
                !skill.enabled ? 'opacity-50' : ''
              }`}
            >
              {editingSkill?.id === skill.id ? (
                <div className="space-y-3">
                  <p className="text-xs text-fg/50 font-mono">{skill.name}</p>
                  <InputComponent
                    type="text"
                    value={editingSkill.description}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setEditingSkill({
                        ...editingSkill,
                        description: e.target.value,
                      })
                    }
                    placeholder="Description"
                  />
                  <TextareaComponent
                    value={editingSkill.content}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                      setEditingSkill({
                        ...editingSkill,
                        content: e.target.value,
                      })
                    }
                    placeholder="Skill content"
                    className="min-h-[120px]"
                  />
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium">
                        Disable model auto-invocation
                      </p>
                      <p className="text-xs text-fg/50">
                        Slash-command only — hidden from model&apos;s available
                        skills list
                      </p>
                    </div>
                    <AppSwitch
                      checked={editingSkill.disableModelInvocation}
                      onChange={(val: boolean) =>
                        setEditingSkill({
                          ...editingSkill,
                          disableModelInvocation: val,
                        })
                      }
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingSkill(null)}
                      className="px-3 py-2 text-sm rounded-control bg-surface hover:bg-surface-2 flex items-center gap-1.5"
                    >
                      <X size={14} />
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleUpdate}
                      disabled={updateSkill.isPending}
                      className="px-3 py-2 text-sm rounded-control bg-accent text-accent-fg flex items-center gap-1.5"
                    >
                      <Save size={14} />
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex justify-between items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="text-xs font-mono text-fg/80">
                        {skill.name}
                      </code>
                      <span className="text-xs text-fg/50 bg-surface px-1.5 py-0.5 rounded-pill border border-surface-2">
                        {getScopeBadge(skill)}
                      </span>
                      {skill.disableModelInvocation && (
                        <span className="text-xs text-fg/50 bg-surface px-1.5 py-0.5 rounded-pill border border-surface-2">
                          Slash-only
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-fg/60 mt-0.5 truncate">
                      {skill.description}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <AppSwitch
                      checked={skill.enabled}
                      onChange={(val: boolean) => handleToggle(skill, val)}
                    />
                    <button
                      type="button"
                      onClick={() => setEditingSkill({ ...skill })}
                      title="Edit"
                      className="p-1.5 rounded-control hover:bg-surface"
                    >
                      <Edit3 size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(skill)}
                      title="Delete"
                      className="p-1.5 rounded-control hover:bg-surface text-danger"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </SettingsSection>
  );
}
