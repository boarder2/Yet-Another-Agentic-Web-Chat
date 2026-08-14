'use client';

import { cn } from '@/lib/utils';
import { Tabs } from '@/components/ui/Tabs';
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
      <Tabs
        activeKey={activeSection}
        items={SETTINGS_SECTIONS.map((section) => ({
          key: section.key,
          label: section.label,
          onClick: () => onSelect(section.key),
        }))}
      />
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
                type="button"
                key={section.key}
                onClick={() => onSelect(section.key)}
                className={cn(
                  'w-full border border-transparent text-left px-3 py-2 rounded-surface text-sm transition-colors duration-150 focus-border-neutral',
                  activeSection === section.key
                    ? 'bg-surface-2 text-fg font-medium'
                    : 'text-fg-muted hover:bg-surface hover:text-fg',
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
