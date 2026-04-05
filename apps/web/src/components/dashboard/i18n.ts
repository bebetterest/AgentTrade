import type { SupportedLocale } from "@agentrade/i18n";
import { ActivityEventType, CycleStatus, DisputeStatus, TaskStatus } from "@agentrade/types";

type AgentStateLabel = "ACTIVE" | "IDLE";

interface DashboardCopy {
  common: {
    loading: string;
    retry: string;
    details: string;
    fullPage: string;
    noActivityYet: string;
    loadingMore: string;
    on: string;
    off: string;
  };
  page: {
    centerEyebrow: string;
    centerTitle: string;
    centerBody: string;
    platformName: string;
    webReadOnly: string;
    centerUpdated: string;
    centerSource: string;
    centerBoundary: string;
    centerRateLimit: string;
    centerHealth: string;
    centerPersistence: string;
    sectionNavLabel: string;
    sectionOverview: string;
    sectionMetrics: string;
    sectionActivity: string;
    sectionStreams: string;
    jumpToStreams: string;
    focusDisputes: string;
    flowEyebrow: string;
    flowTitle: string;
    flowBody: string;
    flowStepPublishTitle: string;
    flowStepPublishBody: string;
    flowStepAcceptTitle: string;
    flowStepAcceptBody: string;
    flowStepReviewTitle: string;
    flowStepReviewBody: string;
    flowStepDisputeTitle: string;
    flowStepDisputeBody: string;
    flowStepSettleTitle: string;
    flowStepSettleBody: string;
    refresh: string;
    refreshing: string;
    overviewError: string;
    search: string;
    searchPlaceholder: string;
    clear: string;
    allStatus: string;
    latest: string;
    created: string;
    deadline: string;
    reward: string;
    activeOnly: string;
    score: string;
    reputation: string;
    completed: string;
    published: string;
    intended: string;
    orderDesc: string;
    orderAsc: string;
    filterOptions: string;
    showFilters: string;
    hideFilters: string;
    reset: string;
    drawerTitle: string;
    drawerTask: string;
    drawerAgent: string;
    drawerCycle: string;
    drawerDispute: string;
    drawerHint: string;
    close: string;
    tabTasks: string;
    tabUsers: string;
    tabCycles: string;
    tabDisputes: string;
    openOnly: string;
    resolvedCompleted: string;
    resolvedNotCompleted: string;
    listingsTitle: string;
  };
  activityFeed: {
    title: string;
    reload: string;
    loadError: string;
  };
  taskList: {
    all: string;
    loadError: string;
    reward: string;
    slots: string;
    deadline: string;
    emptyFiltered: string;
    empty: string;
    loadMore: string;
  };
  agentList: {
    loadError: string;
    score: string;
    summary: string;
    latest: string;
    emptyFiltered: string;
    empty: string;
    loadMore: string;
  };
  cycleList: {
    loadError: string;
    started: string;
    mint: string;
    tax: string;
    penalty: string;
    empty: string;
    loadMore: string;
  };
  taskDetail: {
    loadError: string;
    notFound: string;
    publisher: string;
    reward: string;
    tax: string;
    escrowRemaining: string;
    slotProgress: string;
    deadline: string;
    participants: string;
    intended: string;
    competition: string;
    none: string;
    completed: string;
    acceptanceCriteria: string;
    relatedDisputes: string;
    opener: string;
    noRelatedDisputes: string;
    activityTimeline: string;
  };
  agentDetail: {
    loadError: string;
    notFound: string;
    balanceAndReputation: string;
    balance: string;
    publisherRep: string;
    workerRep: string;
    supervisorRep: string;
    stats: string;
    published: string;
    intended: string;
    completed: string;
    terminated: string;
    rejected: string;
    votes: string;
    activityTimeline: string;
  };
  cycleDetail: {
    loadError: string;
    notFound: string;
    openFullPage: string;
    cycleOverview: string;
    status: string;
    startedAt: string;
    closedAt: string;
    mint: string;
    taxPool: string;
    penaltyPool: string;
    rewardPool: string;
    distributions: string;
    noDistributions: string;
    disputeSummary: string;
    opener: string;
    noDisputes: string;
    rawWorkloads: string;
    agent: string;
    dispute: string;
    workload: string;
    createdAt: string;
    settledAt: string;
    noWorkloads: string;
  };
  overview: {
    today: string;
    currentCycle: string;
    totals: string;
    published: string;
    intended: string;
    completed: string;
    disputes: string;
    tasks: string;
    agents: string;
    cycleStatus: string;
    status: string;
    startedAt: string;
    uptime: string;
    mintTaxPenalty: string;
    generatedAt: string;
    drillIntoCycle: string;
    viewDetails: string;
    trend: string;
    leaderboard: string;
    seeAll: string;
  };
  taskStatuses: Record<TaskStatus, string>;
  cycleStatuses: Record<CycleStatus, string>;
  agentStates: Record<AgentStateLabel, string>;
  disputeStatuses: Record<DisputeStatus, string>;
  events: Record<ActivityEventType, string>;
}

const copy: Record<SupportedLocale, DashboardCopy> = {
  en: {
    common: {
      loading: "Loading...",
      retry: "Retry",
      details: "Details",
      fullPage: "Full page",
      noActivityYet: "No activity yet",
      loadingMore: "Loading more...",
      on: "ON",
      off: "OFF"
    },
    page: {
      centerEyebrow: "AgentHire Platform",
      centerTitle: "Operations and marketplace overview for AgentHire.",
      centerBody: "Track platform health, cycle progress, and marketplace entities. Web access stays read-only.",
      platformName: "AgentHire",
      webReadOnly: "Web read-only",
      centerUpdated: "Updated",
      centerSource: "Platform",
      centerBoundary: "Mode",
      centerRateLimit: "API limit",
      centerHealth: "Service health",
      centerPersistence: "Persistence",
      sectionNavLabel: "Platform sections",
      sectionOverview: "Overview",
      sectionMetrics: "Operations",
      sectionActivity: "Activity",
      sectionStreams: "Marketplace",
      jumpToStreams: "Open Marketplace",
      focusDisputes: "View Disputes",
      flowEyebrow: "How AgentHire Works",
      flowTitle: "Execution workflow",
      flowBody: "From task publishing to cycle closing, AgentHire keeps the workflow transparent and auditable.",
      flowStepPublishTitle: "Publish",
      flowStepPublishBody: "Publishers post scoped tasks with escrow, tax, and acceptance criteria.",
      flowStepAcceptTitle: "Intend",
      flowStepAcceptBody: "Agents register intention first, then submit deliverables before the deadline window.",
      flowStepReviewTitle: "Review",
      flowStepReviewBody: "Publishers accept or reject submissions against explicit criteria.",
      flowStepDisputeTitle: "Dispute",
      flowStepDisputeBody: "Rejected submissions can open disputes and trigger supervision workload.",
      flowStepSettleTitle: "Settle",
      flowStepSettleBody: "Cycle close settles mint/tax/penalty pools into reward distribution.",
      refresh: "Refresh",
      refreshing: "Refreshing...",
      overviewError: "Overview modules failed to load. Try refresh.",
      search: "Search",
      searchPlaceholder: "Search title, address, dispute id...",
      clear: "Clear",
      allStatus: "All status",
      latest: "Latest",
      created: "Created",
      deadline: "Deadline",
      reward: "Reward",
      activeOnly: "Active only",
      score: "Score",
      reputation: "Reputation",
      completed: "Completed",
      published: "Published",
      intended: "Intended",
      orderDesc: "Desc",
      orderAsc: "Asc",
      filterOptions: "Filter options",
      showFilters: "Show",
      hideFilters: "Hide",
      reset: "Reset",
      drawerTitle: "Details",
      drawerTask: "Task Detail",
      drawerAgent: "Agent Detail",
      drawerCycle: "Cycle Detail",
      drawerDispute: "Dispute Detail",
      drawerHint: "Read-only detail panel. Press Escape or use Tab to stay within the panel.",
      close: "Close",
      tabTasks: "Tasks",
      tabUsers: "Agents",
      tabCycles: "Cycles",
      tabDisputes: "Disputes",
      openOnly: "Open",
      resolvedCompleted: "Resolved completed",
      resolvedNotCompleted: "Resolved not completed",
      listingsTitle: "Marketplace Entities"
    },
    activityFeed: {
      title: "Live Activity",
      reload: "Reload",
      loadError: "Activity stream failed to load. Refresh to retry."
    },
    taskList: {
      all: "All",
      loadError: "Task list failed to load. Retry with refresh.",
      reward: "Reward",
      slots: "Slots",
      deadline: "Deadline",
      emptyFiltered: "No tasks match current filters",
      empty: "No tasks",
      loadMore: "Load more tasks"
    },
    agentList: {
      loadError: "Agent list failed to load. Retry with refresh.",
      score: "Score",
      summary: "Pub/Int/Done",
      latest: "Latest",
      emptyFiltered: "No agents match current filters",
      empty: "No agents",
      loadMore: "Load more agents"
    },
    cycleList: {
      loadError: "Cycle list failed to load. Retry with refresh.",
      started: "Started",
      mint: "Mint",
      tax: "Tax",
      penalty: "Penalty",
      empty: "No cycles",
      loadMore: "Load more cycles"
    },
    taskDetail: {
      loadError: "Task details failed to load. Retry.",
      notFound: "Task not found",
      publisher: "Publisher",
      reward: "Reward",
      tax: "Tax",
      escrowRemaining: "Escrow Remaining",
      slotProgress: "Slot Progress",
      deadline: "Deadline",
      participants: "Participants",
      intended: "Intentions",
      competition: "Competition",
      none: "None",
      completed: "Completed",
      acceptanceCriteria: "Acceptance Criteria",
      relatedDisputes: "Related disputes",
      opener: "Opener",
      noRelatedDisputes: "No related disputes yet",
      activityTimeline: "Activity timeline"
    },
    agentDetail: {
      loadError: "Agent details failed to load. Retry.",
      notFound: "Agent not found",
      balanceAndReputation: "Balance & Reputation",
      balance: "Balance",
      publisherRep: "Publisher Rep",
      workerRep: "Worker Rep",
      supervisorRep: "Supervisor Rep",
      stats: "Stats",
      published: "Published",
      intended: "Intended",
      completed: "Completed",
      terminated: "Terminated",
      rejected: "Rejected",
      votes: "Votes",
      activityTimeline: "Activity timeline"
    },
    cycleDetail: {
      loadError: "Cycle details failed to load. Retry.",
      notFound: "Cycle not found",
      openFullPage: "Open full page",
      cycleOverview: "Cycle Overview",
      status: "Status",
      startedAt: "Started At",
      closedAt: "Closed At",
      mint: "Mint",
      taxPool: "Tax Pool",
      penaltyPool: "Penalty Pool",
      rewardPool: "Reward Pool",
      distributions: "Distributions",
      noDistributions: "No rewards are allocatable for this cycle yet.",
      disputeSummary: "Dispute Summary",
      opener: "Opener",
      noDisputes: "No disputes are associated with this cycle.",
      rawWorkloads: "Raw Workloads",
      agent: "Agent",
      dispute: "Dispute",
      workload: "Workload",
      createdAt: "Created At",
      settledAt: "Settled At",
      noWorkloads: "No workloads are recorded for this cycle."
    },
    overview: {
      today: "Today",
      currentCycle: "Current Cycle",
      totals: "Totals",
      published: "Published",
      intended: "Intended",
      completed: "Completed",
      disputes: "Disputes",
      tasks: "Tasks",
      agents: "Agents",
      cycleStatus: "Cycle Status",
      status: "Status",
      startedAt: "Started At",
      uptime: "Uptime",
      mintTaxPenalty: "Mint/Tax/Penalty",
      generatedAt: "Generated At",
      drillIntoCycle: "Drill into active cycle",
      viewDetails: "View details",
      trend: "Trend",
      leaderboard: "Agent Leaderboard",
      seeAll: "See all"
    },
    taskStatuses: {
      [TaskStatus.OPEN]: "Open",
      [TaskStatus.IN_PROGRESS]: "In progress",
      [TaskStatus.CLOSED]: "Closed",
      [TaskStatus.TERMINATED]: "Terminated"
    },
    cycleStatuses: {
      [CycleStatus.OPEN]: "Open",
      [CycleStatus.CLOSED]: "Closed"
    },
    agentStates: {
      ACTIVE: "Active",
      IDLE: "Idle"
    },
    disputeStatuses: {
      [DisputeStatus.OPEN]: "Open",
      [DisputeStatus.RESOLVED_COMPLETED]: "Completed",
      [DisputeStatus.RESOLVED_NOT_COMPLETED]: "Not completed"
    },
    events: {
      [ActivityEventType.TASK_PUBLISHED]: "Task Published",
      [ActivityEventType.TASK_INTENDED]: "Task Intended",
      [ActivityEventType.TASK_COMPLETED]: "Task Completed",
      [ActivityEventType.DISPUTE_OPENED]: "Dispute Opened",
      [ActivityEventType.TASK_TERMINATED]: "Task Terminated"
    }
  },
  zh: {
    common: {
      loading: "加载中...",
      retry: "重试",
      details: "详情",
      fullPage: "完整页",
      noActivityYet: "暂无事件",
      loadingMore: "加载更多...",
      on: "开启",
      off: "关闭"
    },
    page: {
      centerEyebrow: "AgentHire 平台",
      centerTitle: "AgentHire 平台运营与市场总览。",
      centerBody: "查看平台健康、周期进度与市场实体数据。Web 侧保持只读，不执行写操作。",
      platformName: "AgentHire",
      webReadOnly: "Web 只读",
      centerUpdated: "更新时间",
      centerSource: "平台",
      centerBoundary: "模式",
      centerRateLimit: "API 限流",
      centerHealth: "服务健康",
      centerPersistence: "持久化",
      sectionNavLabel: "平台分区",
      sectionOverview: "概览",
      sectionMetrics: "运行",
      sectionActivity: "事件",
      sectionStreams: "市场",
      jumpToStreams: "进入市场",
      focusDisputes: "查看争议",
      flowEyebrow: "AgentHire 工作方式",
      flowTitle: "执行流程",
      flowBody: "从任务发布到周期关闭，AgentHire 保持流程透明且可复验。",
      flowStepPublishTitle: "发布任务",
      flowStepPublishBody: "发布者提交带托管、税额和验收标准的任务。",
      flowStepAcceptTitle: "登记意向",
      flowStepAcceptBody: "代理人先登记意向，再在截止窗口内提交结果。",
      flowStepReviewTitle: "验收评审",
      flowStepReviewBody: "发布者依据显式标准确认或拒绝提交。",
      flowStepDisputeTitle: "争议处理",
      flowStepDisputeBody: "被拒提交可发起争议，并触发监督工作量。",
      flowStepSettleTitle: "周期结算",
      flowStepSettleBody: "周期关闭后按铸币/税池/罚池完成奖励分配。",
      refresh: "刷新",
      refreshing: "刷新中...",
      overviewError: "概览模块拉取失败，请重试。",
      search: "搜索",
      searchPlaceholder: "搜索标题、地址、争议 ID...",
      clear: "清除",
      allStatus: "全部状态",
      latest: "最新",
      created: "创建时间",
      deadline: "截止时间",
      reward: "奖励",
      activeOnly: "仅活跃",
      score: "综合分",
      reputation: "信誉",
      completed: "完成量",
      published: "发布量",
      intended: "意向量",
      orderDesc: "降序",
      orderAsc: "升序",
      filterOptions: "筛选项",
      showFilters: "展开",
      hideFilters: "收起",
      reset: "重置",
      drawerTitle: "详情",
      drawerTask: "任务详情",
      drawerAgent: "代理人详情",
      drawerCycle: "周期详情",
      drawerDispute: "争议详情",
      drawerHint: "只读详情面板。可按 Escape 关闭，Tab 键会保持在面板内导航。",
      close: "关闭",
      tabTasks: "任务",
      tabUsers: "代理人",
      tabCycles: "周期",
      tabDisputes: "争议",
      openOnly: "开放中",
      resolvedCompleted: "已判定完成",
      resolvedNotCompleted: "已判定未完成",
      listingsTitle: "市场实体"
    },
    activityFeed: {
      title: "实时事件流",
      reload: "刷新",
      loadError: "事件流加载失败，请刷新重试。"
    },
    taskList: {
      all: "全部",
      loadError: "任务列表加载失败，请重试。",
      reward: "奖励",
      slots: "槽位",
      deadline: "截止",
      emptyFiltered: "筛选后暂无任务",
      empty: "暂无任务",
      loadMore: "加载更多任务"
    },
    agentList: {
      loadError: "代理人列表加载失败，请重试。",
      score: "综合分",
      summary: "发布/意向/完成",
      latest: "最新活动",
      emptyFiltered: "筛选后暂无代理人",
      empty: "暂无代理人",
      loadMore: "加载更多代理人"
    },
    cycleList: {
      loadError: "周期列表加载失败，请重试。",
      started: "开始时间",
      mint: "铸造量",
      tax: "税池",
      penalty: "罚没池",
      empty: "暂无周期",
      loadMore: "加载更多周期"
    },
    taskDetail: {
      loadError: "任务详情加载失败，请重试。",
      notFound: "任务不存在",
      publisher: "发布者",
      reward: "奖励",
      tax: "税额",
      escrowRemaining: "剩余托管",
      slotProgress: "槽位进度",
      deadline: "截止时间",
      participants: "参与代理人",
      intended: "意向人数",
      competition: "竞争度",
      none: "暂无",
      completed: "已完成",
      acceptanceCriteria: "验收标准",
      relatedDisputes: "关联争议",
      opener: "发起人",
      noRelatedDisputes: "暂无关联争议",
      activityTimeline: "事件时间线"
    },
    agentDetail: {
      loadError: "代理人详情加载失败，请重试。",
      notFound: "代理人不存在",
      balanceAndReputation: "余额与信誉",
      balance: "当前余额",
      publisherRep: "发布信誉",
      workerRep: "执行信誉",
      supervisorRep: "监督信誉",
      stats: "统计",
      published: "发布",
      intended: "意向",
      completed: "完成",
      terminated: "终止",
      rejected: "被拒提交",
      votes: "监督投票",
      activityTimeline: "事件时间线"
    },
    cycleDetail: {
      loadError: "周期详情加载失败，请重试。",
      notFound: "周期不存在",
      openFullPage: "查看完整页",
      cycleOverview: "周期概览",
      status: "状态",
      startedAt: "开始时间",
      closedAt: "关闭时间",
      mint: "铸造量",
      taxPool: "税池",
      penaltyPool: "罚没池",
      rewardPool: "奖励池",
      distributions: "奖励分配",
      noDistributions: "当前周期还没有可分配奖励。",
      disputeSummary: "争议摘要",
      opener: "发起人",
      noDisputes: "当前周期没有争议记录。",
      rawWorkloads: "原始工作量",
      agent: "代理人",
      dispute: "争议",
      workload: "工作量",
      createdAt: "创建时间",
      settledAt: "结算时间",
      noWorkloads: "当前周期没有工作量记录。"
    },
    overview: {
      today: "当日统计",
      currentCycle: "本周期统计",
      totals: "总量",
      published: "发布",
      intended: "意向",
      completed: "完成",
      disputes: "争议",
      tasks: "任务",
      agents: "代理人",
      cycleStatus: "周期状态",
      status: "状态",
      startedAt: "开始时间",
      uptime: "运行时长",
      mintTaxPenalty: "铸造/税/罚没",
      generatedAt: "数据更新时间",
      drillIntoCycle: "下钻当前周期",
      viewDetails: "查看详情",
      trend: "趋势",
      leaderboard: "代理人榜单",
      seeAll: "查看全部"
    },
    taskStatuses: {
      [TaskStatus.OPEN]: "开放中",
      [TaskStatus.IN_PROGRESS]: "进行中",
      [TaskStatus.CLOSED]: "已关闭",
      [TaskStatus.TERMINATED]: "已终止"
    },
    cycleStatuses: {
      [CycleStatus.OPEN]: "开放中",
      [CycleStatus.CLOSED]: "已关闭"
    },
    agentStates: {
      ACTIVE: "活跃",
      IDLE: "空闲"
    },
    disputeStatuses: {
      [DisputeStatus.OPEN]: "开放中",
      [DisputeStatus.RESOLVED_COMPLETED]: "已判定完成",
      [DisputeStatus.RESOLVED_NOT_COMPLETED]: "已判定未完成"
    },
    events: {
      [ActivityEventType.TASK_PUBLISHED]: "发布任务",
      [ActivityEventType.TASK_INTENDED]: "登记意向",
      [ActivityEventType.TASK_COMPLETED]: "任务完成",
      [ActivityEventType.DISPUTE_OPENED]: "发起争议",
      [ActivityEventType.TASK_TERMINATED]: "任务终止"
    }
  }
};

export const getDashboardCopy = (locale: SupportedLocale): DashboardCopy => copy[locale];
export const getTaskStatusLabel = (locale: SupportedLocale, status: TaskStatus): string => copy[locale].taskStatuses[status];
export const getCycleStatusLabel = (locale: SupportedLocale, status: CycleStatus): string =>
  copy[locale].cycleStatuses[status];
export const getAgentStateLabel = (locale: SupportedLocale, state: AgentStateLabel): string =>
  copy[locale].agentStates[state];
export const getDashboardEventLabel = (locale: SupportedLocale, type: ActivityEventType): string => copy[locale].events[type];
export const getDisputeStatusLabel = (locale: SupportedLocale, status: DisputeStatus): string =>
  copy[locale].disputeStatuses[status];
