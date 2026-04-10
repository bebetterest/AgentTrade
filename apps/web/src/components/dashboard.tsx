"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupportedLocale } from "@agentrade/i18n";
import type {
  ActivityEvent,
  AgentDirectoryItem,
  AgentProfile,
  Cycle,
  CycleRewardsResponse,
  DashboardSummaryResponse,
  Dispute,
  HealthStatus,
  LedgerBalance,
  PaginatedResponse,
  PublicEconomyParams,
  Task,
  TaskIntention
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
  fetchDispute,
  fetchDisputes,
  fetchEconomyParams,
  fetchHealthStatus,
  fetchLedger,
  fetchTask,
  fetchTaskIntentions,
  fetchTasks
} from "../lib/api";
import {
  DEFAULT_TIMEZONE,
  computeCycleRemainingMs,
  formatDuration,
  formatRemainingDuration
} from "../lib/dashboard-format";
import { parseDashboardQuery, sanitizeQueryPatch } from "../lib/dashboard-query";
import {
  filterAgentsBySearchFallback,
  filterDisputesBySearchFallback,
  filterTasksBySearchFallback
} from "../lib/dashboard-search";
import { getLoadErrorKind, pickLoadErrorKind, type LoadErrorKind } from "../lib/load-error";
import { TIMEZONE_COOKIE_NAME, buildPreferenceCookie } from "../lib/request-context";

interface DashboardProps {
  initialLocale: SupportedLocale;
  initialTimeZone: string;
  initialSkillsInstallCommand: string;
  initialSummary: DashboardSummaryResponse | null;
  initialTasks: PaginatedResponse<Task>;
  initialAgents: PaginatedResponse<AgentDirectoryItem>;
  initialActiveCycle: Cycle | null;
  initialActivities: PaginatedResponse<ActivityEvent>;
  initialCycles: PaginatedResponse<Cycle>;
  initialDisputes: PaginatedResponse<Dispute>;
  initialEconomy: PublicEconomyParams | null;
  initialHealth: HealthStatus | null;
  initialStreamsLoaded: boolean;
  initialActivityLoaded: boolean;
  initialMetricsLoaded: boolean;
}

const REFRESH_FEED_LIMIT = 12;
const TASK_STATUS_COUNT_PREFETCH_LIMIT = 100;

const buildTaskStatusCounts = (items: Task[]): Record<string, number> =>
  items.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  }, {});

export const Dashboard = ({
  initialLocale,
  initialTimeZone,
  initialSkillsInstallCommand,
  initialSummary,
  initialTasks,
  initialAgents,
  initialActiveCycle,
  initialActivities,
  initialCycles,
  initialDisputes,
  initialEconomy,
  initialHealth,
  initialStreamsLoaded,
  initialActivityLoaded,
  initialMetricsLoaded
}: DashboardProps) => {
  const [locale, setLocale] = useState<SupportedLocale>(initialLocale);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [timeZone, setTimeZone] = useState(initialTimeZone);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [summary, setSummary] = useState<DashboardSummaryResponse | null>(initialSummary);
  const [activeCycle, setActiveCycle] = useState<Cycle | null>(initialActiveCycle);
  const [activityFeed, setActivityFeed] = useState<ActivityEvent[]>(initialActivities.items.slice(0, REFRESH_FEED_LIMIT));
  const [economy, setEconomy] = useState<PublicEconomyParams | null>(initialEconomy);
  const [health, setHealth] = useState<HealthStatus | null>(initialHealth);
  const [streamsLoaded, setStreamsLoaded] = useState(initialStreamsLoaded);
  const [activityLoaded, setActivityLoaded] = useState(initialActivityLoaded);
  const [metricsLoaded, setMetricsLoaded] = useState(initialMetricsLoaded);

  const [tasksData, setTasksData] = useState<PaginatedResponse<Task>>(initialTasks);
  const [agentsData, setAgentsData] = useState<PaginatedResponse<AgentDirectoryItem>>(initialAgents);
  const [cyclesData, setCyclesData] = useState<PaginatedResponse<Cycle>>(initialCycles);
  const [disputesData, setDisputesData] = useState<PaginatedResponse<Dispute>>(initialDisputes);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [loadingCycles, setLoadingCycles] = useState(false);
  const [loadingDisputes, setLoadingDisputes] = useState(false);
  const [loadingMoreTasks, setLoadingMoreTasks] = useState(false);
  const [loadingMoreAgents, setLoadingMoreAgents] = useState(false);
  const [loadingMoreCycles, setLoadingMoreCycles] = useState(false);
  const [loadingMoreDisputes, setLoadingMoreDisputes] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [overviewError, setOverviewError] = useState(false);
  const [taskLoadError, setTaskLoadError] = useState(false);
  const [agentLoadError, setAgentLoadError] = useState(false);
  const [cycleLoadError, setCycleLoadError] = useState(false);
  const [disputeLoadError, setDisputeLoadError] = useState(false);
  const [feedLoadError, setFeedLoadError] = useState(false);
  const [overviewErrorKind, setOverviewErrorKind] = useState<LoadErrorKind | null>(null);
  const [taskLoadErrorKind, setTaskLoadErrorKind] = useState<LoadErrorKind | null>(null);
  const [agentLoadErrorKind, setAgentLoadErrorKind] = useState<LoadErrorKind | null>(null);
  const [cycleLoadErrorKind, setCycleLoadErrorKind] = useState<LoadErrorKind | null>(null);
  const [disputeLoadErrorKind, setDisputeLoadErrorKind] = useState<LoadErrorKind | null>(null);
  const [feedLoadErrorKind, setFeedLoadErrorKind] = useState<LoadErrorKind | null>(null);
  const [taskStatusCountSnapshot, setTaskStatusCountSnapshot] = useState<{
    scopeKey: string;
    allCount: number;
    counts: Record<string, number>;
  } | null>(() => ({
    scopeKey: "",
    allCount: initialTasks.items.length,
    counts: buildTaskStatusCounts(initialTasks.items)
  }));
  const [taskDetailReloadTick, setTaskDetailReloadTick] = useState(0);
  const [agentDetailReloadTick, setAgentDetailReloadTick] = useState(0);
  const [cycleDetailReloadTick, setCycleDetailReloadTick] = useState(0);
  const [disputeDetailReloadTick, setDisputeDetailReloadTick] = useState(0);

  const [taskDetail, setTaskDetail] = useState<{
    loading: boolean;
    error: boolean;
    errorKind: LoadErrorKind | null;
    task: Task | null;
    intentions: TaskIntention[];
    disputes: Dispute[];
    activities: ActivityEvent[];
  }>({
    loading: false,
    error: false,
    errorKind: null,
    task: null,
    intentions: [],
    disputes: [],
    activities: []
  });
  const [agentDetail, setAgentDetail] = useState<{
    loading: boolean;
    error: boolean;
    errorKind: LoadErrorKind | null;
    profile: AgentProfile | null;
    ledger: LedgerBalance | null;
    activities: ActivityEvent[];
  }>({
    loading: false,
    error: false,
    errorKind: null,
    profile: null,
    ledger: null,
    activities: []
  });
  const [cycleDetail, setCycleDetail] = useState<{
    loading: boolean;
    error: boolean;
    errorKind: LoadErrorKind | null;
    rewards: CycleRewardsResponse | null;
    disputes: Dispute[];
  }>({
    loading: false,
    error: false,
    errorKind: null,
    rewards: null,
    disputes: []
  });
  const [disputeDetail, setDisputeDetail] = useState<{
    loading: boolean;
    error: boolean;
    errorKind: LoadErrorKind | null;
    dispute: Dispute | null;
    task: Task | null;
    activities: ActivityEvent[];
  }>({
    loading: false,
    error: false,
    errorKind: null,
    dispute: null,
    task: null,
    activities: []
  });

  const taskSentinelRef = useRef<HTMLDivElement | null>(null);
  const agentSentinelRef = useRef<HTMLDivElement | null>(null);
  const cycleSentinelRef = useRef<HTMLDivElement | null>(null);
  const disputeSentinelRef = useRef<HTMLDivElement | null>(null);
  const taskQueryKeyRef = useRef("");
  const agentQueryKeyRef = useRef("");
  const disputeQueryKeyRef = useRef("");

  const {
    section,
    tab,
    q,
    taskStatus,
    taskSort,
    taskOrder,
    agentSort,
    agentOrder,
    disputeStatus,
    disputeSort,
    disputeOrder,
    activeOnly,
    taskDetailId,
    agentDetailAddress,
    cycleDetailId,
    disputeDetailId
  } = useMemo(() => parseDashboardQuery(searchParams), [searchParams]);
  const [searchDraft, setSearchDraft] = useState(q);

  const taskQueryKey = `${q}|${taskStatus ?? ""}|${taskSort}|${taskOrder}`;
  const agentQueryKey = `${q}|${activeOnly}|${agentSort}|${agentOrder}`;
  const disputeQueryKey = `${q}|${disputeStatus ?? ""}|${disputeSort}|${disputeOrder}`;
  const taskCountScopeKey = q.trim().toLowerCase();
  taskQueryKeyRef.current = taskQueryKey;
  agentQueryKeyRef.current = agentQueryKey;
  disputeQueryKeyRef.current = disputeQueryKey;

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

  const applyOverviewSettled = useCallback((
    summaryRes: PromiseSettledResult<DashboardSummaryResponse | null>,
    cycleRes: PromiseSettledResult<Cycle | null>
  ) => {
    const anyFulfilled =
      summaryRes.status === "fulfilled" ||
      cycleRes.status === "fulfilled";

    if (summaryRes.status === "fulfilled") {
      setSummary(summaryRes.value);
    }
    if (cycleRes.status === "fulfilled") {
      setActiveCycle(cycleRes.value);
    }

    if (anyFulfilled) {
      setOverviewError(false);
      setOverviewErrorKind(null);
      return;
    }

    const reasons = [summaryRes, cycleRes]
      .flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
    setOverviewError(true);
    setOverviewErrorKind(pickLoadErrorKind(reasons));
  }, []);

  const openTaskDetail = useCallback((taskId: string) => {
    router.push(`/tasks/${taskId}`);
  }, [router]);

  const openAgentDetail = useCallback((address: string) => {
    router.push(`/agents/${address}`);
  }, [router]);

  const openCycleDetail = useCallback((cycleId: string) => {
    router.push(`/cycles/${cycleId}`);
  }, [router]);

  const openDisputeDetail = useCallback((disputeId: string) => {
    router.push(`/disputes/${disputeId}`);
  }, [router]);

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

  const retryDisputeDetail = () => {
    if (disputeDetailId) {
      setDisputeDetailReloadTick((prev) => prev + 1);
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
    } catch (error) {
      setTaskLoadError(true);
      setTaskLoadErrorKind(getLoadErrorKind(error));
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
    } catch (error) {
      setAgentLoadError(true);
      setAgentLoadErrorKind(getLoadErrorKind(error));
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
    } catch (error) {
      setCycleLoadError(true);
      setCycleLoadErrorKind(getLoadErrorKind(error));
    } finally {
      setLoadingMoreCycles(false);
    }
  }, [cyclesData.nextCursor, loadingMoreCycles]);

  const loadMoreDisputes = useCallback(async () => {
    if (!disputesData.nextCursor || loadingMoreDisputes) {
      return;
    }
    const expectedQueryKey = disputeQueryKey;
    setLoadingMoreDisputes(true);
    try {
      const response = await fetchDisputes({
        q: q || undefined,
        status: disputeStatus ?? undefined,
        sort: disputeSort,
        order: disputeOrder,
        cursor: disputesData.nextCursor ?? undefined,
        limit: 20,
        strict: true
      });
      if (disputeQueryKeyRef.current !== expectedQueryKey) {
        return;
      }
      setDisputeLoadError(false);
      setDisputesData((prev) => ({
        items: [
          ...prev.items,
          ...response.items.filter((item) => !prev.items.some((prevItem) => prevItem.id === item.id))
        ],
        nextCursor: response.nextCursor
      }));
    } catch (error) {
      setDisputeLoadError(true);
      setDisputeLoadErrorKind(getLoadErrorKind(error));
    } finally {
      setLoadingMoreDisputes(false);
    }
  }, [disputeOrder, disputeQueryKey, disputeSort, disputeStatus, disputesData.nextCursor, loadingMoreDisputes, q]);

  const refreshAll = async () => {
    setRefreshing(true);
    try {
      const overviewPromise = Promise.allSettled([
        fetchDashboardSummary(timeZone, { strict: true }),
        fetchActiveCycle()
      ]);

      const streamsPromise = streamsLoaded
        ? Promise.allSettled([
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
            fetchDisputes({
              q: q || undefined,
              status: disputeStatus ?? undefined,
              sort: disputeSort,
              order: disputeOrder,
              limit: 20,
              strict: true
            })
          ])
        : Promise.resolve(null);

      const activityPromise = activityLoaded
        ? Promise.allSettled([
            fetchActivities({ limit: REFRESH_FEED_LIMIT, order: "desc" })
          ])
        : Promise.resolve(null);

      const metricsPromise = metricsLoaded
        ? Promise.allSettled([
            fetchEconomyParams({ strict: true }),
            fetchHealthStatus({ strict: true })
          ])
        : Promise.resolve(null);

      const [overviewResults, streamsResults, activityResults, metricsResults] = await Promise.all([
        overviewPromise,
        streamsPromise,
        activityPromise,
        metricsPromise
      ]);

      const [summaryRes, cycleRes] = overviewResults;
      applyOverviewSettled(summaryRes, cycleRes);

      if (streamsResults) {
        const [tasksRes, agentsRes, cyclesRes, disputesRes] = streamsResults;
        if (tasksRes.status === "fulfilled") {
          setTaskLoadError(false);
          setTaskLoadErrorKind(null);
          setTasksData(tasksRes.value);
        } else {
          setTaskLoadError(true);
          setTaskLoadErrorKind(getLoadErrorKind(tasksRes.reason));
        }

        if (agentsRes.status === "fulfilled") {
          setAgentLoadError(false);
          setAgentLoadErrorKind(null);
          setAgentsData(agentsRes.value);
        } else {
          setAgentLoadError(true);
          setAgentLoadErrorKind(getLoadErrorKind(agentsRes.reason));
        }

        if (cyclesRes.status === "fulfilled") {
          setCycleLoadError(false);
          setCycleLoadErrorKind(null);
          setCyclesData(cyclesRes.value);
        } else {
          setCycleLoadError(true);
          setCycleLoadErrorKind(getLoadErrorKind(cyclesRes.reason));
        }

        if (disputesRes.status === "fulfilled") {
          setDisputeLoadError(false);
          setDisputeLoadErrorKind(null);
          setDisputesData(disputesRes.value);
        } else {
          setDisputeLoadError(true);
          setDisputeLoadErrorKind(getLoadErrorKind(disputesRes.reason));
        }
      }

      if (activityResults) {
        const [feedRes] = activityResults;
        if (feedRes.status === "fulfilled") {
          setFeedLoadError(false);
          setFeedLoadErrorKind(null);
          setActivityFeed(feedRes.value.items);
        } else {
          setFeedLoadError(true);
          setFeedLoadErrorKind(getLoadErrorKind(feedRes.reason));
        }
      }

      if (metricsResults) {
        const [economyRes, healthRes] = metricsResults;
        if (economyRes.status === "fulfilled") {
          setEconomy(economyRes.value);
        }

        if (healthRes.status === "fulfilled") {
          setHealth(healthRes.value);
        }
      }
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    const detectedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE;
    document.cookie = buildPreferenceCookie(TIMEZONE_COOKIE_NAME, detectedTimeZone);
    if (detectedTimeZone !== initialTimeZone) {
      setTimeZone(detectedTimeZone);
    }
  }, [initialTimeZone]);

  useEffect(() => {
    setSearchDraft(q);
  }, [q]);

  useEffect(() => {
    if (section === "streams") {
      setStreamsLoaded(true);
      return;
    }
    if (section === "activity") {
      setActivityLoaded(true);
      return;
    }
    if (section === "metrics") {
      setMetricsLoaded(true);
    }
  }, [section]);

  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 60_000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (taskDetailId) {
      router.replace(`/tasks/${taskDetailId}`);
      return;
    }
    if (agentDetailAddress) {
      router.replace(`/agents/${agentDetailAddress}`);
      return;
    }
    if (cycleDetailId) {
      router.replace(`/cycles/${cycleDetailId}`);
      return;
    }
    if (disputeDetailId) {
      router.replace(`/disputes/${disputeDetailId}`);
    }
  }, [taskDetailId, agentDetailAddress, cycleDetailId, disputeDetailId, router]);

  useEffect(() => {
    if (!timeZone) {
      return;
    }
    let cancelled = false;
    (async () => {
      const [summaryRes, cycleRes] = await Promise.allSettled([
        fetchDashboardSummary(timeZone, { strict: true }),
        fetchActiveCycle()
      ]);
      if (cancelled) {
        return;
      }
      applyOverviewSettled(summaryRes, cycleRes);
    })();
    return () => {
      cancelled = true;
    };
  }, [timeZone, applyOverviewSettled]);

  useEffect(() => {
    if (!activityLoaded) {
      return;
    }
    let cancelled = false;
    setLoadingFeed(true);
    setFeedLoadError(false);
    setFeedLoadErrorKind(null);
    const controller = new AbortController();
    fetchActivities({
      limit: REFRESH_FEED_LIMIT,
      order: "desc",
      signal: controller.signal
    }).then((response) => {
      if (!cancelled) {
        setFeedLoadError(false);
        setFeedLoadErrorKind(null);
        setActivityFeed(response.items);
        setLoadingFeed(false);
      }
    }).catch((error) => {
      if (!cancelled) {
        setFeedLoadError(true);
        setFeedLoadErrorKind(getLoadErrorKind(error));
        setLoadingFeed(false);
      }
    });
    return () => {
      cancelled = true;
      controller.abort();
      setLoadingFeed(false);
    };
  }, [activityLoaded]);

  useEffect(() => {
    if (!metricsLoaded) {
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    Promise.allSettled([
      fetchEconomyParams({ signal: controller.signal, strict: true }),
      fetchHealthStatus({ signal: controller.signal, strict: true })
    ]).then(([economyRes, healthRes]) => {
      if (cancelled) {
        return;
      }
      if (economyRes.status === "fulfilled") {
        setEconomy(economyRes.value);
      }
      if (healthRes.status === "fulfilled") {
        setHealth(healthRes.value);
      }
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [metricsLoaded]);

  useEffect(() => {
    if (!streamsLoaded) {
      return;
    }
    let cancelled = false;
    setLoadingTasks(true);
    setTaskLoadError(false);
    setTaskLoadErrorKind(null);
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
    }).catch((error) => {
      if (!cancelled) {
        setTaskLoadError(true);
        setTaskLoadErrorKind(getLoadErrorKind(error));
        setLoadingTasks(false);
      }
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [taskQueryKey, streamsLoaded]);

  useEffect(() => {
    if (!streamsLoaded) {
      return;
    }
    let cancelled = false;
    setLoadingAgents(true);
    setAgentLoadError(false);
    setAgentLoadErrorKind(null);
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
    }).catch((error) => {
      if (!cancelled) {
        setAgentLoadError(true);
        setAgentLoadErrorKind(getLoadErrorKind(error));
        setLoadingAgents(false);
      }
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [agentQueryKey, streamsLoaded]);

  useEffect(() => {
    if (!streamsLoaded) {
      return;
    }
    let cancelled = false;
    setLoadingDisputes(true);
    setDisputeLoadError(false);
    setDisputeLoadErrorKind(null);
    const controller = new AbortController();
    fetchDisputes({
      q: q || undefined,
      status: disputeStatus ?? undefined,
      sort: disputeSort,
      order: disputeOrder,
      limit: 20,
      signal: controller.signal,
      strict: true
    }).then((response) => {
      if (!cancelled) {
        setDisputesData(response);
        setLoadingDisputes(false);
      }
    }).catch((error) => {
      if (!cancelled) {
        setDisputeLoadError(true);
        setDisputeLoadErrorKind(getLoadErrorKind(error));
        setLoadingDisputes(false);
      }
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [disputeQueryKey, streamsLoaded]);

  useEffect(() => {
    if (!streamsLoaded) {
      return;
    }
    let cancelled = false;
    setLoadingCycles(true);
    setCycleLoadError(false);
    setCycleLoadErrorKind(null);
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
    }).catch((error) => {
      if (!cancelled) {
        setCycleLoadError(true);
        setCycleLoadErrorKind(getLoadErrorKind(error));
        setLoadingCycles(false);
      }
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [streamsLoaded]);

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
    if (tab !== "disputes" || !disputesData.nextCursor || loadingMoreDisputes) {
      return;
    }
    const target = disputeSentinelRef.current;
    if (!target) {
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      const first = entries[0];
      if (!first?.isIntersecting || !disputesData.nextCursor) {
        return;
      }
      void loadMoreDisputes();
    });
    observer.observe(target);
    return () => {
      observer.disconnect();
    };
  }, [tab, disputesData.nextCursor, loadingMoreDisputes, loadMoreDisputes]);

  useEffect(() => {
    if (!taskDetailId) {
      setTaskDetail({ loading: false, error: false, errorKind: null, task: null, intentions: [], disputes: [], activities: [] });
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setTaskDetail((prev) => ({ ...prev, loading: true, error: false, errorKind: null }));
    Promise.all([
      fetchTask(taskDetailId, { signal: controller.signal, strict: true }),
      fetchTaskIntentions({ taskId: taskDetailId, limit: 100, signal: controller.signal, strict: true }),
      fetchDisputes({ taskId: taskDetailId, limit: 50, signal: controller.signal, strict: true }),
      fetchActivities({ taskId: taskDetailId, limit: 50, order: "desc", signal: controller.signal, strict: true })
    ]).then(([task, intentions, disputes, activities]) => {
      if (cancelled) {
        return;
      }
      setTaskDetail({
        loading: false,
        error: false,
        errorKind: null,
        task,
        intentions: intentions.items,
        disputes: disputes.items,
        activities: activities.items
      });
    }).catch((error) => {
      if (!cancelled) {
        setTaskDetail((prev) => ({ ...prev, loading: false, error: true, errorKind: getLoadErrorKind(error) }));
      }
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [taskDetailId, taskDetailReloadTick]);

  useEffect(() => {
    if (!agentDetailAddress) {
      setAgentDetail({ loading: false, error: false, errorKind: null, profile: null, ledger: null, activities: [] });
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setAgentDetail((prev) => ({ ...prev, loading: true, error: false, errorKind: null }));
    Promise.all([
      fetchAgent(agentDetailAddress, { signal: controller.signal, strict: true }),
      fetchLedger(agentDetailAddress, { signal: controller.signal, strict: true }),
      fetchActivities({ address: agentDetailAddress, limit: 50, order: "desc", signal: controller.signal, strict: true })
    ]).then(([profile, ledger, activities]) => {
      if (cancelled) {
        return;
      }
      setAgentDetail({
        loading: false,
        error: false,
        errorKind: null,
        profile,
        ledger,
        activities: activities.items
      });
    }).catch((error) => {
      if (!cancelled) {
        setAgentDetail((prev) => ({ ...prev, loading: false, error: true, errorKind: getLoadErrorKind(error) }));
      }
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [agentDetailAddress, agentDetailReloadTick]);

  useEffect(() => {
    if (!cycleDetailId) {
      setCycleDetail({ loading: false, error: false, errorKind: null, rewards: null, disputes: [] });
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setCycleDetail((prev) => ({ ...prev, loading: true, error: false, errorKind: null }));
    (async () => {
      try {
        const rewards = await fetchCycleRewards(cycleDetailId, { signal: controller.signal, strict: true });
        if (cancelled) {
          return;
        }
        if (!rewards) {
          setCycleDetail({ loading: false, error: false, errorKind: null, rewards: null, disputes: [] });
          return;
        }
        const disputeIds = [
          ...new Set(
            rewards.workloads
              .map((item) => item.disputeId)
              .filter((item): item is string => Boolean(item))
          )
        ];
        const disputeItems = await Promise.all(
          disputeIds.map((id) => fetchDispute(id, { signal: controller.signal, strict: true }))
        );
        if (cancelled) {
          return;
        }
        setCycleDetail({
          loading: false,
          error: false,
          errorKind: null,
          rewards,
          disputes: disputeItems.filter((item): item is Dispute => Boolean(item))
        });
      } catch (error) {
        if (!cancelled) {
          setCycleDetail((prev) => ({ ...prev, loading: false, error: true, errorKind: getLoadErrorKind(error) }));
        }
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [cycleDetailId, cycleDetailReloadTick]);

  useEffect(() => {
    if (!disputeDetailId) {
      setDisputeDetail({ loading: false, error: false, errorKind: null, dispute: null, task: null, activities: [] });
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setDisputeDetail((prev) => ({ ...prev, loading: true, error: false, errorKind: null }));
    (async () => {
      try {
        const dispute = await fetchDispute(disputeDetailId, { signal: controller.signal, strict: true });
        if (cancelled) {
          return;
        }
        if (!dispute) {
          setDisputeDetail({ loading: false, error: false, errorKind: null, dispute: null, task: null, activities: [] });
          return;
        }
        const [task, activities] = await Promise.all([
          fetchTask(dispute.taskId, { signal: controller.signal, strict: true }),
          fetchActivities({ disputeId: dispute.id, limit: 50, order: "desc", signal: controller.signal, strict: true })
        ]);
        if (cancelled) {
          return;
        }
        setDisputeDetail({
          loading: false,
          error: false,
          errorKind: null,
          dispute,
          task,
          activities: activities.items
        });
      } catch (error) {
        if (!cancelled) {
          setDisputeDetail((prev) => ({ ...prev, loading: false, error: true, errorKind: getLoadErrorKind(error) }));
        }
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [disputeDetailId, disputeDetailReloadTick]);

  const visibleTasks = useMemo(
    () => filterTasksBySearchFallback(tasksData.items, q),
    [tasksData.items, q]
  );
  const visibleAgents = useMemo(
    () => filterAgentsBySearchFallback(agentsData.items, q),
    [agentsData.items, q]
  );
  const visibleDisputes = useMemo(
    () => filterDisputesBySearchFallback(disputesData.items, q),
    [disputesData.items, q]
  );
  const visibleTasksData = useMemo(
    () => ({ ...tasksData, items: visibleTasks }),
    [tasksData, visibleTasks]
  );
  const visibleAgentsData = useMemo(
    () => ({ ...agentsData, items: visibleAgents }),
    [agentsData, visibleAgents]
  );
  const visibleDisputesData = useMemo(
    () => ({ ...disputesData, items: visibleDisputes }),
    [disputesData, visibleDisputes]
  );

  useEffect(() => {
    if (!streamsLoaded || taskStatus === null) {
      return;
    }
    if (taskStatusCountSnapshot?.scopeKey === taskCountScopeKey) {
      return;
    }
    const counts = buildTaskStatusCounts(visibleTasks);
    const allCount = visibleTasks.length;
    const selectedCount = counts[taskStatus] ?? 0;
    if (allCount <= selectedCount) {
      return;
    }
    setTaskStatusCountSnapshot({
      scopeKey: taskCountScopeKey,
      allCount,
      counts
    });
  }, [streamsLoaded, taskStatus, taskStatusCountSnapshot?.scopeKey, taskCountScopeKey, visibleTasks]);

  useEffect(() => {
    if (!streamsLoaded || taskStatus !== null) {
      return;
    }
    setTaskStatusCountSnapshot({
      scopeKey: taskCountScopeKey,
      allCount: visibleTasks.length,
      counts: buildTaskStatusCounts(visibleTasks)
    });
  }, [streamsLoaded, taskStatus, taskCountScopeKey, visibleTasks]);

  useEffect(() => {
    if (!streamsLoaded || taskStatus === null) {
      return;
    }
    if (taskStatusCountSnapshot?.scopeKey === taskCountScopeKey) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    fetchTasks({
      q: q || undefined,
      limit: TASK_STATUS_COUNT_PREFETCH_LIMIT,
      signal: controller.signal,
      strict: true
    }).then((response) => {
      if (cancelled) {
        return;
      }
      const scopedTasks = filterTasksBySearchFallback(response.items, q);
      setTaskStatusCountSnapshot({
        scopeKey: taskCountScopeKey,
        allCount: scopedTasks.length,
        counts: buildTaskStatusCounts(scopedTasks)
      });
    }).catch(() => {
      if (!cancelled) {
        setTaskStatusCountSnapshot((prev) => (prev?.scopeKey === taskCountScopeKey ? prev : null));
      }
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [streamsLoaded, taskStatus, taskCountScopeKey, taskStatusCountSnapshot?.scopeKey, q]);

  const cycleUptime = useMemo(() => {
    if (!activeCycle) {
      return "-";
    }
    return formatDuration(nowMs - new Date(activeCycle.startedAt).getTime(), locale);
  }, [activeCycle, nowMs, locale]);
  const cycleRemaining = useMemo(() => {
    if (!activeCycle || activeCycle.status !== "OPEN") {
      return "-";
    }
    const remainingMs = computeCycleRemainingMs(activeCycle.startedAt, economy?.cycleDurationHours, nowMs);
    return formatRemainingDuration(remainingMs, locale);
  }, [activeCycle, economy?.cycleDurationHours, nowMs, locale]);
  const currentTaskStatusCounts = useMemo(
    () => buildTaskStatusCounts(visibleTasks),
    [visibleTasks]
  );
  const canUseTaskStatusSnapshot = taskStatusCountSnapshot?.scopeKey === taskCountScopeKey;
  const taskStatusCounts = canUseTaskStatusSnapshot
    ? taskStatusCountSnapshot.counts
    : currentTaskStatusCounts;
  const taskAllCount = canUseTaskStatusSnapshot
    ? taskStatusCountSnapshot.allCount
    : visibleTasks.length;
  const disputeStatusCounts = useMemo(() => visibleDisputes.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  }, {}), [visibleDisputes]);
  const hasTaskFilters = q.trim().length > 0 || Boolean(taskStatus);
  const hasAgentFilters = q.trim().length > 0 || !activeOnly;
  const hasDisputeFilters = q.trim().length > 0 || Boolean(disputeStatus);

  const clearSearch = () => {
    setSearchDraft("");
    updateQuery({ q: null });
  };

  const commitSearch = () => {
    updateQuery({ q: searchDraft });
  };

  const resetFilters = () => {
    if (tab === "tasks") {
      updateQuery({ q: null, taskStatus: null, taskSort: "latest", taskOrder: "desc" });
      return;
    }
    if (tab === "users") {
      updateQuery({ q: null, activeOnly: "true", agentSort: "latest", agentOrder: "desc" });
      return;
    }
    if (tab === "disputes") {
      updateQuery({ q: null, disputeStatus: null, disputeSort: "latest", disputeOrder: "desc" });
    }
  };

  const openByActivity = (item: ActivityEvent) => {
    if (item.disputeId) {
      openDisputeDetail(item.disputeId);
      return;
    }
    if (item.taskId) {
      openTaskDetail(item.taskId);
      return;
    }
    openAgentDetail(item.actor);
  };

  return (
    <DashboardView
      locale={locale}
      setLocale={setLocale}
      skillsInstallCommand={initialSkillsInstallCommand}
      timeZone={timeZone}
      refreshing={refreshing}
      overviewError={overviewError}
      overviewErrorKind={overviewErrorKind}
      summary={summary}
      activeCycle={activeCycle}
      activityFeed={activityFeed}
      tasksData={visibleTasksData}
      agentsData={visibleAgentsData}
      cyclesData={cyclesData}
      disputesData={visibleDisputesData}
      economy={economy}
      cycleDurationHours={economy?.cycleDurationHours ?? null}
      health={health}
      loadingTasks={loadingTasks}
      loadingAgents={loadingAgents}
      loadingCycles={loadingCycles}
      loadingDisputes={loadingDisputes}
      loadingMoreTasks={loadingMoreTasks}
      loadingMoreAgents={loadingMoreAgents}
      loadingMoreCycles={loadingMoreCycles}
      loadingMoreDisputes={loadingMoreDisputes}
      loadingFeed={loadingFeed}
      taskLoadError={taskLoadError}
      taskLoadErrorKind={taskLoadErrorKind}
      agentLoadError={agentLoadError}
      agentLoadErrorKind={agentLoadErrorKind}
      cycleLoadError={cycleLoadError}
      cycleLoadErrorKind={cycleLoadErrorKind}
      disputeLoadError={disputeLoadError}
      disputeLoadErrorKind={disputeLoadErrorKind}
      feedLoadError={feedLoadError}
      feedLoadErrorKind={feedLoadErrorKind}
      taskSentinelRef={taskSentinelRef}
      agentSentinelRef={agentSentinelRef}
      cycleSentinelRef={cycleSentinelRef}
      disputeSentinelRef={disputeSentinelRef}
      section={section}
      tab={tab}
      taskStatus={taskStatus}
      taskSort={taskSort}
      taskOrder={taskOrder}
      agentSort={agentSort}
      agentOrder={agentOrder}
      disputeStatus={disputeStatus}
      disputeSort={disputeSort}
      disputeOrder={disputeOrder}
      activeOnly={activeOnly}
      taskAllCount={taskAllCount}
      searchDraft={searchDraft}
      setSearchDraft={setSearchDraft}
      cycleUptime={cycleUptime}
      cycleRemaining={cycleRemaining}
      taskStatusCounts={taskStatusCounts}
      disputeStatusCounts={disputeStatusCounts}
      hasTaskFilters={hasTaskFilters}
      hasAgentFilters={hasAgentFilters}
      hasDisputeFilters={hasDisputeFilters}
      updateQuery={updateQuery}
      refreshAll={refreshAll}
      clearSearch={clearSearch}
      commitSearch={commitSearch}
      resetFilters={resetFilters}
      openTaskDetail={openTaskDetail}
      openAgentDetail={openAgentDetail}
      openCycleDetail={openCycleDetail}
      openDisputeDetail={openDisputeDetail}
      loadMoreTasks={() => void loadMoreTasks()}
      loadMoreAgents={() => void loadMoreAgents()}
      loadMoreCycles={() => void loadMoreCycles()}
      loadMoreDisputes={() => void loadMoreDisputes()}
      openByActivity={openByActivity}
    />
  );
};
