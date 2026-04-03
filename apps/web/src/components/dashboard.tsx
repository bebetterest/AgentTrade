"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { messages, type SupportedLocale } from "@agentrade/i18n";
import type {
  ActivityEvent,
  AgentDirectoryItem,
  AgentProfile,
  Cycle,
  CycleRewardsResponse,
  DashboardSummaryResponse,
  DashboardTrendsResponse,
  Dispute,
  LedgerBalance,
  PaginatedResponse,
  Task
} from "@agentrade/types";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AgentDetailDrawer } from "./dashboard/agent-detail-drawer";
import { AgentListPanel } from "./dashboard/agent-list-panel";
import { ActivityFeed } from "./dashboard/activity-feed";
import { CycleDetailDrawer } from "./dashboard/cycle-detail-drawer";
import { CycleListPanel } from "./dashboard/cycle-list-panel";
import { OverviewPanels } from "./dashboard/overview-panels";
import { TaskDetailDrawer } from "./dashboard/task-detail-drawer";
import { TaskListPanel } from "./dashboard/task-list-panel";
import { LocaleSwitcher } from "./locale-switcher";
import {
  fetchActivities,
  fetchActiveCycle,
  fetchAgent,
  fetchAgents,
  fetchCycleRewards,
  fetchCycles,
  fetchDashboardSummary,
  fetchDashboardTrends,
  fetchDispute,
  fetchDisputes,
  fetchLedger,
  fetchTask,
  fetchTasks
} from "../lib/api";
import { DEFAULT_TIMEZONE, formatDuration } from "../lib/dashboard-format";
import { parseDashboardQuery, sanitizeQueryPatch } from "../lib/dashboard-query";
import { TIMEZONE_COOKIE_NAME, buildPreferenceCookie } from "../lib/request-context";

interface DashboardProps {
  initialLocale: SupportedLocale;
  initialTimeZone: string;
  initialSummary: DashboardSummaryResponse | null;
  initialTrends: DashboardTrendsResponse | null;
  initialTasks: PaginatedResponse<Task>;
  initialAgents: PaginatedResponse<AgentDirectoryItem>;
  initialLeaders: AgentDirectoryItem[];
  initialActiveCycle: Cycle | null;
  initialActivities: PaginatedResponse<ActivityEvent>;
  initialCycles: PaginatedResponse<Cycle>;
}

const REFRESH_FEED_LIMIT = 12;
const SEARCH_DEBOUNCE_MS = 320;

export const Dashboard = ({
  initialLocale,
  initialTimeZone,
  initialSummary,
  initialTrends,
  initialTasks,
  initialAgents,
  initialLeaders,
  initialActiveCycle,
  initialActivities,
  initialCycles
}: DashboardProps) => {
  const [locale, setLocale] = useState<SupportedLocale>(initialLocale);
  const t = messages[locale];
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [timeZone, setTimeZone] = useState(initialTimeZone);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [summary, setSummary] = useState<DashboardSummaryResponse | null>(initialSummary);
  const [trends, setTrends] = useState<DashboardTrendsResponse | null>(initialTrends);
  const [leaders, setLeaders] = useState<AgentDirectoryItem[]>(initialLeaders);
  const [activeCycle, setActiveCycle] = useState<Cycle | null>(initialActiveCycle);
  const [activityFeed, setActivityFeed] = useState<ActivityEvent[]>(initialActivities.items.slice(0, REFRESH_FEED_LIMIT));

  const [tasksData, setTasksData] = useState<PaginatedResponse<Task>>(initialTasks);
  const [agentsData, setAgentsData] = useState<PaginatedResponse<AgentDirectoryItem>>(initialAgents);
  const [cyclesData, setCyclesData] = useState<PaginatedResponse<Cycle>>(initialCycles);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [loadingCycles, setLoadingCycles] = useState(false);
  const [loadingMoreTasks, setLoadingMoreTasks] = useState(false);
  const [loadingMoreAgents, setLoadingMoreAgents] = useState(false);
  const [loadingMoreCycles, setLoadingMoreCycles] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [overviewError, setOverviewError] = useState(false);
  const [taskLoadError, setTaskLoadError] = useState(false);
  const [agentLoadError, setAgentLoadError] = useState(false);
  const [cycleLoadError, setCycleLoadError] = useState(false);
  const [feedLoadError, setFeedLoadError] = useState(false);
  const [taskDetailReloadTick, setTaskDetailReloadTick] = useState(0);
  const [agentDetailReloadTick, setAgentDetailReloadTick] = useState(0);
  const [cycleDetailReloadTick, setCycleDetailReloadTick] = useState(0);

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
    ledger: LedgerBalance | null;
    activities: ActivityEvent[];
  }>({
    loading: false,
    error: false,
    profile: null,
    ledger: null,
    activities: []
  });
  const [cycleDetail, setCycleDetail] = useState<{
    loading: boolean;
    error: boolean;
    rewards: CycleRewardsResponse | null;
    disputes: Dispute[];
  }>({
    loading: false,
    error: false,
    rewards: null,
    disputes: []
  });

  const taskSentinelRef = useRef<HTMLDivElement | null>(null);
  const agentSentinelRef = useRef<HTMLDivElement | null>(null);
  const cycleSentinelRef = useRef<HTMLDivElement | null>(null);
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
    agentDetailAddress,
    cycleDetailId
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
    updateQuery({ taskDetail: taskId, agentDetail: null, cycleDetail: null });
  }, [updateQuery]);
  const openAgentDetail = useCallback((address: string) => {
    updateQuery({ agentDetail: address, taskDetail: null, cycleDetail: null });
  }, [updateQuery]);
  const openCycleDetail = useCallback((cycleId: string) => {
    updateQuery({ cycleDetail: cycleId, taskDetail: null, agentDetail: null });
  }, [updateQuery]);
  const closeDetail = useCallback(() => {
    updateQuery({ taskDetail: null, agentDetail: null, cycleDetail: null });
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

  const retryCycleDetail = () => {
    if (cycleDetailId) {
      setCycleDetailReloadTick((prev) => prev + 1);
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

  const loadMoreCycles = useCallback(async () => {
    if (!cyclesData.nextCursor || loadingMoreCycles) {
      return;
    }
    setLoadingMoreCycles(true);
    try {
      const response = await fetchCycles({
        cursor: cyclesData.nextCursor ?? undefined,
        limit: 12,
        strict: true
      });
      setCycleLoadError(false);
      setCyclesData((prev) => ({
        items: [
          ...prev.items,
          ...response.items.filter((item) => !prev.items.some((prevItem) => prevItem.id === item.id))
        ],
        nextCursor: response.nextCursor
      }));
    } catch {
      setCycleLoadError(true);
    } finally {
      setLoadingMoreCycles(false);
    }
  }, [cyclesData.nextCursor, loadingMoreCycles]);

  const refreshAll = async () => {
    setRefreshing(true);
    const [summaryRes, trendsRes, leadersRes, tasksRes, agentsRes, cyclesRes, cycleRes, feedRes] = await Promise.allSettled([
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
      fetchCycles({ limit: 12, strict: true }),
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

    if (cyclesRes.status === "fulfilled") {
      setCycleLoadError(false);
      setCyclesData(cyclesRes.value);
    } else {
      setCycleLoadError(true);
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
    const detectedTimeZone =
      Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE;
    document.cookie = buildPreferenceCookie(TIMEZONE_COOKIE_NAME, detectedTimeZone);
    if (detectedTimeZone !== initialTimeZone) {
      setTimeZone(detectedTimeZone);
    }
  }, [initialTimeZone]);

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
    const opened = Boolean(taskDetailId || agentDetailAddress || cycleDetailId);
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
  }, [taskDetailId, agentDetailAddress, cycleDetailId, closeDetail]);

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
    let cancelled = false;
    setLoadingCycles(true);
    setCycleLoadError(false);
    const controller = new AbortController();
    fetchCycles({
      limit: 12,
      signal: controller.signal,
      strict: true
    }).then((response) => {
      if (!cancelled) {
        setCyclesData(response);
        setLoadingCycles(false);
      }
    }).catch(() => {
      if (!cancelled) {
        setCycleLoadError(true);
        setLoadingCycles(false);
      }
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

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
    if (tab !== "cycles" || !cyclesData.nextCursor || loadingMoreCycles) {
      return;
    }
    const target = cycleSentinelRef.current;
    if (!target) {
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      const first = entries[0];
      if (!first?.isIntersecting || !cyclesData.nextCursor) {
        return;
      }
      void loadMoreCycles();
    });
    observer.observe(target);
    return () => {
      observer.disconnect();
    };
  }, [tab, cyclesData.nextCursor, loadingMoreCycles, loadMoreCycles]);

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
      setAgentDetail({ loading: false, error: false, profile: null, ledger: null, activities: [] });
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setAgentDetail((prev) => ({ ...prev, loading: true, error: false }));
    Promise.all([
      fetchAgent(agentDetailAddress, { signal: controller.signal, strict: true }),
      fetchLedger(agentDetailAddress, { signal: controller.signal, strict: true }),
      fetchActivities({
        address: agentDetailAddress,
        limit: 50,
        order: "desc",
        signal: controller.signal,
        strict: true
      })
    ])
      .then(([profile, ledger, activities]) => {
        if (cancelled) {
          return;
        }
        setAgentDetail({
          loading: false,
          error: false,
          profile,
          ledger,
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

  useEffect(() => {
    if (!cycleDetailId) {
      setCycleDetail({ loading: false, error: false, rewards: null, disputes: [] });
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setCycleDetail((prev) => ({ ...prev, loading: true, error: false }));
    (async () => {
      try {
        const rewards = await fetchCycleRewards(cycleDetailId, { signal: controller.signal, strict: true });
        if (cancelled) {
          return;
        }
        if (!rewards) {
          setCycleDetail({
            loading: false,
            error: false,
            rewards: null,
            disputes: []
          });
          return;
        }
        const disputeIds = [...new Set(rewards.workloads.map((item) => item.disputeId).filter(Boolean))];
        const disputeItems = await Promise.all(
          disputeIds.map((id) => fetchDispute(id, { signal: controller.signal, strict: true }))
        );
        if (cancelled) {
          return;
        }
        setCycleDetail({
          loading: false,
          error: false,
          rewards,
          disputes: disputeItems.filter((item): item is Dispute => Boolean(item))
        });
      } catch {
        if (cancelled) {
          return;
        }
        setCycleDetail((prev) => ({
          ...prev,
          loading: false,
          error: true
        }));
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [cycleDetailId, cycleDetailReloadTick]);

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
        <LocaleSwitcher initialLocale={initialLocale} onChange={setLocale} />
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

      <OverviewPanels
        locale={locale}
        timeZone={timeZone}
        summary={summary}
        activeCycle={activeCycle}
        cycleUptime={cycleUptime}
        trendWindow={trendWindow}
        trendPublished={trendPublished}
        trendAccepted={trendAccepted}
        trendCompleted={trendCompleted}
        trendDisputes={trendDisputes}
        leaders={leaders}
        onTrendWindowChange={(window) => updateQuery({ trendWindow: window })}
        onOpenAgentDetail={openAgentDetail}
        onOpenCycleDetail={openCycleDetail}
      />

      <section className="insight-grid">
        <ActivityFeed
          locale={locale}
          timeZone={timeZone}
          refreshing={refreshing}
          feedLoadError={feedLoadError}
          loadingFeed={loadingFeed}
          activityFeed={activityFeed}
          onRefresh={refreshAll}
          onOpenByActivity={openByActivity}
        />
      </section>

      <section className="card">
        <div className="tabs">
          <button
            type="button"
            className={`tab-btn ${tab === "tasks" ? "active" : ""}`}
            data-testid="tab-tasks"
            onClick={() => updateQuery({ tab: "tasks", agentDetail: null, taskDetail: null, cycleDetail: null })}
          >
            Task
          </button>
          <button
            type="button"
            className={`tab-btn ${tab === "users" ? "active" : ""}`}
            data-testid="tab-users"
            onClick={() => updateQuery({ tab: "users", agentDetail: null, taskDetail: null, cycleDetail: null })}
          >
            User
          </button>
          <button
            type="button"
            className={`tab-btn ${tab === "cycles" ? "active" : ""}`}
            data-testid="tab-cycles"
            onClick={() => updateQuery({ tab: "cycles", agentDetail: null, taskDetail: null, cycleDetail: null })}
          >
            Cycle
          </button>
        </div>

        {tab !== "cycles" ? (
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
        ) : (
          <p className="sub">{locale === "zh" ? "查看周期、奖励分配与监督 workload。" : "Browse cycles, reward distributions, and supervision workloads."}</p>
        )}
        {tab === "tasks" ? (
          <TaskListPanel
            locale={locale}
            timeZone={timeZone}
            tasks={tasksData.items}
            taskStatus={taskStatus}
            taskStatusCounts={taskStatusCounts}
            hasTaskFilters={hasTaskFilters}
            loadingTasks={loadingTasks}
            loadingMoreTasks={loadingMoreTasks}
            taskLoadError={taskLoadError}
            nextCursor={tasksData.nextCursor}
            taskSentinelRef={taskSentinelRef}
            onOpenTaskDetail={openTaskDetail}
            onSetTaskStatus={(status) => updateQuery({ taskStatus: status })}
            onRefresh={refreshAll}
            onLoadMore={() => void loadMoreTasks()}
          />
        ) : tab === "users" ? (
          <AgentListPanel
            locale={locale}
            timeZone={timeZone}
            agents={agentsData.items}
            hasAgentFilters={hasAgentFilters}
            loadingAgents={loadingAgents}
            loadingMoreAgents={loadingMoreAgents}
            agentLoadError={agentLoadError}
            nextCursor={agentsData.nextCursor}
            agentSentinelRef={agentSentinelRef}
            onOpenAgentDetail={openAgentDetail}
            onRefresh={refreshAll}
            onLoadMore={() => void loadMoreAgents()}
          />
        ) : (
          <CycleListPanel
            locale={locale}
            timeZone={timeZone}
            cycles={cyclesData.items}
            loadingCycles={loadingCycles}
            loadingMoreCycles={loadingMoreCycles}
            cycleLoadError={cycleLoadError}
            nextCursor={cyclesData.nextCursor}
            cycleSentinelRef={cycleSentinelRef}
            onOpenCycleDetail={openCycleDetail}
            onRefresh={refreshAll}
            onLoadMore={() => void loadMoreCycles()}
          />
        )}
      </section>

      {taskDetailId || agentDetailAddress || cycleDetailId ? (
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
              <TaskDetailDrawer
                locale={locale}
                timeZone={timeZone}
                taskDetail={taskDetail}
                onRetry={retryTaskDetail}
                onOpenAgentDetail={openAgentDetail}
              />
            ) : cycleDetailId ? (
              <CycleDetailDrawer
                locale={locale}
                timeZone={timeZone}
                cycleDetail={cycleDetail}
                onRetry={retryCycleDetail}
                onOpenAgentDetail={openAgentDetail}
              />
            ) : (
              <AgentDetailDrawer
                locale={locale}
                timeZone={timeZone}
                agentDetail={agentDetail}
                onRetry={retryAgentDetail}
              />
            )}
          </aside>
        </section>
      ) : null}
    </main>
  );
};
