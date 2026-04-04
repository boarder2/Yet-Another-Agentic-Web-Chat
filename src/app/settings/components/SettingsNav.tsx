'use client';

import { cn } from '@/lib/utils';
import { SectionKey, SETTINGS_SECTIONS } from '../types';

export function MobileSettingsNav({
  activeSection,
  onSelect,
}: {
  activeSection: SectionKey;
  onSelect: (key: SectionKey) => void;
}) {
  return (
    <div className="lg:hidden overflow-x-auto overflow-hidden-scrollable -mx-4 px-4 mb-4">
      <div className="flex flex-nowrap gap-2 pb-2">
        {SETTINGS_SECTIONS.map((section) => (
          <button
            key={section.key}
            onClick={() => onSelect(section.key)}
            className={cn(
              'whitespace-nowrap px-3 py-1.5 rounded-full text-sm border transition-colors',
              activeSection === section.key
                ? 'bg-accent text-white border-accent'
                : 'bg-surface border-surface-2 text-fg/70 hover:text-fg',
            )}
          >
            {section.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function DesktopSettingsNav({
  activeSection,
  onSelect,
}: {
  activeSection: SectionKey;
  onSelect: (key: SectionKey) => void;
}) {
  const groups = SETTINGS_SECTIONS.reduce(
    (acc, section) => {
      if (!acc[section.group]) acc[section.group] = [];
      acc[section.group].push(section);
      return acc;
    },
    {} as Record<string, typeof SETTINGS_SECTIONS>,
  );

  return (
    <nav className="hidden lg:block w-56 shrink-0 sticky top-4 self-start">
      <div className="flex flex-col space-y-1">
        {Object.entries(groups).map(([group, sections]) => (
          <div key={group} className="mb-2">
            <p className="text-xs font-semibold uppercase text-accent px-3 py-1">
              {group}
            </p>
            {sections.map((section) => (
              <button
                key={section.key}
                onClick={() => onSelect(section.key)}
                className={cn(
                  'w-full text-left px-3 py-2 rounded-lg text-sm transition-colors',
                  activeSection === section.key
                    ? 'bg-surface-2 text-fg font-medium'
                    : 'text-fg/70 hover:bg-surface hover:text-fg',
                )}
              >
                {section.label}
              </button>
            ))}
          </div>
        ))}
      </div>
    </nav>
  );
}
