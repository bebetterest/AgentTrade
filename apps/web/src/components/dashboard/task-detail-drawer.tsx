import type { ActivityEvent, Dispute, Task } from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import { formatDateTime } from "../../lib/dashboard-format";
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
}

export const TaskDetailDrawer = ({ locale, timeZone, taskDetail, onRetry }: TaskDetailDrawerProps) => {
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

  return (
    <div className="detail-block">
      <h3>{taskDetail.task.title}</h3>
      <span className="state-chip">{taskDetail.task.status}</span>
      <div className="markdown">{renderSafeMarkdown(taskDetail.task.descriptionMd)}</div>
      <h4>{locale === "zh" ? "关联争议" : "Related disputes"}</h4>
      <ul>
        {taskDetail.disputes.map((item) => (
          <li key={item.id}>{item.id} · {item.status}</li>
        ))}
      </ul>
      <h4>{locale === "zh" ? "事件时间线" : "Activity timeline"}</h4>
      <ul>
        {taskDetail.activities.map((item) => (
          <li key={item.id}>
            {EVENT_LABELS[item.type][locale]} · {formatDateTime(item.createdAt, locale, timeZone)}
          </li>
        ))}
      </ul>
    </div>
  );
};
