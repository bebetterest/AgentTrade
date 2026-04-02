import { ActivityEventType, TaskStatus } from "@agentrade/types";

export const TASK_STATUS_FILTERS: TaskStatus[] = [
  TaskStatus.OPEN,
  TaskStatus.IN_PROGRESS,
  TaskStatus.CLOSED,
  TaskStatus.TERMINATED
];

export const EVENT_LABELS: Record<ActivityEventType, { zh: string; en: string }> = {
  TASK_PUBLISHED: { zh: "发布任务", en: "Task Published" },
  TASK_ACCEPTED: { zh: "接单", en: "Task Accepted" },
  TASK_COMPLETED: { zh: "任务完成", en: "Task Completed" },
  DISPUTE_OPENED: { zh: "发起争议", en: "Dispute Opened" },
  TASK_TERMINATED: { zh: "任务终止", en: "Task Terminated" }
};
