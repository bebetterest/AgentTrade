"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { ActivityEvent, Dispute, Submission, Task } from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import { fetchActivities } from "../../lib/api";
import { formatDateTime, shortAddress } from "../../lib/dashboard-format";
import { getLoadErrorKind, withRateLimitMessage, type LoadErrorKind } from "../../lib/load-error";
import { renderSafeMarkdown } from "../../lib/markdown";
import { getDisputeStatusLabel } from "./i18n";
import { buildStateChipClass } from "./shared";
import { ActivityTimeline } from "../ui/activity-timeline";

interface DisputeDetailContentProps {
  locale: SupportedLocale;
  timeZone: string;
  dispute: Dispute;
  task: Task | null;
  submission?: Submission | null;
  activities: ActivityEvent[];
  initialActivitiesCursor?: string | null;
  onOpenAgentDetail?: (address: string) => void;
  getAgentHref?: (address: string) => string;
  getTaskHref?: (taskId: string) => string;
  getSubmissionHref?: (submissionId: string) => string;
  showOverviewTitle?: boolean;
}

const DETAIL_LIST_PAGE_SIZE = 20;

const copy = {
  en: {
    overview: "Dispute Overview",
    disputeId: "Dispute ID",
    task: "Task",
    submission: "Submission",
    opener: "Opener",
    status: "Status",
    createdAt: "Created At",
    updatedAt: "Updated At",
    taskContext: "Task Context",
    submissionContext: "Submission Context",
    submissionAgent: "Submission Agent",
    submissionStatus: "Submission Status",
    attachments: "Attachments",
    reward: "Reward",
    deadline: "Deadline",
    slotProgress: "Slot Progress",
    reason: "Reason",
    resolution: "Resolution Summary",
    winner: "Winning Side",
    publisherWins: "Publisher Wins",
    submissionWins: "Submission Agent Wins",
    totalVotes: "Total Votes",
    completedVotes: "Completed",
    notCompletedVotes: "Not Completed",
    timeline: "Activity Timeline",
    noActivity: "No dispute activity yet"
  },
  zh: {
    overview: "争议概览",
    disputeId: "争议 ID",
    task: "任务",
    submission: "提交",
    opener: "发起人",
    status: "状态",
    createdAt: "创建时间",
    updatedAt: "更新时间",
    taskContext: "任务上下文",
    submissionContext: "提交上下文",
    submissionAgent: "提交方",
    submissionStatus: "提交状态",
    attachments: "附件",
    reward: "奖励",
    deadline: "截止时间",
    slotProgress: "槽位进度",
    reason: "争议原因",
    resolution: "结案摘要",
    winner: "胜诉方",
    publisherWins: "发布方胜诉",
    submissionWins: "提交方胜诉",
    totalVotes: "总票数",
    completedVotes: "支持完成",
    notCompletedVotes: "支持未完成",
    timeline: "事件时间线",
    noActivity: "暂无争议事件"
  }
} as const;

const renderAgent = (
  address: string,
  onOpenAgentDetail: ((address: string) => void) | undefined,
  getAgentHref: ((address: string) => string) | undefined
) => {
  if (onOpenAgentDetail) {
    return (
      <button type="button" className="link-btn inline-link" onClick={() => onOpenAgentDetail(address)}>
        {shortAddress(address)}
      </button>
    );
  }

  return (
    <Link className="inline-link" href={(getAgentHref?.(address) ?? `/agents/${address}`)}>
      {shortAddress(address)}
    </Link>
  );
};

const renderTask = (task: Task | null, taskId: string, getTaskHref: ((taskId: string) => string) | undefined) => (
  <Link className="inline-link" href={(getTaskHref?.(taskId) ?? `/tasks/${taskId}`)}>
    {task?.title || taskId}
  </Link>
);

const renderSubmission = (
  submissionId: string,
  getSubmissionHref: ((submissionId: string) => string) | undefined
) => (
  <Link className="inline-link" href={(getSubmissionHref?.(submissionId) ?? `/submissions/${submissionId}`)}>
    {submissionId}
  </Link>
);

export const DisputeDetailContent = ({
  locale,
  timeZone,
  dispute,
  task,
  submission = null,
  activities,
  initialActivitiesCursor = null,
  onOpenAgentDetail,
  getAgentHref,
  getTaskHref,
  getSubmissionHref,
  showOverviewTitle = true
}: DisputeDetailContentProps) => {
  const t = copy[locale];
  const loadMoreLabel = locale === "zh" ? "继续加载" : "Load more";
  const loadMoreFallback = locale === "zh" ? "加载更多失败，请重试。" : "Failed to load more. Please retry.";
  const disputeStatusLabel = getDisputeStatusLabel(locale, dispute.status);
  const resolution = dispute.resolution;
  const winnerLabel = resolution?.winnerRole === "SUBMISSION_AGENT" ? t.submissionWins : t.publisherWins;
  const submissionStatusLabel = submission
    ? locale === "zh"
      ? submission.status === "CONFIRMED"
        ? "已确认"
        : submission.status === "REJECTED"
          ? "已拒绝"
          : "已提交"
      : submission.status === "CONFIRMED"
        ? "Confirmed"
        : submission.status === "REJECTED"
          ? "Rejected"
          : "Submitted"
    : "-";
  const overviewAnchor = "dispute-overview";
  const contextAnchor = "dispute-context";
  const reasonAnchor = "dispute-reason";
  const timelineAnchor = "dispute-timeline";

  const [activityItems, setActivityItems] = useState<ActivityEvent[]>(activities);
  const [activityCursor, setActivityCursor] = useState<string | null>(initialActivitiesCursor);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [activityErrorKind, setActivityErrorKind] = useState<LoadErrorKind | null>(null);

  useEffect(() => {
    setActivityItems(activities);
    setActivityCursor(initialActivitiesCursor);
    setLoadingActivities(false);
    setActivityErrorKind(null);
  }, [dispute.id, activities, initialActivitiesCursor]);

  const loadMoreActivities = useCallback(async () => {
    if (!activityCursor || loadingActivities) {
      return;
    }
    setLoadingActivities(true);
    try {
      const response = await fetchActivities({
        disputeId: dispute.id,
        cursor: activityCursor,
        limit: DETAIL_LIST_PAGE_SIZE,
        order: "desc",
        strict: true
      });
      setActivityItems((prev) => prev.concat(response.items));
      setActivityCursor(response.nextCursor);
      setActivityErrorKind(null);
    } catch (error) {
      setActivityErrorKind(getLoadErrorKind(error));
    } finally {
      setLoadingActivities(false);
    }
  }, [activityCursor, dispute.id, loadingActivities]);

  const activityLoadErrorMessage = withRateLimitMessage(locale, loadMoreFallback, activityErrorKind);

  return (
    <div className="detail-block">
      {showOverviewTitle ? <h3>{t.overview}</h3> : null}
      <nav className="detail-anchor-nav" aria-label={locale === "zh" ? "争议详情导航" : "Dispute detail navigation"}>
        <a href={`#${overviewAnchor}`}>{t.overview}</a>
        <a href={`#${contextAnchor}`}>{t.taskContext}</a>
        <a href={`#${reasonAnchor}`}>{t.reason}</a>
        <a href={`#${timelineAnchor}`}>{t.timeline}</a>
      </nav>
      <div className="detail-grid">
        <div className="detail-card" id={overviewAnchor}>
          <div className="metric-line"><span>{t.disputeId}</span><strong>{dispute.id}</strong></div>
          <div className="metric-line"><span>{t.task}</span><strong>{renderTask(task, dispute.taskId, getTaskHref)}</strong></div>
          <div className="metric-line">
            <span>{t.submission}</span>
            <strong>{renderSubmission(dispute.submissionId, getSubmissionHref)}</strong>
          </div>
          <div className="metric-line"><span>{t.opener}</span><strong>{renderAgent(dispute.opener, onOpenAgentDetail, getAgentHref)}</strong></div>
          <div className="metric-line">
            <span>{t.status}</span>
            <strong>
              <span className={buildStateChipClass(dispute.status)}>{disputeStatusLabel}</span>
            </strong>
          </div>
          <div className="metric-line"><span>{t.createdAt}</span><strong>{formatDateTime(dispute.createdAt, locale, timeZone)}</strong></div>
          <div className="metric-line"><span>{t.updatedAt}</span><strong>{formatDateTime(dispute.updatedAt, locale, timeZone)}</strong></div>
        </div>
        <div className="detail-card" id={contextAnchor}>
          <h4>{t.taskContext}</h4>
          {task ? (
            <>
              <div className="metric-line"><span>{t.reward}</span><strong>{task.rewardPerSlot} AGC</strong></div>
              <div className="metric-line"><span>{t.deadline}</span><strong>{formatDateTime(task.deadlineUtc, locale, timeZone)}</strong></div>
              <div className="metric-line"><span>{t.slotProgress}</span><strong>{task.completedAgents.length}/{task.slotsTotal}</strong></div>
            </>
          ) : (
            <p className="empty-line">-</p>
          )}

          <h4 className="detail-subsection-title">{t.submissionContext}</h4>
          {submission ? (
            <>
              <div className="metric-line">
                <span>{t.submissionAgent}</span>
                <strong>{renderAgent(submission.agent, onOpenAgentDetail, getAgentHref)}</strong>
              </div>
              <div className="metric-line">
                <span>{t.submissionStatus}</span>
                <strong>{submissionStatusLabel}</strong>
              </div>
              {submission.attachments.length > 0 ? (
                <div className="detail-subline">
                  <span>{t.attachments}:</span>
                  {submission.attachments.map((attachment, index) => (
                    <span key={`${submission.id}-attachment-${index}`}>
                      <a className="inline-link" href={attachment.url} target="_blank" rel="noreferrer">
                        {attachment.name}
                      </a>
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="markdown markdown--compact">{renderSafeMarkdown(submission.payloadMd)}</div>
            </>
          ) : (
            <p className="empty-line">-</p>
          )}
        </div>
      </div>

      {resolution ? (
        <section className="detail-card dispute-resolution-card">
          <div className="dispute-resolution-card__head">
            <h4 className="detail-subsection-title">{t.resolution}</h4>
            <span className={buildStateChipClass(dispute.status)}>{disputeStatusLabel}</span>
          </div>
          <p className="dispute-resolution-card__winner">
            {t.winner}: <strong>{winnerLabel}</strong>
          </p>
          <p className="dispute-resolution-card__address">
            {renderAgent(resolution.winnerAddress, onOpenAgentDetail, getAgentHref)}
          </p>
          <div className="dispute-resolution-card__votes">
            <span>{t.totalVotes}: {resolution.totalVotes}</span>
            <span>{t.completedVotes}: {resolution.completedVotes}</span>
            <span>{t.notCompletedVotes}: {resolution.notCompletedVotes}</span>
          </div>
        </section>
      ) : null}

      <section className="detail-card" id={reasonAnchor}>
        <h4 className="detail-subsection-title">{t.reason}</h4>
        <div className="markdown">{renderSafeMarkdown(dispute.reasonMd)}</div>
      </section>

      <section className="detail-card" id={timelineAnchor}>
        <h4 className="detail-subsection-title">{t.timeline}</h4>
        {activityItems.length > 0 ? (
          <>
            <ActivityTimeline
              activities={activityItems}
              locale={locale}
              timeZone={timeZone}
              renderLinks={(item) => (
                <>
                  <span>
                    {locale === "zh" ? "执行方" : "Actor"}: {renderAgent(item.actor, onOpenAgentDetail, getAgentHref)}
                  </span>
                  {item.taskId ? (
                    <span>
                      {locale === "zh" ? "任务" : "Task"}: {renderTask(task, item.taskId, getTaskHref)}
                    </span>
                  ) : null}
                  {item.disputeId ? (
                    <span>
                      {locale === "zh" ? "争议" : "Dispute"}: {item.disputeId}
                    </span>
                  ) : null}
                  <span>
                    {locale === "zh" ? "周期" : "Cycle"}: {item.cycleId}
                  </span>
                </>
              )}
            />
            {activityCursor ? (
              <button type="button" className="action-btn more-btn" onClick={loadMoreActivities} disabled={loadingActivities}>
                {loadingActivities ? (locale === "zh" ? "加载更多..." : "Loading more...") : loadMoreLabel}
              </button>
            ) : null}
            {activityErrorKind ? <p className="empty-line">{activityLoadErrorMessage}</p> : null}
          </>
        ) : (
          <p className="empty-line">{t.noActivity}</p>
        )}
      </section>
    </div>
  );
};
