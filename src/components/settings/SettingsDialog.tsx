'use client';

import { Settings as SettingsIcon } from 'lucide-react';

import { SectionKey } from '@/app/settings/types';
import SettingsPanel from '@/app/settings/SettingsPanel';
import Modal from '@/components/ui/Modal';

/**
 * Settings modal. `xl` is the widest shared size and goes edge-to-edge under
 * `lg`, which is what the long settings form wants. Section selection is
 * controlled by the provider so deep-link entry points can jump straight to a
 * section.
 */
export default function SettingsDialog({
  open,
  onClose,
  activeSection,
  onSelectSection,
}: {
  open: boolean;
  onClose: () => void;
  activeSection: SectionKey;
  onSelectSection: (key: SectionKey) => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={
        <>
          <SettingsIcon size={18} />
          Settings
        </>
      }
    >
      <SettingsPanel
        variant="modal"
        activeSection={activeSection}
        onSelectSection={onSelectSection}
        onNavigateToHelp={onClose}
      />
    </Modal>
  );
}
