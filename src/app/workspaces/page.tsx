'use client';

import { FolderOpen, Plus, LoaderCircle, Archive } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import WorkspaceIcon from '@/components/Workspaces/WorkspaceIcon';
import WorkspaceSettingsFields, {
  WorkspaceModelOverrideField,
} from '@/components/Workspaces/WorkspaceSettingsFields';
import { workspaceColorClasses } from '@/lib/workspaces/appearance';
import {
  useWorkspacesList,
  useCreateWorkspace,
} from '@/lib/hooks/api/useWorkspaces';
import type { WorkspaceModelOverride } from '@/lib/workspaces/types';
import { captureCurrentSelection } from '@/lib/models/presets';

interface CreateModalProps {
  onClose: () => void;
  onCreated: () => void;
}

const FORM_ID = 'new-workspace-form';

const CreateModal = ({ onClose, onCreated }: CreateModalProps) => {
  const router = useRouter();
  const createWorkspace = useCreateWorkspace();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState<string | null>(null);
  const [icon, setIcon] = useState<string | null>(null);
  const [autoMemory, setAutoMemory] = useState(false);
  const [autoAcceptFileEdits, setAutoAcceptFileEdits] = useState(false);
  const [useCustomModels, setUseCustomModels] = useState(false);
  const [modelOverride, setModelOverride] =
    useState<WorkspaceModelOverride | null>(null);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError('');
    createWorkspace.mutate(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        color: color ?? undefined,
        icon: icon ?? undefined,
        autoMemoryEnabled: autoMemory ? 1 : 0,
        autoAcceptFileEdits: autoAcceptFileEdits ? 1 : 0,
        ...(useCustomModels && modelOverride ? { modelOverride } : {}),
      },
      {
        onSuccess: (data) => {
          onCreated();
          onClose();
          router.push(`/workspaces/${data.workspace.id}`);
        },
        onError: (err) => {
          setError(err.message ?? 'Failed to create workspace');
        },
      },
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="New Workspace"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={FORM_ID}
            variant="primary"
            disabled={!name.trim()}
            loading={createWorkspace.isPending}
          >
            Create
          </Button>
        </>
      }
    >
      <form
        id={FORM_ID}
        onSubmit={handleSubmit}
        className="flex flex-col gap-3"
      >
        <WorkspaceSettingsFields
          name={name}
          onNameChange={setName}
          description={description}
          onDescriptionChange={setDescription}
          color={color}
          icon={icon}
          onAppearanceChange={(next) => {
            setColor(next.color);
            setIcon(next.icon);
          }}
          autoMemory={autoMemory}
          onAutoMemoryChange={setAutoMemory}
          autoAcceptFileEdits={autoAcceptFileEdits}
          onAutoAcceptFileEditsChange={setAutoAcceptFileEdits}
          autoFocusName
        />
        <WorkspaceModelOverrideField
          useCustomModels={useCustomModels}
          onUseCustomModelsChange={(enabled) => {
            setUseCustomModels(enabled);
            if (enabled)
              setModelOverride((prev) => prev ?? captureCurrentSelection());
          }}
          modelOverride={modelOverride}
          onModelOverrideChange={setModelOverride}
        />
        {error && <p className="text-xs text-danger">{error}</p>}
      </form>
    </Modal>
  );
};

const WorkspacesPage = () => {
  const [showArchived, setShowArchived] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const { data: workspaces = [], isLoading } = useWorkspacesList(showArchived);

  return (
    <div>
      <PageHeader
        icon={FolderOpen}
        title="Workspaces"
        subtitle={
          !isLoading
            ? `${workspaces.length} workspace${workspaces.length !== 1 ? 's' : ''}`
            : undefined
        }
        actions={
          <>
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-surface border border-surface-2 transition duration-200',
                showArchived
                  ? 'bg-accent/20 text-accent'
                  : 'bg-surface hover:bg-surface-2',
              )}
            >
              <Archive size={14} />
              {showArchived ? 'Active' : 'Archived'}
            </button>
            <Button
              variant="primary"
              icon={Plus}
              onClick={() => setShowCreate(true)}
            >
              New Workspace
            </Button>
          </>
        }
      />

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <LoaderCircle size={24} className="animate-spin text-accent" />
        </div>
      ) : workspaces.length === 0 ? (
        <div className="text-center py-16">
          <FolderOpen className="mx-auto mb-4 text-fg/20" size={48} />
          <h2 className="text-lg font-medium text-fg/60 mb-2">
            {showArchived ? 'No archived workspaces' : 'No workspaces yet'}
          </h2>
          {!showArchived && (
            <p className="text-sm text-fg/40 max-w-md mx-auto">
              Workspaces let you organize chats, files, and instructions for
              specific projects.
            </p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {workspaces.map((ws) => {
            const c = workspaceColorClasses(ws.color);
            return (
              <Link
                key={ws.id}
                href={`/workspaces/${ws.id}`}
                className={cn(
                  'flex flex-col gap-2 p-4 bg-surface rounded-floating border transition cursor-pointer',
                  c.border,
                  'hover:opacity-90',
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'flex items-center justify-center w-7 h-7 rounded-control',
                      c.bgTint,
                    )}
                  >
                    <WorkspaceIcon
                      name={ws.icon}
                      color={ws.color}
                      size={16}
                      applyColor
                    />
                  </span>
                  <span className="font-medium truncate">{ws.name}</span>
                </div>
                {ws.description && (
                  <p className="text-xs text-fg/50 line-clamp-2">
                    {ws.description}
                  </p>
                )}
              </Link>
            );
          })}
        </div>
      )}

      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {}}
        />
      )}
    </div>
  );
};

export default WorkspacesPage;
