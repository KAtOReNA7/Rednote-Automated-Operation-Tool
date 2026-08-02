export type V2RouteId =
  'overview' | 'weekly-plan' | 'content' | 'interaction' | 'library' | 'review' | 'settings';

export interface V2Route {
  readonly icon:
    | 'books'
    | 'calendar-blank'
    | 'chart-line-up'
    | 'chats-circle'
    | 'file-text'
    | 'gear-six'
    | 'house';
  readonly id: V2RouteId;
  readonly label: string;
}

export const V2_ROUTES = Object.freeze([
  { icon: 'house', id: 'overview', label: '总览' },
  { icon: 'calendar-blank', id: 'weekly-plan', label: '本周计划' },
  { icon: 'file-text', id: 'content', label: '内容' },
  { icon: 'chats-circle', id: 'interaction', label: '互动' },
  { icon: 'books', id: 'library', label: '书库' },
  { icon: 'chart-line-up', id: 'review', label: '数据复盘' },
  { icon: 'gear-six', id: 'settings', label: '设置' },
] satisfies readonly V2Route[]);

const routeIds = new Set<V2RouteId>(V2_ROUTES.map(({ id }) => id));

export function toV2Hash(route: V2RouteId): string {
  return `#/v2/${route}`;
}

export function resolveV2Route(hash: string): {
  readonly route: V2RouteId;
  readonly valid: boolean;
} {
  const candidate = hash.replace(/^#\/v2\//u, '');
  return routeIds.has(candidate as V2RouteId)
    ? { route: candidate as V2RouteId, valid: true }
    : { route: 'overview', valid: false };
}
