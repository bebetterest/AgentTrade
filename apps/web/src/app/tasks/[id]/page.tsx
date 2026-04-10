import { cookies, headers } from "next/headers";
import type { SupportedLocale } from "@agentrade/i18n";
import { getTaskStatusLabel } from "../../../components/dashboard/i18n";
import { DetailPageShell } from "../../../components/detail-page-shell";
import { DetailStateCard } from "../../../components/detail-state-card";
import { TaskDetailContent } from "../../../components/dashboard/task-detail-content";
import { fetchActivities, fetchDisputes, fetchSubmissions, fetchTask, fetchTaskIntentions } from "../../../lib/api";
import { formatDateTime } from "../../../lib/dashboard-format";
import { getLoadErrorKind, withRateLimitMessage } from "../../../lib/load-error";
import { logWebLoadError } from "../../../lib/logging";
import {
  LOCALE_COOKIE_NAME,
  TIMEZONE_COOKIE_NAME,
  resolveRequestPreferences
} from "../../../lib/request-context";

interface TaskDetailPageProps {
  params: Promise<{ id: string }>;
}

const DETAIL_LIST_PAGE_SIZE = 20;

const copy = (locale: SupportedLocale) =>
  locale === "zh"
    ? {
        loadFailed: "任务详情加载失败",
        loadUnavailable: "详情服务暂时不可用。",
        back: "返回 Agentrade 平台",
        notFound: "任务不存在",
        loadHint: "任务详情服务当前不可用，可以返回 Agentrade 平台查看其他实体。",
        notFoundHint: "这个任务 ID 当前没有公开记录，请返回 Agentrade 平台重新选择。",
        eyebrow: "任务档案",
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
        back: "Back to Agentrade",
        notFound: "Task Not Found",
        loadHint: "The task detail service is unavailable right now. Return to Agentrade and inspect another entity.",
        notFoundHint: "There is no public record for this task id. Return to Agentrade and choose another entity.",
        eyebrow: "Task Dossier",
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
  let loadErrorKind: ReturnType<typeof getLoadErrorKind> | null = null;
  let task: Awaited<ReturnType<typeof fetchTask>> = null;
  let intentions: Awaited<ReturnType<typeof fetchTaskIntentions>> = { items: [], nextCursor: null };
  let submissions: Awaited<ReturnType<typeof fetchSubmissions>> = { items: [], nextCursor: null };
  let disputes: Awaited<ReturnType<typeof fetchDisputes>> = { items: [], nextCursor: null };
  let activities: Awaited<ReturnType<typeof fetchActivities>> = { items: [], nextCursor: null };
  try {
    task = await fetchTask(id, { strict: true });
    if (task) {
      const [intentionsRes, submissionsRes, disputesRes, activitiesRes] = await Promise.allSettled([
        fetchTaskIntentions({ taskId: id, limit: DETAIL_LIST_PAGE_SIZE, strict: true }),
        fetchSubmissions({ taskId: id, limit: DETAIL_LIST_PAGE_SIZE, sort: "latest", order: "desc", strict: true }),
        fetchDisputes({ taskId: id, limit: DETAIL_LIST_PAGE_SIZE, sort: "latest", order: "desc", strict: true }),
        fetchActivities({ taskId: id, limit: DETAIL_LIST_PAGE_SIZE, order: "desc", strict: true })
      ]);

      if (intentionsRes.status === "fulfilled") {
        intentions = intentionsRes.value;
      } else {
        logWebLoadError("task-detail:intentions", intentionsRes.reason, { taskId: id });
      }

      if (submissionsRes.status === "fulfilled") {
        submissions = submissionsRes.value;
      } else {
        logWebLoadError("task-detail:submissions", submissionsRes.reason, { taskId: id });
      }

      if (disputesRes.status === "fulfilled") {
        disputes = disputesRes.value;
      } else {
        logWebLoadError("task-detail:disputes", disputesRes.reason, { taskId: id });
      }

      if (activitiesRes.status === "fulfilled") {
        activities = activitiesRes.value;
      } else {
        logWebLoadError("task-detail:activities", activitiesRes.reason, { taskId: id });
      }
    }
  } catch (error) {
    logWebLoadError("task-detail:task", error, { taskId: id });
    loadError = true;
    loadErrorKind = getLoadErrorKind(error);
  }

  if (loadError) {
    const loadHint = withRateLimitMessage(requestPreferences.locale, t.loadHint, loadErrorKind);
    return (
      <DetailPageShell
        locale={requestPreferences.locale}
        active="tasks"
        eyebrow={t.eyebrow}
        title={t.loadFailed}
        backHref="/?section=streams&tab=tasks"
        backLabel={t.back}
        metaLabel={t.taskId}
        metaValue={id}
        summary={[]}
      >
        <DetailStateCard
          title={t.loadFailed}
          body={loadHint}
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

  const relatedDisputesCountLabel = disputes.nextCursor
    ? `${disputes.items.length}+`
    : String(disputes.items.length);

  return (
    <DetailPageShell
      locale={requestPreferences.locale}
      active="tasks"
      eyebrow={t.eyebrow}
      title={task.title}
      backHref="/?section=streams&tab=tasks"
      backLabel={t.back}
      metaLabel={t.taskId}
      metaValue={task.id}
      statusLabel={getTaskStatusLabel(requestPreferences.locale, task.status)}
      statusTone={task.status}
      summary={[
        { label: t.reward, value: `${task.rewardPerSlot} AGC`, note: `${t.tax}: ${task.taxAmount} AGC` },
        {
          label: t.escrow,
          value: `${task.rewardEscrowRemaining} AGC`,
          note: `${requestPreferences.locale === "zh" ? "托管总额" : "Escrow total"}: ${task.rewardPerSlot * task.slotsTotal} AGC`
        },
        {
          label: t.slots,
          value: `${task.completedAgents.length}/${task.slotsTotal}`,
          note:
            requestPreferences.locale === "zh"
              ? `${task.intentCount} 次意向 / ${relatedDisputesCountLabel} 个关联争议`
              : `${task.intentCount} intentions / ${relatedDisputesCountLabel} related disputes`
        },
        {
          label: t.deadline,
          value: formatDateTime(task.deadlineUtc, requestPreferences.locale, requestPreferences.timeZone),
          note: `${t.updatedAt}: ${formatDateTime(task.updatedAt, requestPreferences.locale, requestPreferences.timeZone)}`
        }
      ]}
    >
      <section className="card">
        <TaskDetailContent
          locale={requestPreferences.locale}
          timeZone={requestPreferences.timeZone}
          task={task}
          intentions={intentions.items}
          submissions={submissions.items}
          disputes={disputes.items}
          activities={activities.items}
          initialIntentionsCursor={intentions.nextCursor}
          initialSubmissionsCursor={submissions.nextCursor}
          initialDisputesCursor={disputes.nextCursor}
          initialActivitiesCursor={activities.nextCursor}
        />
      </section>
    </DetailPageShell>
  );
}
