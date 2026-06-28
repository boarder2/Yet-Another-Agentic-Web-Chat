'use client';

import { Settings as SettingsIcon, X } from 'lucide-react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

import { SectionKey } from '@/app/settings/types';
import SettingsPanel from '@/app/settings/SettingsPanel';

/**
 * Settings modal. Reuses the app modal pattern (portal, Escape, overlay click,
 * body scroll lock) from {@link WorkspaceModal} but is sized for the long
 * settings form: a wide centered panel on desktop, a near-full-screen sheet
 * under `lg`. Section selection is controlled by the provider so deep-link
 * entry points can jump straight to a section.
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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-overlay lg:items-center lg:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-5xl flex-col bg-surface lg:max-h-[90vh] lg:rounded-floating lg:border lg:border-surface-2 lg:shadow-floating lg:overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-2 shrink-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            <SettingsIcon size={18} />
            Settings
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-control hover:bg-surface-2 transition text-fg/60"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-5">
          <SettingsPanel
            variant="modal"
            activeSection={activeSection}
            onSelectSection={onSelectSection}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
