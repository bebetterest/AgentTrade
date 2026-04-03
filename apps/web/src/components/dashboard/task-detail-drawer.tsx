import type { ActivityEvent, Dispute, Task } from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import { formatDateTime, shortAddress } from "../../lib/dashboard-format";
import { renderSafeMarkdown } from "../../lib/markdown";
import { EVENT_LABELS } from "./shared";

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
  if (taskDetail.loading) {
    return <p className="empty-line">{locale === "zh" ? "加载中..." : "Loading..."}</p>;
  }

  if (taskDetail.error) {
    return (
      <div className="inline-error" data-testid="task-detail-error">
        <p className="empty-line">
          {locale === "zh" ? "任务详情加载失败，请重试。" : "Task details failed to load. Retry."}
        </p>
        <button type="button" className="link-btn" data-testid="retry-task-detail" onClick={onRetry}>
          {locale === "zh" ? "重试" : "Retry"}
        </button>
      </div>
    );
  }

  if (!taskDetail.task) {
    return <p className="empty-line">{locale === "zh" ? "任务不存在" : "Task not found"}</p>;
  }

  const task = taskDetail.task;

  return (
    <div className="detail-block">
      <h3>{task.title}</h3>
      <span className="state-chip">{task.status}</span>
      <div className="detail-grid">
        <div className="detail-card">
          <div className="metric-line">
            <span>{locale === "zh" ? "发布者" : "Publisher"}</span>
            <strong>
              <button type="button" className="link-btn inline-link" onClick={() => onOpenAgentDetail(task.publisher)}>
                {shortAddress(task.publisher)}
              </button>
            </strong>
          </div>
          <div className="metric-line"><span>{locale === "zh" ? "奖励" : "Reward"}</span><strong>{task.rewardPerSlot} AGC</strong></div>
          <div className="metric-line"><span>{locale === "zh" ? "税额" : "Tax"}</span><strong>{task.taxAmount} AGC</strong></div>
          <div className="metric-line"><span>{locale === "zh" ? "剩余托管" : "Escrow Remaining"}</span><strong>{task.rewardEscrowRemaining} AGC</strong></div>
          <div className="metric-line"><span>{locale === "zh" ? "槽位进度" : "Slot Progress"}</span><strong>{task.completedAgents.length}/{task.slotsTotal}</strong></div>
          <div className="metric-line"><span>{locale === "zh" ? "截止时间" : "Deadline"}</span><strong>{formatDateTime(task.deadlineUtc, locale, timeZone)}</strong></div>
        </div>
        <div className="detail-card">
          <h4>{locale === "zh" ? "参与 Agent" : "Participants"}</h4>
          <p className="muted">{locale === "zh" ? "已接受" : "Accepted"}</p>
          {task.acceptedAgents.length > 0 ? (
            <div className="chip-list">
              {task.acceptedAgents.map((address) => (
                <button key={address} type="button" className="link-btn" onClick={() => onOpenAgentDetail(address)}>
                  {shortAddress(address)}
                </button>
              ))}
            </div>
          ) : (
            <p className="empty-line">{locale === "zh" ? "暂无" : "None"}</p>
          )}
          <p className="muted">{locale === "zh" ? "已完成" : "Completed"}</p>
          {task.completedAgents.length > 0 ? (
            <div className="chip-list">
              {task.completedAgents.map((address) => (
                <button key={address} type="button" className="link-btn" onClick={() => onOpenAgentDetail(address)}>
                  {shortAddress(address)}
                </button>
              ))}
            </div>
          ) : (
            <p className="empty-line">{locale === "zh" ? "暂无" : "None"}</p>
          )}
        </div>
      </div>
      <div className="markdown">{renderSafeMarkdown(task.descriptionMd)}</div>
      <h4>{locale === "zh" ? "验收标准" : "Acceptance Criteria"}</h4>
      <div className="markdown">{renderSafeMarkdown(task.acceptanceCriteria)}</div>
      <h4>{locale === "zh" ? "关联争议" : "Related disputes"}</h4>
      {taskDetail.disputes.length > 0 ? (
        <ul className="detail-list">
          {taskDetail.disputes.map((item) => (
            <li key={item.id} className="detail-card">
              <div className="section-head compact-head">
                <strong>{item.id}</strong>
                <span className="state-chip">{item.status}</span>
              </div>
              <p className="muted">
                {locale === "zh" ? "发起人" : "Opener"}:{" "}
                <button type="button" className="link-btn inline-link" onClick={() => onOpenAgentDetail(item.opener)}>
                  {shortAddress(item.opener)}
                </button>
              </p>
              <p>{item.reasonMd}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-line">{locale === "zh" ? "暂无关联争议" : "No related disputes yet"}</p>
      )}
      <h4>{locale === "zh" ? "事件时间线" : "Activity timeline"}</h4>
      {taskDetail.activities.length > 0 ? (
        <ul className="detail-list">
          {taskDetail.activities.map((item) => (
            <li key={item.id} className="detail-list-row">
              <span>{EVENT_LABELS[item.type][locale]}</span>
              <strong>{formatDateTime(item.createdAt, locale, timeZone)}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-line">{locale === "zh" ? "暂无事件" : "No activity yet"}</p>
      )}
    </div>
  );
};
