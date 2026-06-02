import {
  DisputeStatus,
  SubmissionStatus,
  TaskStatus,
  TODO_ACTION_REQUIRED_TYPES,
  TODO_GROUP_SCOPE_VALUES,
  TODO_GROUP_TYPE_VALUES,
  TODO_WAITING_TYPES,
  type Address,
  type DisputeStatus as DisputeStatusType,
  type IsoDateString,
  type SubmissionStatus as SubmissionStatusType,
  type TaskStatus as TaskStatusType,
  type TodoGroup,
  type TodoGroupScope,
  type TodoGroupType,
  type TodoItemSummary,
  type TodoResourceKind,
  type TodoScope,
  type TodosResponse
} from "@agentrade/types";
import { DomainError } from "../domain/errors.js";
import {
  clampPageLimit,
  encodeKeysetCursor,
  nextCursorOffset,
  parseListCursor,
  type CursorValues,
  type ParsedCursor
} from "../pagination/cursor.js";

const ACTIVE_TASK_STATUSES = new Set<TaskStatusType>([TaskStatus.OPEN, TaskStatus.IN_PROGRESS]);
const ACTION_REQUIRED_TYPE_SET = new Set<TodoGroupType>(TODO_ACTION_REQUIRED_TYPES);
const WAITING_TYPE_SET = new Set<TodoGroupType>(TODO_WAITING_TYPES);

export interface TodoTaskRecord {
  id: string;
  publisher: Address;
  title: string;
  status: TaskStatusType;
  deadlineUtc: IsoDateString;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

export interface TodoSubmissionRecord {
  id: string;
  taskId: string;
  agent: Address;
  taskPublisher: Address;
  taskTitle: string;
  taskStatus: TaskStatusType;
  taskDeadlineUtc: IsoDateString | null;
  status: SubmissionStatusType;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

export interface TodoDisputeRecord {
  id: string;
  taskId: string;
  submissionId: string;
  opener: Address;
  taskPublisher: Address;
  submissionAgent: Address;
  taskTitle: string;
  taskDeadlineUtc: IsoDateString | null;
  counterpartyReasonMd: string | null;
  status: DisputeStatusType;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

export interface TodoIntentionRecord {
  id: string;
  taskId: string;
  agent: Address;
  createdAt: IsoDateString;
}

export interface TodoTargetMentionRecord {
  id: string;
  taskId: string;
  publisher: Address;
  targetAgent: Address;
  taskTitle: string;
  taskStatus: TaskStatusType;
  taskDeadlineUtc: IsoDateString | null;
  status: "OPEN" | "DISMISSED";
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

export interface BuildTodosResponseInput {
  address: Address;
  scope: TodoScope;
  type?: TodoGroupType;
  limit: number;
  cursor?: string;
  generatedAt?: IsoDateString;
  tasks: TodoTaskRecord[];
  submissions: TodoSubmissionRecord[];
  disputes: TodoDisputeRecord[];
  intentions: TodoIntentionRecord[];
  targetMentions: TodoTargetMentionRecord[];
}

interface TodoGroupMetadata {
  scope: TodoGroupScope;
  resourceKind: TodoResourceKind;
  title: string;
  description: string;
}

const TODO_GROUPS_BY_SCOPE: Record<TodoGroupScope, readonly TodoGroupType[]> = {
  action_required: TODO_ACTION_REQUIRED_TYPES,
  waiting: TODO_WAITING_TYPES
};

export const TODO_GROUP_METADATA: Record<TodoGroupType, TodoGroupMetadata> = {
  targeted_task_mention: {
    scope: "action_required",
    resourceKind: "task",
    title: "Targeted Task Mention",
    description: "This account was directly mentioned by the publisher as a suggested agent for this task."
  },
  latest_rejected_submission_no_followup: {
    scope: "action_required",
    resourceKind: "submission",
    title: "Latest Rejected Submission Needs Follow-up",
    description: "The latest submission for this task and agent was rejected, and there is no newer submission or open dispute yet."
  },
  open_dispute_counterparty_response_required: {
    scope: "action_required",
    resourceKind: "dispute",
    title: "Open Dispute Counterparty Response Required",
    description: "This account is the counterparty on an open dispute and still needs to submit its response."
  },
  published_task_submission_pending_review: {
    scope: "action_required",
    resourceKind: "submission",
    title: "Published Task Submission Pending Review",
    description: "A submitted output under this account's published task still needs confirm or reject handling."
  },
  expired_published_task_cleanup_required: {
    scope: "action_required",
    resourceKind: "task",
    title: "Expired Published Task Cleanup Required",
    description: "A published task passed its deadline and still needs publisher cleanup because it remains open."
  },
  intended_task_never_submitted: {
    scope: "action_required",
    resourceKind: "task",
    title: "Intended Task Never Submitted",
    description: "This account intended the task, has never submitted work for it, and the deadline has not passed yet."
  },
  submitted_submission_waiting_review: {
    scope: "waiting",
    resourceKind: "submission",
    title: "Submitted Submission Waiting Review",
    description: "This submitted output is waiting for the publisher to review it."
  },
  published_task_waiting_new_submission: {
    scope: "waiting",
    resourceKind: "task",
    title: "Published Task Waiting New Submission",
    description: "The published task is still active and currently has no pending submissions or open disputes."
  },
  open_dispute_waiting_resolution: {
    scope: "waiting",
    resourceKind: "dispute",
    title: "Open Dispute Waiting Resolution",
    description: "The open dispute is now waiting for supervisor voting or final resolution for this account."
  }
};

const lower = (value: string): string => value.toLowerCase();
const isBlank = (value: string | null | undefined): boolean => !value || value.trim().length === 0;
const toDateMs = (value: string | null | undefined): number | null => {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const dedupeById = <T extends { id: string }>(items: readonly T[]): T[] => {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    deduped.push(item);
  }
  return deduped;
};

const dedupeTasksById = (items: readonly TodoTaskRecord[]): TodoTaskRecord[] => dedupeById(items);
const dedupeSubmissionsById = (items: readonly TodoSubmissionRecord[]): TodoSubmissionRecord[] => dedupeById(items);
const dedupeDisputesById = (items: readonly TodoDisputeRecord[]): TodoDisputeRecord[] => dedupeById(items);
const dedupeIntentionsById = (items: readonly TodoIntentionRecord[]): TodoIntentionRecord[] => dedupeById(items);
const dedupeTargetMentionsById = (items: readonly TodoTargetMentionRecord[]): TodoTargetMentionRecord[] => dedupeById(items);

const todoCursorResource = (type: TodoGroupType): string => `todos:${type}`;

const compareTodoAfterCursor = (
  item: TodoItemSummary,
  cursorValues: CursorValues
): number => {
  const cursorId = cursorValues.id;
  const cursorPrimary = cursorValues.primary;
  if (typeof cursorId !== "string" || cursorId.length === 0) {
    throw new DomainError("INVALID_CURSOR", "cursor id must be a non-empty string", 400);
  }
  if (typeof cursorPrimary !== "string" || cursorPrimary.length === 0) {
    throw new DomainError("INVALID_CURSOR", "cursor primary must be a non-empty ISO datetime string", 400);
  }
  let delta = item.updatedAt.localeCompare(cursorPrimary);
  if (delta === 0) {
    delta = item.primaryId.localeCompare(cursorId);
  }
  return -delta;
};

const sortTodoItems = (items: TodoItemSummary[]): TodoItemSummary[] =>
  items.sort((left, right) => {
    const updatedAtDelta = right.updatedAt.localeCompare(left.updatedAt);
    if (updatedAtDelta !== 0) {
      return updatedAtDelta;
    }
    return right.primaryId.localeCompare(left.primaryId);
  });

const paginateTodoItems = (
  items: TodoItemSummary[],
  input: {
    type: TodoGroupType;
    limit: number;
    cursor?: string;
  }
): Pick<TodoGroup, "items" | "nextCursor" | "totalCount"> => {
  const boundedLimit = clampPageLimit(input.limit);
  const parsedCursor: ParsedCursor = input.cursor
    ? parseListCursor(input.cursor, {
        resource: todoCursorResource(input.type),
        sort: "updatedAt",
        order: "desc"
      })
    : { mode: "start", offset: 0 };
  const sorted = sortTodoItems(items);
  const startIndex =
    parsedCursor.mode === "legacy-offset"
      ? Math.min(parsedCursor.offset, sorted.length)
      : parsedCursor.mode === "keyset"
        ? sorted.findIndex((item) => compareTodoAfterCursor(item, parsedCursor.values) > 0)
        : 0;
  const normalizedStart = startIndex < 0 ? sorted.length : startIndex;
  const pageWithSentinel = sorted.slice(normalizedStart, normalizedStart + boundedLimit + 1);
  const hasMore = pageWithSentinel.length > boundedLimit;
  const pageItems = hasMore ? pageWithSentinel.slice(0, boundedLimit) : pageWithSentinel;
  const nextCursor =
    hasMore && pageItems.length > 0
      ? encodeKeysetCursor({
          resource: todoCursorResource(input.type),
          sort: "updatedAt",
          order: "desc",
          offset: nextCursorOffset(parsedCursor, pageItems.length),
          values: {
            primary: pageItems[pageItems.length - 1]!.updatedAt,
            id: pageItems[pageItems.length - 1]!.primaryId
          }
        })
      : null;

  return {
    items: pageItems,
    nextCursor,
    totalCount: sorted.length
  };
};

const toTaskItem = (task: TodoTaskRecord): TodoItemSummary => ({
  resourceKind: "task",
  primaryId: task.id,
  title: task.title,
  taskId: task.id,
  submissionId: null,
  disputeId: null,
  status: task.status,
  createdAt: task.createdAt,
  updatedAt: task.updatedAt,
  deadlineUtc: task.deadlineUtc
});

const toTargetMentionItem = (mention: TodoTargetMentionRecord): TodoItemSummary => ({
  resourceKind: "task",
  primaryId: mention.id,
  title: mention.taskTitle,
  taskId: mention.taskId,
  submissionId: null,
  disputeId: null,
  status: mention.taskStatus,
  createdAt: mention.createdAt,
  updatedAt: mention.updatedAt,
  deadlineUtc: mention.taskDeadlineUtc
});

const toSubmissionItem = (submission: TodoSubmissionRecord): TodoItemSummary => ({
  resourceKind: "submission",
  primaryId: submission.id,
  title: submission.taskTitle,
  taskId: submission.taskId,
  submissionId: submission.id,
  disputeId: null,
  status: submission.status,
  createdAt: submission.createdAt,
  updatedAt: submission.updatedAt,
  deadlineUtc: submission.taskDeadlineUtc
});

const toDisputeItem = (dispute: TodoDisputeRecord): TodoItemSummary => ({
  resourceKind: "dispute",
  primaryId: dispute.id,
  title: dispute.taskTitle,
  taskId: dispute.taskId,
  submissionId: dispute.submissionId,
  disputeId: dispute.id,
  status: dispute.status,
  createdAt: dispute.createdAt,
  updatedAt: dispute.updatedAt,
  deadlineUtc: dispute.taskDeadlineUtc
});

const resolveDisputeCounterparty = (dispute: TodoDisputeRecord): string | null => {
  const opener = lower(dispute.opener);
  const publisher = lower(dispute.taskPublisher);
  const submissionAgent = lower(dispute.submissionAgent);
  if (opener === publisher) {
    return submissionAgent;
  }
  if (opener === submissionAgent) {
    return publisher;
  }
  return null;
};

const selectLatestSubmissionByTaskAndAgent = (
  submissions: readonly TodoSubmissionRecord[]
): TodoSubmissionRecord[] => {
  const latestByKey = new Map<string, TodoSubmissionRecord>();
  for (const submission of submissions) {
    const key = `${submission.taskId}:${lower(submission.agent)}`;
    const current = latestByKey.get(key);
    if (!current) {
      latestByKey.set(key, submission);
      continue;
    }
    const createdDelta = submission.createdAt.localeCompare(current.createdAt);
    if (createdDelta > 0 || (createdDelta === 0 && submission.id.localeCompare(current.id) > 0)) {
      latestByKey.set(key, submission);
    }
  }
  return [...latestByKey.values()];
};

const ensureTypeMatchesScope = (scope: TodoScope, type: TodoGroupType | undefined): void => {
  if (!type) {
    return;
  }
  if (!TODO_GROUP_TYPE_VALUES.includes(type)) {
    throw new DomainError("INVALID_TODO_TYPE", `unsupported todo type '${type}'`, 400);
  }
  if (scope === "all") {
    return;
  }
  const allowed = TODO_GROUPS_BY_SCOPE[scope];
  if (!allowed.includes(type)) {
    throw new DomainError(
      "INVALID_TODO_TYPE",
      `todo type '${type}' does not belong to scope '${scope}'`,
      400
    );
  }
};

const ensureScope = (scope: TodoScope): TodoScope => {
  if ((TODO_GROUP_SCOPE_VALUES as readonly string[]).includes(scope) || scope === "all") {
    return scope;
  }
  throw new DomainError("INVALID_TODO_SCOPE", `unsupported todo scope '${scope}'`, 400);
};

const todoTypesForScope = (scope: TodoScope, type: TodoGroupType | undefined): TodoGroupType[] => {
  if (type) {
    return [type];
  }
  if (scope === "all") {
    return [...TODO_ACTION_REQUIRED_TYPES, ...TODO_WAITING_TYPES];
  }
  return [...TODO_GROUPS_BY_SCOPE[scope]];
};

export const buildTodosResponse = (input: BuildTodosResponseInput): TodosResponse => {
  const scope = ensureScope(input.scope);
  ensureTypeMatchesScope(scope, input.type);

  const addressLower = lower(input.address);
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const nowMs = toDateMs(generatedAt) ?? Date.now();
  const tasks = dedupeTasksById(input.tasks);
  const submissions = dedupeSubmissionsById(input.submissions);
  const disputes = dedupeDisputesById(input.disputes);
  const intentions = dedupeIntentionsById(input.intentions);
  const targetMentions = dedupeTargetMentionsById(input.targetMentions);

  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const actorIntentions = intentions.filter((item) => lower(item.agent) === addressLower);
  const actorSubmissions = submissions.filter((item) => lower(item.agent) === addressLower);
  const latestActorSubmissions = selectLatestSubmissionByTaskAndAgent(actorSubmissions);

  const openDisputes = disputes.filter((item) => item.status === DisputeStatus.OPEN);
  const openDisputeSubmissionIds = new Set(openDisputes.map((item) => item.submissionId));
  const publishedPendingReviewTaskIds = new Set(
    submissions
      .filter(
        (item) =>
          lower(item.taskPublisher) === addressLower && item.status === SubmissionStatus.SUBMITTED
      )
      .map((item) => item.taskId)
  );
  const publishedOpenDisputeTaskIds = new Set(
    openDisputes
      .filter((item) => lower(item.taskPublisher) === addressLower)
      .map((item) => item.taskId)
  );
  const actorSubmittedTaskIds = new Set(actorSubmissions.map((item) => item.taskId));
  const actorIntendedTaskIds = new Set(actorIntentions.map((item) => item.taskId));

  const computedItems: Record<TodoGroupType, TodoItemSummary[]> = {
    targeted_task_mention: targetMentions
      .filter((item) => lower(item.targetAgent) === addressLower)
      .filter((item) => item.status === "OPEN")
      .filter((item) => ACTIVE_TASK_STATUSES.has(item.taskStatus))
      .filter((item) => {
        const deadlineMs = toDateMs(item.taskDeadlineUtc);
        return deadlineMs === null || deadlineMs > nowMs;
      })
      .filter((item) => !actorIntendedTaskIds.has(item.taskId))
      .map((item) => toTargetMentionItem(item)),
    latest_rejected_submission_no_followup: latestActorSubmissions
      .filter(
        (item) =>
          item.status === SubmissionStatus.REJECTED && !openDisputeSubmissionIds.has(item.id)
      )
      .map((item) => toSubmissionItem(item)),
    open_dispute_counterparty_response_required: openDisputes
      .filter(
        (item) =>
          resolveDisputeCounterparty(item) === addressLower && isBlank(item.counterpartyReasonMd)
      )
      .map((item) => toDisputeItem(item)),
    published_task_submission_pending_review: submissions
      .filter(
        (item) =>
          lower(item.taskPublisher) === addressLower && item.status === SubmissionStatus.SUBMITTED
      )
      .map((item) => toSubmissionItem(item)),
    expired_published_task_cleanup_required: tasks
      .filter((item) => lower(item.publisher) === addressLower)
      .filter((item) => ACTIVE_TASK_STATUSES.has(item.status))
      .filter((item) => {
        const deadlineMs = toDateMs(item.deadlineUtc);
        return deadlineMs !== null && deadlineMs < nowMs;
      })
      .filter((item) => !publishedPendingReviewTaskIds.has(item.id))
      .filter((item) => !publishedOpenDisputeTaskIds.has(item.id))
      .map((item) => toTaskItem(item)),
    intended_task_never_submitted: actorIntentions
      .map((item) => tasksById.get(item.taskId) ?? null)
      .filter((item): item is TodoTaskRecord => item !== null)
      .filter((item) => ACTIVE_TASK_STATUSES.has(item.status))
      .filter((item) => {
        const deadlineMs = toDateMs(item.deadlineUtc);
        return deadlineMs !== null && deadlineMs > nowMs;
      })
      .filter((item) => !actorSubmittedTaskIds.has(item.id))
      .map((item) => toTaskItem(item)),
    submitted_submission_waiting_review: actorSubmissions
      .filter((item) => item.status === SubmissionStatus.SUBMITTED)
      .map((item) => toSubmissionItem(item)),
    published_task_waiting_new_submission: tasks
      .filter((item) => lower(item.publisher) === addressLower)
      .filter((item) => ACTIVE_TASK_STATUSES.has(item.status))
      .filter((item) => {
        const deadlineMs = toDateMs(item.deadlineUtc);
        return deadlineMs !== null && deadlineMs > nowMs;
      })
      .filter((item) => !publishedPendingReviewTaskIds.has(item.id))
      .filter((item) => !publishedOpenDisputeTaskIds.has(item.id))
      .map((item) => toTaskItem(item)),
    open_dispute_waiting_resolution: openDisputes
      .filter(
        (item) =>
          lower(item.opener) === addressLower ||
          (resolveDisputeCounterparty(item) === addressLower && !isBlank(item.counterpartyReasonMd))
      )
      .map((item) => toDisputeItem(item))
  };

  const groups = todoTypesForScope(scope, input.type).map((type) => {
    const metadata = TODO_GROUP_METADATA[type];
    const pagination = paginateTodoItems(computedItems[type], {
      type,
      limit: input.limit,
      cursor: input.type === type ? input.cursor : undefined
    });

    return {
      scope: metadata.scope,
      type,
      resourceKind: metadata.resourceKind,
      title: metadata.title,
      description: metadata.description,
      totalCount: pagination.totalCount,
      nextCursor: pagination.nextCursor,
      items: pagination.items
    } satisfies TodoGroup;
  });

  return {
    address: input.address,
    scope,
    selectedType: input.type ?? null,
    generatedAt,
    groups
  };
};
