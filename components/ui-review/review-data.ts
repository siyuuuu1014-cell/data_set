export type ReviewStatus = 'pending' | 'confirmed' | 'adjust'
export type OptimizationMode = '保守优化' | '局部结构优化' | '重新设计'

export type PreviewState =
  | 'normal'
  | 'loading'
  | 'empty'
  | 'error'
  | 'processing'
  | 'partial'
  | 'approved'
  | 'success'

export type PreviewKey =
  | 'home'
  | 'annotation-projects'
  | 'annotation-project'
  | 'annotation-workbench'
  | 'table-workspace'
  | 'data-projects'
  | 'new-data-project'
  | 'data-project-detail'
  | 'new-data-table'
  | 'shared-settings'
  | 'workspace-restore'
  | 'global-loading'
  | 'global-error'
  | 'not-found'
  | 'video-upload'
  | 'annotation-export'
  | 'identity-manager'
  | 'table-statistics'

export interface ReviewPage {
  key: PreviewKey
  module: string
  name: string
  formalRoute: string
  type: string
  mode: OptimizationMode
  skills: string[]
  status: ReviewStatus
  problem: string
  improvement: string
  reviewFocus: string
  states: PreviewState[]
}

export const REVIEW_PAGES: ReviewPage[] = [
  {
    key: 'home',
    module: '全局入口',
    name: '工作区首页',
    formalRoute: '/',
    type: '首页 / 品牌入口',
    mode: '局部结构优化',
    skills: ['impeccable', 'ui-ux-pro-max', 'design-taste-frontend'],
    status: 'confirmed',
    problem: '视觉记忆点与产品导航混在同一数据流装饰中，双工作区的差异还不够清楚。',
    improvement: '以“原始素材进入、结构化结果离开”的单一数据轨迹连接两个工作区，同时保持入口直接可用。',
    reviewFocus: '首页的新主题是否足够有辨识度，同时仍像本地专业工具。',
    states: ['normal', 'loading', 'error'],
  },
  {
    key: 'annotation-projects',
    module: '视频标注',
    name: '标注项目列表',
    formalRoute: '/annotations',
    type: '列表页',
    mode: '局部结构优化',
    skills: ['impeccable', 'ui-ux-pro-max', 'design-taste-frontend'],
    status: 'confirmed',
    problem: '总览、视图切换与项目卡片争夺层级，请求失败也可能被误解为空项目。',
    improvement: '改为操作导向的项目队列，直接暴露待审、失败和处理进度，并将错误状态独立呈现。',
    reviewFocus: '列表密度、状态层级和创建入口是否清楚。',
    states: ['normal', 'loading', 'empty', 'error'],
  },
  {
    key: 'annotation-project',
    module: '视频标注',
    name: '标注项目详情',
    formalRoute: '/annotations/[annotateId]',
    type: '详情页 / 质量中心',
    mode: '局部结构优化',
    skills: ['impeccable', 'ui-ux-pro-max'],
    status: 'confirmed',
    problem: '质量问题、视频清单和上传动作在纵向页面中彼此分散，异常定位成本偏高。',
    improvement: '将质量队列作为稳定侧栏，视频列表成为主工作区，并在行内显示下一步动作。',
    reviewFocus: '质量中心是否应该常驻，以及窄屏时的折叠顺序。',
    states: ['normal', 'loading', 'empty', 'error', 'processing', 'partial'],
  },
  {
    key: 'annotation-workbench',
    module: '视频标注',
    name: '视频标注工作台',
    formalRoute: '/annotations/[annotateId]/videos/[videoId]',
    type: '复杂工作台',
    mode: '局部结构优化',
    skills: ['impeccable', 'ui-ux-pro-max'],
    status: 'confirmed',
    problem: '阶段操作、画布、场景列表、对象编辑、审核和导出同时争夺注意力，状态文案也未完全双语化。',
    improvement: '建立“场景队列 - 画布 - 检查器 - 时间线”的固定空间模型，审核动作随当前片段保持可见。',
    reviewFocus: '三栏比例、画布优先级和审核操作位置。',
    states: ['normal', 'loading', 'error', 'processing', 'partial', 'approved'],
  },
  {
    key: 'table-workspace',
    module: '数据合成',
    name: '数据表工作台',
    formalRoute: '/project/[id]/table/[tableId]',
    type: '表格页 / 编辑工作台',
    mode: '局部结构优化',
    skills: ['impeccable', 'ui-ux-pro-max'],
    status: 'confirmed',
    problem: 'Schema、生成控制、统计、导入导出和数据浏览横向叠加，主任务层级不稳定。',
    improvement: '用紧凑命令栏区分结构、生成和输出操作，表格保持最大可视面积，列状态直接进入表头。',
    reviewFocus: '命令栏分组、表格信息密度以及窄屏的字段摘要模式。',
    states: ['normal', 'loading', 'empty', 'error', 'processing'],
  },
  {
    key: 'data-projects',
    module: '数据合成',
    name: '数据项目列表',
    formalRoute: '/projects',
    type: '列表页 / 工作区总览',
    mode: '局部结构优化',
    skills: ['impeccable', 'ui-ux-pro-max'],
    status: 'confirmed',
    problem: '项目总览、汇总指标和逐行操作已经齐全，但缺少搜索、筛选和更明确的最近工作上下文。',
    improvement: '建立可扫描的项目目录，将项目规模、更新时间和下一步动作放在同一阅读路径中。',
    reviewFocus: '项目行密度、搜索位置以及删除动作是否足够克制。',
    states: ['normal', 'loading', 'empty', 'error'],
  },
  {
    key: 'new-data-project',
    module: '数据合成',
    name: '创建数据项目',
    formalRoute: '/project/new',
    type: '创建页 / 单字段表单',
    mode: '保守优化',
    skills: ['impeccable', 'ui-ux-pro-max'],
    status: 'confirmed',
    problem: '流程很短，但表单缺少对项目用途、命名边界和创建后去向的即时说明。',
    improvement: '保留单字段创建路径，用明确帮助、行内校验和成功反馈提高确定性。',
    reviewFocus: '表单是否足够直接，以及辅助说明是否过量。',
    states: ['normal', 'loading', 'empty', 'error', 'success'],
  },
  {
    key: 'data-project-detail',
    module: '数据合成',
    name: '数据项目详情',
    formalRoute: '/project/[id]',
    type: '详情页 / 数据表目录',
    mode: '局部结构优化',
    skills: ['impeccable', 'ui-ux-pro-max'],
    status: 'confirmed',
    problem: '表数量、字段摘要、拖动排序、导出和删除集中在列表中，关键动作与风险动作距离偏近。',
    improvement: '把项目上下文、表规模和表操作分层，默认突出打开与新增，将删除降为安静的次级动作。',
    reviewFocus: '表目录的信息密度、字段摘要和批量导出入口。',
    states: ['normal', 'loading', 'empty', 'error'],
  },
  {
    key: 'new-data-table',
    module: '数据合成',
    name: '创建数据表',
    formalRoute: '/project/[id]/table/new',
    type: '复杂表单 / Schema Builder',
    mode: '局部结构优化',
    skills: ['impeccable', 'ui-ux-pro-max'],
    status: 'confirmed',
    problem: '列类型、关联表、导入、LLM 提示词和生成代码同时展开，首次创建时认知负荷很高。',
    improvement: '改为有顺序的 Schema Builder，只展开当前字段的高级配置，并让完整性检查常驻。',
    reviewFocus: '渐进展开是否保留专业能力，以及窄屏时字段编辑顺序。',
    states: ['normal', 'loading', 'empty', 'error', 'processing', 'success'],
  },
  {
    key: 'shared-settings',
    module: '系统配置',
    name: '共享设置中心',
    formalRoute: '/settings',
    type: '设置页 / 多服务配置',
    mode: '局部结构优化',
    skills: ['impeccable', 'ui-ux-pro-max'],
    status: 'confirmed',
    problem: '合成数据 LLM、视频语义模型和部署模式纵向堆叠，当前配置范围与保存状态不易快速定位。',
    improvement: '用左侧服务目录稳定配置上下文，右侧仅展示当前设置，并把连接测试、隐私影响和保存反馈放回相关配置区。',
    reviewFocus: '左侧分类是否清楚，配置密度与风险说明是否平衡。',
    states: ['normal', 'loading', 'empty', 'error', 'processing', 'success'],
  },
  {
    key: 'workspace-restore',
    module: '系统恢复',
    name: '工作区恢复',
    formalRoute: '/restore',
    type: '恢复流程 / 自动跳转页',
    mode: '保守优化',
    skills: ['impeccable', 'ui-ux-pro-max'],
    status: 'confirmed',
    problem: '恢复过程会快速跳转，但用户难以判断当前扫描对象、已保留数据以及降级恢复的影响。',
    improvement: '保留自动恢复路径，以清晰阶段、扫描结果和降级说明表达进度，完成后给出明确去向。',
    reviewFocus: '恢复信息是否足够安心，同时不会拖慢自动流程。',
    states: ['normal', 'loading', 'processing', 'partial', 'error', 'success'],
  },
  {
    key: 'global-loading',
    module: '系统状态',
    name: '全局加载状态',
    formalRoute: 'app/loading.tsx',
    type: '路由状态页 / 加载',
    mode: '保守优化',
    skills: ['impeccable', 'ui-ux-pro-max'],
    status: 'confirmed',
    problem: '通用加载页缺少正在准备哪些本地资源的上下文。',
    improvement: '使用克制的工作区准备状态和阶段提示，避免空白等待。',
    reviewFocus: '加载反馈是否清楚且不过度抢占注意力。',
    states: ['loading'],
  },
  {
    key: 'global-error',
    module: '系统状态',
    name: '全局错误状态',
    formalRoute: 'app/error.tsx',
    type: '路由状态页 / 错误恢复',
    mode: '保守优化',
    skills: ['impeccable', 'ui-ux-pro-max'],
    status: 'confirmed',
    problem: '错误页有恢复操作，但本地数据安全边界和替代入口表达不足。',
    improvement: '先说明数据未被修改，再提供重试、返回首页和检查本地服务三条恢复路径。',
    reviewFocus: '恢复路径的优先级和错误语气是否合适。',
    states: ['error'],
  },
  {
    key: 'not-found',
    module: '系统状态',
    name: '页面未找到',
    formalRoute: 'app/not-found.tsx',
    type: '路由状态页 / 404',
    mode: '保守优化',
    skills: ['impeccable', 'ui-ux-pro-max'],
    status: 'confirmed',
    problem: '404 页面提供入口，但没有帮助用户理解动态项目或任务可能已被移除。',
    improvement: '把“地址变化”和“本地内容已移除”说清楚，并按工作区提供返回路径。',
    reviewFocus: '文案是否足够具体，两个工作区入口是否容易选择。',
    states: ['empty'],
  },
  {
    key: 'video-upload',
    module: '视频标注',
    name: '批量导入视频',
    formalRoute: '弹层 · /annotations/[annotateId]',
    type: '对话框 / 文件导入',
    mode: '局部结构优化',
    skills: ['impeccable', 'ui-ux-pro-max'],
    status: 'confirmed',
    problem: '拖放区域能够选择视频，但选中清单、格式校验、逐文件进度和失败恢复缺少统一阅读路径。',
    improvement: '保留受保护的导入对话框，以单一文件队列呈现校验与进度，错误直接贴近对应文件。',
    reviewFocus: '批量文件队列是否清楚，失败文件能否快速识别与重试。',
    states: ['normal', 'empty', 'error', 'processing', 'success'],
  },
  {
    key: 'annotation-export',
    module: '视频标注',
    name: '导出标注数据',
    formalRoute: '弹层 · 视频标注工作台',
    type: '对话框 / 导出配置',
    mode: '局部结构优化',
    skills: ['impeccable', 'ui-ux-pro-max'],
    status: 'confirmed',
    problem: '三种导出格式和识别文本选项使用相似卡片堆叠，格式差异与最终输出内容不够容易比较。',
    improvement: '用轻量格式切换和即时输出摘要替代卡片列表，导出中、失败和完成反馈留在同一位置。',
    reviewFocus: '格式选择是否直观，附加 OCR 与语音文本的影响是否清楚。',
    states: ['normal', 'error', 'processing', 'success'],
  },
  {
    key: 'identity-manager',
    module: '视频标注',
    name: '人物身份管理',
    formalRoute: '内嵌工具 · 视频标注工作台',
    type: '工作台面板 / 合并与拆分',
    mode: '局部结构优化',
    skills: ['impeccable', 'ui-ux-pro-max'],
    status: 'confirmed',
    problem: '身份列表、锁定、合并和拆分集中在折叠块中，跨片段影响与危险操作的方向不够显眼。',
    improvement: '改为左侧身份目录与右侧决策工作区，明确来源、目标、影响范围和持久化结果。',
    reviewFocus: '合并方向和拆分范围是否不易误解，锁定状态是否足够清楚。',
    states: ['normal', 'loading', 'empty', 'error', 'processing', 'success'],
  },
  {
    key: 'table-statistics',
    module: '数据合成',
    name: '字段统计分析',
    formalRoute: '内嵌工具 · /project/[id]/table/[tableId]',
    type: '数据分析面板',
    mode: '局部结构优化',
    skills: ['impeccable', 'ui-ux-pro-max'],
    status: 'confirmed',
    problem: '每个字段都渲染为统计卡片，字段较多时扫描成本高，类型特有指标也难以聚焦。',
    improvement: '用字段目录控制单字段分析，右侧按字段类型展示核心指标和分布，避免统计卡片墙。',
    reviewFocus: '单字段聚焦是否比多卡片总览更高效，字段切换和窄屏布局是否顺畅。',
    states: ['normal', 'loading', 'empty', 'error'],
  },
]

export const REVIEW_PAGE_MAP = new Map(REVIEW_PAGES.map(page => [page.key, page]))

export const STATE_LABELS: Record<PreviewState, string> = {
  normal: '正常',
  loading: '加载',
  empty: '空数据',
  error: '错误',
  processing: '处理中',
  partial: '降级结果',
  approved: '已通过',
  success: '成功',
}
