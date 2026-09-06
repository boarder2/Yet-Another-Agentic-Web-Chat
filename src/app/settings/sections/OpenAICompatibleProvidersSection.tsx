'use client';

import { useState } from 'react';
import { Pencil, Plus, TestTube, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import AppSwitch from '@/components/ui/AppSwitch';
import Badge from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import ConfirmModal from '@/components/ui/ConfirmModal';
import { IconButton } from '@/components/ui/IconButton';
import { ListEmptyState, ListLoading, ListRow } from '@/components/ui/List';
import { ApiError } from '@/lib/api/client';
import {
  useDeleteOpenAICompatibleProvider,
  useOpenAICompatibleProviders,
  usePatchOpenAICompatibleProvider,
  useTestOpenAICompatibleProvider,
  type OpenAICompatibleProvider,
} from '@/lib/hooks/api/useOpenAICompatibleProviders';
import SettingsSection from '../components/SettingsSection';
import OpenAICompatibleProviderModal from '../components/OpenAICompatibleProviderModal';

function ProviderRow({
  provider,
  onEdit,
  onDelete,
}: {
  provider: OpenAICompatibleProvider;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const patch = usePatchOpenAICompatibleProvider(provider.id);
  const test = useTestOpenAICompatibleProvider(provider.id);
  const [testResult, setTestResult] = useState<
    { ok: true; modelCount: number } | { ok: false; message: string } | null
  >(null);

  const toggleEnabled = (enabled: boolean) => {
    patch.mutate(
      { enabled },
      {
        onError: (error) =>
          toast.error(
            error instanceof ApiError
              ? error.message
              : 'Could not update provider',
          ),
      },
    );
  };

  const runTest = () => {
    setTestResult(null);
    test.mutate(undefined, {
      onSuccess: (result) => setTestResult(result),
      onError: (error) =>
        setTestResult({
          ok: false,
          message:
            error instanceof Error ? error.message : 'Provider test failed',
        }),
    });
  };

  return (
    <ListRow
      leading={
        <AppSwitch
          checked={provider.enabled}
          onChange={toggleEnabled}
          disabled={patch.isPending}
          aria-label={`${provider.enabled ? 'Disable' : 'Enable'} ${provider.name}`}
        />
      }
      title={provider.name}
      body={
        <div className="flex flex-col gap-1 text-xs text-fg-subtle">
          <span className="break-all">{provider.baseUrl}</span>
          {testResult?.ok && (
            <span role="status" className="text-success">
              Test successful — {testResult.modelCount} model
              {testResult.modelCount === 1 ? '' : 's'} discovered.
            </span>
          )}
          {testResult && !testResult.ok && (
            <span role="alert" className="text-danger">
              Test failed: {testResult.message}
            </span>
          )}
        </div>
      }
      meta={
        <>
          <Badge tone={provider.enabled ? 'success' : 'default'}>
            {provider.enabled ? 'Enabled' : 'Disabled'}
          </Badge>
          <Badge tone={provider.supportsEmbeddings ? 'info' : 'default'}>
            {provider.supportsEmbeddings ? 'Embeddings' : 'No embeddings'}
          </Badge>
          <span>
            {provider.headerNames.length} header
            {provider.headerNames.length === 1 ? '' : 's'}
          </span>
        </>
      }
      actions={
        <>
          <IconButton icon={Pencil} label="Edit" onClick={onEdit} />
          <IconButton
            icon={TestTube}
            label="Test"
            loading={test.isPending}
            onClick={runTest}
          />
          <IconButton
            icon={Trash2}
            label="Delete"
            tone="danger"
            onClick={onDelete}
          />
        </>
      }
    />
  );
}

export default function OpenAICompatibleProvidersSection() {
  const {
    data: providers = [],
    isLoading,
    isError,
  } = useOpenAICompatibleProviders();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingProvider, setEditingProvider] =
    useState<OpenAICompatibleProvider | null>(null);
  const [deleteTarget, setDeleteTarget] =
    useState<OpenAICompatibleProvider | null>(null);
  const deleteProvider = useDeleteOpenAICompatibleProvider(
    deleteTarget?.id ?? '',
  );

  const addProvider = () => {
    setEditingProvider(null);
    setEditorOpen(true);
  };

  const editProvider = (provider: OpenAICompatibleProvider) => {
    setEditingProvider(provider);
    setEditorOpen(true);
  };

  const closeEditor = () => setEditorOpen(false);

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteProvider.mutate(undefined, {
      onSuccess: () => {
        toast.success(`Deleted "${deleteTarget.name}"`);
        setDeleteTarget(null);
      },
      onError: (error) =>
        toast.error(
          error instanceof Error ? error.message : 'Could not delete provider',
        ),
    });
  };

  return (
    <>
      <SettingsSection
        title="OpenAI-Compatible Providers"
        headerAction={
          <Button size="sm" icon={Plus} onClick={addProvider}>
            Add provider
          </Button>
        }
      >
        <p className="text-xs text-fg-muted">
          Configure named OpenAI-compatible endpoints. Model catalogs are
          discovered from each enabled provider; header values stay encrypted
          and are never shown here.
        </p>

        {isLoading && (
          <ListLoading
            layout="compact"
            size={20}
            status="Loading compatible providers…"
          />
        )}
        {isError && (
          <p role="alert" className="text-sm text-danger">
            Could not load OpenAI-compatible providers.
          </p>
        )}
        {!isLoading && !isError && providers.length === 0 && (
          <ListEmptyState
            layout="compact"
            body="No OpenAI-compatible providers configured yet."
            action={
              <Button size="sm" icon={Plus} onClick={addProvider}>
                Add provider
              </Button>
            }
          />
        )}
        {!isLoading && !isError && providers.length > 0 && (
          <div className="divide-y divide-surface-2">
            {providers.map((provider) => (
              <ProviderRow
                key={provider.id}
                provider={provider}
                onEdit={() => editProvider(provider)}
                onDelete={() => setDeleteTarget(provider)}
              />
            ))}
          </div>
        )}
      </SettingsSection>

      <OpenAICompatibleProviderModal
        open={editorOpen}
        provider={editingProvider}
        onClose={closeEditor}
      />

      <ConfirmModal
        open={deleteTarget !== null}
        onClose={() => {
          if (!deleteProvider.isPending) setDeleteTarget(null);
        }}
        title="Delete OpenAI-compatible provider"
        body={
          <p>
            Saved model references will remain after deletion and may be
            unavailable until they are updated.
          </p>
        }
        loading={deleteProvider.isPending}
        onConfirm={confirmDelete}
      />
    </>
  );
}
