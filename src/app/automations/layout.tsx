'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const tabs = [
  { href: '/automations', label: 'Workflows' },
  { href: '/automations/scheduled', label: 'Scheduled Tasks' },
];

export default function AutomationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? '';

  return (
    <div className="flex flex-col">
      <nav className="flex items-center gap-1 pt-4">
        {tabs.map((t) => {
          const active =
            t.href === '/automations'
              ? pathname === '/automations' ||
                pathname.startsWith('/automations/workflows')
              : pathname.startsWith('/automations/scheduled') ||
                pathname.startsWith('/automations/schedules');
          return (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                'px-4 py-2 rounded-control text-sm font-medium transition-colors duration-150',
                active
                  ? 'bg-surface-2 text-fg'
                  : 'text-fg/60 hover:text-fg hover:bg-surface',
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
