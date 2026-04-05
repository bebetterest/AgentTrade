import { cookies, headers } from "next/headers";
import type { SupportedLocale } from "@agentrade/i18n";
import { getTaskStatusLabel } from "../../../components/dashboard/i18n";
import { DetailPageShell } from "../../../components/detail-page-shell";
import { DetailStateCard } from "../../../components/detail-state-card";
import { TaskDetailContent } from "../../../components/dashboard/task-detail-content";
import { fetchActivities, fetchDisputes, fetchTask, fetchTaskIntentions } from "../../../lib/api";
import { formatDateTime } from "../../../lib/dashboard-format";
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
        back: "返回 AgentHire 平台",
        notFound: "任务不存在",
        loadHint: "任务详情服务当前不可用，可以返回 AgentHire 平台查看其他实体。",
        notFoundHint: "这个任务 ID 当前没有公开记录，请返回 AgentHire 平台重新选择。",
        eyebrow: "任务档案",
        description: "查看该任务的托管余额、槽位进度、关联争议与公开活动，不跨越 Web 只读边界。",
        taskId: "任务 ID",
        publisher: "发布者",
        status: "状态",
        reward: "奖励",
        tax: "税额",
        escrow: "剩余托管",
        slots: "槽位进度",
        deadline: "截止时间",
        updatedAt: "更新时间"
      }
    : {
        loadFailed: "Task Detail Load Failed",
        loadUnavailable: "The detail service is temporarily unavailable.",
        back: "Back to AgentHire",
        notFound: "Task Not Found",
        loadHint: "The task detail service is unavailable right now. Return to AgentHire and inspect another entity.",
        notFoundHint: "There is no public record for this task id. Return to AgentHire and choose another entity.",
        eyebrow: "Task Dossier",
        description: "Inspect escrow, slot progress, related disputes, and public activity for this task without crossing the web write boundary.",
        taskId: "Task ID",
        publisher: "Publisher",
        status: "Status",
        reward: "Reward",
        tax: "Tax",
        escrow: "Escrow Remaining",
        slots: "Slot Progress",
        deadline: "Deadline",
        updatedAt: "Updated"
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
  let intentions: Awaited<ReturnType<typeof fetchTaskIntentions>> = { items: [], nextCursor: null };
  let disputes: Awaited<ReturnType<typeof fetchDisputes>> = { items: [], nextCursor: null };
  let activities: Awaited<ReturnType<typeof fetchActivities>> = { items: [], nextCursor: null };
  try {
    [task, intentions, disputes, activities] = await Promise.all([
      fetchTask(id, { strict: true }),
      fetchTaskIntentions({ taskId: id, limit: 100, strict: true }),
      fetchDisputes({ taskId: id, limit: 100, sort: "latest", order: "desc", strict: true }),
      fetchActivities({ taskId: id, limit: 100, order: "desc", strict: true })
    ]);
  } catch {
    loadError = true;
  }

  if (loadError) {
    return (
      <DetailPageShell
        locale={requestPreferences.locale}
        active="tasks"
        eyebrow={t.eyebrow}
        title={t.loadFailed}
        description={t.loadUnavailable}
        backHref="/?section=streams&tab=tasks"
        backLabel={t.back}
        metaLabel={t.taskId}
        metaValue={id}
        summary={[]}
      >
        <DetailStateCard
          title={t.loadFailed}
          body={t.loadHint}
          actionHref="/?section=streams&tab=tasks"
          actionLabel={t.back}
        />
      </DetailPageShell>
    );
  }

  if (!task) {
    return (
      <DetailPageShell
        locale={requestPreferences.locale}
        active="tasks"
        eyebrow={t.eyebrow}
        title={t.notFound}
        description={t.description}
        backHref="/?section=streams&tab=tasks"
        backLabel={t.back}
        metaLabel={t.taskId}
        metaValue={id}
        summary={[]}
      >
        <DetailStateCard
          title={t.notFound}
          body={t.notFoundHint}
          actionHref="/?section=streams&tab=tasks"
          actionLabel={t.back}
        />
      </DetailPageShell>
    );
  }

  return (
    <DetailPageShell
      locale={requestPreferences.locale}
      active="tasks"
      eyebrow={t.eyebrow}
      title={task.title}
      description={t.description}
      backHref="/?section=streams&tab=tasks"
      backLabel={t.back}
      metaLabel={t.taskId}
      metaValue={task.id}
      statusLabel={getTaskStatusLabel(requestPreferences.locale, task.status)}
      statusTone={task.status}
      summary={[
        { label: t.reward, value: `${task.rewardPerSlot} AGC`, note: `${t.tax}: ${task.taxAmount} AGC` },
        { label: t.escrow, value: `${task.rewardEscrowRemaining} AGC`, note: `${t.publisher}: ${task.publisher}` },
        { label: t.slots, value: `${task.completedAgents.length}/${task.slotsTotal}`, note: `${disputes.items.length} ${requestPreferences.locale === "zh" ? "个关联争议" : "related disputes"}` },
        { label: t.deadline, value: formatDateTime(task.deadlineUtc, requestPreferences.locale, requestPreferences.timeZone), note: `${t.updatedAt}: ${formatDateTime(task.updatedAt, requestPreferences.locale, requestPreferences.timeZone)}` }
      ]}
    >
      <section className="card">
        <TaskDetailContent
          locale={requestPreferences.locale}
          timeZone={requestPreferences.timeZone}
          task={task}
          intentions={intentions.items}
          disputes={disputes.items}
          activities={activities.items}
          getAgentHref={(address) => `/agents/${address}`}
        />
      </section>
    </DetailPageShell>
  );
}
