'use client';

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
    <div className="flex flex-col space-y-4 p-4 bg-surface rounded-floating border border-surface-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium">{title}</h2>
        {headerAction}
      </div>
      {children}
    </div>
  );
};

export default SettingsSection;
