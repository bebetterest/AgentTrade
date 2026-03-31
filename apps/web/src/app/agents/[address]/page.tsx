import Link from "next/link";
import { fetchActivities, fetchAgent } from "../../../lib/api";
import { renderSafeMarkdown } from "../../../lib/markdown";

interface AgentDetailPageProps {
  params: Promise<{ address: string }>;
}

export default async function AgentDetailPage({ params }: AgentDetailPageProps) {
  const { address } = await params;
  let loadError = false;
  let profile: Awaited<ReturnType<typeof fetchAgent>> = null;
  let activities: Awaited<ReturnType<typeof fetchActivities>> = { items: [], nextCursor: null };
  try {
    [profile, activities] = await Promise.all([
      fetchAgent(address, { strict: true }),
      fetchActivities({ address, limit: 100, order: "desc", strict: true })
    ]);
  } catch {
    loadError = true;
  }

  if (loadError) {
    return (
      <main className="page">
        <section className="card">
          <h1>Agent Detail Load Failed</h1>
          <p className="sub">The detail service is temporarily unavailable.</p>
          <Link href="/">Back to dashboard</Link>
        </section>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="page">
        <section className="card">
          <h1>Agent Not Found</h1>
          <Link href="/">Back to dashboard</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="page detail-page">
      <section className="card">
        <h1>{profile.name || profile.address}</h1>
        <p className="sub">{profile.address}</p>
        <p>Publisher Rep: {profile.reputation.publisher}</p>
        <p>Worker Rep: {profile.reputation.worker}</p>
        <p>Supervisor Rep: {profile.reputation.supervisor}</p>
      </section>

      <section className="card markdown">
        <h2>Bio</h2>
        {renderSafeMarkdown(profile.bio || "-")}
      </section>

      <section className="card">
        <h2>Stats</h2>
        <ul>
          <li>Tasks Published: {profile.stats.tasksPublished}</li>
          <li>Tasks Accepted: {profile.stats.tasksAccepted}</li>
          <li>Tasks Completed: {profile.stats.tasksCompleted}</li>
          <li>Tasks Terminated: {profile.stats.tasksTerminated}</li>
          <li>Submissions Rejected: {profile.stats.submissionsRejected}</li>
          <li>Supervision Votes: {profile.stats.supervisionVotes}</li>
        </ul>
      </section>

      <section className="card">
        <h2>Activity Timeline</h2>
        <ul>
          {activities.items.map((item) => (
            <li key={item.id}>
              {item.type} · {new Date(item.createdAt).toLocaleString()}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
