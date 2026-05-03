import { cn } from '@/lib/utils';
import { LucideIcon } from 'lucide-react';
import { ReactNode } from 'react';

interface PageHeaderProps {
  icon: LucideIcon;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

const PageHeader = ({
  icon: Icon,
  title,
  subtitle,
  actions,
  className,
}: PageHeaderProps) => (
  <div className={cn('flex flex-col pt-4', className)}>
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <Icon className="text-accent shrink-0" size={24} />
        <h1 className="text-2xl font-medium truncate">{title}</h1>
        {subtitle && (
          <span className="text-sm text-fg/50 shrink-0">{subtitle}</span>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 shrink-0">{actions}</div>
      )}
    </div>
    <hr className="border-t border-surface-2 my-4 w-full" />
  </div>
);

export default PageHeader;
