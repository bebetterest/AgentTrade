import Link from "next/link";
import type { ActivityEvent, AgentProfile, LedgerBalance } from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import { formatDateTime, shortAddress } from "../../lib/dashboard-format";
import { renderSafeMarkdown } from "../../lib/markdown";
import { getDashboardCopy, getDashboardEventLabel } from "./i18n";

interface AgentDetailContentProps {
  locale: SupportedLocale;
  timeZone: string;
  profile: AgentProfile;
  ledger: LedgerBalance | null;
  activities: ActivityEvent[];
  getTaskHref?: (taskId: string) => string;
  getDisputeHref?: (disputeId: string) => string;
}

const renderTask = (taskId: string, getTaskHref: ((taskId: string) => string) | undefined) => {
  if (!getTaskHref) {
    return <span>{taskId}</span>;
  }

  return (
    <Link className="inline-link" href={getTaskHref(taskId)}>
      {taskId}
    </Link>
  );
};

const renderDispute = (disputeId: string, getDisputeHref: ((disputeId: string) => string) | undefined) => {
  if (!getDisputeHref) {
    return <span>{disputeId}</span>;
  }

  return (
    <Link className="inline-link" href={getDisputeHref(disputeId)}>
      {disputeId}
    </Link>
  );
};

export const AgentDetailContent = ({
  locale,
  timeZone,
  profile,
  ledger,
  activities,
  getTaskHref,
  getDisputeHref
}: AgentDetailContentProps) => {
  const copy = getDashboardCopy(locale);

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
          <div className="metric-line"><span>{copy.agentDetail.publisherRep}</span><strong>{profile.reputation.publisher}</strong></div>
          <div className="metric-line"><span>{copy.agentDetail.workerRep}</span><strong>{profile.reputation.worker}</strong></div>
          <div className="metric-line"><span>{copy.agentDetail.supervisorRep}</span><strong>{profile.reputation.supervisor}</strong></div>
        </div>

        <div className="detail-card">
          <h4>{copy.agentDetail.stats}</h4>
          <ul className="detail-list compact-list">
            <li>{copy.agentDetail.published}: {profile.stats.tasksPublished}</li>
            <li>{copy.agentDetail.accepted}: {profile.stats.tasksAccepted}</li>
            <li>{copy.agentDetail.completed}: {profile.stats.tasksCompleted}</li>
            <li>{copy.agentDetail.terminated}: {profile.stats.tasksTerminated}</li>
            <li>{copy.agentDetail.rejected}: {profile.stats.submissionsRejected}</li>
            <li>{copy.agentDetail.votes}: {profile.stats.supervisionVotes}</li>
          </ul>
        </div>
      </div>

      <h4>{locale === "zh" ? "简介" : "Bio"}</h4>
      <div className="markdown">{renderSafeMarkdown(profile.bio || "-")}</div>

      <h4>{copy.agentDetail.activityTimeline}</h4>
      {activities.length > 0 ? (
        <ul className="detail-list">
          {activities.map((item) => (
            <li key={item.id} className="detail-list-row detail-event-row">
              <div className="detail-event-row__main">
                <span className={`event-chip event-${item.type.toLowerCase()}`}>
                  {getDashboardEventLabel(locale, item.type)}
                </span>
                <strong>{formatDateTime(item.createdAt, locale, timeZone)}</strong>
              </div>
              <div className="detail-subline">
                <span>{locale === "zh" ? "执行方" : "Actor"}: {shortAddress(item.actor)}</span>
                <span>{locale === "zh" ? "周期" : "Cycle"}: {item.cycleId}</span>
                {item.taskId ? <span>{locale === "zh" ? "任务" : "Task"}: {renderTask(item.taskId, getTaskHref)}</span> : null}
                {item.disputeId ? <span>{locale === "zh" ? "争议" : "Dispute"}: {renderDispute(item.disputeId, getDisputeHref)}</span> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-line">{copy.common.noActivityYet}</p>
      )}
    </div>
  );
};
