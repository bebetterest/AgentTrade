import Link from "next/link";
import type { ActivityEvent, Dispute, Task, TaskIntention } from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import { getDashboardCopy, getTaskStatusLabel } from "./i18n";
import { buildStateChipClass } from "./shared";
import { TaskDetailContent } from "./task-detail-content";

interface TaskDetailDrawerProps {
  locale: SupportedLocale;
  timeZone: string;
  taskDetail: {
    loading: boolean;
    error: boolean;
    task: Task | null;
    intentions: TaskIntention[];
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
      <div className="card-actions">
        <span className="muted">{task.id}</span>
        <Link href={`/tasks/${task.id}`}>{copy.common.fullPage}</Link>
      </div>
      <h3>{task.title}</h3>
      <span className={buildStateChipClass(task.status)}>{getTaskStatusLabel(locale, task.status)}</span>
      <TaskDetailContent
        locale={locale}
        timeZone={timeZone}
        task={task}
        intentions={taskDetail.intentions}
        disputes={taskDetail.disputes}
        activities={taskDetail.activities}
        onOpenAgentDetail={onOpenAgentDetail}
      />
    </div>
  );
};
