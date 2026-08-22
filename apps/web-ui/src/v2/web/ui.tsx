import type { ReactNode } from 'react';

import iconSpriteUrl from '../assets/icons/phosphor-v2-subset.svg';
import { WebRepositoryError } from './contracts.js';

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

const PROVIDER_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  PROVIDER_ABORTED: '本次 Provider 请求已取消。',
  PROVIDER_INVALID_CONTENT_TYPE: 'Provider 返回了不受支持的内容类型。',
  PROVIDER_INVALID_JSON: 'Provider 返回的内容不是有效 JSON。',
  PROVIDER_NETWORK_UNREACHABLE: '浏览器无法连接 Provider；请检查网络和对方的 CORS 设置。',
  PROVIDER_RATE_LIMITED: 'Provider 当前限流，本应用不会自动重试。',
  PROVIDER_REQUEST_TOO_LARGE: '本次 Provider 请求超过本地大小上限。',
  PROVIDER_RESPONSE_TOO_LARGE: 'Provider 响应超过本地大小上限。',
  PROVIDER_TIMEOUT: 'Provider 请求已超时，结果可能不确定，本应用不会自动重试。',
  PROVIDER_UPSTREAM_4XX: 'Provider 拒绝了本次请求；请检查凭据、模型和服务配置。',
  PROVIDER_UPSTREAM_5XX: 'Provider 服务暂时失败，本应用不会自动重试。',
});

export function webSafeErrorMessage(error: unknown): string {
  if (error instanceof WebRepositoryError) return `${error.message} [${error.code}]`;
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = String((error as { readonly code: unknown }).code).slice(0, 64);
    const providerMessage = PROVIDER_MESSAGES[code];
    if (providerMessage !== undefined) return `${providerMessage} [${code}]`;
  }
  return '操作未完成；已有本地数据未改变。 [WEB_OPERATION_FAILED]';
}

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
