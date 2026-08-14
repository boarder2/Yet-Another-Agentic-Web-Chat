'use client';

import { Description } from '@headlessui/react';
import { useEffect, useState, type ReactNode } from 'react';
import Modal from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export interface TypedConfirmation {
  value: string;
  label?: ReactNode;
  placeholder?: string;
  ariaLabel?: string;
}

export interface ConfirmModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  body: ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  loading?: boolean;
  onConfirm: () => void;
  requireTypedConfirmation?: TypedConfirmation;
}

/** A controlled confirmation dialog. The parent closes it after a successful action. */
export default function ConfirmModal({
  open,
  onClose,
  title,
  body,
  confirmLabel = 'Delete',
  tone = 'danger',
  loading = false,
  onConfirm,
  requireTypedConfirmation,
}: ConfirmModalProps) {
  const [typedValue, setTypedValue] = useState('');

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) setTypedValue('');
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const typedConfirmationMatches =
    !requireTypedConfirmation || typedValue === requireTypedConfirmation.value;
  const cancel = () => {
    if (loading) return;
    setTypedValue('');
    onClose();
  };
  const confirm = () => {
    if (loading || !typedConfirmationMatches) return;
    onConfirm();
  };

  return (
    <Modal
      open={open}
      onClose={cancel}
      size="sm"
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={cancel} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant={tone}
            loading={loading}
            disabled={!typedConfirmationMatches}
            onClick={confirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Description as="div" className="text-sm text-fg-muted">
          {body}
        </Description>
        {requireTypedConfirmation && (
          <div className="space-y-1">
            <label className="text-xs text-fg-muted">
              {requireTypedConfirmation.label ?? (
                <>
                  Type <strong>{requireTypedConfirmation.value}</strong> to
                  confirm
                </>
              )}
            </label>
            <Input
              aria-label={
                requireTypedConfirmation.ariaLabel ??
                `Confirm ${requireTypedConfirmation.value}`
              }
              value={typedValue}
              onChange={(event) => setTypedValue(event.target.value)}
              placeholder={requireTypedConfirmation.placeholder}
              disabled={loading}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}

export { ConfirmModal };
