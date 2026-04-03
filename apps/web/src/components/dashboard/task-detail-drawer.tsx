import type { ActivityEvent, Dispute, Task } from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import { formatDateTime, shortAddress } from "../../lib/dashboard-format";
import { renderSafeMarkdown } from "../../lib/markdown";
import { getDashboardCopy } from "./i18n";

interface TaskDetailDrawerProps {
  locale: SupportedLocale;
  timeZone: string;
  taskDetail: {
    loading: boolean;
    error: boolean;
    task: Task | null;
    disputes: Dispute[];
    activities: ActivityEvent[];
  };
  onRetry: () => void;
  onOpenAgentDetail: (address: string) => void;
}

export const TaskDetailDrawer = ({
  locale,
  timeZone,
  taskDetail,
  onRetry,
  onOpenAgentDetail
}: TaskDetailDrawerProps) => {
  const copy = getDashboardCopy(locale);

  if (taskDetail.loading) {
    return <p className="empty-line">{copy.common.loading}</p>;
  }

  if (taskDetail.error) {
    return (
      <div className="inline-error" data-testid="task-detail-error">
        <p className="empty-line">
          {copy.taskDetail.loadError}
        </p>
        <button type="button" className="link-btn" data-testid="retry-task-detail" onClick={onRetry}>
          {copy.common.retry}
        </button>
      </div>
    );
  }

  if (!taskDetail.task) {
    return <p className="empty-line">{copy.taskDetail.notFound}</p>;
  }

  const task = taskDetail.task;

  return (
    <div className="detail-block">
      <h3>{task.title}</h3>
      <span className="state-chip">{task.status}</span>
      <div className="detail-grid">
        <div className="detail-card">
          <div className="metric-line">
            <span>{copy.taskDetail.publisher}</span>
            <strong>
              <button type="button" className="link-btn inline-link" onClick={() => onOpenAgentDetail(task.publisher)}>
                {shortAddress(task.publisher)}
              </button>
            </strong>
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
                <button key={address} type="button" className="link-btn" onClick={() => onOpenAgentDetail(address)}>
                  {shortAddress(address)}
                </button>
              ))}
            </div>
          ) : (
            <p className="empty-line">{copy.taskDetail.none}</p>
          )}
          <p className="muted">{copy.taskDetail.completed}</p>
          {task.completedAgents.length > 0 ? (
            <div className="chip-list">
              {task.completedAgents.map((address) => (
                <button key={address} type="button" className="link-btn" onClick={() => onOpenAgentDetail(address)}>
                  {shortAddress(address)}
                </button>
              ))}
            </div>
          ) : (
            <p className="empty-line">{copy.taskDetail.none}</p>
          )}
        </div>
      </div>
      <div className="markdown">{renderSafeMarkdown(task.descriptionMd)}</div>
      <h4>{copy.taskDetail.acceptanceCriteria}</h4>
      <div className="markdown">{renderSafeMarkdown(task.acceptanceCriteria)}</div>
      <h4>{copy.taskDetail.relatedDisputes}</h4>
      {taskDetail.disputes.length > 0 ? (
        <ul className="detail-list">
          {taskDetail.disputes.map((item) => (
            <li key={item.id} className="detail-card">
              <div className="section-head compact-head">
                <strong>{item.id}</strong>
                <span className="state-chip">{item.status}</span>
              </div>
              <p className="muted">
                {copy.taskDetail.opener}:{" "}
                <button type="button" className="link-btn inline-link" onClick={() => onOpenAgentDetail(item.opener)}>
                  {shortAddress(item.opener)}
                </button>
              </p>
              <p>{item.reasonMd}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-line">{copy.taskDetail.noRelatedDisputes}</p>
      )}
      <h4>{copy.taskDetail.activityTimeline}</h4>
      {taskDetail.activities.length > 0 ? (
        <ul className="detail-list">
          {taskDetail.activities.map((item) => (
            <li key={item.id} className="detail-list-row">
              <span>{copy.events[item.type]}</span>
              <strong>{formatDateTime(item.createdAt, locale, timeZone)}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-line">{copy.common.noActivityYet}</p>
      )}
    </div>
  );
};
