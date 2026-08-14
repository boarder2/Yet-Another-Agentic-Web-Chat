import React from 'react';
import Link, { type LinkProps } from 'next/link';
import { LoaderCircle, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type IconButtonTone = 'default' | 'danger' | 'active' | 'primary';

type IconButtonCommonProps = {
  icon: LucideIcon;
  /** Accessible name and tooltip. */
  label: string;
  /** Rendered icon size in pixels. */
  iconSize?: number;
  tone?: IconButtonTone;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
};

type IconButtonButtonProps = IconButtonCommonProps &
  Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    'aria-label' | 'children' | 'className' | 'disabled' | 'title' | 'type'
  > & {
    href?: never;
    type?: 'button' | 'submit';
  };

type IconButtonLinkProps = IconButtonCommonProps &
  Omit<
    React.ComponentPropsWithoutRef<typeof Link>,
    'aria-label' | 'children' | 'className' | 'href' | 'title'
  > & {
    href: LinkProps['href'];
  };

export type IconButtonProps = IconButtonButtonProps | IconButtonLinkProps;

const base =
  'inline-flex items-center justify-center rounded-control border border-transparent p-1.5 transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-fg-muted aria-disabled:pointer-events-none aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent aria-disabled:hover:text-fg-muted';

const tones: Record<IconButtonTone, string> = {
  default: 'text-fg-muted hover:bg-surface hover:text-fg focus-border-neutral',
  danger:
    'text-danger hover:bg-danger-soft hover:text-danger focus-border-contrast',
  active:
    'bg-surface-2 text-accent hover:bg-surface-2 hover:text-accent focus-border-neutral',
  primary:
    'bg-accent text-accent-fg hover:bg-accent-700 hover:text-accent-fg focus-border-contrast',
};

export const iconButtonClasses = (tone: IconButtonTone = 'default') =>
  cn(base, tones[tone]);

const IconButton = React.forwardRef<
  HTMLButtonElement | HTMLAnchorElement,
  IconButtonProps
>((props, ref) => {
  const {
    icon: Icon,
    label,
    iconSize = 15,
    tone = 'default',
    loading = false,
    className,
    disabled = false,
  } = props;
  const busy = loading || undefined;
  const icon = loading ? (
    <LoaderCircle size={iconSize} className="animate-spin" />
  ) : (
    <Icon size={iconSize} />
  );

  if (props.href !== undefined) {
    const {
      href,
      onClick,
      icon: _icon,
      label: _label,
      iconSize: _iconSize,
      tone: _tone,
      loading: _loading,
      disabled: _disabled,
      className: _className,
      ...linkProps
    } = props as IconButtonLinkProps;
    const unavailable = disabled || loading;

    return (
      <Link
        ref={ref as React.Ref<HTMLAnchorElement>}
        href={href}
        {...linkProps}
        title={label}
        aria-label={label}
        aria-busy={busy}
        aria-disabled={unavailable || undefined}
        tabIndex={unavailable ? -1 : linkProps.tabIndex}
        onClick={(event) => {
          if (unavailable) {
            event.preventDefault();
            return;
          }
          onClick?.(event);
        }}
        className={cn(iconButtonClasses(tone), className)}
      >
        {icon}
      </Link>
    );
  }

  const {
    type = 'button',
    icon: _icon,
    label: _label,
    iconSize: _iconSize,
    tone: _tone,
    loading: _loading,
    disabled: _disabled,
    className: _className,
    ...buttonProps
  } = props as IconButtonButtonProps;
  return (
    <button
      ref={ref as React.Ref<HTMLButtonElement>}
      type={type === 'submit' ? 'submit' : 'button'}
      {...buttonProps}
      disabled={disabled || loading}
      title={label}
      aria-label={label}
      aria-busy={busy}
      className={cn(iconButtonClasses(tone), className)}
    >
      {icon}
    </button>
  );
});
IconButton.displayName = 'IconButton';

export { IconButton };
