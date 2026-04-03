import Link from "next/link";
import type { ActivityEvent, Dispute, Task } from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import { formatDateTime, shortAddress } from "../../lib/dashboard-format";
import { renderSafeMarkdown } from "../../lib/markdown";
import { getDashboardCopy, getDashboardEventLabel, getDisputeStatusLabel } from "./i18n";
import { buildStateChipClass } from "./shared";

interface TaskDetailContentProps {
  locale: SupportedLocale;
  timeZone: string;
  task: Task;
  disputes: Dispute[];
  activities: ActivityEvent[];
  onOpenAgentDetail?: (address: string) => void;
  getAgentHref?: (address: string) => string;
}

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

  if (getAgentHref) {
    return (
      <Link className="inline-link" href={getAgentHref(address)}>
        {shortAddress(address)}
      </Link>
    );
  }

  return <span>{shortAddress(address)}</span>;
};

export const TaskDetailContent = ({
  locale,
  timeZone,
  task,
  disputes,
  activities,
  onOpenAgentDetail,
  getAgentHref
}: TaskDetailContentProps) => {
  const copy = getDashboardCopy(locale);

  return (
    <div className="detail-block">
      <div className="detail-grid">
        <div className="detail-card">
          <div className="metric-line">
            <span>{copy.taskDetail.publisher}</span>
            <strong>{renderAgent(task.publisher, onOpenAgentDetail, getAgentHref)}</strong>
          </div>
          <div className="metric-line"><span>{copy.taskDetail.reward}</span><strong>{task.rewardPerSlot} AGC</strong></div>
          <div className="metric-line"><span>{copy.taskDetail.tax}</span><strong>{task.taxAmount} AGC</strong></div>
          <div className="metric-line"><span>{copy.taskDetail.escrowRemaining}</span><strong>{task.rewardEscrowRemaining} AGC</strong></div>
          <div className="metric-line"><span>{copy.taskDetail.slotProgress}</span><strong>{task.completedAgents.length}/{task.slotsTotal}</strong></div>
          <div className="metric-line"><span>{copy.taskDetail.deadline}</span><strong>{formatDateTime(task.deadlineUtc, locale, timeZone)}</strong></div>
        </div>

        <div className="detail-card">
          <h4>{copy.taskDetail.participants}</h4>
          <p className="muted">{copy.taskDetail.accepted}</p>
          {task.acceptedAgents.length > 0 ? (
            <div className="chip-list">
              {task.acceptedAgents.map((address) => (
                <span key={address}>{renderAgent(address, onOpenAgentDetail, getAgentHref)}</span>
              ))}
            </div>
          ) : (
            <p className="empty-line">{copy.taskDetail.none}</p>
          )}

          <p className="muted">{copy.taskDetail.completed}</p>
          {task.completedAgents.length > 0 ? (
            <div className="chip-list">
              {task.completedAgents.map((address) => (
                <span key={address}>{renderAgent(address, onOpenAgentDetail, getAgentHref)}</span>
              ))}
            </div>
          ) : (
            <p className="empty-line">{copy.taskDetail.none}</p>
          )}
        </div>
      </div>

      <h4>{copy.taskDetail.acceptanceCriteria}</h4>
      <div className="markdown">{renderSafeMarkdown(task.acceptanceCriteria)}</div>

      <h4>{locale === "zh" ? "任务说明" : "Task Description"}</h4>
      <div className="markdown">{renderSafeMarkdown(task.descriptionMd)}</div>

      <h4>{copy.taskDetail.relatedDisputes}</h4>
      {disputes.length > 0 ? (
        <ul className="detail-list">
          {disputes.map((item) => (
            <li key={item.id} className="detail-card">
              <div className="section-head compact-head">
                <strong>{item.id}</strong>
                <span className={buildStateChipClass(item.status)}>{getDisputeStatusLabel(locale, item.status)}</span>
              </div>
              <p className="muted">
                {copy.taskDetail.opener}: {renderAgent(item.opener, onOpenAgentDetail, getAgentHref)}
              </p>
              <p>{item.reasonMd}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-line">{copy.taskDetail.noRelatedDisputes}</p>
      )}

      <h4>{copy.taskDetail.activityTimeline}</h4>
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
                <span>{locale === "zh" ? "执行方" : "Actor"}: {renderAgent(item.actor, onOpenAgentDetail, getAgentHref)}</span>
                <span>{locale === "zh" ? "周期" : "Cycle"}: {item.cycleId}</span>
                {item.disputeId ? <span>{locale === "zh" ? "争议" : "Dispute"}: {item.disputeId}</span> : null}
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
