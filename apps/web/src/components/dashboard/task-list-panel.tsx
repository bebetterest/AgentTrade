import Link from "next/link";
import type { Task } from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import { formatDateTime, shortAddress } from "../../lib/dashboard-format";
import { getDashboardCopy, getTaskStatusLabel } from "./i18n";
import { buildStateChipClass, TASK_STATUS_FILTERS } from "./shared";

interface TaskListPanelProps {
  locale: SupportedLocale;
  timeZone: string;
  tasks: Task[];
  taskStatus: Task["status"] | null;
  taskStatusCounts: Record<string, number>;
  hasTaskFilters: boolean;
  loadingTasks: boolean;
  loadingMoreTasks: boolean;
  taskLoadError: boolean;
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
  taskStatus,
  taskStatusCounts,
  hasTaskFilters,
  loadingTasks,
  loadingMoreTasks,
  taskLoadError,
  nextCursor,
  taskSentinelRef,
  onOpenTaskDetail,
  onSetTaskStatus,
  onRefresh,
  onLoadMore
}: TaskListPanelProps) => {
  const copy = getDashboardCopy(locale);

  return (
    <>
      <div className="status-strip">
        <button
          className={`status-pill ${taskStatus ? "" : "active"}`}
          data-testid="status-pill-all"
          type="button"
          onClick={() => onSetTaskStatus(null)}
        >
          {copy.taskList.all} ({tasks.length})
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
            {copy.taskList.loadError}
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
              <span className="muted">{task.id}</span>
            </div>
            <h3>{task.title}</h3>
            <p className="muted">{shortAddress(task.publisher)}</p>
            <p className="card-primary-number">{task.rewardPerSlot} AGC</p>
            <div className="card-meta">
              <p>{copy.taskList.reward}</p>
              <p>{copy.taskList.slots}: {task.completedAgents.length}/{task.slotsTotal}</p>
              <p>{copy.taskDetail.intended}: {task.intentCount}</p>
              <p>{copy.taskDetail.competition}: {(task.competitionRatio * 100).toFixed(0)}%</p>
              <p>{copy.taskList.deadline}: {formatDateTime(task.deadlineUtc, locale, timeZone)}</p>
            </div>
            <div className="card-actions">
              <button type="button" className="link-btn" data-testid="task-detail-trigger" onClick={() => onOpenTaskDetail(task.id)}>
                {copy.common.details}
              </button>
              <Link href={`/tasks/${task.id}`}>{copy.common.fullPage}</Link>
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
