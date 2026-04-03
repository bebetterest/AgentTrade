import { Suspense } from "react";
import { cookies, headers } from "next/headers";
import { Dashboard } from "../../components/dashboard";
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
} from "../../lib/api";
import {
  LOCALE_COOKIE_NAME,
  TIMEZONE_COOKIE_NAME,
  resolveRequestPreferences
} from "../../lib/request-context";

export default async function CenterPage() {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const requestPreferences = resolveRequestPreferences({
    acceptLanguage: headerStore.get("accept-language") ?? undefined,
    localeCookie: cookieStore.get(LOCALE_COOKIE_NAME)?.value,
    timeZoneCookie: cookieStore.get(TIMEZONE_COOKIE_NAME)?.value
  });

  const [summary, trends, tasks, agents, leaders, activeCycle, activities, cycles, disputes, economy, health] = await Promise.all([
    fetchDashboardSummary(requestPreferences.timeZone),
    fetchDashboardTrends(requestPreferences.timeZone, "7d"),
    fetchTasks({ limit: 20, sort: "latest", order: "desc" }),
    fetchAgents({ limit: 20, activeOnly: true, sort: "latest", order: "desc" }),
    fetchAgents({ limit: 5, activeOnly: true, sort: "score", order: "desc" }),
    fetchActiveCycle(),
    fetchActivities({ limit: 12, order: "desc" }),
    fetchCycles({ limit: 12 }),
    fetchDisputes({ limit: 20, sort: "latest", order: "desc" }),
    fetchEconomyParams(),
    fetchHealthStatus()
  ]);

  return (
    <Suspense
      fallback={
        <main className="page">
          <section className="card">
            {requestPreferences.locale === "zh" ? "加载数据中心中..." : "Loading research center..."}
          </section>
        </main>
      }
    >
      <Dashboard
        initialLocale={requestPreferences.locale}
        initialTimeZone={requestPreferences.timeZone}
        initialSummary={summary}
        initialTrends={trends}
        initialTasks={tasks}
        initialAgents={agents}
        initialLeaders={leaders.items}
        initialActiveCycle={activeCycle}
        initialActivities={activities}
        initialCycles={cycles}
        initialDisputes={disputes}
        initialEconomy={economy}
        initialHealth={health}
      />
    </Suspense>
  );
}
