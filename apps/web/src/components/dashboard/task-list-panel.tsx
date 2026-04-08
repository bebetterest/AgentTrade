import type { Task } from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import { formatDateTime, shortAddress } from "../../lib/dashboard-format";
import type { LoadErrorKind } from "../../lib/load-error";
import { withRateLimitMessage } from "../../lib/load-error";
import { getDashboardCopy, getTaskStatusLabel } from "./i18n";
import { buildStateChipClass, TASK_STATUS_FILTERS } from "./shared";
import { ListPanelShell } from "./list-panel-shell";

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

      <ListPanelShell
        loadError={taskLoadError}
        loadErrorMessage={taskLoadErrorMessage}
        errorTestId="tasks-error"
        onRefresh={onRefresh}
        retryLabel={copy.common.retry}
        loading={loadingTasks}
        loadingLabel={copy.common.loading}
        itemCount={tasks.length}
        emptyTestId="tasks-empty"
        emptyLabel={hasTaskFilters ? copy.taskList.emptyFiltered : copy.taskList.empty}
        sentinelRef={taskSentinelRef}
        loadingMore={loadingMoreTasks}
        loadingMoreLabel={copy.common.loadingMore}
        nextCursor={nextCursor}
        loadMoreTestId="load-more-tasks"
        loadMoreLabel={copy.taskList.loadMore}
        onLoadMore={onLoadMore}
      >
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
      </ListPanelShell>
    </>
  );
};
