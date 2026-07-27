export interface NavigationItem {
  readonly description: string;
  readonly label: string;
  readonly path: string;
  readonly shortLabel: string;
}

export const NAVIGATION_ITEMS: readonly NavigationItem[] = Object.freeze([
  {
    description: '查看本机运行状态与基础设施自检结果。',
    label: '总览',
    path: '/overview',
    shortLabel: '总',
  },
  {
    description: '书目与阅读材料管理尚未在当前里程碑实现。',
    label: '书库',
    path: '/library',
    shortLabel: '书',
  },
  {
    description: '资料采集、整理和研究尚未在当前里程碑实现。',
    label: '资料研究',
    path: '/research',
    shortLabel: '研',
  },
  {
    description: '选题记录与排序尚未在当前里程碑实现。',
    label: '选题池',
    path: '/topics',
    shortLabel: '题',
  },
  {
    description: '内容生成与编辑尚未在当前里程碑实现。',
    label: '内容生产',
    path: '/production',
    shortLabel: '产',
  },
  {
    description: '人工审批流程尚未在当前里程碑实现。',
    label: '审批',
    path: '/approvals',
    shortLabel: '审',
  },
  {
    description: '发布包整理与导出尚未在当前里程碑实现。',
    label: '发布包',
    path: '/packages',
    shortLabel: '包',
  },
  {
    description: '运营数据记录与复盘尚未在当前里程碑实现。',
    label: '数据复盘',
    path: '/review',
    shortLabel: '盘',
  },
  {
    description: '本地任务查看与控制尚未在当前里程碑实现。',
    label: '任务中心',
    path: '/tasks',
    shortLabel: '任',
  },
  {
    description: '应用配置尚未在当前里程碑实现。',
    label: '设置',
    path: '/settings',
    shortLabel: '设',
  },
]);

export function resolveRoute(path: string): NavigationItem | null {
  return NAVIGATION_ITEMS.find((item) => item.path === path) ?? null;
}
