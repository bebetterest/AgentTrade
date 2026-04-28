import { Prisma, type PrismaClient } from "@prisma/client";
import {
  DisputeStatus as DomainDisputeStatus,
  SubmissionStatus as DomainSubmissionStatus,
  TaskStatus as DomainTaskStatus,
  TODO_ACTION_REQUIRED_TYPES,
  TODO_GROUP_SCOPE_VALUES,
  TODO_GROUP_TYPE_VALUES,
  TODO_WAITING_TYPES,
  type Address,
  type TodoGroup,
  type TodoGroupType,
  type TodoItemSummary,
  type TodoScope,
  type TodosResponse
} from "@agentrade/types";
import { DomainError } from "../domain/errors.js";
import { TODO_GROUP_METADATA } from "../todos/read-model.js";
import {
  clampPageLimit,
  encodeKeysetCursor,
  nextCursorOffset,
  parseListCursor,
  type ParsedCursor
} from "../pagination/cursor.js";

export interface TodosDirectQueryInput {
  address: Address;
  scope: TodoScope;
  type?: TodoGroupType;
  cursor?: string;
  limit: number;
  generatedAt?: string;
}

interface TodoPageContext {
  boundedLimit: number;
  parsedCursor: ParsedCursor;
}

interface TodoPageResult {
  items: TodoItemSummary[];
  nextCursor: string | null;
  totalCount: number;
}

interface LatestRejectedSubmissionRow {
  id: string;
  taskId: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  taskTitle: string;
  taskDeadlineUtc: Date;
}

interface TodoDisputeRow {
  id: string;
  taskId: string;
  submissionId: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  taskTitle: string;
  taskDeadlineUtc: Date;
}

const ACTIVE_TASK_STATUSES = [DomainTaskStatus.OPEN, DomainTaskStatus.IN_PROGRESS] as const;

const todoCursorResource = (type: TodoGroupType): string => `todos:${type}`;

const toIso = (value: Date | null): string | null => (value ? value.toISOString() : null);

const requireCursorString = (value: unknown, name: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new DomainError("INVALID_CURSOR", `cursor ${name} must be a non-empty string`, 400);
  }
  return value;
};

const requireCursorDate = (value: unknown, name: string): Date => {
  const raw = requireCursorString(value, name);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new DomainError("INVALID_CURSOR", `cursor ${name} must be a valid ISO datetime`, 400);
  }
  return parsed;
};

const ensureScope = (scope: TodoScope): TodoScope => {
  if ((TODO_GROUP_SCOPE_VALUES as readonly string[]).includes(scope) || scope === "all") {
    return scope;
  }
  throw new DomainError("INVALID_TODO_SCOPE", `unsupported todo scope '${scope}'`, 400);
};

const ensureTypeMatchesScope = (scope: TodoScope, type: TodoGroupType | undefined): void => {
  if (!type) {
    return;
  }
  if (!(TODO_GROUP_TYPE_VALUES as readonly string[]).includes(type)) {
    throw new DomainError("INVALID_TODO_TYPE", `unsupported todo type '${type}'`, 400);
  }
  if (scope === "all") {
    return;
  }
  if (TODO_GROUP_METADATA[type].scope !== scope) {
    throw new DomainError(
      "INVALID_TODO_TYPE",
      `todo type '${type}' does not belong to scope '${scope}'`,
      400
    );
  }
};

const todoTypesForScope = (scope: TodoScope, type: TodoGroupType | undefined): TodoGroupType[] => {
  if (type) {
    return [type];
  }
  if (scope === "all") {
    return [...TODO_ACTION_REQUIRED_TYPES, ...TODO_WAITING_TYPES];
  }
  return scope === "action_required" ? [...TODO_ACTION_REQUIRED_TYPES] : [...TODO_WAITING_TYPES];
};

const createTodoPageContext = (
  type: TodoGroupType,
  cursor: string | undefined,
  limit: number
): TodoPageContext => ({
  boundedLimit: clampPageLimit(limit),
  parsedCursor: parseListCursor(cursor, {
    resource: todoCursorResource(type),
    sort: "updatedAt",
    order: "desc"
  })
});

const buildUpdatedAtKeysetWhere = (parsedCursor: ParsedCursor) => {
  if (parsedCursor.mode !== "keyset") {
    return null;
  }
  const cursorId = requireCursorString(parsedCursor.values.id, "id");
  const cursorUpdatedAt = requireCursorDate(parsedCursor.values.primary, "primary");
  return {
    OR: [
      { updatedAt: { lt: cursorUpdatedAt } },
      {
        AND: [{ updatedAt: cursorUpdatedAt }, { id: { lt: cursorId } }]
      }
    ]
  };
};

const applyCursorWhere = <T extends Prisma.TaskWhereInput | Prisma.SubmissionWhereInput | Prisma.DisputeWhereInput>(
  where: T,
  parsedCursor: ParsedCursor
): T => {
  const keysetWhere = buildUpdatedAtKeysetWhere(parsedCursor);
  if (!keysetWhere) {
    return where;
  }
  return {
    AND: [where, keysetWhere as T]
  } as T;
};

const pagedArgs = (context: TodoPageContext) => ({
  ...(context.parsedCursor.mode === "legacy-offset"
    ? {
        skip: context.parsedCursor.offset
      }
    : {}),
  take: context.boundedLimit + 1
});

const buildTodoPageResult = (
  type: TodoGroupType,
  context: TodoPageContext,
  totalCount: number,
  itemsWithSentinel: TodoItemSummary[]
): TodoPageResult => {
  const hasMore = itemsWithSentinel.length > context.boundedLimit;
  const items = hasMore ? itemsWithSentinel.slice(0, context.boundedLimit) : itemsWithSentinel;
  const nextCursor =
    hasMore && items.length > 0
      ? encodeKeysetCursor({
          resource: todoCursorResource(type),
          sort: "updatedAt",
          order: "desc",
          offset: nextCursorOffset(context.parsedCursor, items.length),
          values: {
            primary: items[items.length - 1]!.updatedAt,
            id: items[items.length - 1]!.primaryId
          }
        })
      : null;
  return {
    items,
    nextCursor,
    totalCount
  };
};

const toCountNumber = (value: bigint | number | string | null | undefined): number => {
  if (value === null || value === undefined) {
    return 0;
  }
  return Number(value);
};

const toTaskItem = (task: {
  id: string;
  title: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  deadlineUtc: Date;
}): TodoItemSummary => ({
  resourceKind: "task",
  primaryId: task.id,
  title: task.title,
  taskId: task.id,
  submissionId: null,
  disputeId: null,
  status: task.status as DomainTaskStatus,
  createdAt: task.createdAt.toISOString(),
  updatedAt: task.updatedAt.toISOString(),
  deadlineUtc: task.deadlineUtc.toISOString()
});

const toSubmissionItem = (submission: {
  id: string;
  taskId: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  task: {
    title: string;
    deadlineUtc: Date;
  };
}): TodoItemSummary => ({
  resourceKind: "submission",
  primaryId: submission.id,
  title: submission.task.title,
  taskId: submission.taskId,
  submissionId: submission.id,
  disputeId: null,
  status: submission.status as DomainSubmissionStatus,
  createdAt: submission.createdAt.toISOString(),
  updatedAt: submission.updatedAt.toISOString(),
  deadlineUtc: submission.task.deadlineUtc.toISOString()
});

const queryPublishedTaskSubmissionPendingReview = async (
  prisma: PrismaClient,
  address: Address,
  cursor: string | undefined,
  limit: number
): Promise<TodoPageResult> => {
  const context = createTodoPageContext("published_task_submission_pending_review", cursor, limit);
  const where: Prisma.SubmissionWhereInput = {
    status: DomainSubmissionStatus.SUBMITTED,
    task: {
      publisherAddress: {
        equals: address,
        mode: "insensitive"
      }
    }
  };
  const [totalCount, rows] = await Promise.all([
    prisma.submission.count({ where }),
    prisma.submission.findMany({
      where: applyCursorWhere(where, context.parsedCursor),
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        taskId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        task: {
          select: {
            title: true,
            deadlineUtc: true
          }
        }
      },
      ...pagedArgs(context)
    })
  ]);
  return buildTodoPageResult(
    "published_task_submission_pending_review",
    context,
    totalCount,
    rows.map((item) => toSubmissionItem(item))
  );
};

const querySubmittedSubmissionWaitingReview = async (
  prisma: PrismaClient,
  address: Address,
  cursor: string | undefined,
  limit: number
): Promise<TodoPageResult> => {
  const context = createTodoPageContext("submitted_submission_waiting_review", cursor, limit);
  const where: Prisma.SubmissionWhereInput = {
    status: DomainSubmissionStatus.SUBMITTED,
    agentAddress: {
      equals: address,
      mode: "insensitive"
    }
  };
  const [totalCount, rows] = await Promise.all([
    prisma.submission.count({ where }),
    prisma.submission.findMany({
      where: applyCursorWhere(where, context.parsedCursor),
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        taskId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        task: {
          select: {
            title: true,
            deadlineUtc: true
          }
        }
      },
      ...pagedArgs(context)
    })
  ]);
  return buildTodoPageResult(
    "submitted_submission_waiting_review",
    context,
    totalCount,
    rows.map((item) => toSubmissionItem(item))
  );
};

const queryExpiredPublishedTaskCleanupRequired = async (
  prisma: PrismaClient,
  address: Address,
  now: Date,
  cursor: string | undefined,
  limit: number
): Promise<TodoPageResult> => {
  const context = createTodoPageContext("expired_published_task_cleanup_required", cursor, limit);
  const where: Prisma.TaskWhereInput = {
    publisherAddress: {
      equals: address,
      mode: "insensitive"
    },
    status: {
      in: [...ACTIVE_TASK_STATUSES]
    },
    deadlineUtc: {
      lt: now
    },
    submissions: {
      none: {
        status: DomainSubmissionStatus.SUBMITTED
      }
    },
    disputes: {
      none: {
        status: DomainDisputeStatus.OPEN
      }
    }
  };
  const [totalCount, rows] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where: applyCursorWhere(where, context.parsedCursor),
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        deadlineUtc: true
      },
      ...pagedArgs(context)
    })
  ]);
  return buildTodoPageResult(
    "expired_published_task_cleanup_required",
    context,
    totalCount,
    rows.map((item) => toTaskItem(item))
  );
};

const queryIntendedTaskNeverSubmitted = async (
  prisma: PrismaClient,
  address: Address,
  now: Date,
  cursor: string | undefined,
  limit: number
): Promise<TodoPageResult> => {
  const context = createTodoPageContext("intended_task_never_submitted", cursor, limit);
  const where: Prisma.TaskWhereInput = {
    status: {
      in: [...ACTIVE_TASK_STATUSES]
    },
    deadlineUtc: {
      gt: now
    },
    intentions: {
      some: {
        agentAddress: {
          equals: address,
          mode: "insensitive"
        }
      }
    },
    submissions: {
      none: {
        agentAddress: {
          equals: address,
          mode: "insensitive"
        }
      }
    }
  };
  const [totalCount, rows] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where: applyCursorWhere(where, context.parsedCursor),
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        deadlineUtc: true
      },
      ...pagedArgs(context)
    })
  ]);
  return buildTodoPageResult(
    "intended_task_never_submitted",
    context,
    totalCount,
    rows.map((item) => toTaskItem(item))
  );
};

const queryPublishedTaskWaitingNewSubmission = async (
  prisma: PrismaClient,
  address: Address,
  now: Date,
  cursor: string | undefined,
  limit: number
): Promise<TodoPageResult> => {
  const context = createTodoPageContext("published_task_waiting_new_submission", cursor, limit);
  const where: Prisma.TaskWhereInput = {
    publisherAddress: {
      equals: address,
      mode: "insensitive"
    },
    status: {
      in: [...ACTIVE_TASK_STATUSES]
    },
    deadlineUtc: {
      gt: now
    },
    submissions: {
      none: {
        status: DomainSubmissionStatus.SUBMITTED
      }
    },
    disputes: {
      none: {
        status: DomainDisputeStatus.OPEN
      }
    }
  };
  const [totalCount, rows] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where: applyCursorWhere(where, context.parsedCursor),
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        deadlineUtc: true
      },
      ...pagedArgs(context)
    })
  ]);
  return buildTodoPageResult(
    "published_task_waiting_new_submission",
    context,
    totalCount,
    rows.map((item) => toTaskItem(item))
  );
};

const disputeCounterpartySql = Prisma.sql`
  CASE
    WHEN lower(d."openerAddress") = lower(t."publisherAddress") THEN lower(s."agentAddress")
    WHEN lower(d."openerAddress") = lower(s."agentAddress") THEN lower(t."publisherAddress")
    ELSE NULL
  END
`;

const queryDisputeTodoGroupRaw = async (
  prisma: PrismaClient,
  input: {
    type: "open_dispute_counterparty_response_required" | "open_dispute_waiting_resolution";
    cursor?: string;
    limit: number;
    extraWhereSql: Prisma.Sql;
  }
): Promise<TodoPageResult> => {
  const context = createTodoPageContext(input.type, input.cursor, input.limit);
  const keysetSql =
    context.parsedCursor.mode === "keyset"
      ? (() => {
          const cursorId = requireCursorString(context.parsedCursor.values.id, "id");
          const cursorUpdatedAt = requireCursorDate(context.parsedCursor.values.primary, "primary");
          return Prisma.sql`
            AND (
              d."updatedAt" < ${cursorUpdatedAt}
              OR (d."updatedAt" = ${cursorUpdatedAt} AND d.id < ${cursorId})
            )
          `;
        })()
      : Prisma.empty;
  const paginationSql =
    context.parsedCursor.mode === "legacy-offset"
      ? Prisma.sql`LIMIT ${context.boundedLimit + 1} OFFSET ${context.parsedCursor.offset}`
      : Prisma.sql`LIMIT ${context.boundedLimit + 1}`;

  const [countRows, rows] = await Promise.all([
    prisma.$queryRaw<Array<{ totalCount: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS "totalCount"
      FROM "Dispute" d
      INNER JOIN "Task" t ON t.id = d."taskId"
      INNER JOIN "Submission" s ON s.id = d."submissionId"
      WHERE d.status = CAST(${DomainDisputeStatus.OPEN} AS "DisputeStatus")
        AND ${input.extraWhereSql}
    `),
    prisma.$queryRaw<TodoDisputeRow[]>(Prisma.sql`
      SELECT
        d.id,
        d."taskId",
        d."submissionId",
        d.status,
        d."createdAt",
        d."updatedAt",
        t.title AS "taskTitle",
        t."deadlineUtc" AS "taskDeadlineUtc"
      FROM "Dispute" d
      INNER JOIN "Task" t ON t.id = d."taskId"
      INNER JOIN "Submission" s ON s.id = d."submissionId"
      WHERE d.status = CAST(${DomainDisputeStatus.OPEN} AS "DisputeStatus")
        AND ${input.extraWhereSql}
        ${keysetSql}
      ORDER BY d."updatedAt" DESC, d.id DESC
      ${paginationSql}
    `)
  ]);

  return buildTodoPageResult(
    input.type,
    context,
    toCountNumber(countRows[0]?.totalCount),
    rows.map((item) => ({
      resourceKind: "dispute",
      primaryId: item.id,
      title: item.taskTitle,
      taskId: item.taskId,
      submissionId: item.submissionId,
      disputeId: item.id,
      status: item.status as DomainDisputeStatus,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      deadlineUtc: toIso(item.taskDeadlineUtc)
    }))
  );
};

const queryOpenDisputeCounterpartyResponseRequired = async (
  prisma: PrismaClient,
  address: Address,
  cursor: string | undefined,
  limit: number
): Promise<TodoPageResult> =>
  queryDisputeTodoGroupRaw(prisma, {
    type: "open_dispute_counterparty_response_required",
    cursor,
    limit,
    extraWhereSql: Prisma.sql`
      ${disputeCounterpartySql} = lower(${address})
      AND btrim(COALESCE(d."counterpartyReasonMd", '')) = ''
    `
  });

const queryOpenDisputeWaitingResolution = async (
  prisma: PrismaClient,
  address: Address,
  cursor: string | undefined,
  limit: number
): Promise<TodoPageResult> =>
  queryDisputeTodoGroupRaw(prisma, {
    type: "open_dispute_waiting_resolution",
    cursor,
    limit,
    extraWhereSql: Prisma.sql`
      (
        lower(d."openerAddress") = lower(${address})
        OR (
          ${disputeCounterpartySql} = lower(${address})
          AND btrim(COALESCE(d."counterpartyReasonMd", '')) <> ''
        )
      )
    `
  });

const latestRejectedBaseSql = (address: Address) => Prisma.sql`
  WITH latest_actor_submissions AS (
    SELECT
      s.id,
      s."taskId",
      s.status,
      s."createdAt",
      s."updatedAt",
      t.title AS "taskTitle",
      t."deadlineUtc" AS "taskDeadlineUtc",
      ROW_NUMBER() OVER (PARTITION BY s."taskId" ORDER BY s."createdAt" DESC, s.id DESC) AS rn
    FROM "Submission" s
    INNER JOIN "Task" t ON t.id = s."taskId"
    WHERE lower(s."agentAddress") = lower(${address})
  )
`;

const queryLatestRejectedSubmissionNoFollowup = async (
  prisma: PrismaClient,
  address: Address,
  cursor: string | undefined,
  limit: number
): Promise<TodoPageResult> => {
  const context = createTodoPageContext("latest_rejected_submission_no_followup", cursor, limit);
  const keysetSql =
    context.parsedCursor.mode === "keyset"
      ? (() => {
          const cursorId = requireCursorString(context.parsedCursor.values.id, "id");
          const cursorUpdatedAt = requireCursorDate(context.parsedCursor.values.primary, "primary");
          return Prisma.sql`
            AND (
              latest."updatedAt" < ${cursorUpdatedAt}
              OR (latest."updatedAt" = ${cursorUpdatedAt} AND latest.id < ${cursorId})
            )
          `;
        })()
      : Prisma.empty;
  const paginationSql =
    context.parsedCursor.mode === "legacy-offset"
      ? Prisma.sql`LIMIT ${context.boundedLimit + 1} OFFSET ${context.parsedCursor.offset}`
      : Prisma.sql`LIMIT ${context.boundedLimit + 1}`;

  const [countRows, rows] = await Promise.all([
    prisma.$queryRaw<Array<{ totalCount: bigint }>>(Prisma.sql`
      ${latestRejectedBaseSql(address)}
      SELECT COUNT(*)::bigint AS "totalCount"
      FROM latest_actor_submissions latest
      WHERE latest.rn = 1
        AND latest.status = CAST(${DomainSubmissionStatus.REJECTED} AS "SubmissionStatus")
        AND NOT EXISTS (
          SELECT 1
          FROM "Dispute" d
          WHERE d."submissionId" = latest.id
            AND d.status = CAST(${DomainDisputeStatus.OPEN} AS "DisputeStatus")
        )
    `),
    prisma.$queryRaw<LatestRejectedSubmissionRow[]>(Prisma.sql`
      ${latestRejectedBaseSql(address)}
      SELECT
        latest.id,
        latest."taskId",
        latest.status,
        latest."createdAt",
        latest."updatedAt",
        latest."taskTitle",
        latest."taskDeadlineUtc"
      FROM latest_actor_submissions latest
      WHERE latest.rn = 1
        AND latest.status = CAST(${DomainSubmissionStatus.REJECTED} AS "SubmissionStatus")
        AND NOT EXISTS (
          SELECT 1
          FROM "Dispute" d
          WHERE d."submissionId" = latest.id
            AND d.status = CAST(${DomainDisputeStatus.OPEN} AS "DisputeStatus")
        )
        ${keysetSql}
      ORDER BY latest."updatedAt" DESC, latest.id DESC
      ${paginationSql}
    `)
  ]);

  return buildTodoPageResult(
    "latest_rejected_submission_no_followup",
    context,
    toCountNumber(countRows[0]?.totalCount),
    rows.map((item) => ({
      resourceKind: "submission",
      primaryId: item.id,
      title: item.taskTitle,
      taskId: item.taskId,
      submissionId: item.id,
      disputeId: null,
      status: item.status as DomainSubmissionStatus,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      deadlineUtc: toIso(item.taskDeadlineUtc)
    }))
  );
};

const queryTodoGroup = async (
  prisma: PrismaClient,
  input: {
    type: TodoGroupType;
    address: Address;
    now: Date;
    cursor?: string;
    limit: number;
  }
): Promise<TodoGroup> => {
  const page =
    input.type === "latest_rejected_submission_no_followup"
      ? await queryLatestRejectedSubmissionNoFollowup(prisma, input.address, input.cursor, input.limit)
      : input.type === "open_dispute_counterparty_response_required"
        ? await queryOpenDisputeCounterpartyResponseRequired(prisma, input.address, input.cursor, input.limit)
        : input.type === "published_task_submission_pending_review"
          ? await queryPublishedTaskSubmissionPendingReview(prisma, input.address, input.cursor, input.limit)
          : input.type === "expired_published_task_cleanup_required"
            ? await queryExpiredPublishedTaskCleanupRequired(
                prisma,
                input.address,
                input.now,
                input.cursor,
                input.limit
              )
            : input.type === "intended_task_never_submitted"
              ? await queryIntendedTaskNeverSubmitted(
                  prisma,
                  input.address,
                  input.now,
                  input.cursor,
                  input.limit
                )
              : input.type === "submitted_submission_waiting_review"
                ? await querySubmittedSubmissionWaitingReview(prisma, input.address, input.cursor, input.limit)
                : input.type === "published_task_waiting_new_submission"
                  ? await queryPublishedTaskWaitingNewSubmission(
                      prisma,
                      input.address,
                      input.now,
                      input.cursor,
                      input.limit
                    )
                  : await queryOpenDisputeWaitingResolution(
                      prisma,
                      input.address,
                      input.cursor,
                      input.limit
                    );

  const metadata = TODO_GROUP_METADATA[input.type];
  return {
    scope: metadata.scope,
    type: input.type,
    resourceKind: metadata.resourceKind,
    title: metadata.title,
    description: metadata.description,
    totalCount: page.totalCount,
    nextCursor: page.nextCursor,
    items: page.items
  };
};

export const queryTodosDirect = async (
  prisma: PrismaClient,
  input: TodosDirectQueryInput
): Promise<TodosResponse> => {
  const scope = ensureScope(input.scope);
  ensureTypeMatchesScope(scope, input.type);

  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const parsedGeneratedAt = new Date(generatedAt);
  const now = Number.isNaN(parsedGeneratedAt.getTime()) ? new Date() : parsedGeneratedAt;
  const types = todoTypesForScope(scope, input.type);
  const groups = await Promise.all(
    types.map((type) =>
      queryTodoGroup(prisma, {
        type,
        address: input.address,
        now,
        cursor: input.type === type ? input.cursor : undefined,
        limit: input.limit
      })
    )
  );

  return {
    address: input.address,
    scope,
    selectedType: input.type ?? null,
    generatedAt,
    groups
  };
};
