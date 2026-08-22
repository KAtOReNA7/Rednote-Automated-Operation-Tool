import type { ReactNode } from 'react';

import iconSpriteUrl from '../assets/icons/phosphor-v2-subset.svg';

export type WebIconName =
  | 'books'
  | 'bookmark-simple'
  | 'calendar-blank'
  | 'check'
  | 'export'
  | 'file-text'
  | 'gear-six'
  | 'house'
  | 'plus'
  | 'user-circle';

export function WebIcon({
  name,
  size = 20,
}: {
  readonly name: WebIconName;
  readonly size?: number;
}): React.JSX.Element {
  return (
    <svg aria-hidden="true" className="v2-icon" height={size} width={size}>
      <use href={`${iconSpriteUrl}#${name}`} />
    </svg>
  );
}

export function WebButton({
  children,
  icon,
  tone = 'secondary',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly icon?: WebIconName;
  readonly tone?: 'primary' | 'secondary';
}): React.JSX.Element {
  return (
    <button className={`v2-button v2-button--${tone}`} type="button" {...props}>
      {icon === undefined ? null : <WebIcon name={icon} size={18} />}
      <span>{children}</span>
    </button>
  );
}

export function WebPageHeader({
  actions,
  description,
  eyebrow,
  title,
}: {
  readonly actions?: ReactNode;
  readonly description: string;
  readonly eyebrow: string;
  readonly title: string;
}): React.JSX.Element {
  return (
    <header className="v2-page-header">
      <div>
        <p className="v2-kicker">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions === undefined ? null : <div className="v2-header-actions">{actions}</div>}
    </header>
  );
}

export function WebStatusPill({ status }: { readonly status: string }): React.JSX.Element {
  const tone = status === '已确认' ? 'success' : status.includes('待') ? 'warning' : 'neutral';
  return <span className={`v2-status v2-status--${tone}`}>{status}</span>;
}
