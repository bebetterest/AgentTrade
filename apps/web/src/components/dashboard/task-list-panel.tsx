import Link from "next/link";
import type { Task } from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import { formatDateTime, shortAddress } from "../../lib/dashboard-format";
import { TASK_STATUS_FILTERS } from "./shared";

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
  return (
    <>
      <div className="status-strip">
        <button
          className={`status-pill ${taskStatus ? "" : "active"}`}
          data-testid="status-pill-all"
          type="button"
          onClick={() => onSetTaskStatus(null)}
        >
          {locale === "zh" ? "全部" : "All"} ({tasks.length})
        </button>
        {TASK_STATUS_FILTERS.map((status) => (
          <button
            key={status}
            className={`status-pill ${taskStatus === status ? "active" : ""}`}
            data-testid={`status-pill-${status.toLowerCase()}`}
            type="button"
            onClick={() => onSetTaskStatus(status)}
          >
            {status} ({taskStatusCounts[status] ?? 0})
          </button>
        ))}
      </div>

      {taskLoadError ? (
        <div className="inline-error" data-testid="tasks-error">
          <p className="empty-line">
            {locale === "zh" ? "任务列表加载失败，请重试。" : "Task list failed to load. Retry with refresh."}
          </p>
          <button type="button" className="link-btn" onClick={onRefresh}>
            {locale === "zh" ? "重试" : "Retry"}
          </button>
        </div>
      ) : null}
      {loadingTasks ? <p className="empty-line">{locale === "zh" ? "加载中..." : "Loading..."}</p> : null}
      <div className="masonry-grid">
        {tasks.map((task) => (
          <article key={task.id} className="masonry-card" data-testid="task-card">
            <h3>{task.title}</h3>
            <p className="muted">{shortAddress(task.publisher)}</p>
            <span className="state-chip">{task.status}</span>
            <p>{locale === "zh" ? "奖励" : "Reward"}: {task.rewardPerSlot} AGC</p>
            <p>{locale === "zh" ? "槽位" : "Slots"}: {task.completedAgents.length}/{task.slotsTotal}</p>
            <p>{locale === "zh" ? "截止" : "Deadline"}: {formatDateTime(task.deadlineUtc, locale, timeZone)}</p>
            <div className="card-actions">
              <button type="button" className="link-btn" data-testid="task-detail-trigger" onClick={() => onOpenTaskDetail(task.id)}>
                {locale === "zh" ? "详情" : "Details"}
              </button>
              <Link href={`/tasks/${task.id}`}>{locale === "zh" ? "完整页" : "Full page"}</Link>
            </div>
          </article>
        ))}
      </div>
      {tasks.length === 0 && !loadingTasks ? (
        <p className="empty-line" data-testid="tasks-empty">
          {hasTaskFilters
            ? locale === "zh"
              ? "筛选后暂无任务"
              : "No tasks match current filters"
            : locale === "zh"
              ? "暂无任务"
              : "No tasks"}
        </p>
      ) : null}
      <div ref={taskSentinelRef} className="sentinel" />
      {loadingMoreTasks ? <p className="empty-line">{locale === "zh" ? "加载更多..." : "Loading more..."}</p> : null}
      {nextCursor && !loadingMoreTasks ? (
        <button type="button" className="action-btn more-btn" data-testid="load-more-tasks" onClick={onLoadMore}>
          {locale === "zh" ? "加载更多任务" : "Load more tasks"}
        </button>
      ) : null}
    </>
  );
};
