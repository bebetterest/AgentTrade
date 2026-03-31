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
import { DEFAULT_TIMEZONE, formatDateTime, formatDuration, shortAddress, toSparklinePath } from "../lib/dashboard-format";
import { parseDashboardQuery, sanitizeQueryPatch } from "../lib/dashboard-query";
import { renderSafeMarkdown } from "../lib/markdown";

interface DashboardProps {
  initialSummary: DashboardSummaryResponse | null;
  initialTrends: DashboardTrendsResponse | null;
  initialTasks: PaginatedResponse<Task>;
  initialAgents: PaginatedResponse<AgentDirectoryItem>;
  initialActiveCycle: Cycle | null;
  initialActivities: PaginatedResponse<ActivityEvent>;
}

const REFRESH_FEED_LIMIT = 12;
const SEARCH_DEBOUNCE_MS = 320;
const TASK_STATUS_FILTERS: TaskStatus[] = [
  TaskStatus.OPEN,
  TaskStatus.IN_PROGRESS,
  TaskStatus.CLOSED,
  TaskStatus.TERMINATED
];

const EVENT_LABELS: Record<ActivityEventType, { zh: string; en: string }> = {
  TASK_PUBLISHED: { zh: "发布任务", en: "Task Published" },
  TASK_ACCEPTED: { zh: "接单", en: "Task Accepted" },
  TASK_COMPLETED: { zh: "任务完成", en: "Task Completed" },
  DISPUTE_OPENED: { zh: "发起争议", en: "Dispute Opened" },
  TASK_TERMINATED: { zh: "任务终止", en: "Task Terminated" }
};

const Sparkline = ({ title, values }: { title: string; values: number[] }) => {
  const path = toSparklinePath(values);
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
  const [taskDetailReloadTick, setTaskDetailReloadTick] = useState(0);
  const [agentDetailReloadTick, setAgentDetailReloadTick] = useState(0);

  const [taskDetail, setTaskDetail] = useState<{
    loading: boolean;
    error: boolean;
    task: Task | null;
    disputes: Dispute[];
    activities: ActivityEvent[];
  }>({
    loading: false,
    error: false,
    task: null,
    disputes: [],
    activities: []
  });
  const [agentDetail, setAgentDetail] = useState<{
    loading: boolean;
    error: boolean;
    profile: AgentProfile | null;
    activities: ActivityEvent[];
  }>({
    loading: false,
    error: false,
    profile: null,
    activities: []
  });

  const taskSentinelRef = useRef<HTMLDivElement | null>(null);
  const agentSentinelRef = useRef<HTMLDivElement | null>(null);
  const taskQueryKeyRef = useRef("");
  const agentQueryKeyRef = useRef("");

  const {
    tab,
    q,
    taskStatus,
    taskSort,
    taskOrder,
    agentSort,
    agentOrder,
    activeOnly,
    trendWindow,
    taskDetailId,
    agentDetailAddress
  } = useMemo(() => parseDashboardQuery(searchParams), [searchParams]);
  const [searchDraft, setSearchDraft] = useState(q);

  const taskQueryKey = `${q}|${taskStatus ?? ""}|${taskSort}|${taskOrder}`;
  const agentQueryKey = `${q}|${activeOnly}|${agentSort}|${agentOrder}`;
  taskQueryKeyRef.current = taskQueryKey;
  agentQueryKeyRef.current = agentQueryKey;

  const updateQuery = useCallback((patch: Record<string, string | null>) => {
    const sanitizedPatch = sanitizeQueryPatch(patch);
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(sanitizedPatch)) {
      if (value === null || value.trim().length === 0) {
        next.delete(key);
      } else {
        next.set(key, value);
      }
    }
    const query = next.toString();
    router.replace(query.length > 0 ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  const openTaskDetail = useCallback((taskId: string) => {
    updateQuery({ taskDetail: taskId, agentDetail: null });
  }, [updateQuery]);
  const openAgentDetail = useCallback((address: string) => {
    updateQuery({ agentDetail: address, taskDetail: null });
  }, [updateQuery]);
  const closeDetail = useCallback(() => {
    updateQuery({ taskDetail: null, agentDetail: null });
  }, [updateQuery]);

  const retryTaskDetail = () => {
    if (taskDetailId) {
      setTaskDetailReloadTick((prev) => prev + 1);
    }
  };

  const retryAgentDetail = () => {
    if (agentDetailAddress) {
      setAgentDetailReloadTick((prev) => prev + 1);
    }
  };

  const loadMoreTasks = useCallback(async () => {
    if (!tasksData.nextCursor || loadingMoreTasks) {
      return;
    }
    const expectedQueryKey = taskQueryKey;
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
      if (taskQueryKeyRef.current !== expectedQueryKey) {
        return;
      }
      setTaskLoadError(false);
      setTasksData((prev) => ({
        items: [
          ...prev.items,
          ...response.items.filter((item) => !prev.items.some((prevItem) => prevItem.id === item.id))
        ],
        nextCursor: response.nextCursor
      }));
    } catch {
      setTaskLoadError(true);
    } finally {
      setLoadingMoreTasks(false);
    }
  }, [loadingMoreTasks, q, taskOrder, taskQueryKey, taskSort, taskStatus, tasksData.nextCursor]);

  const loadMoreAgents = useCallback(async () => {
    if (!agentsData.nextCursor || loadingMoreAgents) {
      return;
    }
    const expectedQueryKey = agentQueryKey;
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
      if (agentQueryKeyRef.current !== expectedQueryKey) {
        return;
      }
      setAgentLoadError(false);
      setAgentsData((prev) => ({
        items: [
          ...prev.items,
          ...response.items.filter((item) => !prev.items.some((prevItem) => prevItem.address === item.address))
        ],
        nextCursor: response.nextCursor
      }));
    } catch {
      setAgentLoadError(true);
    } finally {
      setLoadingMoreAgents(false);
    }
  }, [activeOnly, agentOrder, agentQueryKey, agentSort, agentsData.nextCursor, loadingMoreAgents, q]);

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
    setSearchDraft(q);
  }, [q]);

  useEffect(() => {
    if (searchDraft === q) {
      return;
    }
    const timer = setTimeout(() => {
      updateQuery({ q: searchDraft });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [searchDraft, q, updateQuery]);

  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 60_000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const opened = Boolean(taskDetailId || agentDetailAddress);
    if (!opened) {
      document.body.style.overflow = "";
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeDetail();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [taskDetailId, agentDetailAddress, closeDetail]);

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
      setTaskDetail({ loading: false, error: false, task: null, disputes: [], activities: [] });
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setTaskDetail((prev) => ({ ...prev, loading: true, error: false }));
    Promise.all([
      fetchTask(taskDetailId, { signal: controller.signal, strict: true }),
      fetchDisputes({ taskId: taskDetailId, limit: 50, signal: controller.signal, strict: true }),
      fetchActivities({ taskId: taskDetailId, limit: 50, order: "desc", signal: controller.signal, strict: true })
    ])
      .then(([task, disputes, activities]) => {
        if (cancelled) {
          return;
        }
        setTaskDetail({
          loading: false,
          error: false,
          task,
          disputes: disputes.items,
          activities: activities.items
        });
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setTaskDetail((prev) => ({
          ...prev,
          loading: false,
          error: true
        }));
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [taskDetailId, taskDetailReloadTick]);

  useEffect(() => {
    if (!agentDetailAddress) {
      setAgentDetail({ loading: false, error: false, profile: null, activities: [] });
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setAgentDetail((prev) => ({ ...prev, loading: true, error: false }));
    Promise.all([
      fetchAgent(agentDetailAddress, { signal: controller.signal, strict: true }),
      fetchActivities({
        address: agentDetailAddress,
        limit: 50,
        order: "desc",
        signal: controller.signal,
        strict: true
      })
    ])
      .then(([profile, activities]) => {
        if (cancelled) {
          return;
        }
        setAgentDetail({
          loading: false,
          error: false,
          profile,
          activities: activities.items
        });
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setAgentDetail((prev) => ({
          ...prev,
          loading: false,
          error: true
        }));
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [agentDetailAddress, agentDetailReloadTick]);

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
  const clearSearch = () => {
    setSearchDraft("");
    updateQuery({ q: null });
  };
  const commitSearch = () => {
    updateQuery({ q: searchDraft });
  };
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
        <button type="button" className="action-btn" data-testid="refresh-button" onClick={refreshAll} disabled={refreshing}>
          {refreshing ? (locale === "zh" ? "刷新中..." : "Refreshing...") : locale === "zh" ? "手动刷新" : "Refresh"}
        </button>
      </section>
      {overviewError ? (
        <section className="card alert-card" data-testid="overview-error">
          <p>{locale === "zh" ? "概览模块拉取失败，请重试。" : "Overview modules failed to load. Try refresh."}</p>
          <button type="button" className="action-btn" onClick={refreshAll}>
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
            <button type="button" className="link-btn" onClick={refreshAll} disabled={refreshing}>
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
              <button type="button" key={item.id} className="feed-item" onClick={() => openByActivity(item)}>
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
                type="button"
                className={`seg-btn ${trendWindow === "7d" ? "active" : ""}`}
                onClick={() => updateQuery({ trendWindow: "7d" })}
              >
              7D
            </button>
              <button
                type="button"
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
            <button type="button" key={item.address} className="leader-row" onClick={() => openAgentDetail(item.address)}>
              <span>{index + 1}. {item.name || shortAddress(item.address)}</span>
              <strong>{item.score}</strong>
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="tabs">
          <button
            type="button"
            className={`tab-btn ${tab === "tasks" ? "active" : ""}`}
            data-testid="tab-tasks"
            onClick={() => updateQuery({ tab: "tasks", agentDetail: null, taskDetail: null })}
          >
            Task
          </button>
          <button
            type="button"
            className={`tab-btn ${tab === "users" ? "active" : ""}`}
            data-testid="tab-users"
            onClick={() => updateQuery({ tab: "users", agentDetail: null, taskDetail: null })}
          >
            User
          </button>
        </div>

        <div className="filter-row">
          <label className="sr-only" htmlFor="dashboard-search-input">
            {locale === "zh" ? "搜索" : "Search"}
          </label>
          <input
            id="dashboard-search-input"
            data-testid="search-input"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            onBlur={commitSearch}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                commitSearch();
              }
            }}
            placeholder={locale === "zh" ? "搜索标题、地址..." : "Search title, address..."}
          />
          {searchDraft.length > 0 ? (
            <button type="button" className="link-btn" data-testid="clear-search-button" onClick={clearSearch}>
              {locale === "zh" ? "清除" : "Clear"}
            </button>
          ) : null}
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
                  data-testid="active-only-checkbox"
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
          <button type="button" className="action-btn" data-testid="reset-filters" onClick={resetFilters}>
            {locale === "zh" ? "重置筛选" : "Reset"}
          </button>
        </div>
        {tab === "tasks" ? (
          <div className="status-strip">
            <button
              className={`status-pill ${taskStatus ? "" : "active"}`}
              data-testid="status-pill-all"
              type="button"
              onClick={() => updateQuery({ taskStatus: null })}
            >
              {locale === "zh" ? "全部" : "All"} ({tasksData.items.length})
            </button>
            {TASK_STATUS_FILTERS.map((status) => (
              <button
                key={status}
                className={`status-pill ${taskStatus === status ? "active" : ""}`}
                data-testid={`status-pill-${status.toLowerCase()}`}
                type="button"
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
              <div className="inline-error" data-testid="tasks-error">
                <p className="empty-line">
                  {locale === "zh" ? "任务列表加载失败，请重试。" : "Task list failed to load. Retry with refresh."}
                </p>
                <button type="button" className="link-btn" onClick={refreshAll}>
                  {locale === "zh" ? "重试" : "Retry"}
                </button>
              </div>
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
                    <button type="button" className="link-btn" data-testid="task-detail-trigger" onClick={() => openTaskDetail(task.id)}>
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
              <button type="button" className="action-btn more-btn" data-testid="load-more-tasks" onClick={() => void loadMoreTasks()}>
                {locale === "zh" ? "加载更多任务" : "Load more tasks"}
              </button>
            ) : null}
          </>
        ) : (
          <>
            {agentLoadError ? (
              <div className="inline-error" data-testid="agents-error">
                <p className="empty-line">
                  {locale === "zh" ? "Agent 列表加载失败，请重试。" : "Agent list failed to load. Retry with refresh."}
                </p>
                <button type="button" className="link-btn" onClick={refreshAll}>
                  {locale === "zh" ? "重试" : "Retry"}
                </button>
              </div>
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
                    <button type="button" className="link-btn" data-testid="agent-detail-trigger" onClick={() => openAgentDetail(agent.address)}>
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
              <button type="button" className="action-btn more-btn" data-testid="load-more-agents" onClick={() => void loadMoreAgents()}>
                {locale === "zh" ? "加载更多 Agent" : "Load more agents"}
              </button>
            ) : null}
          </>
        )}
      </section>

      {taskDetailId || agentDetailAddress ? (
        <section className="drawer-mask" onClick={closeDetail}>
          <aside
            className="drawer"
            data-testid="detail-drawer"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="section-head">
              <h2>{locale === "zh" ? "详情" : "Details"}</h2>
              <button type="button" className="link-btn" onClick={closeDetail}>
                {locale === "zh" ? "关闭" : "Close"}
              </button>
            </div>
            {taskDetailId ? (
              taskDetail.loading ? (
                <p className="empty-line">{locale === "zh" ? "加载中..." : "Loading..."}</p>
              ) : taskDetail.error ? (
                <div className="inline-error" data-testid="task-detail-error">
                  <p className="empty-line">
                    {locale === "zh" ? "任务详情加载失败，请重试。" : "Task details failed to load. Retry."}
                  </p>
                  <button type="button" className="link-btn" data-testid="retry-task-detail" onClick={retryTaskDetail}>
                    {locale === "zh" ? "重试" : "Retry"}
                  </button>
                </div>
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
            ) : agentDetail.error ? (
              <div className="inline-error" data-testid="agent-detail-error">
                <p className="empty-line">
                  {locale === "zh" ? "Agent 详情加载失败，请重试。" : "Agent details failed to load. Retry."}
                </p>
                <button type="button" className="link-btn" data-testid="retry-agent-detail" onClick={retryAgentDetail}>
                  {locale === "zh" ? "重试" : "Retry"}
                </button>
              </div>
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
