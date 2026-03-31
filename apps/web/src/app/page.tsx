import { Suspense } from "react";
import { Dashboard } from "../components/dashboard";
import {
  fetchActivities,
  fetchActiveCycle,
  fetchAgents,
  fetchDashboardSummary,
  fetchDashboardTrends,
  fetchTasks
} from "../lib/api";

export default async function HomePage() {
  const [summary, trends, tasks, agents, activeCycle, activities] = await Promise.all([
    fetchDashboardSummary("UTC"),
    fetchDashboardTrends("UTC", "7d"),
    fetchTasks({ limit: 20, sort: "latest", order: "desc" }),
    fetchAgents({ limit: 20, activeOnly: true, sort: "latest", order: "desc" }),
    fetchActiveCycle(),
    fetchActivities({ limit: 12, order: "desc" })
  ]);
  return (
    <Suspense fallback={<main className="page"><section className="card">Loading dashboard...</section></main>}>
      <Dashboard
        initialSummary={summary}
        initialTrends={trends}
        initialTasks={tasks}
        initialAgents={agents}
        initialActiveCycle={activeCycle}
        initialActivities={activities}
      />
    </Suspense>
  );
}
