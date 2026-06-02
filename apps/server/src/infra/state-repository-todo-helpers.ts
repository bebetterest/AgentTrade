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
  type TodoResourceKind,
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

interface TodoUnifiedRow {
  type: string;
  resourceKind: TodoResourceKind | null;
  primaryId: string | null;
  title: string | null;
  taskId: string | null;
  submissionId: string | null;
  disputeId: string | null;
  status: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  deadlineUtc: Date | null;
  totalCount: bigint | number | string | null;
}

type TodoUnifiedItemRow = TodoUnifiedRow & {
  resourceKind: TodoResourceKind;
  primaryId: string;
  title: string;
  taskId: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

type TodoFamily = "submission" | "task" | "dispute";

const ACTIVE_TASK_STATUSES = [DomainTaskStatus.OPEN, DomainTaskStatus.IN_PROGRESS] as const;
const SUBMISSION_TODO_TYPES = [
  "latest_rejected_submission_no_followup",
  "published_task_submission_pending_review",
  "submitted_submission_waiting_review"
] as const satisfies readonly TodoGroupType[];
const TASK_TODO_TYPES = [
  "targeted_task_mention",
  "expired_published_task_cleanup_required",
  "intended_task_never_submitted",
  "published_task_waiting_new_submission"
] as const satisfies readonly TodoGroupType[];
const DISPUTE_TODO_TYPES = [
  "open_dispute_counterparty_response_required",
  "open_dispute_waiting_resolution"
] as const satisfies readonly TodoGroupType[];

const TODO_TYPES_BY_FAMILY: Record<TodoFamily, readonly TodoGroupType[]> = {
  submission: SUBMISSION_TODO_TYPES,
  task: TASK_TODO_TYPES,
  dispute: DISPUTE_TODO_TYPES
};

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

const todoTypesForFamily = (types: TodoGroupType[], family: TodoFamily): TodoGroupType[] =>
  types.filter((type) => TODO_TYPES_BY_FAMILY[family].includes(type));

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

const todoTypeSql = (type: TodoGroupType): Prisma.Sql => Prisma.sql`CAST(${type} AS text)`;
const todoResourceKindSql = (kind: TodoResourceKind): Prisma.Sql => Prisma.sql`CAST(${kind} AS text)`;
const activeTaskStatusesSql = (): Prisma.Sql =>
  Prisma.join(ACTIVE_TASK_STATUSES.map((status) => Prisma.sql`CAST(${status} AS "TaskStatus")`));

const buildFamilyKeysetFilterSql = (context: TodoPageContext | undefined): Prisma.Sql => {
  if (!context || context.parsedCursor.mode !== "keyset") {
    return Prisma.empty;
  }
  const cursorId = requireCursorString(context.parsedCursor.values.id, "id");
  const cursorUpdatedAt = requireCursorDate(context.parsedCursor.values.primary, "primary");
  return Prisma.sql`
    WHERE (
      "updatedAt" < ${cursorUpdatedAt}
      OR ("updatedAt" = ${cursorUpdatedAt} AND "primaryId" < ${cursorId})
    )
  `;
};

const buildFamilyPageRankFilterSql = (
  context: TodoPageContext | undefined,
  boundedLimit: number
): Prisma.Sql => {
  if (context?.parsedCursor.mode === "legacy-offset") {
    const offset = context.parsedCursor.offset;
    return Prisma.sql`WHERE "pageRank" > ${offset} AND "pageRank" <= ${offset + boundedLimit + 1}`;
  }
  return Prisma.sql`WHERE "pageRank" <= ${boundedLimit + 1}`;
};

const toTodoItem = (row: TodoUnifiedItemRow): TodoItemSummary => ({
  resourceKind: row.resourceKind,
  primaryId: row.primaryId,
  title: row.title,
  taskId: row.taskId,
  submissionId: row.submissionId,
  disputeId: row.disputeId,
  status: row.status as TodoItemSummary["status"],
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  deadlineUtc: toIso(row.deadlineUtc)
});

const isTodoItemRow = (row: TodoUnifiedRow): row is TodoUnifiedItemRow =>
  row.resourceKind !== null &&
  row.primaryId !== null &&
  row.title !== null &&
  row.taskId !== null &&
  row.status !== null &&
  row.createdAt !== null &&
  row.updatedAt !== null;

const buildSubmissionTodoBranches = (types: TodoGroupType[], address: Address): Prisma.Sql[] => {
  const branches: Prisma.Sql[] = [];

  if (types.includes("latest_rejected_submission_no_followup")) {
    branches.push(Prisma.sql`
      SELECT
        ${todoTypeSql("latest_rejected_submission_no_followup")} AS type,
        ${todoResourceKindSql("submission")} AS "resourceKind",
        latest.id AS "primaryId",
        t.title AS title,
        latest."taskId" AS "taskId",
        latest.id AS "submissionId",
        NULL::text AS "disputeId",
        latest.status::text AS status,
        latest."createdAt" AS "createdAt",
        latest."updatedAt" AS "updatedAt",
        t."deadlineUtc" AS "deadlineUtc"
      FROM (
        SELECT DISTINCT ON (s."taskId")
          s.id,
          s."taskId",
          s.status,
          s."createdAt",
          s."updatedAt"
        FROM "Submission" s
        WHERE lower(s."agentAddress") = lower(${address})
        ORDER BY s."taskId" ASC, s."createdAt" DESC, s.id DESC
      ) latest
      INNER JOIN "Task" t ON t.id = latest."taskId"
      WHERE latest.status = CAST(${DomainSubmissionStatus.REJECTED} AS "SubmissionStatus")
        AND NOT EXISTS (
          SELECT 1
          FROM "Dispute" d
          WHERE d."submissionId" = latest.id
            AND d.status = CAST(${DomainDisputeStatus.OPEN} AS "DisputeStatus")
        )
    `);
  }

  if (types.includes("published_task_submission_pending_review")) {
    branches.push(Prisma.sql`
      SELECT
        ${todoTypeSql("published_task_submission_pending_review")} AS type,
        ${todoResourceKindSql("submission")} AS "resourceKind",
        s.id AS "primaryId",
        t.title AS title,
        s."taskId" AS "taskId",
        s.id AS "submissionId",
        NULL::text AS "disputeId",
        s.status::text AS status,
        s."createdAt" AS "createdAt",
        s."updatedAt" AS "updatedAt",
        t."deadlineUtc" AS "deadlineUtc"
      FROM "Submission" s
      INNER JOIN "Task" t ON t.id = s."taskId"
      WHERE s.status = CAST(${DomainSubmissionStatus.SUBMITTED} AS "SubmissionStatus")
        AND lower(t."publisherAddress") = lower(${address})
    `);
  }

  if (types.includes("submitted_submission_waiting_review")) {
    branches.push(Prisma.sql`
      SELECT
        ${todoTypeSql("submitted_submission_waiting_review")} AS type,
        ${todoResourceKindSql("submission")} AS "resourceKind",
        s.id AS "primaryId",
        t.title AS title,
        s."taskId" AS "taskId",
        s.id AS "submissionId",
        NULL::text AS "disputeId",
        s.status::text AS status,
        s."createdAt" AS "createdAt",
        s."updatedAt" AS "updatedAt",
        t."deadlineUtc" AS "deadlineUtc"
      FROM "Submission" s
      INNER JOIN "Task" t ON t.id = s."taskId"
      WHERE s.status = CAST(${DomainSubmissionStatus.SUBMITTED} AS "SubmissionStatus")
        AND lower(s."agentAddress") = lower(${address})
    `);
  }

  return branches;
};

const buildTaskTodoBranches = (
  types: TodoGroupType[],
  address: Address,
  now: Date
): Prisma.Sql[] => {
  const branches: Prisma.Sql[] = [];

  if (types.includes("targeted_task_mention")) {
    branches.push(Prisma.sql`
      SELECT
        ${todoTypeSql("targeted_task_mention")} AS type,
        ${todoResourceKindSql("task")} AS "resourceKind",
        ttm.id AS "primaryId",
        t.title AS title,
        ttm."taskId" AS "taskId",
        NULL::text AS "submissionId",
        NULL::text AS "disputeId",
        t.status::text AS status,
        ttm."createdAt" AS "createdAt",
        ttm."updatedAt" AS "updatedAt",
        t."deadlineUtc" AS "deadlineUtc"
      FROM "TaskTargetMention" ttm
      INNER JOIN "Task" t ON t.id = ttm."taskId"
      WHERE lower(ttm."targetAddress") = lower(${address})
        AND ttm.status = CAST(${"OPEN"} AS "TaskTargetMentionStatus")
        AND t.status IN (${activeTaskStatusesSql()})
        AND t."deadlineUtc" > ${now}
        AND NOT EXISTS (
          SELECT 1
          FROM "TaskIntention" ti
          WHERE ti."taskId" = ttm."taskId"
            AND lower(ti."agentAddress") = lower(${address})
        )
    `);
  }

  if (types.includes("expired_published_task_cleanup_required")) {
    branches.push(Prisma.sql`
      SELECT
        ${todoTypeSql("expired_published_task_cleanup_required")} AS type,
        ${todoResourceKindSql("task")} AS "resourceKind",
        t.id AS "primaryId",
        t.title AS title,
        t.id AS "taskId",
        NULL::text AS "submissionId",
        NULL::text AS "disputeId",
        t.status::text AS status,
        t."createdAt" AS "createdAt",
        t."updatedAt" AS "updatedAt",
        t."deadlineUtc" AS "deadlineUtc"
      FROM "Task" t
      WHERE lower(t."publisherAddress") = lower(${address})
        AND t.status IN (${activeTaskStatusesSql()})
        AND t."deadlineUtc" < ${now}
        AND NOT EXISTS (
          SELECT 1
          FROM "Submission" s
          WHERE s."taskId" = t.id
            AND s.status = CAST(${DomainSubmissionStatus.SUBMITTED} AS "SubmissionStatus")
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "Dispute" d
          WHERE d."taskId" = t.id
            AND d.status = CAST(${DomainDisputeStatus.OPEN} AS "DisputeStatus")
        )
    `);
  }

  if (types.includes("intended_task_never_submitted")) {
    branches.push(Prisma.sql`
      SELECT
        ${todoTypeSql("intended_task_never_submitted")} AS type,
        ${todoResourceKindSql("task")} AS "resourceKind",
        t.id AS "primaryId",
        t.title AS title,
        t.id AS "taskId",
        NULL::text AS "submissionId",
        NULL::text AS "disputeId",
        t.status::text AS status,
        t."createdAt" AS "createdAt",
        t."updatedAt" AS "updatedAt",
        t."deadlineUtc" AS "deadlineUtc"
      FROM "TaskIntention" ti
      INNER JOIN "Task" t ON t.id = ti."taskId"
      WHERE lower(ti."agentAddress") = lower(${address})
        AND t.status IN (${activeTaskStatusesSql()})
        AND t."deadlineUtc" > ${now}
        AND NOT EXISTS (
          SELECT 1
          FROM "Submission" s
          WHERE s."taskId" = t.id
            AND lower(s."agentAddress") = lower(${address})
        )
    `);
  }

  if (types.includes("published_task_waiting_new_submission")) {
    branches.push(Prisma.sql`
      SELECT
        ${todoTypeSql("published_task_waiting_new_submission")} AS type,
        ${todoResourceKindSql("task")} AS "resourceKind",
        t.id AS "primaryId",
        t.title AS title,
        t.id AS "taskId",
        NULL::text AS "submissionId",
        NULL::text AS "disputeId",
        t.status::text AS status,
        t."createdAt" AS "createdAt",
        t."updatedAt" AS "updatedAt",
        t."deadlineUtc" AS "deadlineUtc"
      FROM "Task" t
      WHERE lower(t."publisherAddress") = lower(${address})
        AND t.status IN (${activeTaskStatusesSql()})
        AND t."deadlineUtc" > ${now}
        AND NOT EXISTS (
          SELECT 1
          FROM "Submission" s
          WHERE s."taskId" = t.id
            AND s.status = CAST(${DomainSubmissionStatus.SUBMITTED} AS "SubmissionStatus")
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "Dispute" d
          WHERE d."taskId" = t.id
            AND d.status = CAST(${DomainDisputeStatus.OPEN} AS "DisputeStatus")
        )
    `);
  }

  return branches;
};

const buildDisputeTodoBranches = (types: TodoGroupType[], address: Address): Prisma.Sql[] => {
  const branches: Prisma.Sql[] = [];

  if (types.includes("open_dispute_counterparty_response_required")) {
    branches.push(Prisma.sql`
      SELECT
        ${todoTypeSql("open_dispute_counterparty_response_required")} AS type,
        ${todoResourceKindSql("dispute")} AS "resourceKind",
        d.id AS "primaryId",
        t.title AS title,
        d."taskId" AS "taskId",
        d."submissionId" AS "submissionId",
        d.id AS "disputeId",
        d.status::text AS status,
        d."createdAt" AS "createdAt",
        d."updatedAt" AS "updatedAt",
        t."deadlineUtc" AS "deadlineUtc"
      FROM "Dispute" d
      INNER JOIN "Task" t ON t.id = d."taskId"
      INNER JOIN "Submission" s ON s.id = d."submissionId"
      WHERE d.status = CAST(${DomainDisputeStatus.OPEN} AS "DisputeStatus")
        AND lower(d."openerAddress") = lower(t."publisherAddress")
        AND lower(s."agentAddress") = lower(${address})
        AND btrim(COALESCE(d."counterpartyReasonMd", '')) = ''
    `);
    branches.push(Prisma.sql`
      SELECT
        ${todoTypeSql("open_dispute_counterparty_response_required")} AS type,
        ${todoResourceKindSql("dispute")} AS "resourceKind",
        d.id AS "primaryId",
        t.title AS title,
        d."taskId" AS "taskId",
        d."submissionId" AS "submissionId",
        d.id AS "disputeId",
        d.status::text AS status,
        d."createdAt" AS "createdAt",
        d."updatedAt" AS "updatedAt",
        t."deadlineUtc" AS "deadlineUtc"
      FROM "Dispute" d
      INNER JOIN "Task" t ON t.id = d."taskId"
      INNER JOIN "Submission" s ON s.id = d."submissionId"
      WHERE d.status = CAST(${DomainDisputeStatus.OPEN} AS "DisputeStatus")
        AND lower(d."openerAddress") <> lower(t."publisherAddress")
        AND lower(d."openerAddress") = lower(s."agentAddress")
        AND lower(t."publisherAddress") = lower(${address})
        AND btrim(COALESCE(d."counterpartyReasonMd", '')) = ''
    `);
  }

  if (types.includes("open_dispute_waiting_resolution")) {
    branches.push(Prisma.sql`
      SELECT
        ${todoTypeSql("open_dispute_waiting_resolution")} AS type,
        ${todoResourceKindSql("dispute")} AS "resourceKind",
        d.id AS "primaryId",
        t.title AS title,
        d."taskId" AS "taskId",
        d."submissionId" AS "submissionId",
        d.id AS "disputeId",
        d.status::text AS status,
        d."createdAt" AS "createdAt",
        d."updatedAt" AS "updatedAt",
        t."deadlineUtc" AS "deadlineUtc"
      FROM "Dispute" d
      INNER JOIN "Task" t ON t.id = d."taskId"
      WHERE d.status = CAST(${DomainDisputeStatus.OPEN} AS "DisputeStatus")
        AND lower(d."openerAddress") = lower(${address})
    `);
    branches.push(Prisma.sql`
      SELECT
        ${todoTypeSql("open_dispute_waiting_resolution")} AS type,
        ${todoResourceKindSql("dispute")} AS "resourceKind",
        d.id AS "primaryId",
        t.title AS title,
        d."taskId" AS "taskId",
        d."submissionId" AS "submissionId",
        d.id AS "disputeId",
        d.status::text AS status,
        d."createdAt" AS "createdAt",
        d."updatedAt" AS "updatedAt",
        t."deadlineUtc" AS "deadlineUtc"
      FROM "Dispute" d
      INNER JOIN "Task" t ON t.id = d."taskId"
      WHERE d.status = CAST(${DomainDisputeStatus.OPEN} AS "DisputeStatus")
        AND lower(d."counterpartyResponderAddress") = lower(${address})
        AND lower(d."openerAddress") <> lower(${address})
        AND btrim(COALESCE(d."counterpartyReasonMd", '')) <> ''
    `);
  }

  return branches;
};

const queryTodoFamily = async (
  prisma: PrismaClient,
  input: {
    types: TodoGroupType[];
    selectedType?: TodoGroupType;
    cursor?: string;
    limit: number;
    branches: Prisma.Sql[];
  }
): Promise<Map<TodoGroupType, TodoPageResult>> => {
  const pages = new Map<TodoGroupType, TodoPageResult>();
  const contexts = new Map(
    input.types.map((type) => [
      type,
      createTodoPageContext(type, input.selectedType === type ? input.cursor : undefined, input.limit)
    ])
  );
  const boundedLimit = clampPageLimit(input.limit);
  const selectedContext = input.selectedType ? contexts.get(input.selectedType) : undefined;

  if (input.branches.length === 0) {
    for (const type of input.types) {
      pages.set(type, buildTodoPageResult(type, contexts.get(type)!, 0, []));
    }
    return pages;
  }

  const rows = await prisma.$queryRaw<TodoUnifiedRow[]>(Prisma.sql`
    WITH requested AS (
      ${Prisma.join(
        input.types.map((type) => Prisma.sql`SELECT ${todoTypeSql(type)} AS type`),
        " UNION ALL "
      )}
    ),
    filtered AS (
      ${Prisma.join(input.branches, " UNION ALL ")}
    ),
    totals AS (
      SELECT
        requested.type,
        COUNT(filtered.type)::bigint AS "totalCount"
      FROM requested
      LEFT JOIN filtered ON filtered.type = requested.type
      GROUP BY requested.type
    ),
    after_cursor AS (
      SELECT
        filtered.*,
        totals."totalCount"
      FROM filtered
      INNER JOIN totals ON totals.type = filtered.type
      ${buildFamilyKeysetFilterSql(selectedContext)}
    ),
    numbered AS (
      SELECT
        after_cursor.*,
        ROW_NUMBER() OVER (PARTITION BY type ORDER BY "updatedAt" DESC, "primaryId" DESC) AS "pageRank"
      FROM after_cursor
    ),
    page_rows AS (
      SELECT
        type,
        "resourceKind",
        "primaryId",
        title,
        "taskId",
        "submissionId",
        "disputeId",
        status,
        "createdAt",
        "updatedAt",
        "deadlineUtc",
        "totalCount"
      FROM numbered
      ${buildFamilyPageRankFilterSql(selectedContext, boundedLimit)}
    )
    SELECT
      type,
      "resourceKind",
      "primaryId",
      title,
      "taskId",
      "submissionId",
      "disputeId",
      status,
      "createdAt",
      "updatedAt",
      "deadlineUtc",
      "totalCount"
    FROM page_rows
    UNION ALL
    SELECT
      totals.type,
      NULL::text AS "resourceKind",
      NULL::text AS "primaryId",
      NULL::text AS title,
      NULL::text AS "taskId",
      NULL::text AS "submissionId",
      NULL::text AS "disputeId",
      NULL::text AS status,
      NULL::timestamp AS "createdAt",
      NULL::timestamp AS "updatedAt",
      NULL::timestamp AS "deadlineUtc",
      totals."totalCount"
    FROM totals
    WHERE NOT EXISTS (
      SELECT 1
      FROM page_rows
      WHERE page_rows.type = totals.type
    )
    ORDER BY type ASC, "updatedAt" DESC NULLS LAST, "primaryId" DESC NULLS LAST
  `);

  const rowsByType = new Map<TodoGroupType, TodoUnifiedRow[]>();
  for (const row of rows) {
    const type = row.type as TodoGroupType;
    const items = rowsByType.get(type) ?? [];
    items.push(row);
    rowsByType.set(type, items);
  }

  for (const type of input.types) {
    const typeRows = rowsByType.get(type) ?? [];
    const itemRows = typeRows.filter(isTodoItemRow);
    pages.set(
      type,
      buildTodoPageResult(
        type,
        contexts.get(type)!,
        toCountNumber(typeRows[0]?.totalCount),
        itemRows.map((row) => toTodoItem(row))
      )
    );
  }

  return pages;
};

const queryTodoFamilyByResource = async (
  prisma: PrismaClient,
  input: {
    family: TodoFamily;
    types: TodoGroupType[];
    address: Address;
    now: Date;
    selectedType?: TodoGroupType;
    cursor?: string;
    limit: number;
  }
): Promise<Map<TodoGroupType, TodoPageResult>> => {
  const familyTypes = todoTypesForFamily(input.types, input.family);
  if (familyTypes.length === 0) {
    return new Map();
  }

  const branches =
    input.family === "submission"
      ? buildSubmissionTodoBranches(familyTypes, input.address)
      : input.family === "task"
        ? buildTaskTodoBranches(familyTypes, input.address, input.now)
        : buildDisputeTodoBranches(familyTypes, input.address);

  return queryTodoFamily(prisma, {
    types: familyTypes,
    selectedType: input.selectedType,
    cursor: input.cursor,
    limit: input.limit,
    branches
  });
};

const buildTodoGroup = (type: TodoGroupType, page: TodoPageResult): TodoGroup => {
  const metadata = TODO_GROUP_METADATA[type];
  return {
    scope: metadata.scope,
    type,
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

  const familyPages = await Promise.all(
    (["submission", "task", "dispute"] as const).map((family) =>
      queryTodoFamilyByResource(prisma, {
        family,
        types,
        address: input.address,
        now,
        selectedType: input.type,
        cursor: input.cursor,
        limit: input.limit
      })
    )
  );

  const pageByType = new Map<TodoGroupType, TodoPageResult>();
  for (const pages of familyPages) {
    for (const [type, page] of pages) {
      pageByType.set(type, page);
    }
  }

  return {
    address: input.address,
    scope,
    selectedType: input.type ?? null,
    generatedAt,
    groups: types.map((type) =>
      buildTodoGroup(
        type,
        pageByType.get(type) ??
          buildTodoPageResult(
            type,
            createTodoPageContext(type, input.type === type ? input.cursor : undefined, input.limit),
            0,
            []
          )
      )
    )
  };
};
