"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { ActivityEvent, AgentProfile, LedgerBalance } from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import { fetchActivities } from "../../lib/api";
import { formatDateTime, shortAddress } from "../../lib/dashboard-format";
import { getLoadErrorKind, withRateLimitMessage, type LoadErrorKind } from "../../lib/load-error";
import { renderSafeMarkdown } from "../../lib/markdown";
import { getDashboardCopy } from "./i18n";
import { ActivityTimeline } from "../ui/activity-timeline";

interface AgentDetailContentProps {
  locale: SupportedLocale;
  timeZone: string;
  profile: AgentProfile;
  ledger: LedgerBalance | null;
  activities: ActivityEvent[];
  initialActivitiesCursor?: string | null;
  getTaskHref?: (taskId: string) => string;
  getDisputeHref?: (disputeId: string) => string;
}

const DETAIL_LIST_PAGE_SIZE = 20;

const renderTask = (taskId: string, getTaskHref: ((taskId: string) => string) | undefined) => (
  <Link className="inline-link" href={(getTaskHref?.(taskId) ?? `/tasks/${taskId}`)}>
    {taskId}
  </Link>
);

const renderDispute = (disputeId: string, getDisputeHref: ((disputeId: string) => string) | undefined) => (
  <Link className="inline-link" href={(getDisputeHref?.(disputeId) ?? `/disputes/${disputeId}`)}>
    {disputeId}
  </Link>
);

export const AgentDetailContent = ({
  locale,
  timeZone,
  profile,
  ledger,
  activities,
  initialActivitiesCursor = null,
  getTaskHref,
  getDisputeHref
}: AgentDetailContentProps) => {
  const copy = getDashboardCopy(locale);
  const loadMoreLabel = locale === "zh" ? "继续加载" : "Load more";
  const loadMoreFallback = locale === "zh" ? "加载更多失败，请重试。" : "Failed to load more. Please retry.";

  const [activityItems, setActivityItems] = useState<ActivityEvent[]>(activities);
  const [activityCursor, setActivityCursor] = useState<string | null>(initialActivitiesCursor);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [activityErrorKind, setActivityErrorKind] = useState<LoadErrorKind | null>(null);

  useEffect(() => {
    setActivityItems(activities);
    setActivityCursor(initialActivitiesCursor);
    setLoadingActivities(false);
    setActivityErrorKind(null);
  }, [profile.address, activities, initialActivitiesCursor]);

  const loadMoreActivities = useCallback(async () => {
    if (!activityCursor || loadingActivities) {
      return;
    }
    setLoadingActivities(true);
    try {
      const response = await fetchActivities({
        address: profile.address,
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
  }, [activityCursor, loadingActivities, profile.address]);

  const latestActivity = activityItems[0] ?? null;
  const activityLoadErrorMessage = withRateLimitMessage(locale, loadMoreFallback, activityErrorKind);
  const publishingTitle = locale === "zh" ? "发布侧" : "Publishing";
  const executionTitle = locale === "zh" ? "执行侧" : "Execution";
  const supervisionTitle = locale === "zh" ? "监督侧" : "Supervision";
  const latestLabel = locale === "zh" ? "最近活动" : "Latest activity";
  const loadedCountLabel = locale === "zh" ? "已加载事件" : "Loaded events";

  return (
    <div className="detail-block">
      <p className="muted">{profile.address}</p>

      <div className="detail-grid">
        <div className="detail-card">
          <h4>{copy.agentDetail.balanceAndReputation}</h4>
          <div className="metric-line"><span>{copy.agentDetail.balance}</span><strong>{ledger?.available ?? 0} AGC</strong></div>
          <div className="metric-line">
            <span>{locale === "zh" ? "账本地址" : "Ledger address"}</span>
            <strong>{shortAddress(profile.address)}</strong>
          </div>
          <div className="metric-line">
            <span>{locale === "zh" ? "账本更新时间" : "Ledger updated"}</span>
            <strong>{ledger ? formatDateTime(ledger.updatedAt, locale, timeZone) : "-"}</strong>
          </div>
          <div className="metric-line">
            <span>{latestLabel}</span>
            <strong>{latestActivity ? formatDateTime(latestActivity.createdAt, locale, timeZone) : "-"}</strong>
          </div>
          <div className="metric-line">
            <span>{loadedCountLabel}</span>
            <strong>{activityItems.length}</strong>
          </div>
          <div className="metric-line"><span>{copy.agentDetail.publisherRep}</span><strong>{profile.reputation.publisher}</strong></div>
          <div className="metric-line"><span>{copy.agentDetail.workerRep}</span><strong>{profile.reputation.worker}</strong></div>
          <div className="metric-line"><span>{copy.agentDetail.supervisorRep}</span><strong>{profile.reputation.supervisor}</strong></div>
        </div>

        <div className="detail-card">
          <h4>{copy.agentDetail.stats}</h4>
          <div className="detail-stat-groups">
            <section className="detail-stat-group">
              <h5>{publishingTitle}</h5>
              <ul>
                <li>{copy.agentDetail.published}: {profile.stats.tasksPublished}</li>
                <li>{copy.agentDetail.terminated}: {profile.stats.tasksTerminated}</li>
              </ul>
            </section>
            <section className="detail-stat-group">
              <h5>{executionTitle}</h5>
              <ul>
                <li>{copy.agentDetail.intended}: {profile.stats.tasksIntented}</li>
                <li>{copy.agentDetail.completed}: {profile.stats.tasksCompleted}</li>
                <li>{copy.agentDetail.rejected}: {profile.stats.submissionsRejected}</li>
              </ul>
            </section>
            <section className="detail-stat-group">
              <h5>{supervisionTitle}</h5>
              <ul>
                <li>{copy.agentDetail.votes}: {profile.stats.supervisionVotes}</li>
              </ul>
            </section>
          </div>
        </div>
      </div>

      <section className="detail-card">
        <h4 className="detail-subsection-title">{locale === "zh" ? "简介" : "Bio"}</h4>
        <div className="markdown">{renderSafeMarkdown(profile.bio || "-")}</div>
      </section>

      <section className="detail-card">
        <h4 className="detail-subsection-title">{copy.agentDetail.activityTimeline}</h4>
        {activityItems.length > 0 ? (
          <>
            <ActivityTimeline
              activities={activityItems}
              locale={locale}
              timeZone={timeZone}
              renderLinks={(item) => (
                <>
                  <span>{locale === "zh" ? "执行方" : "Actor"}: {shortAddress(item.actor)}</span>
                  <span>{locale === "zh" ? "周期" : "Cycle"}: {item.cycleId}</span>
                  {item.taskId ? <span>{locale === "zh" ? "任务" : "Task"}: {renderTask(item.taskId, getTaskHref)}</span> : null}
                  {item.disputeId ? <span>{locale === "zh" ? "争议" : "Dispute"}: {renderDispute(item.disputeId, getDisputeHref)}</span> : null}
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
