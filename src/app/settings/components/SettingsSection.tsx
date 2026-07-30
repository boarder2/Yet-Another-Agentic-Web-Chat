'use client';

import { Card } from '@/components/ui/Card';

const SettingsSection = ({
  title,
  headerAction,
  children,
}: {
  title: string;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
}) => {
  return (
    <Card radius="floating" className="flex flex-col space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium">{title}</h2>
        {headerAction}
      </div>
      {children}
    </Card>
  );
};

export default SettingsSection;
