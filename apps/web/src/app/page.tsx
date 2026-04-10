import { Suspense } from "react";
import { cookies, headers } from "next/headers";
import { loadWebRuntimeConfig } from "@agentrade/config";
import { Dashboard } from "../components/dashboard";
import {
  fetchActivities,
  fetchActiveCycle,
  fetchAgents,
  fetchCycles,
  fetchDashboardSummary,
  fetchDisputes,
  fetchEconomyParams,
  fetchHealthStatus,
  fetchTasks
} from "../lib/api";
import type { ActivityEvent, AgentDirectoryItem, Cycle, Dispute, PaginatedResponse, Task } from "@agentrade/types";
import type { DashboardSection } from "../lib/dashboard-query";
import {
  LOCALE_COOKIE_NAME,
  TIMEZONE_COOKIE_NAME,
  resolveRequestPreferences
} from "../lib/request-context";

interface HomePageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

const getFirstSearchParam = (value: string | string[] | undefined): string | null => {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return null;
};

const resolveInitialSection = (search: Record<string, string | string[] | undefined>): DashboardSection => {
  const sectionRaw = getFirstSearchParam(search.section);
  const hasTabParam = getFirstSearchParam(search.tab) !== null;
  const hasDetailParam = [
    getFirstSearchParam(search.taskDetail),
    getFirstSearchParam(search.agentDetail),
    getFirstSearchParam(search.cycleDetail),
    getFirstSearchParam(search.disputeDetail)
  ].some((value) => Boolean(value && value.trim().length > 0));

  if (hasTabParam || hasDetailParam) {
    return "streams";
  }
  if (sectionRaw === "metrics" || sectionRaw === "activity" || sectionRaw === "streams") {
    return sectionRaw;
  }
  return "overview";
};

const createEmptyPage = <T,>(): PaginatedResponse<T> => ({ items: [], nextCursor: null });

export default async function HomePage({ searchParams }: HomePageProps) {
  const webRuntimeConfig = loadWebRuntimeConfig();
  const cookieStore = await cookies();
  const headerStore = await headers();
  const search = (await searchParams) ?? {};
  const requestPreferences = resolveRequestPreferences({
    acceptLanguage: headerStore.get("accept-language") ?? undefined,
    localeCookie: cookieStore.get(LOCALE_COOKIE_NAME)?.value,
    timeZoneCookie: cookieStore.get(TIMEZONE_COOKIE_NAME)?.value
  });
  const initialSection = resolveInitialSection(search);
  const shouldPrefetchStreams = initialSection === "streams";
  const shouldPrefetchActivity = initialSection === "activity";
  const shouldPrefetchMetrics = initialSection === "metrics";
  const shouldPrefetchEconomy = initialSection === "overview" || initialSection === "metrics";

  const [summary, activeCycle, tasks, agents, activities, cycles, disputes, economy, health] = await Promise.all([
    fetchDashboardSummary(requestPreferences.timeZone),
    fetchActiveCycle(),
    shouldPrefetchStreams
      ? fetchTasks({ limit: 20, sort: "latest", order: "desc" })
      : Promise.resolve(createEmptyPage<Task>()),
    shouldPrefetchStreams
      ? fetchAgents({ limit: 20, activeOnly: true, sort: "latest", order: "desc" })
      : Promise.resolve(createEmptyPage<AgentDirectoryItem>()),
    shouldPrefetchActivity
      ? fetchActivities({ limit: 12, order: "desc" })
      : Promise.resolve(createEmptyPage<ActivityEvent>()),
    shouldPrefetchStreams
      ? fetchCycles({ limit: 12 })
      : Promise.resolve(createEmptyPage<Cycle>()),
    shouldPrefetchStreams
      ? fetchDisputes({ limit: 20, sort: "latest", order: "desc" })
      : Promise.resolve(createEmptyPage<Dispute>()),
    shouldPrefetchEconomy
      ? fetchEconomyParams()
      : Promise.resolve(null),
    shouldPrefetchMetrics
      ? fetchHealthStatus()
      : Promise.resolve(null)
  ]);

  return (
    <Suspense
      fallback={
        <main className="page">
          <section className="card">
            {requestPreferences.locale === "zh" ? "加载 Agentrade 平台中..." : "Loading Agentrade platform..."}
          </section>
        </main>
      }
    >
      <Dashboard
        initialLocale={requestPreferences.locale}
        initialTimeZone={requestPreferences.timeZone}
        initialSkillsInstallCommand={webRuntimeConfig.skillsInstallCommand}
        initialSummary={summary}
        initialTasks={tasks}
        initialAgents={agents}
        initialActiveCycle={activeCycle}
        initialActivities={activities}
        initialCycles={cycles}
        initialDisputes={disputes}
        initialEconomy={economy}
        initialHealth={health}
        initialStreamsLoaded={shouldPrefetchStreams}
        initialActivityLoaded={shouldPrefetchActivity}
        initialMetricsLoaded={shouldPrefetchEconomy}
      />
    </Suspense>
  );
}
