import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { PublicHomeView } from "../components/public-home-view";
import { SiteHeader } from "../components/site-header";
import {
  fetchActivities,
  fetchActiveCycle,
  fetchAgents,
  fetchCycles,
  fetchDashboardSummary,
  fetchDashboardTrends,
  fetchDisputes,
  fetchEconomyParams,
  fetchHealthStatus,
  fetchTasks
} from "../lib/api";
import { hasLegacyDashboardQuery, toSearchParamsString } from "../lib/dashboard-route";
import {
  LOCALE_COOKIE_NAME,
  TIMEZONE_COOKIE_NAME,
  resolveRequestPreferences
} from "../lib/request-context";

interface HomePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const resolvedSearchParams = await searchParams;

  if (hasLegacyDashboardQuery(resolvedSearchParams)) {
    const query = toSearchParamsString(resolvedSearchParams);
    redirect(query.length > 0 ? `/center?${query}` : "/center");
  }

  const cookieStore = await cookies();
  const headerStore = await headers();
  const requestPreferences = resolveRequestPreferences({
    acceptLanguage: headerStore.get("accept-language") ?? undefined,
    localeCookie: cookieStore.get(LOCALE_COOKIE_NAME)?.value,
    timeZoneCookie: cookieStore.get(TIMEZONE_COOKIE_NAME)?.value
  });

  const [summary, trends, tasks, leaders, activeCycle, activities, cycles, disputes, economy, health] = await Promise.all([
    fetchDashboardSummary(requestPreferences.timeZone),
    fetchDashboardTrends(requestPreferences.timeZone, "7d"),
    fetchTasks({ limit: 4, sort: "latest", order: "desc" }),
    fetchAgents({ limit: 5, activeOnly: true, sort: "score", order: "desc" }),
    fetchActiveCycle(),
    fetchActivities({ limit: 6, order: "desc" }),
    fetchCycles({ limit: 4 }),
    fetchDisputes({ limit: 4, sort: "latest", order: "desc" }),
    fetchEconomyParams(),
    fetchHealthStatus()
  ]);

  return (
    <>
      <SiteHeader locale={requestPreferences.locale} active="home" />
      <PublicHomeView
        locale={requestPreferences.locale}
        timeZone={requestPreferences.timeZone}
        summary={summary}
        trends={trends}
        activeCycle={activeCycle}
        leaders={leaders.items}
        activities={activities}
        tasks={tasks}
        disputes={disputes}
        cycles={cycles}
        economy={economy}
        health={health}
      />
    </>
  );
}
