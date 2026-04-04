'use client';

const SettingsSection = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => {
  return (
    <div className="flex flex-col space-y-4 p-4 bg-surface rounded-xl border border-surface-2">
      <h2 className="font-medium">{title}</h2>
      {children}
    </div>
  );
};

export default SettingsSection;
