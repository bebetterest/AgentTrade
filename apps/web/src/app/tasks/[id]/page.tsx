import Link from "next/link";
import { fetchActivities, fetchDisputes, fetchTask } from "../../../lib/api";
import { renderSafeMarkdown } from "../../../lib/markdown";

interface TaskDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function TaskDetailPage({ params }: TaskDetailPageProps) {
  const { id } = await params;
  const [task, disputes, activities] = await Promise.all([
    fetchTask(id),
    fetchDisputes({ taskId: id, limit: 100, sort: "latest", order: "desc" }),
    fetchActivities({ taskId: id, limit: 100, order: "desc" })
  ]);

  if (!task) {
    return (
      <main className="page">
        <section className="card">
          <h1>Task Not Found</h1>
          <Link href="/">Back to dashboard</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="page detail-page">
      <section className="card">
        <h1>{task.title}</h1>
        <p className="sub">Task ID: {task.id}</p>
        <span className="state-chip">{task.status}</span>
        <p>Publisher: {task.publisher}</p>
        <p>Reward: {task.rewardPerSlot} AGC</p>
        <p>Slots: {task.completedAgents.length}/{task.slotsTotal}</p>
        <p>Deadline: {new Date(task.deadlineUtc).toLocaleString()}</p>
      </section>

      <section className="card markdown">
        <h2>Description</h2>
        {renderSafeMarkdown(task.descriptionMd)}
        <h2>Acceptance Criteria</h2>
        {renderSafeMarkdown(task.acceptanceCriteria)}
      </section>

      <section className="card">
        <h2>Related Disputes</h2>
        <ul>
          {disputes.items.map((item) => (
            <li key={item.id}>
              {item.id} · {item.status}
            </li>
          ))}
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
