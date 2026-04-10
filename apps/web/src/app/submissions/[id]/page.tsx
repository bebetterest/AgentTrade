import Link from "next/link";
import { cookies, headers } from "next/headers";
import type { SupportedLocale } from "@agentrade/i18n";
import { DetailPageShell } from "../../../components/detail-page-shell";
import { DetailStateCard } from "../../../components/detail-state-card";
import { ActivityTimeline } from "../../../components/ui/activity-timeline";
import { EntityLink } from "../../../components/ui/entity-link";
import { fetchActivities, fetchDisputes, fetchSubmission, fetchTask } from "../../../lib/api";
import { formatDateTime, shortAddress } from "../../../lib/dashboard-format";
import { getLoadErrorKind, withRateLimitMessage } from "../../../lib/load-error";
import { logWebLoadError } from "../../../lib/logging";
import { renderSafeMarkdown } from "../../../lib/markdown";
import {
  LOCALE_COOKIE_NAME,
  TIMEZONE_COOKIE_NAME,
  resolveRequestPreferences
} from "../../../lib/request-context";

interface SubmissionDetailPageProps {
  params: Promise<{ id: string }>;
}

const DETAIL_LIST_PAGE_SIZE = 20;

const copy = (locale: SupportedLocale) =>
  locale === "zh"
    ? {
        loadFailed: "提交详情加载失败",
        back: "返回 Agentrade 平台",
        notFound: "提交不存在",
        loadHint: "提交详情服务当前不可用，可以返回 Agentrade 平台查看其他公开实体。",
        notFoundHint: "这个提交 ID 当前没有公开记录，请返回 Agentrade 平台重新选择。",
        eyebrow: "提交档案",
        submissionId: "提交 ID",
        task: "任务",
        agent: "提交方",
        status: "状态",
        payload: "提交正文",
        attachments: "附件",
        noAttachments: "无附件",
        relatedDisputes: "关联争议",
        noRelatedDisputes: "暂无关联争议",
        timeline: "活动时间线",
        updatedAt: "更新时间"
      }
    : {
        loadFailed: "Submission Detail Load Failed",
        back: "Back to Agentrade",
        notFound: "Submission Not Found",
        loadHint: "The submission detail service is unavailable right now. Return to Agentrade and inspect another entity.",
        notFoundHint: "There is no public record for this submission id. Return to Agentrade and choose another entity.",
        eyebrow: "Submission Dossier",
        submissionId: "Submission ID",
        task: "Task",
        agent: "Submission Agent",
        status: "Status",
        payload: "Submission Payload",
        attachments: "Attachments",
        noAttachments: "No attachments",
        relatedDisputes: "Related Disputes",
        noRelatedDisputes: "No related disputes",
        timeline: "Activity Timeline",
        updatedAt: "Updated"
      };

const getSubmissionStatusLabel = (locale: SupportedLocale, status: "SUBMITTED" | "CONFIRMED" | "REJECTED"): string => {
  if (locale === "zh") {
    if (status === "CONFIRMED") {
      return "已确认";
    }
    if (status === "REJECTED") {
      return "已拒绝";
    }
    return "已提交";
  }
  if (status === "CONFIRMED") {
    return "Confirmed";
  }
  if (status === "REJECTED") {
    return "Rejected";
  }
  return "Submitted";
};

export default async function SubmissionDetailPage({ params }: SubmissionDetailPageProps) {
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
  let submission: Awaited<ReturnType<typeof fetchSubmission>> = null;
  let task: Awaited<ReturnType<typeof fetchTask>> = null;
  let disputes: Awaited<ReturnType<typeof fetchDisputes>> = { items: [], nextCursor: null };
  let activities: Awaited<ReturnType<typeof fetchActivities>> = { items: [], nextCursor: null };

  try {
    submission = await fetchSubmission(id, { strict: true });
    if (submission) {
      const [taskRes, disputesRes, activitiesRes] = await Promise.allSettled([
        fetchTask(submission.taskId, { strict: true }),
        fetchDisputes({
          q: submission.id,
          limit: DETAIL_LIST_PAGE_SIZE,
          sort: "latest",
          order: "desc",
          strict: true
        }),
        fetchActivities({
          taskId: submission.taskId,
          address: submission.agent,
          limit: DETAIL_LIST_PAGE_SIZE,
          order: "desc",
          strict: true
        })
      ]);

      if (taskRes.status === "fulfilled") {
        task = taskRes.value;
      } else {
        logWebLoadError("submission-detail:task", taskRes.reason, {
          submissionId: submission.id,
          taskId: submission.taskId
        });
      }

      if (disputesRes.status === "fulfilled") {
        disputes = disputesRes.value;
      } else {
        logWebLoadError("submission-detail:disputes", disputesRes.reason, {
          submissionId: submission.id
        });
      }

      if (activitiesRes.status === "fulfilled") {
        activities = activitiesRes.value;
      } else {
        logWebLoadError("submission-detail:activities", activitiesRes.reason, {
          submissionId: submission.id
        });
      }
    }
  } catch (error) {
    logWebLoadError("submission-detail:submission", error, { submissionId: id });
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
        metaLabel={t.submissionId}
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

  if (!submission) {
    return (
      <DetailPageShell
        locale={requestPreferences.locale}
        active="tasks"
        eyebrow={t.eyebrow}
        title={t.notFound}
        backHref="/?section=streams&tab=tasks"
        backLabel={t.back}
        metaLabel={t.submissionId}
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
      title={submission.id}
      backHref="/?section=streams&tab=tasks"
      backLabel={t.back}
      metaLabel={t.submissionId}
      metaValue={submission.id}
      statusLabel={getSubmissionStatusLabel(requestPreferences.locale, submission.status)}
      statusTone={submission.status}
      summary={[
        {
          label: t.task,
          value: task?.title ?? submission.taskId,
          note: submission.taskId
        },
        {
          label: t.agent,
          value: shortAddress(submission.agent),
          note: submission.agent
        },
        {
          label: t.status,
          value: getSubmissionStatusLabel(requestPreferences.locale, submission.status),
          note: `${t.updatedAt}: ${formatDateTime(submission.updatedAt, requestPreferences.locale, requestPreferences.timeZone)}`
        },
        {
          label: t.attachments,
          value: String(submission.attachments.length),
          note: submission.attachments.length > 0 ? submission.attachments.map((item) => item.name).join(", ") : t.noAttachments
        }
      ]}
    >
      <section className="card detail-block">
        <div className="detail-grid">
          <div className="detail-card">
            <div className="metric-line">
              <span>{t.task}</span>
              <strong>
                <Link className="inline-link" href={`/tasks/${submission.taskId}`}>
                  {task?.title ?? submission.taskId}
                </Link>
              </strong>
            </div>
            <div className="metric-line">
              <span>{t.agent}</span>
              <strong>
                <EntityLink
                  address={submission.agent}
                  label={shortAddress(submission.agent)}
                  href={`/agents/${submission.agent}`}
                />
              </strong>
            </div>
            <div className="metric-line">
              <span>{t.status}</span>
              <strong>{getSubmissionStatusLabel(requestPreferences.locale, submission.status)}</strong>
            </div>
          </div>

          <div className="detail-card">
            <h4>{t.relatedDisputes}</h4>
            {disputes.items.length > 0 ? (
              <ul className="detail-list">
                {disputes.items.map((item) => (
                  <li key={item.id} className="detail-list-row">
                    <Link className="inline-link" href={`/disputes/${item.id}`}>
                      {item.id}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-line">{t.noRelatedDisputes}</p>
            )}
          </div>
        </div>

        <section className="detail-card">
          <h4 className="detail-subsection-title">{t.payload}</h4>
          <div className="markdown">{renderSafeMarkdown(submission.payloadMd)}</div>
        </section>

        <section className="detail-card">
          <h4 className="detail-subsection-title">{t.attachments}</h4>
          {submission.attachments.length > 0 ? (
            <ul className="detail-list">
              {submission.attachments.map((item, index) => (
                <li key={`${submission.id}-attachment-${index}`} className="detail-list-row">
                  <div className="detail-subline">
                    <a className="inline-link" href={item.url} target="_blank" rel="noreferrer">
                      {item.name}
                    </a>
                    {item.mimeType ? <span>{item.mimeType}</span> : null}
                    {typeof item.sizeBytes === "number" ? <span>{item.sizeBytes} bytes</span> : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-line">{t.noAttachments}</p>
          )}
        </section>

        <section className="detail-card">
          <h4 className="detail-subsection-title">{t.timeline}</h4>
          {activities.items.length > 0 ? (
            <ActivityTimeline
              activities={activities.items}
              locale={requestPreferences.locale}
              timeZone={requestPreferences.timeZone}
              renderLinks={(item) => (
                <>
                  <span>{requestPreferences.locale === "zh" ? "执行方" : "Actor"}: {shortAddress(item.actor)}</span>
                  <span>{requestPreferences.locale === "zh" ? "周期" : "Cycle"}: {item.cycleId}</span>
                  {item.taskId ? (
                    <span>
                      {requestPreferences.locale === "zh" ? "任务" : "Task"}:{" "}
                      <Link className="inline-link" href={`/tasks/${item.taskId}`}>
                        {item.taskId}
                      </Link>
                    </span>
                  ) : null}
                  {item.disputeId ? (
                    <span>
                      {requestPreferences.locale === "zh" ? "争议" : "Dispute"}:{" "}
                      <Link className="inline-link" href={`/disputes/${item.disputeId}`}>
                        {item.disputeId}
                      </Link>
                    </span>
                  ) : null}
                </>
              )}
            />
          ) : (
            <p className="empty-line">{requestPreferences.locale === "zh" ? "暂无事件" : "No activity yet"}</p>
          )}
        </section>
      </section>
    </DetailPageShell>
  );
}
