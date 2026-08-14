import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { filterChipClasses } from '@/components/ui/FilterChip';

export interface TabItem {
  key: string;
  label: string;
  icon?: LucideIcon;
  href?: string;
  /** Replace (rather than push) the history entry, so toggling tabs doesn't stack up. */
  replace?: boolean;
  onClick?: () => void;
}

export function Tabs({
  items,
  activeKey,
  'aria-label': ariaLabel,
  className,
}: {
  items: TabItem[];
  activeKey: string;
  'aria-label'?: string;
  className?: string;
}) {
  if (items.length === 0) return null;

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn('flex items-center gap-2', className)}
    >
      {items.map((item) => {
        const active = item.key === activeKey;
        const cls = filterChipClasses(active, 'md');
        const content = (
          <>
            {item.icon && <item.icon size={15} />}
            {item.label}
          </>
        );

        if (item.href) {
          return (
            <Link
              key={item.key}
              href={item.href}
              replace={item.replace}
              role="tab"
              aria-selected={active}
              aria-current={active ? 'page' : undefined}
              className={cls}
            >
              {content}
            </Link>
          );
        }
        return (
          <button
            key={item.key}
            type="button"
            onClick={item.onClick}
            role="tab"
            aria-selected={active}
            className={cls}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}
