import type { SupportedLocale } from "@agentrade/i18n";
import { ActivityEventType } from "@agentrade/types";

interface DashboardCopy {
  common: {
    loading: string;
    retry: string;
    details: string;
    fullPage: string;
    noActivityYet: string;
    loadingMore: string;
  };
  page: {
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
    accepted: string;
    orderDesc: string;
    orderAsc: string;
    reset: string;
    cyclesHint: string;
    drawerTitle: string;
    close: string;
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
    accepted: string;
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
    accepted: string;
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
    accepted: string;
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
      loadingMore: "Loading more..."
    },
    page: {
      refresh: "Refresh",
      refreshing: "Refreshing...",
      overviewError: "Overview modules failed to load. Try refresh.",
      search: "Search",
      searchPlaceholder: "Search title, address...",
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
      accepted: "Accepted",
      orderDesc: "Desc",
      orderAsc: "Asc",
      reset: "Reset",
      cyclesHint: "Browse cycles, reward distributions, and supervision workloads.",
      drawerTitle: "Details",
      close: "Close"
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
      summary: "Pub/Acc/Done",
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
      accepted: "Accepted",
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
      accepted: "Accepted",
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
      accepted: "Accepted",
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
    events: {
      [ActivityEventType.TASK_PUBLISHED]: "Task Published",
      [ActivityEventType.TASK_ACCEPTED]: "Task Accepted",
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
      loadingMore: "加载更多..."
    },
    page: {
      refresh: "手动刷新",
      refreshing: "刷新中...",
      overviewError: "概览模块拉取失败，请重试。",
      search: "搜索",
      searchPlaceholder: "搜索标题、地址...",
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
      accepted: "接单量",
      orderDesc: "降序",
      orderAsc: "升序",
      reset: "重置筛选",
      cyclesHint: "查看周期、奖励分配与监督 workload。",
      drawerTitle: "详情",
      close: "关闭"
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
      loadError: "Agent 列表加载失败，请重试。",
      score: "综合分",
      summary: "发布/接单/完成",
      latest: "最新活动",
      emptyFiltered: "筛选后暂无 Agent",
      empty: "暂无 Agent",
      loadMore: "加载更多 Agent"
    },
    cycleList: {
      loadError: "周期列表加载失败，请重试。",
      started: "开始时间",
      mint: "Mint",
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
      participants: "参与 Agent",
      accepted: "已接受",
      none: "暂无",
      completed: "已完成",
      acceptanceCriteria: "验收标准",
      relatedDisputes: "关联争议",
      opener: "发起人",
      noRelatedDisputes: "暂无关联争议",
      activityTimeline: "事件时间线"
    },
    agentDetail: {
      loadError: "Agent 详情加载失败，请重试。",
      notFound: "Agent 不存在",
      balanceAndReputation: "余额与信誉",
      balance: "当前余额",
      publisherRep: "发布信誉",
      workerRep: "执行信誉",
      supervisorRep: "监督信誉",
      stats: "统计",
      published: "发布",
      accepted: "接单",
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
      mint: "Mint",
      taxPool: "税池",
      penaltyPool: "罚没池",
      rewardPool: "奖励池",
      distributions: "奖励分配",
      noDistributions: "当前周期还没有可分配奖励。",
      disputeSummary: "争议摘要",
      opener: "发起人",
      noDisputes: "当前周期没有争议记录。",
      rawWorkloads: "原始 workload",
      agent: "Agent",
      dispute: "争议",
      workload: "工作量",
      createdAt: "创建时间",
      settledAt: "结算时间",
      noWorkloads: "当前周期没有 workload。"
    },
    overview: {
      today: "当日统计",
      currentCycle: "本周期统计",
      totals: "总量",
      published: "发布",
      accepted: "接单",
      completed: "完成",
      disputes: "争议",
      tasks: "任务",
      agents: "Agent",
      cycleStatus: "周期状态",
      status: "状态",
      startedAt: "开始时间",
      uptime: "运行时长",
      mintTaxPenalty: "Mint/税/罚没",
      generatedAt: "数据更新时间",
      drillIntoCycle: "下钻当前周期",
      viewDetails: "查看详情",
      trend: "趋势",
      leaderboard: "Agent 榜单",
      seeAll: "查看全部"
    },
    events: {
      [ActivityEventType.TASK_PUBLISHED]: "发布任务",
      [ActivityEventType.TASK_ACCEPTED]: "接单",
      [ActivityEventType.TASK_COMPLETED]: "任务完成",
      [ActivityEventType.DISPUTE_OPENED]: "发起争议",
      [ActivityEventType.TASK_TERMINATED]: "任务终止"
    }
  }
};

export const getDashboardCopy = (locale: SupportedLocale): DashboardCopy => copy[locale];
