import type { Task } from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import { formatDateTime, shortAddress } from "../../lib/dashboard-format";
import type { LoadErrorKind } from "../../lib/load-error";
import { withRateLimitMessage } from "../../lib/load-error";
import { getDashboardCopy, getTaskStatusLabel } from "./i18n";
import { buildStateChipClass, TASK_STATUS_FILTERS } from "./shared";

interface TaskListPanelProps {
  locale: SupportedLocale;
  timeZone: string;
  tasks: Task[];
  taskAllCount: number;
  taskStatus: Task["status"] | null;
  taskStatusCounts: Record<string, number>;
  hasTaskFilters: boolean;
  loadingTasks: boolean;
  loadingMoreTasks: boolean;
  taskLoadError: boolean;
  taskLoadErrorKind: LoadErrorKind | null;
  nextCursor: string | null;
  taskSentinelRef: React.RefObject<HTMLDivElement | null>;
  onOpenTaskDetail: (taskId: string) => void;
  onSetTaskStatus: (status: Task["status"] | null) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
}

export const TaskListPanel = ({
  locale,
  timeZone,
  tasks,
  taskAllCount,
  taskStatus,
  taskStatusCounts,
  hasTaskFilters,
  loadingTasks,
  loadingMoreTasks,
  taskLoadError,
  taskLoadErrorKind,
  nextCursor,
  taskSentinelRef,
  onOpenTaskDetail,
  onSetTaskStatus,
  onRefresh,
  onLoadMore
}: TaskListPanelProps) => {
  const copy = getDashboardCopy(locale);
  const taskLoadErrorMessage = withRateLimitMessage(locale, copy.taskList.loadError, taskLoadErrorKind);

  return (
    <>
      <div className="status-strip">
        <button
          className={`status-pill ${taskStatus ? "" : "active"}`}
          data-testid="status-pill-all"
          type="button"
          onClick={() => onSetTaskStatus(null)}
        >
          {copy.taskList.all} ({taskAllCount})
        </button>
        {TASK_STATUS_FILTERS.map((status) => (
          <button
            key={status}
            className={`status-pill ${taskStatus === status ? "active" : ""}`}
            data-testid={`status-pill-${status.toLowerCase()}`}
            type="button"
            onClick={() => onSetTaskStatus(status)}
          >
            {getTaskStatusLabel(locale, status)} ({taskStatusCounts[status] ?? 0})
          </button>
        ))}
      </div>

      {taskLoadError ? (
        <div className="inline-error" data-testid="tasks-error">
          <p className="empty-line">
            {taskLoadErrorMessage}
          </p>
          <button type="button" className="link-btn" onClick={onRefresh}>
            {copy.common.retry}
          </button>
        </div>
      ) : null}
      {loadingTasks ? <p className="empty-line">{copy.common.loading}</p> : null}
      <div className="masonry-grid">
        {tasks.map((task) => (
          <article key={task.id} className="masonry-card" data-testid="task-card">
            <div className="card-kicker">
              <span className={buildStateChipClass(task.status)}>{getTaskStatusLabel(locale, task.status)}</span>
              <span className="muted card-id">{task.id}</span>
            </div>
            <h3>{task.title}</h3>
            <p className="card-primary-number">{task.rewardPerSlot} AGC</p>
            <div className="card-meta">
              <p><strong>{locale === "zh" ? "发布者" : "Publisher"}:</strong> {shortAddress(task.publisher)}</p>
              <p><strong>{copy.taskList.slots}:</strong> {task.completedAgents.length}/{task.slotsTotal}</p>
              <p><strong>{copy.taskDetail.intended}:</strong> {task.intentCount}</p>
              <p><strong>{copy.taskDetail.competition}:</strong> {(task.competitionRatio * 100).toFixed(0)}%</p>
              <p><strong>{copy.taskList.deadline}:</strong> {formatDateTime(task.deadlineUtc, locale, timeZone)}</p>
            </div>
            <div className="card-actions">
              <button type="button" className="link-btn" data-testid="task-detail-trigger" onClick={() => onOpenTaskDetail(task.id)}>
                {copy.common.details}
              </button>
            </div>
          </article>
        ))}
      </div>
      {tasks.length === 0 && !loadingTasks ? (
        <p className="empty-line" data-testid="tasks-empty">
          {hasTaskFilters ? copy.taskList.emptyFiltered : copy.taskList.empty}
        </p>
      ) : null}
      <div ref={taskSentinelRef} className="sentinel" />
      {loadingMoreTasks ? <p className="empty-line">{copy.common.loadingMore}</p> : null}
      {nextCursor && !loadingMoreTasks ? (
        <button type="button" className="action-btn more-btn" data-testid="load-more-tasks" onClick={onLoadMore}>
          {copy.taskList.loadMore}
        </button>
      ) : null}
    </>
  );
};
