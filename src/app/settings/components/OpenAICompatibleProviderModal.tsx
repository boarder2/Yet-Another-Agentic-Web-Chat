'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import AppSwitch from '@/components/ui/AppSwitch';
import { Field } from '@/components/ui/Field';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import Modal from '@/components/ui/Modal';
import {
  useCreateOpenAICompatibleProvider,
  usePatchOpenAICompatibleProvider,
  type OpenAICompatibleProvider,
} from '@/lib/hooks/api/useOpenAICompatibleProviders';
import { generateId } from '@/lib/utils/id';

type HeaderRow = {
  id: string;
  name: string;
  value: string;
};

type ProviderForm = {
  name: string;
  baseUrl: string;
  enabled: boolean;
  supportsEmbeddings: boolean;
  headers: HeaderRow[];
};

function emptyForm(): ProviderForm {
  return {
    name: '',
    baseUrl: '',
    enabled: true,
    supportsEmbeddings: false,
    headers: [],
  };
}

function formFromProvider(provider: OpenAICompatibleProvider): ProviderForm {
  return {
    name: provider.name,
    baseUrl: provider.baseUrl,
    enabled: provider.enabled,
    supportsEmbeddings: provider.supportsEmbeddings,
    headers: provider.headerNames.map((name) => ({
      id: generateId(),
      name,
      value: '',
    })),
  };
}

/** Build the create payload from the repeatable header rows. */
export function headerRowsToCreatePayload(
  rows: readonly HeaderRow[],
): Record<string, string> | undefined {
  const headers = Object.fromEntries(
    rows
      .filter((row) => row.name.trim())
      .map((row) => [row.name.trim(), row.value]),
  );
  return Object.keys(headers).length > 0 ? headers : undefined;
}

/**
 * Build the write-only edit patch. Blank values preserve an existing header;
 * omitted rows become explicit null removals.
 */
export function headerRowsToPatch(
  rows: readonly HeaderRow[],
  originalNames: readonly string[],
): Record<string, string | null> | undefined {
  const patch: Record<string, string | null> = {};
  const original = new Map(
    originalNames.map((name) => [name.toLowerCase(), name]),
  );
  const kept = new Set<string>();

  for (const row of rows) {
    const name = row.name.trim();
    if (!name) continue;
    const originalName = original.get(name.toLowerCase());
    kept.add((originalName ?? name).toLowerCase());
    if (row.value !== '' || !originalName) {
      if (originalName && originalName !== name) patch[originalName] = null;
      patch[name] = row.value;
    }
  }

  for (const name of originalNames) {
    if (!kept.has(name.toLowerCase())) patch[name] = null;
  }

  return Object.keys(patch).length > 0 ? patch : undefined;
}

function formError(
  form: ProviderForm,
  editing: boolean,
  originalNames: readonly string[],
): string | null {
  if (!form.name.trim()) return 'Name is required.';
  if (!form.baseUrl.trim()) return 'Base URL is required.';

  const seen = new Set<string>();
  const original = new Set(originalNames.map((name) => name.toLowerCase()));
  for (const row of form.headers) {
    const name = row.name.trim();
    if (!name && row.value !== '') return 'Every header value needs a name.';
    if (!name) continue;
    const normalized = name.toLowerCase();
    if (seen.has(normalized)) return 'Header names must be unique.';
    seen.add(normalized);

    const isExisting = editing && original.has(normalized);
    // Existing rows are intentionally allowed to stay blank: blank means
    // unchanged for write-only secrets. A renamed row is a new header.
    if (!row.value && !isExisting) {
      return `Enter a value for header "${name}".`;
    }
  }
  return null;
}

export default function OpenAICompatibleProviderModal({
  open,
  provider,
  onClose,
}: {
  open: boolean;
  provider: OpenAICompatibleProvider | null;
  onClose: () => void;
}) {
  const [form, setForm] = useState<ProviderForm>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const valueRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const formId = useId();
  const create = useCreateOpenAICompatibleProvider();
  const patch = usePatchOpenAICompatibleProvider(provider?.id ?? '');
  const saving = create.isPending || patch.isPending;
  const editing = provider !== null;

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setForm(provider ? formFromProvider(provider) : emptyForm());
    setError(null);
  }, [open, provider]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const close = () => {
    if (!saving) onClose();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validationError = formError(
      form,
      editing,
      provider?.headerNames ?? [],
    );
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    try {
      if (provider) {
        const headersPatch = headerRowsToPatch(
          form.headers,
          provider.headerNames,
        );
        await patch.mutateAsync({
          name: form.name.trim(),
          baseUrl: form.baseUrl.trim(),
          enabled: form.enabled,
          supportsEmbeddings: form.supportsEmbeddings,
          ...(headersPatch ? { headersPatch } : {}),
        });
        toast.success(`Updated "${form.name.trim()}"`);
      } else {
        const headers = headerRowsToCreatePayload(form.headers);
        await create.mutateAsync({
          name: form.name.trim(),
          baseUrl: form.baseUrl.trim(),
          enabled: form.enabled,
          supportsEmbeddings: form.supportsEmbeddings,
          ...(headers ? { headers } : {}),
        });
        toast.success(`Added "${form.name.trim()}"`);
      }
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Could not save provider.',
      );
    }
  };

  const focusHeaderValue = (id: string) => {
    requestAnimationFrame(() => valueRefs.current[id]?.focus());
  };

  const addBearerToken = () => {
    const existing = form.headers.find(
      (row) => row.name.trim().toLowerCase() === 'authorization',
    );
    if (existing) {
      focusHeaderValue(existing.id);
      return;
    }
    const id = generateId();
    setForm((current) => ({
      ...current,
      headers: [...current.headers, { id, name: 'Authorization', value: '' }],
    }));
    focusHeaderValue(id);
  };

  return (
    <Modal
      open={open}
      onClose={close}
      size="md"
      title={
        editing
          ? 'Edit OpenAI-Compatible Provider'
          : 'Add OpenAI-Compatible Provider'
      }
      footer={
        <>
          <Button onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            loading={saving}
          >
            {editing ? 'Save changes' : 'Add provider'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Name">
          <Input
            value={form.name}
            onChange={(event) =>
              setForm((current) => ({ ...current, name: event.target.value }))
            }
            placeholder="My local gateway"
            autoFocus
          />
        </Field>

        <Field
          label="Base URL"
          hint="Use an HTTP(S) root or a URL ending in /v1."
        >
          <Input
            value={form.baseUrl}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                baseUrl: event.target.value,
              }))
            }
            placeholder="http://localhost:1234"
            type="url"
          />
        </Field>

        <div className="flex flex-col gap-3 border-t border-surface-2 pt-4">
          <Field
            grouped
            label="Enabled"
            className="flex-row items-center justify-between"
          >
            <AppSwitch
              checked={form.enabled}
              onChange={(enabled) =>
                setForm((current) => ({ ...current, enabled }))
              }
              aria-label="Enabled"
            />
          </Field>
          <Field
            grouped
            label="Supports Embeddings"
            hint="Expose every discovered model as an embedding option."
            className="flex-row items-center justify-between"
          >
            <AppSwitch
              checked={form.supportsEmbeddings}
              onChange={(supportsEmbeddings) =>
                setForm((current) => ({ ...current, supportsEmbeddings }))
              }
              aria-label="Supports Embeddings"
            />
          </Field>
        </div>

        <div className="flex flex-col gap-2 border-t border-surface-2 pt-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-medium">Request headers</h3>
              <p className="text-xs text-fg-muted">
                Values are write-only and sent with discovery and model
                requests.
              </p>
            </div>
            <Button size="sm" icon={KeyRound} onClick={addBearerToken}>
              Add Bearer Token
            </Button>
          </div>

          {form.headers.map((row, index) => (
            <div key={row.id} className="flex items-center gap-2">
              <Input
                aria-label={`Header ${index + 1} name`}
                value={row.name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    headers: current.headers.map((candidate) =>
                      candidate.id === row.id
                        ? { ...candidate, name: event.target.value }
                        : candidate,
                    ),
                  }))
                }
                placeholder="Header name"
              />
              <Input
                ref={(element) => {
                  valueRefs.current[row.id] = element;
                }}
                aria-label={`Header ${index + 1} value`}
                type="password"
                value={row.value}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    headers: current.headers.map((candidate) =>
                      candidate.id === row.id
                        ? { ...candidate, value: event.target.value }
                        : candidate,
                    ),
                  }))
                }
                placeholder={
                  provider?.headerNames.some(
                    (name) =>
                      name.toLowerCase() === row.name.trim().toLowerCase(),
                  )
                    ? 'Unchanged'
                    : 'Header value'
                }
              />
              <IconButton
                icon={Trash2}
                label={`Remove header ${row.name || index + 1}`}
                tone="danger"
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    headers: current.headers.filter(
                      (candidate) => candidate.id !== row.id,
                    ),
                  }))
                }
              />
            </div>
          ))}

          <Button
            size="sm"
            variant="ghost"
            icon={Plus}
            onClick={() =>
              setForm((current) => ({
                ...current,
                headers: [
                  ...current.headers,
                  { id: generateId(), name: '', value: '' },
                ],
              }))
            }
            className="self-start"
          >
            Add header
          </Button>
        </div>

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
