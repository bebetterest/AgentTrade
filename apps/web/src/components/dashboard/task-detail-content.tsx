"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { ActivityEvent, Dispute, Submission, Task, TaskIntention } from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import { fetchActivities, fetchDisputes, fetchSubmissions, fetchTaskIntentions } from "../../lib/api";
import { formatDateTime, shortAddress } from "../../lib/dashboard-format";
import { getLoadErrorKind, withRateLimitMessage, type LoadErrorKind } from "../../lib/load-error";
import { renderSafeMarkdown } from "../../lib/markdown";
import { getDashboardCopy, getDisputeStatusLabel } from "./i18n";
import { EntityLink } from "../ui/entity-link";
import { MetricLine } from "../ui/metric-line";
import { StateChip } from "../ui/state-chip";
import { ActivityTimeline } from "../ui/activity-timeline";

interface TaskDetailContentProps {
  locale: SupportedLocale;
  timeZone: string;
  task: Task;
  intentions: TaskIntention[];
  submissions?: Submission[];
  disputes: Dispute[];
  activities: ActivityEvent[];
  initialIntentionsCursor?: string | null;
  initialSubmissionsCursor?: string | null;
  initialDisputesCursor?: string | null;
  initialActivitiesCursor?: string | null;
  onOpenAgentDetail?: (address: string) => void;
  getAgentHref?: (address: string) => string;
  getSubmissionHref?: (submissionId: string) => string;
  getDisputeHref?: (disputeId: string) => string;
}

const DETAIL_LIST_PAGE_SIZE = 20;
const COMPLETED_BATCH_SIZE = 10;

export const TaskDetailContent = ({
  locale,
  timeZone,
  task,
  intentions,
  submissions = [],
  disputes,
  activities,
  initialIntentionsCursor = null,
  initialSubmissionsCursor = null,
  initialDisputesCursor = null,
  initialActivitiesCursor = null,
  onOpenAgentDetail,
  getAgentHref,
  getSubmissionHref,
  getDisputeHref
}: TaskDetailContentProps) => {
  const copy = getDashboardCopy(locale);
  const loadMoreLabel = locale === "zh" ? "继续加载" : "Load more";
  const loadMoreFallback = locale === "zh" ? "加载更多失败，请重试。" : "Failed to load more. Please retry.";
  const participantsAnchor = "task-participants";
  const acceptanceAnchor = "task-acceptance";
  const descriptionAnchor = "task-description";
  const submissionsAnchor = "task-submissions";
  const disputesAnchor = "task-disputes";
  const timelineAnchor = "task-timeline";
  const openDisputeLabel = locale === "zh" ? "打开争议页" : "Open dispute";
  const resolveAgentHref = (address: string) => getAgentHref?.(address) ?? `/agents/${address}`;
  const resolveSubmissionHref = (submissionId: string) => getSubmissionHref?.(submissionId) ?? `/submissions/${submissionId}`;
  const resolveDisputeHref = (disputeId: string) => getDisputeHref?.(disputeId) ?? `/disputes/${disputeId}`;

  const [intentionItems, setIntentionItems] = useState<TaskIntention[]>(intentions);
  const [intentionCursor, setIntentionCursor] = useState<string | null>(initialIntentionsCursor);
  const [loadingIntentions, setLoadingIntentions] = useState(false);
  const [intentionErrorKind, setIntentionErrorKind] = useState<LoadErrorKind | null>(null);

  const [submissionItems, setSubmissionItems] = useState<Submission[]>(submissions);
  const [submissionCursor, setSubmissionCursor] = useState<string | null>(initialSubmissionsCursor);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  const [submissionErrorKind, setSubmissionErrorKind] = useState<LoadErrorKind | null>(null);

  const [disputeItems, setDisputeItems] = useState<Dispute[]>(disputes);
  const [disputeCursor, setDisputeCursor] = useState<string | null>(initialDisputesCursor);
  const [loadingDisputes, setLoadingDisputes] = useState(false);
  const [disputeErrorKind, setDisputeErrorKind] = useState<LoadErrorKind | null>(null);

  const [activityItems, setActivityItems] = useState<ActivityEvent[]>(activities);
  const [activityCursor, setActivityCursor] = useState<string | null>(initialActivitiesCursor);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [activityErrorKind, setActivityErrorKind] = useState<LoadErrorKind | null>(null);

  const [visibleCompleted, setVisibleCompleted] = useState(COMPLETED_BATCH_SIZE);

  useEffect(() => {
    setIntentionItems(intentions);
    setIntentionCursor(initialIntentionsCursor);
    setLoadingIntentions(false);
    setIntentionErrorKind(null);

    setSubmissionItems(submissions);
    setSubmissionCursor(initialSubmissionsCursor);
    setLoadingSubmissions(false);
    setSubmissionErrorKind(null);

    setDisputeItems(disputes);
    setDisputeCursor(initialDisputesCursor);
    setLoadingDisputes(false);
    setDisputeErrorKind(null);

    setActivityItems(activities);
    setActivityCursor(initialActivitiesCursor);
    setLoadingActivities(false);
    setActivityErrorKind(null);

    setVisibleCompleted(COMPLETED_BATCH_SIZE);
  }, [
    task.id,
    intentions,
    submissions,
    disputes,
    activities,
    initialIntentionsCursor,
    initialSubmissionsCursor,
    initialDisputesCursor,
    initialActivitiesCursor
  ]);

  const loadMoreIntentions = useCallback(async () => {
    if (!intentionCursor || loadingIntentions) {
      return;
    }
    setLoadingIntentions(true);
    try {
      const response = await fetchTaskIntentions({
        taskId: task.id,
        cursor: intentionCursor,
        limit: DETAIL_LIST_PAGE_SIZE,
        strict: true
      });
      setIntentionItems((prev) => prev.concat(response.items));
      setIntentionCursor(response.nextCursor);
      setIntentionErrorKind(null);
    } catch (error) {
      setIntentionErrorKind(getLoadErrorKind(error));
    } finally {
      setLoadingIntentions(false);
    }
  }, [intentionCursor, loadingIntentions, task.id]);

  const loadMoreDisputes = useCallback(async () => {
    if (!disputeCursor || loadingDisputes) {
      return;
    }
    setLoadingDisputes(true);
    try {
      const response = await fetchDisputes({
        taskId: task.id,
        cursor: disputeCursor,
        limit: DETAIL_LIST_PAGE_SIZE,
        sort: "latest",
        order: "desc",
        strict: true
      });
      setDisputeItems((prev) => prev.concat(response.items));
      setDisputeCursor(response.nextCursor);
      setDisputeErrorKind(null);
    } catch (error) {
      setDisputeErrorKind(getLoadErrorKind(error));
    } finally {
      setLoadingDisputes(false);
    }
  }, [disputeCursor, loadingDisputes, task.id]);

  const loadMoreSubmissions = useCallback(async () => {
    if (!submissionCursor || loadingSubmissions) {
      return;
    }
    setLoadingSubmissions(true);
    try {
      const response = await fetchSubmissions({
        taskId: task.id,
        cursor: submissionCursor,
        limit: DETAIL_LIST_PAGE_SIZE,
        sort: "latest",
        order: "desc",
        strict: true
      });
      setSubmissionItems((prev) => prev.concat(response.items));
      setSubmissionCursor(response.nextCursor);
      setSubmissionErrorKind(null);
    } catch (error) {
      setSubmissionErrorKind(getLoadErrorKind(error));
    } finally {
      setLoadingSubmissions(false);
    }
  }, [loadingSubmissions, submissionCursor, task.id]);

  const loadMoreActivities = useCallback(async () => {
    if (!activityCursor || loadingActivities) {
      return;
    }
    setLoadingActivities(true);
    try {
      const response = await fetchActivities({
        taskId: task.id,
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
  }, [activityCursor, loadingActivities, task.id]);

  const visibleCompletedItems = task.completedAgents.slice(0, visibleCompleted);
  const hasMoreCompleted = visibleCompletedItems.length < task.completedAgents.length;

  const getSubmissionStatusLabel = (status: Submission["status"]): string => {
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

  const intentionLoadErrorMessage = withRateLimitMessage(locale, loadMoreFallback, intentionErrorKind);
  const submissionLoadErrorMessage = withRateLimitMessage(locale, loadMoreFallback, submissionErrorKind);
  const disputeLoadErrorMessage = withRateLimitMessage(locale, loadMoreFallback, disputeErrorKind);
  const activityLoadErrorMessage = withRateLimitMessage(locale, loadMoreFallback, activityErrorKind);

  return (
    <div className="detail-block">
      <nav className="detail-anchor-nav" aria-label={locale === "zh" ? "任务详情导航" : "Task detail navigation"}>
        <a href={`#${participantsAnchor}`}>{copy.taskDetail.participants}</a>
        <a href={`#${acceptanceAnchor}`}>{copy.taskDetail.acceptanceCriteria}</a>
        <a href={`#${descriptionAnchor}`}>{locale === "zh" ? "任务说明" : "Task Description"}</a>
        <a href={`#${submissionsAnchor}`}>{copy.taskDetail.submissions}</a>
        <a href={`#${disputesAnchor}`}>{copy.taskDetail.relatedDisputes}</a>
        <a href={`#${timelineAnchor}`}>{copy.taskDetail.activityTimeline}</a>
      </nav>

      <div className="detail-grid">
        <div className="detail-card">
          <MetricLine
            label={copy.taskDetail.publisher}
            value={<EntityLink address={task.publisher} label={shortAddress(task.publisher)} onClick={onOpenAgentDetail ? () => onOpenAgentDetail(task.publisher) : undefined} href={resolveAgentHref(task.publisher)} />}
          />
          <MetricLine label={copy.taskDetail.reward} value={`${task.rewardPerSlot} AGC`} />
          <MetricLine label={copy.taskDetail.tax} value={`${task.taxAmount} AGC`} />
          <MetricLine label={copy.taskDetail.escrowRemaining} value={`${task.rewardEscrowRemaining} AGC`} />
          <MetricLine label={copy.taskDetail.slotProgress} value={`${task.completedAgents.length}/${task.slotsTotal}`} />
          <MetricLine label={copy.taskDetail.intended} value={String(task.intentCount)} />
          <MetricLine label={copy.taskDetail.competition} value={`${(task.competitionRatio * 100).toFixed(0)}%`} />
          <MetricLine label={copy.taskDetail.deadline} value={formatDateTime(task.deadlineUtc, locale, timeZone)} />
        </div>

        <div className="detail-card" id={participantsAnchor}>
          <h4>{copy.taskDetail.participants}</h4>
          <section className="detail-chip-section">
            <div className="detail-chip-section__head">
              <h5>{copy.taskDetail.intended}</h5>
              <span className="detail-chip-section__count">{task.intentCount}</span>
            </div>
            {intentionItems.length > 0 ? (
              <>
                <div className="detail-chip-list">
                  {intentionItems.map((item) => (
                    <span key={item.id}>
                      <EntityLink address={item.agent} label={shortAddress(item.agent)} onClick={onOpenAgentDetail ? () => onOpenAgentDetail(item.agent) : undefined} href={resolveAgentHref(item.agent)} />
                    </span>
                  ))}
                </div>
                {intentionCursor ? (
                  <button type="button" className="action-btn more-btn" onClick={loadMoreIntentions} disabled={loadingIntentions}>
                    {loadingIntentions ? copy.common.loadingMore : loadMoreLabel}
                  </button>
                ) : null}
                {intentionErrorKind ? <p className="empty-line">{intentionLoadErrorMessage}</p> : null}
              </>
            ) : (
              <p className="empty-line">{copy.taskDetail.none}</p>
            )}
          </section>

          <section className="detail-chip-section">
            <div className="detail-chip-section__head">
              <h5>{copy.taskDetail.completed}</h5>
              <span className="detail-chip-section__count">{task.completedAgents.length}</span>
            </div>
            {task.completedAgents.length > 0 ? (
              <>
                <div className="detail-chip-list">
                  {visibleCompletedItems.map((address) => (
                    <span key={address}>
                      <EntityLink address={address} label={shortAddress(address)} onClick={onOpenAgentDetail ? () => onOpenAgentDetail(address) : undefined} href={resolveAgentHref(address)} />
                    </span>
                  ))}
                </div>
                {hasMoreCompleted ? (
                  <button
                    type="button"
                    className="action-btn more-btn"
                    onClick={() => setVisibleCompleted((count) => Math.min(count + COMPLETED_BATCH_SIZE, task.completedAgents.length))}
                  >
                    {loadMoreLabel}
                  </button>
                ) : null}
              </>
            ) : (
              <p className="empty-line">{copy.taskDetail.none}</p>
            )}
          </section>
        </div>
      </div>

      <section className="detail-card" id={acceptanceAnchor}>
        <h4 className="detail-subsection-title">{copy.taskDetail.acceptanceCriteria}</h4>
        <div className="markdown">{renderSafeMarkdown(task.acceptanceCriteria)}</div>
      </section>

      <section className="detail-card" id={descriptionAnchor}>
        <h4 className="detail-subsection-title">{locale === "zh" ? "任务说明" : "Task Description"}</h4>
        <div className="markdown">{renderSafeMarkdown(task.descriptionMd)}</div>
      </section>

      <section className="detail-card" id={submissionsAnchor}>
        <h4 className="detail-subsection-title">{copy.taskDetail.submissions}</h4>
        {submissionItems.length > 0 ? (
          <>
            <ul className="detail-list">
              {submissionItems.map((item) => (
                <li key={item.id} className="detail-card">
                  <div className="section-head compact-head">
                    <strong>{item.id}</strong>
                    <StateChip status={item.status} label={getSubmissionStatusLabel(item.status)} />
                  </div>
                  <p className="muted">
                    {copy.taskDetail.submissionAgent}:{" "}
                    <EntityLink
                      address={item.agent}
                      label={shortAddress(item.agent)}
                      onClick={onOpenAgentDetail ? () => onOpenAgentDetail(item.agent) : undefined}
                      href={resolveAgentHref(item.agent)}
                    />
                  </p>
                  <p className="muted">
                    {locale === "zh" ? "更新时间" : "Updated"}: {formatDateTime(item.updatedAt, locale, timeZone)}
                  </p>
                  <div className="markdown markdown--compact">{renderSafeMarkdown(item.payloadMd)}</div>
                  {item.attachments.length > 0 ? (
                    <div className="detail-subline">
                      <span>{copy.taskDetail.attachments}:</span>
                      {item.attachments.map((attachment, index) => (
                        <span key={`${item.id}-attachment-${index}`}>
                          <a className="inline-link" href={attachment.url} target="_blank" rel="noreferrer">
                            {attachment.name}
                          </a>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <Link className="inline-link" href={resolveSubmissionHref(item.id)}>
                    {copy.taskDetail.viewSubmission}
                  </Link>
                </li>
              ))}
            </ul>
            {submissionCursor ? (
              <button type="button" className="action-btn more-btn" onClick={loadMoreSubmissions} disabled={loadingSubmissions}>
                {loadingSubmissions ? copy.common.loadingMore : loadMoreLabel}
              </button>
            ) : null}
            {submissionErrorKind ? <p className="empty-line">{submissionLoadErrorMessage}</p> : null}
          </>
        ) : (
          <p className="empty-line">{copy.taskDetail.noSubmissions}</p>
        )}
      </section>

      <section className="detail-card" id={disputesAnchor}>
        <h4 className="detail-subsection-title">{copy.taskDetail.relatedDisputes}</h4>
        {disputeItems.length > 0 ? (
          <>
            <ul className="detail-list">
              {disputeItems.map((item) => (
                <li key={item.id} className="detail-card">
                  <div className="section-head compact-head">
                    <strong>{item.id}</strong>
                    <StateChip status={item.status} label={getDisputeStatusLabel(locale, item.status)} />
                  </div>
                  <p className="muted">
                    {copy.taskDetail.opener}: <EntityLink address={item.opener} label={shortAddress(item.opener)} onClick={onOpenAgentDetail ? () => onOpenAgentDetail(item.opener) : undefined} href={resolveAgentHref(item.opener)} />
                  </p>
                  <p className="muted">
                    {locale === "zh" ? "更新时间" : "Updated"}: {formatDateTime(item.updatedAt, locale, timeZone)}
                  </p>
                  <div className="markdown markdown--compact">{renderSafeMarkdown(item.reasonMd)}</div>
                  <Link className="inline-link" href={resolveDisputeHref(item.id)}>
                    {openDisputeLabel}
                  </Link>
                </li>
              ))}
            </ul>
            {disputeCursor ? (
              <button type="button" className="action-btn more-btn" onClick={loadMoreDisputes} disabled={loadingDisputes}>
                {loadingDisputes ? copy.common.loadingMore : loadMoreLabel}
              </button>
            ) : null}
            {disputeErrorKind ? <p className="empty-line">{disputeLoadErrorMessage}</p> : null}
          </>
        ) : (
          <p className="empty-line">{copy.taskDetail.noRelatedDisputes}</p>
        )}
      </section>

      <section className="detail-card" id={timelineAnchor}>
        <h4 className="detail-subsection-title">{copy.taskDetail.activityTimeline}</h4>
        {activityItems.length > 0 ? (
          <>
            <ActivityTimeline
              activities={activityItems}
              locale={locale}
              timeZone={timeZone}
              renderLinks={(item) => (
                <>
                  <span>{locale === "zh" ? "执行方" : "Actor"}: <EntityLink address={item.actor} label={shortAddress(item.actor)} onClick={onOpenAgentDetail ? () => onOpenAgentDetail(item.actor) : undefined} href={resolveAgentHref(item.actor)} /></span>
                  <span>{locale === "zh" ? "周期" : "Cycle"}: {item.cycleId}</span>
                  {item.disputeId ? <span>{locale === "zh" ? "争议" : "Dispute"}: {item.disputeId}</span> : null}
                </>
              )}
            />
            {activityCursor ? (
              <button type="button" className="action-btn more-btn" onClick={loadMoreActivities} disabled={loadingActivities}>
                {loadingActivities ? copy.common.loadingMore : loadMoreLabel}
              </button>
            ) : null}
            {activityErrorKind ? <p className="empty-line">{activityLoadErrorMessage}</p> : null}
          </>
        ) : (
          <p className="empty-line">{copy.common.noActivityYet}</p>
        )}
      </section>
    </div>
  );
};
