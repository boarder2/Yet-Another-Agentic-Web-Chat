'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

import { SectionKey } from '@/app/settings/types';
import SettingsDialog from './SettingsDialog';

interface SettingsModalContextValue {
  openSettings: (section?: SectionKey) => void;
  closeSettings: () => void;
}

const SettingsModalContext = createContext<SettingsModalContextValue | null>(
  null,
);

/**
 * Mounts a single app-wide {@link SettingsDialog} and exposes imperative
 * open/close handlers via {@link useSettingsModal}. Section state lives here so
 * a deep-link entry point can open the modal directly on a given section, and
 * so re-opening to a different section while open updates the view.
 */
export default function SettingsModalProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [activeSection, setActiveSection] =
    useState<SectionKey>('personalization');

  const openSettings = useCallback((section?: SectionKey) => {
    if (section) setActiveSection(section);
    setOpen(true);
  }, []);

  const closeSettings = useCallback(() => setOpen(false), []);

  const value = useMemo(
    () => ({ openSettings, closeSettings }),
    [openSettings, closeSettings],
  );

  return (
    <SettingsModalContext.Provider value={value}>
      {children}
      <SettingsDialog
        open={open}
        onClose={closeSettings}
        activeSection={activeSection}
        onSelectSection={setActiveSection}
      />
    </SettingsModalContext.Provider>
  );
}

export function useSettingsModal() {
  const ctx = useContext(SettingsModalContext);
  if (!ctx) {
    throw new Error(
      'useSettingsModal must be used within a SettingsModalProvider',
    );
  }
  return ctx;
}
