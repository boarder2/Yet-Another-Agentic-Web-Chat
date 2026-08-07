'use client';

import { usePathname } from 'next/navigation';
import { Tabs } from '@/components/ui/Tabs';

const tabs = [
  { key: 'workflows', label: 'Workflows', href: '/automations' },
  {
    key: 'scheduled',
    label: 'Scheduled Tasks',
    href: '/automations/scheduled',
  },
];

export default function AutomationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? '';

  const activeKey = tabs.find((t) => {
    if (t.key === 'workflows')
      return (
        pathname === '/automations' ||
        pathname.startsWith('/automations/workflows')
      );
    return (
      pathname.startsWith('/automations/scheduled') ||
      pathname.startsWith('/automations/schedules')
    );
  })?.key;

  return (
    <div className="flex flex-col">
      <nav className="pt-4">
        <Tabs items={tabs} activeKey={activeKey ?? ''} />
      </nav>
      {children}
    </div>
  );
}
