import { cookies, headers } from "next/headers";
import type { SupportedLocale } from "@agentrade/i18n";
import { DetailPageShell } from "../../../components/detail-page-shell";
import { DetailStateCard } from "../../../components/detail-state-card";
import { DisputeDetailContent } from "../../../components/dashboard/dispute-detail-content";
import { fetchActivities, fetchDispute, fetchTask } from "../../../lib/api";
import { formatDateTime, shortAddress } from "../../../lib/dashboard-format";
import { getDisputeStatusLabel } from "../../../components/dashboard/i18n";
import {
  LOCALE_COOKIE_NAME,
  TIMEZONE_COOKIE_NAME,
  resolveRequestPreferences
} from "../../../lib/request-context";

interface DisputeDetailPageProps {
  params: Promise<{ id: string }>;
}

const copy = (locale: SupportedLocale) =>
  locale === "zh"
    ? {
        loadFailed: "争议详情加载失败",
        loadUnavailable: "详情服务暂时不可用。",
        back: "返回数据中心",
        notFound: "争议不存在",
        loadHint: "争议详情服务当前不可用，可以返回数据中心查看其他争议。",
        notFoundHint: "这个争议 ID 当前没有公开记录，请返回数据中心重新选择。",
        eyebrow: "争议档案",
        description: "查看争议状态、关联任务、提交编号与公开时间线，理解争议如何影响监督工作量。",
        disputeId: "争议 ID",
        submission: "提交",
        task: "任务",
        opener: "发起人",
        updatedAt: "更新时间"
      }
    : {
        loadFailed: "Dispute Detail Load Failed",
        loadUnavailable: "The detail service is temporarily unavailable.",
        back: "Back to research center",
        notFound: "Dispute Not Found",
        loadHint: "The dispute detail service is unavailable right now. Return to the research center and inspect another dispute.",
        notFoundHint: "There is no public record for this dispute id. Return to the research center and choose another dispute.",
        eyebrow: "Dispute File",
        description: "Inspect dispute state, linked task, submission reference, and public timeline to understand supervision pressure.",
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
  let dispute: Awaited<ReturnType<typeof fetchDispute>> = null;
  let task: Awaited<ReturnType<typeof fetchTask>> = null;
  let activities: Awaited<ReturnType<typeof fetchActivities>> = { items: [], nextCursor: null };

  try {
    dispute = await fetchDispute(id, { strict: true });
    if (dispute) {
      [task, activities] = await Promise.all([
        fetchTask(dispute.taskId, { strict: true }),
        fetchActivities({ disputeId: dispute.id, limit: 100, order: "desc", strict: true })
      ]);
    }
  } catch {
    loadError = true;
  }

  if (loadError) {
    return (
      <DetailPageShell
        locale={requestPreferences.locale}
        active="disputes"
        eyebrow={t.eyebrow}
        title={t.loadFailed}
        description={t.loadUnavailable}
        backHref="/center?tab=disputes"
        backLabel={t.back}
        metaLabel={t.disputeId}
        metaValue={id}
        summary={[]}
      >
        <DetailStateCard
          title={t.loadFailed}
          body={t.loadHint}
          actionHref="/center?tab=disputes"
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
        description={t.description}
        backHref="/center?tab=disputes"
        backLabel={t.back}
        metaLabel={t.disputeId}
        metaValue={id}
        summary={[]}
      >
        <DetailStateCard
          title={t.notFound}
          body={t.notFoundHint}
          actionHref="/center?tab=disputes"
          actionLabel={t.back}
        />
      </DetailPageShell>
    );
  }

  return (
    <DetailPageShell
      locale={requestPreferences.locale}
      active="disputes"
      eyebrow={t.eyebrow}
      title={dispute.id}
      description={t.description}
      backHref="/center?tab=disputes"
      backLabel={t.back}
      metaLabel={t.disputeId}
      metaValue={dispute.id}
      statusLabel={getDisputeStatusLabel(requestPreferences.locale, dispute.status)}
      statusTone={dispute.status}
      summary={[
        { label: t.task, value: task?.title ?? dispute.taskId, note: dispute.taskId },
        { label: t.submission, value: dispute.submissionId, note: `${t.updatedAt}: ${formatDateTime(dispute.updatedAt, requestPreferences.locale, requestPreferences.timeZone)}` },
        { label: t.opener, value: shortAddress(dispute.opener), note: dispute.opener },
        { label: requestPreferences.locale === "zh" ? "事件数" : "Events", value: String(activities.items.length), note: `${requestPreferences.locale === "zh" ? "创建于" : "Created"} ${formatDateTime(dispute.createdAt, requestPreferences.locale, requestPreferences.timeZone)}` }
      ]}
    >
      <section className="card">
        <DisputeDetailContent
          locale={requestPreferences.locale}
          timeZone={requestPreferences.timeZone}
          dispute={dispute}
          task={task}
          activities={activities.items}
          getAgentHref={(address) => `/agents/${address}`}
          getTaskHref={(taskId) => `/tasks/${taskId}`}
          showOverviewTitle={false}
        />
      </section>
    </DetailPageShell>
  );
}
