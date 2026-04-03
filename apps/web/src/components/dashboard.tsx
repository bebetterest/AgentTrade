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
import { DashboardView } from "./dashboard/dashboard-view";
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
    <DashboardView
      initialLocale={initialLocale}
      locale={locale}
      setLocale={setLocale}
      appTitle={t.appTitle}
      readOnlyNotice={t.readOnlyNotice}
      timeZone={timeZone}
      refreshing={refreshing}
      overviewError={overviewError}
      summary={summary}
      leaders={leaders}
      activeCycle={activeCycle}
      activityFeed={activityFeed}
      tasksData={tasksData}
      agentsData={agentsData}
      cyclesData={cyclesData}
      loadingTasks={loadingTasks}
      loadingAgents={loadingAgents}
      loadingCycles={loadingCycles}
      loadingMoreTasks={loadingMoreTasks}
      loadingMoreAgents={loadingMoreAgents}
      loadingMoreCycles={loadingMoreCycles}
      loadingFeed={loadingFeed}
      taskLoadError={taskLoadError}
      agentLoadError={agentLoadError}
      cycleLoadError={cycleLoadError}
      feedLoadError={feedLoadError}
      taskDetail={taskDetail}
      agentDetail={agentDetail}
      cycleDetail={cycleDetail}
      taskSentinelRef={taskSentinelRef}
      agentSentinelRef={agentSentinelRef}
      cycleSentinelRef={cycleSentinelRef}
      tab={tab}
      taskStatus={taskStatus}
      taskSort={taskSort}
      taskOrder={taskOrder}
      agentSort={agentSort}
      agentOrder={agentOrder}
      activeOnly={activeOnly}
      trendWindow={trendWindow}
      taskDetailId={taskDetailId}
      agentDetailAddress={agentDetailAddress}
      cycleDetailId={cycleDetailId}
      searchDraft={searchDraft}
      setSearchDraft={setSearchDraft}
      trendPublished={trendPublished}
      trendAccepted={trendAccepted}
      trendCompleted={trendCompleted}
      trendDisputes={trendDisputes}
      cycleUptime={cycleUptime}
      taskStatusCounts={taskStatusCounts}
      hasTaskFilters={hasTaskFilters}
      hasAgentFilters={hasAgentFilters}
      updateQuery={updateQuery}
      refreshAll={refreshAll}
      clearSearch={clearSearch}
      commitSearch={commitSearch}
      resetFilters={resetFilters}
      openTaskDetail={openTaskDetail}
      openAgentDetail={openAgentDetail}
      openCycleDetail={openCycleDetail}
      closeDetail={closeDetail}
      retryTaskDetail={retryTaskDetail}
      retryAgentDetail={retryAgentDetail}
      retryCycleDetail={retryCycleDetail}
      loadMoreTasks={() => void loadMoreTasks()}
      loadMoreAgents={() => void loadMoreAgents()}
      loadMoreCycles={() => void loadMoreCycles()}
      openByActivity={openByActivity}
    />
  );
};
