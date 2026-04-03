import Link from "next/link";
import { cookies, headers } from "next/headers";
import type { SupportedLocale } from "@agentrade/i18n";
import { fetchActivities, fetchDisputes, fetchTask } from "../../../lib/api";
import { formatDateTime, shortAddress } from "../../../lib/dashboard-format";
import { renderSafeMarkdown } from "../../../lib/markdown";
import {
  LOCALE_COOKIE_NAME,
  TIMEZONE_COOKIE_NAME,
  resolveRequestPreferences
} from "../../../lib/request-context";

interface TaskDetailPageProps {
  params: Promise<{ id: string }>;
}

const copy = (locale: SupportedLocale) =>
  locale === "zh"
    ? {
        loadFailed: "任务详情加载失败",
        loadUnavailable: "详情服务暂时不可用。",
        back: "返回看板",
        notFound: "任务不存在",
        taskId: "任务 ID",
        publisher: "发布者",
        reward: "奖励",
        tax: "税额",
        escrow: "剩余托管",
        slots: "槽位进度",
        acceptedAgents: "已接受 Agent",
        completedAgents: "已完成 Agent",
        none: "暂无",
        deadline: "截止时间",
        description: "任务说明",
        acceptanceCriteria: "验收标准",
        relatedDisputes: "关联争议",
        opener: "发起人",
        noDisputes: "暂无关联争议",
        timeline: "事件时间线",
        noActivity: "暂无事件"
      }
    : {
        loadFailed: "Task Detail Load Failed",
        loadUnavailable: "The detail service is temporarily unavailable.",
        back: "Back to dashboard",
        notFound: "Task Not Found",
        taskId: "Task ID",
        publisher: "Publisher",
        reward: "Reward",
        tax: "Tax",
        escrow: "Escrow Remaining",
        slots: "Slot Progress",
        acceptedAgents: "Accepted Agents",
        completedAgents: "Completed Agents",
        none: "None",
        deadline: "Deadline",
        description: "Description",
        acceptanceCriteria: "Acceptance Criteria",
        relatedDisputes: "Related Disputes",
        opener: "Opener",
        noDisputes: "No related disputes yet",
        timeline: "Activity Timeline",
        noActivity: "No activity yet"
      };

export default async function TaskDetailPage({ params }: TaskDetailPageProps) {
  const { id } = await params;
  const cookieStore = await cookies();
  const headerStore = await headers();
  const requestPreferences = resolveRequestPreferences({
    acceptLanguage: headerStore.get("accept-language") ?? undefined,
    localeCookie: cookieStore.get(LOCALE_COOKIE_NAME)?.value,
    timeZoneCookie: cookieStore.get(TIMEZONE_COOKIE_NAME)?.value
  });
  const t = copy(requestPreferences.locale);

  let loadError = false;
  let task: Awaited<ReturnType<typeof fetchTask>> = null;
  let disputes: Awaited<ReturnType<typeof fetchDisputes>> = { items: [], nextCursor: null };
  let activities: Awaited<ReturnType<typeof fetchActivities>> = { items: [], nextCursor: null };
  try {
    [task, disputes, activities] = await Promise.all([
      fetchTask(id, { strict: true }),
      fetchDisputes({ taskId: id, limit: 100, sort: "latest", order: "desc", strict: true }),
      fetchActivities({ taskId: id, limit: 100, order: "desc", strict: true })
    ]);
  } catch {
    loadError = true;
  }

  if (loadError) {
    return (
      <main className="page">
        <section className="card">
          <h1>{t.loadFailed}</h1>
          <p className="sub">{t.loadUnavailable}</p>
          <Link href="/">{t.back}</Link>
        </section>
      </main>
    );
  }

  if (!task) {
    return (
      <main className="page">
        <section className="card">
          <h1>{t.notFound}</h1>
          <Link href="/">{t.back}</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="page detail-page">
      <section className="card">
        <div className="card-actions">
          <span className="muted">
            {t.taskId}: {task.id}
          </span>
          <Link href="/">{t.back}</Link>
        </div>
        <h1>{task.title}</h1>
        <span className="state-chip">{task.status}</span>
        <div className="detail-grid">
          <div className="detail-card">
            <div className="metric-line">
              <span>{t.publisher}</span>
              <strong>
                <Link className="inline-link" href={`/agents/${task.publisher}`}>
                  {shortAddress(task.publisher)}
                </Link>
              </strong>
            </div>
            <div className="metric-line"><span>{t.reward}</span><strong>{task.rewardPerSlot} AGC</strong></div>
            <div className="metric-line"><span>{t.tax}</span><strong>{task.taxAmount} AGC</strong></div>
            <div className="metric-line"><span>{t.escrow}</span><strong>{task.rewardEscrowRemaining} AGC</strong></div>
            <div className="metric-line"><span>{t.slots}</span><strong>{task.completedAgents.length}/{task.slotsTotal}</strong></div>
            <div className="metric-line">
              <span>{t.deadline}</span>
              <strong>{formatDateTime(task.deadlineUtc, requestPreferences.locale, requestPreferences.timeZone)}</strong>
            </div>
          </div>
          <div className="detail-card">
            <h2>{t.acceptedAgents}</h2>
            {task.acceptedAgents.length > 0 ? (
              <div className="chip-list">
                {task.acceptedAgents.map((address) => (
                  <Link key={address} className="link-btn" href={`/agents/${address}`}>
                    {shortAddress(address)}
                  </Link>
                ))}
              </div>
            ) : (
              <p className="empty-line">{t.none}</p>
            )}
            <h2>{t.completedAgents}</h2>
            {task.completedAgents.length > 0 ? (
              <div className="chip-list">
                {task.completedAgents.map((address) => (
                  <Link key={address} className="link-btn" href={`/agents/${address}`}>
                    {shortAddress(address)}
                  </Link>
                ))}
              </div>
            ) : (
              <p className="empty-line">{t.none}</p>
            )}
          </div>
        </div>
      </section>

      <section className="card markdown">
        <h2>{t.description}</h2>
        {renderSafeMarkdown(task.descriptionMd)}
        <h2>{t.acceptanceCriteria}</h2>
        {renderSafeMarkdown(task.acceptanceCriteria)}
      </section>

      <section className="card">
        <h2>{t.relatedDisputes}</h2>
        {disputes.items.length > 0 ? (
          <ul className="detail-list">
            {disputes.items.map((item) => (
              <li key={item.id} className="detail-card">
                <div className="section-head compact-head">
                  <strong>{item.id}</strong>
                  <span className="state-chip">{item.status}</span>
                </div>
                <p className="muted">
                  {t.opener}:{" "}
                  <Link className="inline-link" href={`/agents/${item.opener}`}>
                    {shortAddress(item.opener)}
                  </Link>
                </p>
                <p>{item.reasonMd}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="sub">{t.noDisputes}</p>
        )}
      </section>

      <section className="card">
        <h2>{t.timeline}</h2>
        {activities.items.length > 0 ? (
          <ul className="detail-list">
            {activities.items.map((item) => (
              <li key={item.id} className="detail-list-row">
                <span>{item.type}</span>
                <strong>{formatDateTime(item.createdAt, requestPreferences.locale, requestPreferences.timeZone)}</strong>
              </li>
            ))}
          </ul>
        ) : (
          <p className="sub">{t.noActivity}</p>
        )}
      </section>
    </main>
  );
}
