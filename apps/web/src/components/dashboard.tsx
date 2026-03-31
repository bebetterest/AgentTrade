"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { messages, resolveLocale, type SupportedLocale } from "@agentrade/i18n";
import type {
  ActivityEvent,
  Cycle,
  AgentDirectoryItem,
  AgentProfile,
  DashboardSummaryResponse,
  DashboardTrendsResponse,
  Dispute,
  PaginatedResponse,
  Task
} from "@agentrade/types";
import { ActivityEventType, TaskStatus } from "@agentrade/types";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LocaleSwitcher } from "./locale-switcher";
import {
  fetchActivities,
  fetchActiveCycle,
  fetchAgent,
  fetchAgents,
  fetchDashboardSummary,
  fetchDashboardTrends,
  fetchDisputes,
  fetchTask,
  fetchTasks
} from "../lib/api";
import { renderSafeMarkdown } from "../lib/markdown";

interface DashboardProps {
  initialSummary: DashboardSummaryResponse | null;
  initialTrends: DashboardTrendsResponse | null;
  initialTasks: PaginatedResponse<Task>;
  initialAgents: PaginatedResponse<AgentDirectoryItem>;
  initialActiveCycle: Cycle | null;
  initialActivities: PaginatedResponse<ActivityEvent>;
}

const DEFAULT_TIMEZONE = "UTC";
const REFRESH_FEED_LIMIT = 12;

const EVENT_LABELS: Record<ActivityEventType, { zh: string; en: string }> = {
  TASK_PUBLISHED: { zh: "发布任务", en: "Task Published" },
  TASK_ACCEPTED: { zh: "接单", en: "Task Accepted" },
  TASK_COMPLETED: { zh: "任务完成", en: "Task Completed" },
  DISPUTE_OPENED: { zh: "发起争议", en: "Dispute Opened" },
  TASK_TERMINATED: { zh: "任务终止", en: "Task Terminated" }
};

const shortAddress = (value: string): string =>
  value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;

const formatDateTime = (value: string, locale: SupportedLocale, timeZone?: string): string =>
  new Date(value).toLocaleString(locale === "zh" ? "zh-CN" : "en-US", {
    timeZone
  });

const formatDuration = (ms: number, locale: SupportedLocale): string => {
  if (!Number.isFinite(ms) || ms <= 0) {
    return locale === "zh" ? "刚刚开始" : "Just started";
  }
  const day = Math.floor(ms / (24 * 60 * 60 * 1000));
  const hour = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minute = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  if (locale === "zh") {
    if (day > 0) {
      return `${day}天 ${hour}小时`;
    }
    if (hour > 0) {
      return `${hour}小时 ${minute}分钟`;
    }
    return `${Math.max(minute, 1)}分钟`;
  }
  if (day > 0) {
    return `${day}d ${hour}h`;
  }
  if (hour > 0) {
    return `${hour}h ${minute}m`;
  }
  return `${Math.max(minute, 1)}m`;
};

const toNumberList = (items: number[]): string =>
  items
    .map((value, index) => `${index === 0 ? "M" : "L"} ${index * 32},${80 - value}`)
    .join(" ");

const valueToPoints = (values: number[]): number[] => {
  if (values.length === 0) {
    return [];
  }
  const max = Math.max(...values, 1);
  return values.map((item) => Math.round((item / max) * 70));
};

const Sparkline = ({ title, values }: { title: string; values: number[] }) => {
  const points = valueToPoints(values);
  const path = toNumberList(points);
  const latest = values.length > 0 ? values[values.length - 1] : 0;
  return (
    <div className="spark-card">
      <p className="spark-title">{title}</p>
      <p className="spark-value">{latest}</p>
      <svg viewBox="0 0 220 90" className="spark-svg" aria-hidden="true">
        <path d={path} />
      </svg>
    </div>
  );
};

export const Dashboard = ({
  initialSummary,
  initialTrends,
  initialTasks,
  initialAgents,
  initialActiveCycle,
  initialActivities
}: DashboardProps) => {
  const [locale, setLocale] = useState<SupportedLocale>("en");
  const t = messages[locale];
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [timeZone, setTimeZone] = useState(DEFAULT_TIMEZONE);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [summary, setSummary] = useState<DashboardSummaryResponse | null>(initialSummary);
  const [trends, setTrends] = useState<DashboardTrendsResponse | null>(initialTrends);
  const [leaders, setLeaders] = useState<AgentDirectoryItem[]>(initialAgents.items.slice(0, 5));
  const [activeCycle, setActiveCycle] = useState<Cycle | null>(initialActiveCycle);
  const [activityFeed, setActivityFeed] = useState<ActivityEvent[]>(initialActivities.items.slice(0, REFRESH_FEED_LIMIT));

  const [tasksData, setTasksData] = useState<PaginatedResponse<Task>>(initialTasks);
  const [agentsData, setAgentsData] = useState<PaginatedResponse<AgentDirectoryItem>>(initialAgents);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [loadingMoreTasks, setLoadingMoreTasks] = useState(false);
  const [loadingMoreAgents, setLoadingMoreAgents] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [overviewError, setOverviewError] = useState(false);
  const [taskLoadError, setTaskLoadError] = useState(false);
  const [agentLoadError, setAgentLoadError] = useState(false);
  const [feedLoadError, setFeedLoadError] = useState(false);

  const [taskDetail, setTaskDetail] = useState<{
    loading: boolean;
    task: Task | null;
    disputes: Dispute[];
    activities: ActivityEvent[];
  }>({
    loading: false,
    task: null,
    disputes: [],
    activities: []
  });
  const [agentDetail, setAgentDetail] = useState<{
    loading: boolean;
    profile: AgentProfile | null;
    activities: ActivityEvent[];
  }>({
    loading: false,
    profile: null,
    activities: []
  });

  const taskSentinelRef = useRef<HTMLDivElement | null>(null);
  const agentSentinelRef = useRef<HTMLDivElement | null>(null);

  const tab = searchParams.get("tab") === "users" ? "users" : "tasks";
  const q = searchParams.get("q") ?? "";
  const taskStatus = searchParams.get("taskStatus") as TaskStatus | null;
  const taskSort = (searchParams.get("taskSort") as "latest" | "created" | "deadline" | "reward" | null) ?? "latest";
  const taskOrder = (searchParams.get("taskOrder") as "asc" | "desc" | null) ?? "desc";
  const agentSort = (searchParams.get("agentSort") as
    | "latest"
    | "score"
    | "reputation"
    | "completed"
    | "published"
    | "accepted"
    | null) ?? "latest";
  const agentOrder = (searchParams.get("agentOrder") as "asc" | "desc" | null) ?? "desc";
  const activeOnly = searchParams.get("activeOnly") !== "false";
  const trendWindow = searchParams.get("trendWindow") === "30d" ? "30d" : "7d";
  const taskDetailId = searchParams.get("taskDetail");
  const agentDetailAddress = searchParams.get("agentDetail");

  const taskQueryKey = `${q}|${taskStatus ?? ""}|${taskSort}|${taskOrder}`;
  const agentQueryKey = `${q}|${activeOnly}|${agentSort}|${agentOrder}`;

  const updateQuery = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value.trim().length === 0) {
        next.delete(key);
      } else {
        next.set(key, value);
      }
    }
    const query = next.toString();
    router.replace(query.length > 0 ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const openTaskDetail = (taskId: string) => {
    updateQuery({ taskDetail: taskId, agentDetail: null });
  };
  const openAgentDetail = (address: string) => {
    updateQuery({ agentDetail: address, taskDetail: null });
  };
  const closeDetail = () => {
    updateQuery({ taskDetail: null, agentDetail: null });
  };

  const loadMoreTasks = useCallback(async () => {
    if (!tasksData.nextCursor || loadingMoreTasks) {
      return;
    }
    setLoadingMoreTasks(true);
    try {
      const response = await fetchTasks({
        q: q || undefined,
        status: taskStatus ?? undefined,
        sort: taskSort,
        order: taskOrder,
        cursor: tasksData.nextCursor ?? undefined,
        limit: 20,
        strict: true
      });
      setTaskLoadError(false);
      setTasksData((prev) => ({
        items: [...prev.items, ...response.items],
        nextCursor: response.nextCursor
      }));
    } catch {
      setTaskLoadError(true);
    } finally {
      setLoadingMoreTasks(false);
    }
  }, [loadingMoreTasks, q, taskOrder, taskSort, taskStatus, tasksData.nextCursor]);

  const loadMoreAgents = useCallback(async () => {
    if (!agentsData.nextCursor || loadingMoreAgents) {
      return;
    }
    setLoadingMoreAgents(true);
    try {
      const response = await fetchAgents({
        q: q || undefined,
        activeOnly,
        sort: agentSort,
        order: agentOrder,
        cursor: agentsData.nextCursor ?? undefined,
        limit: 20,
        strict: true
      });
      setAgentLoadError(false);
      setAgentsData((prev) => ({
        items: [...prev.items, ...response.items],
        nextCursor: response.nextCursor
      }));
    } catch {
      setAgentLoadError(true);
    } finally {
      setLoadingMoreAgents(false);
    }
  }, [activeOnly, agentOrder, agentSort, agentsData.nextCursor, loadingMoreAgents, q]);

  const refreshAll = async () => {
    setRefreshing(true);
    const [summaryRes, trendsRes, leadersRes, tasksRes, agentsRes, cycleRes, feedRes] = await Promise.allSettled([
      fetchDashboardSummary(timeZone, { strict: true }),
      fetchDashboardTrends(timeZone, trendWindow, { strict: true }),
      fetchAgents({ activeOnly: true, sort: "score", order: "desc", limit: 5, strict: true }),
      fetchTasks({
        q: q || undefined,
        status: taskStatus ?? undefined,
        sort: taskSort,
        order: taskOrder,
        limit: 20,
        strict: true
      }),
      fetchAgents({
        q: q || undefined,
        activeOnly,
        sort: agentSort,
        order: agentOrder,
        limit: 20,
        strict: true
      }),
      fetchActiveCycle({ strict: true }),
      fetchActivities({ limit: REFRESH_FEED_LIMIT, order: "desc", strict: true })
    ]);

    if (summaryRes.status === "fulfilled" && trendsRes.status === "fulfilled" && leadersRes.status === "fulfilled" && cycleRes.status === "fulfilled") {
      setOverviewError(false);
      setSummary(summaryRes.value);
      setTrends(trendsRes.value);
      setLeaders(leadersRes.value.items);
      setActiveCycle(cycleRes.value);
    } else {
      setOverviewError(true);
    }

    if (tasksRes.status === "fulfilled") {
      setTaskLoadError(false);
      setTasksData(tasksRes.value);
    } else {
      setTaskLoadError(true);
    }

    if (agentsRes.status === "fulfilled") {
      setAgentLoadError(false);
      setAgentsData(agentsRes.value);
    } else {
      setAgentLoadError(true);
    }

    if (feedRes.status === "fulfilled") {
      setFeedLoadError(false);
      setActivityFeed(feedRes.value.items);
    } else {
      setFeedLoadError(true);
    }
    setRefreshing(false);
  };

  useEffect(() => {
    const saved = localStorage.getItem("agentrade.locale") ?? undefined;
    const detected = resolveLocale(navigator.language, saved);
    setLocale(detected);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE;
    setTimeZone(tz);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 60_000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!timeZone) {
      return;
    }
    let cancelled = false;
    setLoadingFeed(true);
    (async () => {
      const [summaryRes, trendsRes, leadersRes, cycleRes, feedRes] = await Promise.allSettled([
        fetchDashboardSummary(timeZone, { strict: true }),
        fetchDashboardTrends(timeZone, trendWindow, { strict: true }),
        fetchAgents({ activeOnly: true, sort: "score", order: "desc", limit: 5, strict: true }),
        fetchActiveCycle({ strict: true }),
        fetchActivities({ limit: REFRESH_FEED_LIMIT, order: "desc", strict: true })
      ]);
      if (cancelled) {
        return;
      }
      if (summaryRes.status === "fulfilled" && trendsRes.status === "fulfilled" && leadersRes.status === "fulfilled" && cycleRes.status === "fulfilled") {
        setOverviewError(false);
        setSummary(summaryRes.value);
        setTrends(trendsRes.value);
        setLeaders(leadersRes.value.items);
        setActiveCycle(cycleRes.value);
      } else {
        setOverviewError(true);
      }
      if (feedRes.status === "fulfilled") {
        setFeedLoadError(false);
        setActivityFeed(feedRes.value.items);
      } else {
        setFeedLoadError(true);
      }
      setLoadingFeed(false);
    })();
    return () => {
      cancelled = true;
      setLoadingFeed(false);
    };
  }, [timeZone, trendWindow]);

  useEffect(() => {
    let cancelled = false;
    setLoadingTasks(true);
    setTaskLoadError(false);
    const controller = new AbortController();
    fetchTasks({
      q: q || undefined,
      status: taskStatus ?? undefined,
      sort: taskSort,
      order: taskOrder,
      limit: 20,
      signal: controller.signal,
      strict: true
    }).then((response) => {
      if (!cancelled) {
        setTasksData(response);
        setLoadingTasks(false);
      }
    }).catch(() => {
      if (!cancelled) {
        setTaskLoadError(true);
        setLoadingTasks(false);
      }
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [taskQueryKey]);

  useEffect(() => {
    let cancelled = false;
    setLoadingAgents(true);
    setAgentLoadError(false);
    const controller = new AbortController();
    fetchAgents({
      q: q || undefined,
      activeOnly,
      sort: agentSort,
      order: agentOrder,
      limit: 20,
      signal: controller.signal,
      strict: true
    }).then((response) => {
      if (!cancelled) {
        setAgentsData(response);
        setLoadingAgents(false);
      }
    }).catch(() => {
      if (!cancelled) {
        setAgentLoadError(true);
        setLoadingAgents(false);
      }
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [agentQueryKey]);

  useEffect(() => {
    if (tab !== "tasks" || !tasksData.nextCursor || loadingMoreTasks) {
      return;
    }
    const target = taskSentinelRef.current;
    if (!target) {
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      const first = entries[0];
      if (!first?.isIntersecting || !tasksData.nextCursor) {
        return;
      }
      void loadMoreTasks();
    });
    observer.observe(target);
    return () => {
      observer.disconnect();
    };
  }, [tab, tasksData.nextCursor, loadingMoreTasks, loadMoreTasks]);

  useEffect(() => {
    if (tab !== "users" || !agentsData.nextCursor || loadingMoreAgents) {
      return;
    }
    const target = agentSentinelRef.current;
    if (!target) {
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      const first = entries[0];
      if (!first?.isIntersecting || !agentsData.nextCursor) {
        return;
      }
      void loadMoreAgents();
    });
    observer.observe(target);
    return () => {
      observer.disconnect();
    };
  }, [tab, agentsData.nextCursor, loadingMoreAgents, loadMoreAgents]);

  useEffect(() => {
    if (!taskDetailId) {
      setTaskDetail({ loading: false, task: null, disputes: [], activities: [] });
      return;
    }
    let cancelled = false;
    setTaskDetail((prev) => ({ ...prev, loading: true }));
    Promise.all([
      fetchTask(taskDetailId),
      fetchDisputes({ taskId: taskDetailId, limit: 50 }),
      fetchActivities({ taskId: taskDetailId, limit: 50, order: "desc" })
    ]).then(([task, disputes, activities]) => {
      if (cancelled) {
        return;
      }
      setTaskDetail({
        loading: false,
        task,
        disputes: disputes.items,
        activities: activities.items
      });
    });
    return () => {
      cancelled = true;
    };
  }, [taskDetailId]);

  useEffect(() => {
    if (!agentDetailAddress) {
      setAgentDetail({ loading: false, profile: null, activities: [] });
      return;
    }
    let cancelled = false;
    setAgentDetail((prev) => ({ ...prev, loading: true }));
    Promise.all([
      fetchAgent(agentDetailAddress),
      fetchActivities({ address: agentDetailAddress, limit: 50, order: "desc" })
    ]).then(([profile, activities]) => {
      if (cancelled) {
        return;
      }
      setAgentDetail({
        loading: false,
        profile,
        activities: activities.items
      });
    });
    return () => {
      cancelled = true;
    };
  }, [agentDetailAddress]);

  const trendPublished = useMemo(
    () => trends?.points.map((item) => item.tasksPublished) ?? [],
    [trends]
  );
  const trendAccepted = useMemo(
    () => trends?.points.map((item) => item.tasksAccepted) ?? [],
    [trends]
  );
  const trendCompleted = useMemo(
    () => trends?.points.map((item) => item.tasksCompleted) ?? [],
    [trends]
  );
  const trendDisputes = useMemo(
    () => trends?.points.map((item) => item.disputesOpened) ?? [],
    [trends]
  );
  const cycleUptime = useMemo(() => {
    if (!activeCycle) {
      return "-";
    }
    const startedAtMs = new Date(activeCycle.startedAt).getTime();
    return formatDuration(nowMs - startedAtMs, locale);
  }, [activeCycle, nowMs, locale]);
  const taskStatusCounts = useMemo(() => {
    return tasksData.items.reduce<Record<string, number>>((acc, item) => {
      acc[item.status] = (acc[item.status] ?? 0) + 1;
      return acc;
    }, {});
  }, [tasksData.items]);
  const hasTaskFilters = q.trim().length > 0 || Boolean(taskStatus);
  const hasAgentFilters = q.trim().length > 0 || !activeOnly;
  const resetFilters = () => {
    if (tab === "tasks") {
      updateQuery({
        q: null,
        taskStatus: null,
        taskSort: "latest",
        taskOrder: "desc"
      });
      return;
    }
    updateQuery({
      q: null,
      activeOnly: "true",
      agentSort: "latest",
      agentOrder: "desc"
    });
  };
  const openByActivity = (item: ActivityEvent) => {
    if (item.taskId) {
      openTaskDetail(item.taskId);
      return;
    }
    openAgentDetail(item.actor);
  };

  return (
    <main className="page" data-testid="dashboard-page">
      <section className="top">
        <div>
          <h1 className="title">{t.appTitle}</h1>
          <p className="sub">{t.readOnlyNotice}</p>
        </div>
        <LocaleSwitcher onChange={setLocale} />
      </section>

      <section className="toolbar">
        <span className="badge">{timeZone}</span>
        <button className="action-btn" data-testid="refresh-button" onClick={refreshAll} disabled={refreshing}>
          {refreshing ? (locale === "zh" ? "刷新中..." : "Refreshing...") : locale === "zh" ? "手动刷新" : "Refresh"}
        </button>
      </section>
      {overviewError ? (
        <section className="card alert-card" data-testid="overview-error">
          <p>{locale === "zh" ? "概览模块拉取失败，请重试。" : "Overview modules failed to load. Try refresh."}</p>
          <button className="action-btn" onClick={refreshAll}>
            {locale === "zh" ? "重试" : "Retry"}
          </button>
        </section>
      ) : null}

      <section className="summary-grid">
        <div className="card metric-card">
          <h2>{locale === "zh" ? "当日统计" : "Today"}</h2>
          <div className="metric-line"><span>{locale === "zh" ? "发布" : "Published"}</span><strong>{summary?.today.tasksPublished ?? 0}</strong></div>
          <div className="metric-line"><span>{locale === "zh" ? "接单" : "Accepted"}</span><strong>{summary?.today.tasksAccepted ?? 0}</strong></div>
          <div className="metric-line"><span>{locale === "zh" ? "完成" : "Completed"}</span><strong>{summary?.today.tasksCompleted ?? 0}</strong></div>
          <div className="metric-line"><span>{locale === "zh" ? "争议" : "Disputes"}</span><strong>{summary?.today.disputesOpened ?? 0}</strong></div>
        </div>
        <div className="card metric-card">
          <h2>{locale === "zh" ? "本周期统计" : "Current Cycle"}</h2>
          <div className="metric-line"><span>{locale === "zh" ? "发布" : "Published"}</span><strong>{summary?.currentCycle.tasksPublished ?? 0}</strong></div>
          <div className="metric-line"><span>{locale === "zh" ? "接单" : "Accepted"}</span><strong>{summary?.currentCycle.tasksAccepted ?? 0}</strong></div>
          <div className="metric-line"><span>{locale === "zh" ? "完成" : "Completed"}</span><strong>{summary?.currentCycle.tasksCompleted ?? 0}</strong></div>
          <div className="metric-line"><span>{locale === "zh" ? "争议" : "Disputes"}</span><strong>{summary?.currentCycle.disputesOpened ?? 0}</strong></div>
        </div>
        <div className="card metric-card">
          <h2>{locale === "zh" ? "总量" : "Totals"}</h2>
          <div className="metric-line"><span>{locale === "zh" ? "任务" : "Tasks"}</span><strong>{summary?.totals.tasks ?? 0}</strong></div>
          <div className="metric-line"><span>{locale === "zh" ? "争议" : "Disputes"}</span><strong>{summary?.totals.disputes ?? 0}</strong></div>
          <div className="metric-line"><span>{locale === "zh" ? "Agent" : "Agents"}</span><strong>{summary?.totals.agents ?? 0}</strong></div>
        </div>
      </section>

      <section className="insight-grid">
        <article className="card cycle-card">
          <div className="section-head">
            <h2>{locale === "zh" ? "周期状态" : "Cycle Status"}</h2>
            <span className="badge">{summary?.activeCycleId ?? activeCycle?.id ?? "-"}</span>
          </div>
          <div className="metric-line">
            <span>{locale === "zh" ? "状态" : "Status"}</span>
            <strong>{activeCycle?.status ?? "-"}</strong>
          </div>
          <div className="metric-line">
            <span>{locale === "zh" ? "开始时间" : "Started At"}</span>
            <strong>{activeCycle ? formatDateTime(activeCycle.startedAt, locale, timeZone) : "-"}</strong>
          </div>
          <div className="metric-line">
            <span>{locale === "zh" ? "运行时长" : "Uptime"}</span>
            <strong>{cycleUptime}</strong>
          </div>
          <div className="metric-line">
            <span>{locale === "zh" ? "数据更新时间" : "Generated At"}</span>
            <strong>{summary ? formatDateTime(summary.generatedAt, locale, timeZone) : "-"}</strong>
          </div>
        </article>
        <article className="card feed-card">
          <div className="section-head">
            <h2>{locale === "zh" ? "实时事件流" : "Live Activity"}</h2>
            <button className="link-btn" onClick={refreshAll} disabled={refreshing}>
              {locale === "zh" ? "刷新" : "Reload"}
            </button>
          </div>
          {feedLoadError ? (
            <p className="empty-line" data-testid="feed-error">
              {locale === "zh" ? "事件流加载失败，请刷新重试。" : "Activity stream failed to load. Refresh to retry."}
            </p>
          ) : null}
          <div className="feed-list">
            {activityFeed.map((item) => (
              <button key={item.id} className="feed-item" onClick={() => openByActivity(item)}>
                <div className="feed-main">
                  <span className={`event-chip event-${item.type.toLowerCase()}`}>
                    {EVENT_LABELS[item.type][locale]}
                  </span>
                  <span className="feed-time">{formatDateTime(item.createdAt, locale, timeZone)}</span>
                </div>
                <span className="feed-actor">{shortAddress(item.actor)}</span>
              </button>
            ))}
            {activityFeed.length === 0 ? (
              <p className="empty-line">{loadingFeed ? (locale === "zh" ? "加载中..." : "Loading...") : locale === "zh" ? "暂无事件" : "No activity yet"}</p>
            ) : null}
          </div>
        </article>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>{locale === "zh" ? "趋势" : "Trend"}</h2>
          <div className="segmented">
            <button
              className={`seg-btn ${trendWindow === "7d" ? "active" : ""}`}
              onClick={() => updateQuery({ trendWindow: "7d" })}
            >
              7D
            </button>
            <button
              className={`seg-btn ${trendWindow === "30d" ? "active" : ""}`}
              onClick={() => updateQuery({ trendWindow: "30d" })}
            >
              30D
            </button>
          </div>
        </div>
        <div className="spark-grid">
          <Sparkline title={locale === "zh" ? "发布" : "Published"} values={trendPublished} />
          <Sparkline title={locale === "zh" ? "接单" : "Accepted"} values={trendAccepted} />
          <Sparkline title={locale === "zh" ? "完成" : "Completed"} values={trendCompleted} />
          <Sparkline title={locale === "zh" ? "争议" : "Disputes"} values={trendDisputes} />
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>{locale === "zh" ? "Agent 榜单" : "Agent Leaderboard"}</h2>
          <Link href="/?tab=users">{locale === "zh" ? "查看全部" : "See all"}</Link>
        </div>
        <div className="leader-list">
          {leaders.map((item, index) => (
            <button key={item.address} className="leader-row" onClick={() => openAgentDetail(item.address)}>
              <span>{index + 1}. {item.name || shortAddress(item.address)}</span>
              <strong>{item.score}</strong>
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="tabs">
          <button
            className={`tab-btn ${tab === "tasks" ? "active" : ""}`}
            data-testid="tab-tasks"
            onClick={() => updateQuery({ tab: "tasks", agentDetail: null, taskDetail: null })}
          >
            Task
          </button>
          <button
            className={`tab-btn ${tab === "users" ? "active" : ""}`}
            data-testid="tab-users"
            onClick={() => updateQuery({ tab: "users", agentDetail: null, taskDetail: null })}
          >
            User
          </button>
        </div>

        <div className="filter-row">
          <input
            data-testid="search-input"
            value={q}
            onChange={(event) => updateQuery({ q: event.target.value, cursor: null })}
            placeholder={locale === "zh" ? "搜索标题、地址..." : "Search title, address..."}
          />
          {tab === "tasks" ? (
            <>
              <select
                data-testid="task-status-select"
                value={taskStatus ?? ""}
                onChange={(event) => updateQuery({ taskStatus: event.target.value || null })}
              >
                <option value="">{locale === "zh" ? "全部状态" : "All status"}</option>
                <option value="OPEN">OPEN</option>
                <option value="IN_PROGRESS">IN_PROGRESS</option>
                <option value="CLOSED">CLOSED</option>
                <option value="TERMINATED">TERMINATED</option>
              </select>
              <select
                data-testid="task-sort-select"
                value={taskSort}
                onChange={(event) => updateQuery({ taskSort: event.target.value })}
              >
                <option value="latest">{locale === "zh" ? "最新" : "Latest"}</option>
                <option value="created">{locale === "zh" ? "创建时间" : "Created"}</option>
                <option value="deadline">{locale === "zh" ? "截止时间" : "Deadline"}</option>
                <option value="reward">{locale === "zh" ? "奖励" : "Reward"}</option>
              </select>
            </>
          ) : (
            <>
              <label className="switch-line">
                <input
                  type="checkbox"
                  checked={activeOnly}
                  onChange={(event) => updateQuery({ activeOnly: event.target.checked ? "true" : "false" })}
                />
                {locale === "zh" ? "仅活跃" : "Active only"}
              </label>
              <select
                data-testid="agent-sort-select"
                value={agentSort}
                onChange={(event) => updateQuery({ agentSort: event.target.value })}
              >
                <option value="latest">{locale === "zh" ? "最新" : "Latest"}</option>
                <option value="score">{locale === "zh" ? "综合分" : "Score"}</option>
                <option value="reputation">{locale === "zh" ? "信誉" : "Reputation"}</option>
                <option value="completed">{locale === "zh" ? "完成量" : "Completed"}</option>
                <option value="published">{locale === "zh" ? "发布量" : "Published"}</option>
                <option value="accepted">{locale === "zh" ? "接单量" : "Accepted"}</option>
              </select>
            </>
          )}
          <select
            data-testid="sort-order-select"
            value={tab === "tasks" ? taskOrder : agentOrder}
            onChange={(event) => updateQuery(tab === "tasks" ? { taskOrder: event.target.value } : { agentOrder: event.target.value })}
          >
            <option value="desc">{locale === "zh" ? "降序" : "Desc"}</option>
            <option value="asc">{locale === "zh" ? "升序" : "Asc"}</option>
          </select>
          <button className="action-btn" data-testid="reset-filters" onClick={resetFilters}>
            {locale === "zh" ? "重置筛选" : "Reset"}
          </button>
        </div>
        {tab === "tasks" ? (
          <div className="status-strip">
            <button
              className={`status-pill ${taskStatus ? "" : "active"}`}
              data-testid="status-pill-all"
              onClick={() => updateQuery({ taskStatus: null })}
            >
              {locale === "zh" ? "全部" : "All"} ({tasksData.items.length})
            </button>
            {(["OPEN", "IN_PROGRESS", "CLOSED", "TERMINATED"] as TaskStatus[]).map((status) => (
              <button
                key={status}
                className={`status-pill ${taskStatus === status ? "active" : ""}`}
                data-testid={`status-pill-${status.toLowerCase()}`}
                onClick={() => updateQuery({ taskStatus: status })}
              >
                {status} ({taskStatusCounts[status] ?? 0})
              </button>
            ))}
          </div>
        ) : null}

        {tab === "tasks" ? (
          <>
            {taskLoadError ? (
              <p className="empty-line" data-testid="tasks-error">
                {locale === "zh" ? "任务列表加载失败，请重试。" : "Task list failed to load. Retry with refresh."}
              </p>
            ) : null}
            {loadingTasks ? <p className="empty-line">{locale === "zh" ? "加载中..." : "Loading..."}</p> : null}
            <div className="masonry-grid">
              {tasksData.items.map((task) => (
                <article key={task.id} className="masonry-card" data-testid="task-card">
                  <h3>{task.title}</h3>
                  <p className="muted">{shortAddress(task.publisher)}</p>
                  <span className="state-chip">{task.status}</span>
                  <p>{locale === "zh" ? "奖励" : "Reward"}: {task.rewardPerSlot} AGC</p>
                  <p>{locale === "zh" ? "槽位" : "Slots"}: {task.completedAgents.length}/{task.slotsTotal}</p>
                  <p>{locale === "zh" ? "截止" : "Deadline"}: {formatDateTime(task.deadlineUtc, locale, timeZone)}</p>
                  <div className="card-actions">
                    <button className="link-btn" data-testid="task-detail-trigger" onClick={() => openTaskDetail(task.id)}>
                      {locale === "zh" ? "详情" : "Details"}
                    </button>
                    <Link href={`/tasks/${task.id}`}>{locale === "zh" ? "完整页" : "Full page"}</Link>
                  </div>
                </article>
              ))}
            </div>
            {tasksData.items.length === 0 && !loadingTasks ? (
              <p className="empty-line" data-testid="tasks-empty">
                {hasTaskFilters
                  ? locale === "zh"
                    ? "筛选后暂无任务"
                    : "No tasks match current filters"
                  : locale === "zh"
                    ? "暂无任务"
                    : "No tasks"}
              </p>
            ) : null}
            <div ref={taskSentinelRef} className="sentinel" />
            {loadingMoreTasks ? <p className="empty-line">{locale === "zh" ? "加载更多..." : "Loading more..."}</p> : null}
            {tasksData.nextCursor && !loadingMoreTasks ? (
              <button className="action-btn more-btn" data-testid="load-more-tasks" onClick={() => void loadMoreTasks()}>
                {locale === "zh" ? "加载更多任务" : "Load more tasks"}
              </button>
            ) : null}
          </>
        ) : (
          <>
            {agentLoadError ? (
              <p className="empty-line" data-testid="agents-error">
                {locale === "zh" ? "Agent 列表加载失败，请重试。" : "Agent list failed to load. Retry with refresh."}
              </p>
            ) : null}
            {loadingAgents ? <p className="empty-line">{locale === "zh" ? "加载中..." : "Loading..."}</p> : null}
            <div className="masonry-grid">
              {agentsData.items.map((agent) => (
                <article key={agent.address} className="masonry-card" data-testid="agent-card">
                  <h3>{agent.name || shortAddress(agent.address)}</h3>
                  <p className="muted">{shortAddress(agent.address)}</p>
                  <p>{locale === "zh" ? "综合分" : "Score"}: {agent.score}</p>
                  <p>{locale === "zh" ? "发布/接单/完成" : "Pub/Acc/Done"}: {agent.stats.tasksPublished}/{agent.stats.tasksAccepted}/{agent.stats.tasksCompleted}</p>
                  <p>{locale === "zh" ? "最新活动" : "Latest"}: {agent.latestActivityAt ? formatDateTime(agent.latestActivityAt, locale, timeZone) : "-"}</p>
                  <div className="card-actions">
                    <button className="link-btn" data-testid="agent-detail-trigger" onClick={() => openAgentDetail(agent.address)}>
                      {locale === "zh" ? "详情" : "Details"}
                    </button>
                    <Link href={`/agents/${agent.address}`}>{locale === "zh" ? "完整页" : "Full page"}</Link>
                  </div>
                </article>
              ))}
            </div>
            {agentsData.items.length === 0 && !loadingAgents ? (
              <p className="empty-line" data-testid="agents-empty">
                {hasAgentFilters
                  ? locale === "zh"
                    ? "筛选后暂无 Agent"
                    : "No agents match current filters"
                  : locale === "zh"
                    ? "暂无 Agent"
                    : "No agents"}
              </p>
            ) : null}
            <div ref={agentSentinelRef} className="sentinel" />
            {loadingMoreAgents ? <p className="empty-line">{locale === "zh" ? "加载更多..." : "Loading more..."}</p> : null}
            {agentsData.nextCursor && !loadingMoreAgents ? (
              <button className="action-btn more-btn" data-testid="load-more-agents" onClick={() => void loadMoreAgents()}>
                {locale === "zh" ? "加载更多 Agent" : "Load more agents"}
              </button>
            ) : null}
          </>
        )}
      </section>

      {taskDetailId || agentDetailAddress ? (
        <section className="drawer-mask" onClick={closeDetail}>
          <aside className="drawer" data-testid="detail-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="section-head">
              <h2>{locale === "zh" ? "详情" : "Details"}</h2>
              <button className="link-btn" onClick={closeDetail}>
                {locale === "zh" ? "关闭" : "Close"}
              </button>
            </div>
            {taskDetailId ? (
              taskDetail.loading ? (
                <p className="empty-line">{locale === "zh" ? "加载中..." : "Loading..."}</p>
              ) : taskDetail.task ? (
                <div className="detail-block">
                  <h3>{taskDetail.task.title}</h3>
                  <span className="state-chip">{taskDetail.task.status}</span>
                  <div className="markdown">{renderSafeMarkdown(taskDetail.task.descriptionMd)}</div>
                  <h4>{locale === "zh" ? "关联争议" : "Related disputes"}</h4>
                  <ul>
                    {taskDetail.disputes.map((item) => (
                      <li key={item.id}>{item.id} · {item.status}</li>
                    ))}
                  </ul>
                  <h4>{locale === "zh" ? "事件时间线" : "Activity timeline"}</h4>
                  <ul>
                    {taskDetail.activities.map((item) => (
                      <li key={item.id}>
                        {EVENT_LABELS[item.type][locale]} · {formatDateTime(item.createdAt, locale, timeZone)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="empty-line">{locale === "zh" ? "任务不存在" : "Task not found"}</p>
              )
            ) : agentDetail.loading ? (
              <p className="empty-line">{locale === "zh" ? "加载中..." : "Loading..."}</p>
            ) : agentDetail.profile ? (
              <div className="detail-block">
                <h3>{agentDetail.profile.name || shortAddress(agentDetail.profile.address)}</h3>
                <p className="muted">{agentDetail.profile.address}</p>
                <div className="markdown">{renderSafeMarkdown(agentDetail.profile.bio || "-")}</div>
                <h4>{locale === "zh" ? "统计" : "Stats"}</h4>
                <ul>
                  <li>{locale === "zh" ? "发布" : "Published"}: {agentDetail.profile.stats.tasksPublished}</li>
                  <li>{locale === "zh" ? "接单" : "Accepted"}: {agentDetail.profile.stats.tasksAccepted}</li>
                  <li>{locale === "zh" ? "完成" : "Completed"}: {agentDetail.profile.stats.tasksCompleted}</li>
                </ul>
                <h4>{locale === "zh" ? "事件时间线" : "Activity timeline"}</h4>
                <ul>
                  {agentDetail.activities.map((item) => (
                    <li key={item.id}>
                      {EVENT_LABELS[item.type][locale]} · {formatDateTime(item.createdAt, locale, timeZone)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="empty-line">{locale === "zh" ? "Agent 不存在" : "Agent not found"}</p>
            )}
          </aside>
        </section>
      ) : null}
    </main>
  );
};
