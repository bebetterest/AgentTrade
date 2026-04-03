import Link from "next/link";
import type { ActivityEvent, Dispute, Task } from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import { formatDateTime, shortAddress } from "../../lib/dashboard-format";
import { renderSafeMarkdown } from "../../lib/markdown";
import { getDashboardEventLabel, getDisputeStatusLabel } from "./i18n";
import { buildStateChipClass } from "./shared";

interface DisputeDetailContentProps {
  locale: SupportedLocale;
  timeZone: string;
  dispute: Dispute;
  task: Task | null;
  activities: ActivityEvent[];
  onOpenAgentDetail?: (address: string) => void;
  getAgentHref?: (address: string) => string;
  getTaskHref?: (taskId: string) => string;
  showOverviewTitle?: boolean;
}

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
    reward: "Reward",
    deadline: "Deadline",
    slotProgress: "Slot Progress",
    reason: "Reason",
    timeline: "Activity Timeline",
    noActivity: "No dispute activity yet",
    actor: "Actor",
    cycle: "Cycle",
    disputeRef: "Dispute"
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
    reward: "奖励",
    deadline: "截止时间",
    slotProgress: "槽位进度",
    reason: "争议原因",
    timeline: "事件时间线",
    noActivity: "暂无争议事件",
    actor: "执行方",
    cycle: "周期",
    disputeRef: "争议"
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

  if (getAgentHref) {
    return (
      <Link className="inline-link" href={getAgentHref(address)}>
        {shortAddress(address)}
      </Link>
    );
  }

  return <span>{shortAddress(address)}</span>;
};

const renderTask = (task: Task | null, taskId: string, getTaskHref: ((taskId: string) => string) | undefined) => {
  if (!getTaskHref) {
    return <span>{task?.title || taskId}</span>;
  }

  return (
    <Link className="inline-link" href={getTaskHref(taskId)}>
      {task?.title || taskId}
    </Link>
  );
};

export const DisputeDetailContent = ({
  locale,
  timeZone,
  dispute,
  task,
  activities,
  onOpenAgentDetail,
  getAgentHref,
  getTaskHref,
  showOverviewTitle = true
}: DisputeDetailContentProps) => {
  const t = copy[locale];
  const disputeStatusLabel = getDisputeStatusLabel(locale, dispute.status);

  return (
    <div className="detail-block">
      {showOverviewTitle ? <h3>{t.overview}</h3> : null}
      <div className="detail-grid">
        <div className="detail-card">
          <div className="metric-line"><span>{t.disputeId}</span><strong>{dispute.id}</strong></div>
          <div className="metric-line"><span>{t.task}</span><strong>{renderTask(task, dispute.taskId, getTaskHref)}</strong></div>
          <div className="metric-line"><span>{t.submission}</span><strong>{dispute.submissionId}</strong></div>
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
        <div className="detail-card">
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
        </div>
      </div>

      <h4>{t.reason}</h4>
      <div className="markdown">{renderSafeMarkdown(dispute.reasonMd)}</div>

      <h4>{t.timeline}</h4>
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
                <span>
                  {t.actor}: {renderAgent(item.actor, onOpenAgentDetail, getAgentHref)}
                </span>
                {item.taskId ? (
                  <span>
                    {t.task}: {renderTask(task, item.taskId, getTaskHref)}
                  </span>
                ) : null}
                {item.disputeId ? (
                  <span>
                    {t.disputeRef}: {item.disputeId}
                  </span>
                ) : null}
                <span>
                  {t.cycle}: {item.cycleId}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-line">{t.noActivity}</p>
      )}
    </div>
  );
};
