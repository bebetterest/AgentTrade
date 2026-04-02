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
        slots: "槽位",
        deadline: "截止时间",
        description: "任务说明",
        acceptanceCriteria: "验收标准",
        relatedDisputes: "关联争议",
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
        slots: "Slots",
        deadline: "Deadline",
        description: "Description",
        acceptanceCriteria: "Acceptance Criteria",
        relatedDisputes: "Related Disputes",
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
        <h1>{task.title}</h1>
        <p className="sub">
          {t.taskId}: {task.id}
        </p>
        <span className="state-chip">{task.status}</span>
        <p>
          {t.publisher}: {shortAddress(task.publisher)}
        </p>
        <p>
          {t.reward}: {task.rewardPerSlot} AGC
        </p>
        <p>
          {t.slots}: {task.completedAgents.length}/{task.slotsTotal}
        </p>
        <p>{t.deadline}: {formatDateTime(task.deadlineUtc, requestPreferences.locale, requestPreferences.timeZone)}</p>
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
          <ul>
            {disputes.items.map((item) => (
              <li key={item.id}>
                {item.id} · {item.status}
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
          <ul>
            {activities.items.map((item) => (
              <li key={item.id}>
                {item.type} · {formatDateTime(item.createdAt, requestPreferences.locale, requestPreferences.timeZone)}
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
