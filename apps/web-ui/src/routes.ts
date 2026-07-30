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
    description: '管理本地书目实体、来源观察、发现覆盖与待确认消歧。',
    label: '书库',
    path: '/library',
    shortLabel: '书',
  },
  {
    description: '管理版本化来源、精确证据、原子事实、事实评估与可逆冲突决定。',
    label: '资料研究',
    path: '/research',
    shortLabel: '研',
  },
  {
    description: '管理五类候选、确定性资格与排序、语义去重及 FIRST_30_V1 配额计划。',
    label: '选题池',
    path: '/topics',
    shortLabel: '题',
  },
  {
    description: '管理可检验的单变量实验、跨作品复现、分层 assignment 与版本状态。',
    label: '实验管理',
    path: '/experiments',
    shortLabel: '验',
  },
  {
    description: '管理五类结构化 Brief、字段证据、真实性、剧透、实验绑定与受控结构候选。',
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
    description: '配置本地数据目录、中转站、模型、预算、账号策略与本机凭据引用。',
    label: '设置',
    path: '/settings',
    shortLabel: '设',
  },
]);

export function resolveRoute(path: string): NavigationItem | null {
  return NAVIGATION_ITEMS.find((item) => item.path === path) ?? null;
}
