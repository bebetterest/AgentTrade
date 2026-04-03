import { TaskStatus } from "@agentrade/types";

export const TASK_STATUS_FILTERS: TaskStatus[] = [
  TaskStatus.OPEN,
  TaskStatus.IN_PROGRESS,
  TaskStatus.CLOSED,
  TaskStatus.TERMINATED
];
