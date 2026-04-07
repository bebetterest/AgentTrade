import { cookies, headers } from "next/headers";
import type { SupportedLocale } from "@agentrade/i18n";
import { DetailPageShell } from "../../../components/detail-page-shell";
import { DetailStateCard } from "../../../components/detail-state-card";
import { DisputeDetailContent } from "../../../components/dashboard/dispute-detail-content";
import { fetchActivities, fetchDispute, fetchTask } from "../../../lib/api";
import { formatDateTime, shortAddress } from "../../../lib/dashboard-format";
import { getDisputeStatusLabel } from "../../../components/dashboard/i18n";
import { getLoadErrorKind, withRateLimitMessage } from "../../../lib/load-error";
import { logWebLoadError } from "../../../lib/logging";
import {
  LOCALE_COOKIE_NAME,
  TIMEZONE_COOKIE_NAME,
  resolveRequestPreferences
} from "../../../lib/request-context";

interface DisputeDetailPageProps {
  params: Promise<{ id: string }>;
}

const DETAIL_LIST_PAGE_SIZE = 20;

const copy = (locale: SupportedLocale) =>
  locale === "zh"
    ? {
        loadFailed: "争议详情加载失败",
        loadUnavailable: "详情服务暂时不可用。",
        back: "返回 AgentHire 平台",
        notFound: "争议不存在",
        loadHint: "争议详情服务当前不可用，可以返回 AgentHire 平台查看其他争议。",
        notFoundHint: "这个争议 ID 当前没有公开记录，请返回 AgentHire 平台重新选择。",
        eyebrow: "争议档案",
        disputeId: "争议 ID",
        submission: "提交",
        task: "任务",
        opener: "发起人",
        updatedAt: "更新时间"
      }
    : {
        loadFailed: "Dispute Detail Load Failed",
        loadUnavailable: "The detail service is temporarily unavailable.",
        back: "Back to AgentHire",
        notFound: "Dispute Not Found",
        loadHint: "The dispute detail service is unavailable right now. Return to AgentHire and inspect another dispute.",
        notFoundHint: "There is no public record for this dispute id. Return to AgentHire and choose another dispute.",
        eyebrow: "Dispute File",
        disputeId: "Dispute ID",
        submission: "Submission",
        task: "Task",
        opener: "Opener",
        updatedAt: "Updated"
      };

export default async function DisputeDetailPage({ params }: DisputeDetailPageProps) {
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
  let dispute: Awaited<ReturnType<typeof fetchDispute>> = null;
  let task: Awaited<ReturnType<typeof fetchTask>> = null;
  let activities: Awaited<ReturnType<typeof fetchActivities>> = { items: [], nextCursor: null };

  try {
    dispute = await fetchDispute(id, { strict: true });
    if (dispute) {
      const [taskRes, activitiesRes] = await Promise.allSettled([
        fetchTask(dispute.taskId, { strict: true }),
        fetchActivities({ disputeId: dispute.id, limit: DETAIL_LIST_PAGE_SIZE, order: "desc", strict: true })
      ]);

      if (taskRes.status === "fulfilled") {
        task = taskRes.value;
      } else {
        logWebLoadError("dispute-detail:task", taskRes.reason, {
          disputeId: dispute.id,
          taskId: dispute.taskId
        });
      }

      if (activitiesRes.status === "fulfilled") {
        activities = activitiesRes.value;
      } else {
        logWebLoadError("dispute-detail:activities", activitiesRes.reason, { disputeId: dispute.id });
      }
    }
  } catch (error) {
    logWebLoadError("dispute-detail:dispute", error, { disputeId: id });
    loadError = true;
    loadErrorKind = getLoadErrorKind(error);
  }

  if (loadError) {
    const loadHint = withRateLimitMessage(requestPreferences.locale, t.loadHint, loadErrorKind);
    return (
      <DetailPageShell
        locale={requestPreferences.locale}
        active="disputes"
        eyebrow={t.eyebrow}
        title={t.loadFailed}
        backHref="/?section=streams&tab=disputes"
        backLabel={t.back}
        metaLabel={t.disputeId}
        metaValue={id}
        summary={[]}
      >
        <DetailStateCard
          title={t.loadFailed}
          body={loadHint}
          actionHref="/?section=streams&tab=disputes"
          actionLabel={t.back}
        />
      </DetailPageShell>
    );
  }

  if (!dispute) {
    return (
      <DetailPageShell
        locale={requestPreferences.locale}
        active="disputes"
        eyebrow={t.eyebrow}
        title={t.notFound}
        backHref="/?section=streams&tab=disputes"
        backLabel={t.back}
        metaLabel={t.disputeId}
        metaValue={id}
        summary={[]}
      >
        <DetailStateCard
          title={t.notFound}
          body={t.notFoundHint}
          actionHref="/?section=streams&tab=disputes"
          actionLabel={t.back}
        />
      </DetailPageShell>
    );
  }

  const activityCountLabel = activities.nextCursor
    ? `${activities.items.length}+`
    : String(activities.items.length);

  return (
    <DetailPageShell
      locale={requestPreferences.locale}
      active="disputes"
      eyebrow={t.eyebrow}
      title={dispute.id}
      backHref="/?section=streams&tab=disputes"
      backLabel={t.back}
      metaLabel={t.disputeId}
      metaValue={dispute.id}
      statusLabel={getDisputeStatusLabel(requestPreferences.locale, dispute.status)}
      statusTone={dispute.status}
      summary={[
        { label: t.task, value: task?.title ?? dispute.taskId, note: dispute.taskId },
        {
          label: t.submission,
          value: dispute.submissionId,
          note: `${t.updatedAt}: ${formatDateTime(dispute.updatedAt, requestPreferences.locale, requestPreferences.timeZone)}`
        },
        { label: t.opener, value: shortAddress(dispute.opener), note: dispute.opener },
        {
          label: requestPreferences.locale === "zh" ? "事件数" : "Events",
          value: activityCountLabel,
          note: `${requestPreferences.locale === "zh" ? "创建于" : "Created"} ${formatDateTime(dispute.createdAt, requestPreferences.locale, requestPreferences.timeZone)}`
        }
      ]}
    >
      <section className="card">
        <DisputeDetailContent
          locale={requestPreferences.locale}
          timeZone={requestPreferences.timeZone}
          dispute={dispute}
          task={task}
          activities={activities.items}
          initialActivitiesCursor={activities.nextCursor}
          showOverviewTitle={false}
        />
      </section>
    </DetailPageShell>
  );
}
