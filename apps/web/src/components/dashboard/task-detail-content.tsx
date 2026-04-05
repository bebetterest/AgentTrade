import type { ActivityEvent, Dispute, Task, TaskIntention } from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import { formatDateTime, shortAddress } from "../../lib/dashboard-format";
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
  disputes: Dispute[];
  activities: ActivityEvent[];
  onOpenAgentDetail?: (address: string) => void;
  getAgentHref?: (address: string) => string;
}

export const TaskDetailContent = ({
  locale,
  timeZone,
  task,
  intentions,
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
          <MetricLine
            label={copy.taskDetail.publisher}
            value={<EntityLink address={task.publisher} label={shortAddress(task.publisher)} onClick={onOpenAgentDetail ? () => onOpenAgentDetail(task.publisher) : undefined} href={getAgentHref?.(task.publisher)} />}
          />
          <MetricLine label={copy.taskDetail.reward} value={`${task.rewardPerSlot} AGC`} />
          <MetricLine label={copy.taskDetail.tax} value={`${task.taxAmount} AGC`} />
          <MetricLine label={copy.taskDetail.escrowRemaining} value={`${task.rewardEscrowRemaining} AGC`} />
          <MetricLine label={copy.taskDetail.slotProgress} value={`${task.completedAgents.length}/${task.slotsTotal}`} />
          <MetricLine label={copy.taskDetail.intended} value={String(task.intentCount)} />
          <MetricLine label={copy.taskDetail.competition} value={`${(task.competitionRatio * 100).toFixed(0)}%`} />
          <MetricLine label={copy.taskDetail.deadline} value={formatDateTime(task.deadlineUtc, locale, timeZone)} />
        </div>

        <div className="detail-card">
          <h4>{copy.taskDetail.participants}</h4>
          <p className="muted">{copy.taskDetail.intended}</p>
          {intentions.length > 0 ? (
            <div className="chip-list">
              {intentions.map((item) => (
                <span key={item.id}>
                  <EntityLink address={item.agent} label={shortAddress(item.agent)} onClick={onOpenAgentDetail ? () => onOpenAgentDetail(item.agent) : undefined} href={getAgentHref?.(item.agent)} />
                </span>
              ))}
            </div>
          ) : (
            <p className="empty-line">{copy.taskDetail.none}</p>
          )}

          <p className="muted">{copy.taskDetail.completed}</p>
          {task.completedAgents.length > 0 ? (
            <div className="chip-list">
              {task.completedAgents.map((address) => (
                <span key={address}>
                  <EntityLink address={address} label={shortAddress(address)} onClick={onOpenAgentDetail ? () => onOpenAgentDetail(address) : undefined} href={getAgentHref?.(address)} />
                </span>
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
                <StateChip status={item.status} label={getDisputeStatusLabel(locale, item.status)} />
              </div>
              <p className="muted">
                {copy.taskDetail.opener}: <EntityLink address={item.opener} label={shortAddress(item.opener)} onClick={onOpenAgentDetail ? () => onOpenAgentDetail(item.opener) : undefined} href={getAgentHref?.(item.opener)} />
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
        <ActivityTimeline
          activities={activities}
          locale={locale}
          timeZone={timeZone}
          renderLinks={(item) => (
            <>
              <span>{locale === "zh" ? "执行方" : "Actor"}: <EntityLink address={item.actor} label={shortAddress(item.actor)} onClick={onOpenAgentDetail ? () => onOpenAgentDetail(item.actor) : undefined} href={getAgentHref?.(item.actor)} /></span>
              <span>{locale === "zh" ? "周期" : "Cycle"}: {item.cycleId}</span>
              {item.disputeId ? <span>{locale === "zh" ? "争议" : "Dispute"}: {item.disputeId}</span> : null}
            </>
          )}
        />
      ) : (
        <p className="empty-line">{copy.common.noActivityYet}</p>
      )}
    </div>
  );
};
