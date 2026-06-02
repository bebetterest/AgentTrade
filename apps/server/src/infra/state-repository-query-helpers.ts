import { Prisma, type PrismaClient } from "@prisma/client";
import type { AppConfig } from "@agentrade/config";
import type {
  ActivityEvent,
  ActivityEventType as DomainActivityEventType,
  Address,
  AgentDirectoryItem,
  Cycle,
  Dispute,
  PaginatedResponse,
  Submission,
  Task
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
import {
  mapActivityEvent,
  mapAgentDirectoryItem,
  mapCycle,
  mapDispute,
  mapSubmission,
  mapTask
} from "./state-repository-mappers.js";

export type SortOrder = "asc" | "desc";
export type TaskListSort = "latest" | "created" | "deadline" | "reward";
export type DisputeListSort = "latest" | "created";
export type SubmissionListSort = "latest" | "created";
export type AgentListSort =
  | "latest"
  | "score"
  | "reputation"
  | "completed"
  | "published"
  | "intented";

export interface TaskListQuery {
  q?: string;
  status?: Task["status"];
  publisher?: Address;
  sort: TaskListSort;
  order: SortOrder;
  cursor?: string;
  offset?: number;
  limit: number;
  paged: boolean;
}

export interface DisputeListQuery {
  taskId?: string;
  opener?: Address;
  status?: Dispute["status"];
  q?: string;
  sort: DisputeListSort;
  order: SortOrder;
  cursor?: string;
  offset?: number;
  limit: number;
  paged: boolean;
}

export interface SubmissionListQuery {
  taskId?: string;
  agent?: Address;
  status?: Submission["status"];
  q?: string;
  sort: SubmissionListSort;
  order: SortOrder;
  cursor?: string;
  offset?: number;
  limit: number;
  paged: boolean;
}

export interface AgentListQuery {
  q?: string;
  activeOnly?: boolean;
  sort: AgentListSort;
  order: SortOrder;
  cursor?: string;
  offset?: number;
  limit: number;
  paged: boolean;
}

export interface ActivityListQuery {
  taskId?: string;
  disputeId?: string;
  address?: Address;
  type?: DomainActivityEventType;
  order: SortOrder;
  cursor?: string;
  offset?: number;
  sort?: "created";
  limit: number;
  paged: boolean;
}

export interface CycleListQuery {
  cursor?: string;
  offset?: number;
  limit: number;
  paged: boolean;
}

interface AgentDirectoryRow {
  address: string;
  name: string;
  bio: string;
  status: string;
  bannedAt: Date | null;
  banReasonCode: string | null;
  publisherRep: number;
  workerRep: number;
  supervisorRep: number;
  tasksPublishedCount: number;
  tasksIntentedCount: number;
  tasksCompletedCount: number;
  tasksTerminatedCount: number;
  submissionsRejectedCount: number;
  supervisionVotesCount: number;
  createdAt: Date;
  updatedAt: Date;
  latestActivityAt: Date | null;
  reputationSum: number | Prisma.Decimal | string;
  reputationAverage: number | Prisma.Decimal | string;
  score: number | Prisma.Decimal | string;
  isActive: boolean;
}

interface TaskQueryRow {
  id: string;
  publisherAddress: string;
  title: string;
  descriptionMd: string;
  acceptanceCriteria: string;
  status: unknown;
  deadlineUtc: Date;
  displayTimezone: string;
  slotsTotal: number;
  rewardPerSlot: number;
  allowRepeatCompletionsBySameAgent: boolean;
  taxAmount: number;
  rewardEscrowRemaining: number;
  intentCount: number;
  completedAgents: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}

interface SubmissionQueryRow {
  id: string;
  taskId: string;
  agentAddress: string;
  payloadMd: string;
  attachments: Prisma.JsonValue | null;
  rejectReasonMd: string | null;
  status: unknown;
  createdAt: Date;
  updatedAt: Date;
}

interface DisputeQueryRow {
  id: string;
  taskId: string;
  submissionId: string;
  openerAddress: string;
  reasonMd: string;
  counterpartyResponderAddress: string | null;
  counterpartyReasonMd: string | null;
  status: unknown;
  createdAt: Date;
  updatedAt: Date;
}

interface ActivityEventQueryRow {
  id: string;
  type: unknown;
  cycleId: string;
  taskId: string | null;
  disputeId: string | null;
  actorAddress: string;
  createdAt: Date;
}

const escapeLikePattern = (value: string): string => value.replace(/[\\%_]/g, "\\$&");

const buildWhereSql = (clauses: Prisma.Sql[]): Prisma.Sql =>
  clauses.length > 0 ? Prisma.sql`WHERE ${Prisma.join(clauses, " AND ")}` : Prisma.empty;

const buildPaginationSql = (
  paged: boolean,
  parsedCursor: ParsedCursor,
  boundedLimit: number
): Prisma.Sql => {
  if (!paged) {
    return Prisma.empty;
  }
  return parsedCursor.mode === "legacy-offset"
    ? Prisma.sql`LIMIT ${boundedLimit + 1} OFFSET ${parsedCursor.offset}`
    : Prisma.sql`LIMIT ${boundedLimit + 1}`;
};

const resolveCursorInput = (
  cursor: string | undefined,
  offset: number | undefined
): string | undefined => cursor ?? (Number.isSafeInteger(offset) ? String(offset) : undefined);

const requireCursorString = (value: unknown, name: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new DomainError("INVALID_CURSOR", `cursor ${name} must be a non-empty string`, 400);
  }
  return value;
};

const requireCursorNumber = (value: unknown, name: string): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  throw new DomainError("INVALID_CURSOR", `cursor ${name} must be a finite number`, 400);
};

const requireAgentReputationCursorSum = (values: CursorValues): number => {
  if (values.reputationSum !== undefined && values.reputationSum !== null) {
    return requireCursorNumber(values.reputationSum, "reputationSum");
  }
  const reputationAverage = requireCursorNumber(values.primary, "primary");
  return Number((reputationAverage * 3).toPrecision(15));
};

const requireCursorDate = (value: unknown, name: string): Date => {
  const raw = requireCursorString(value, name);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new DomainError("INVALID_CURSOR", `cursor ${name} must be a valid ISO datetime`, 400);
  }
  return parsed;
};

const buildPaginatedResponse = <T>(
  itemsWithSentinel: T[],
  limit: number,
  parsedCursor: ParsedCursor,
  input: {
    resource: string;
    sort?: string;
    order?: SortOrder;
    toCursorValues: (item: T) => CursorValues;
  }
): PaginatedResponse<T> => {
  const boundedLimit = clampPageLimit(limit);
  const hasMore = itemsWithSentinel.length > boundedLimit;
  const pageItems = hasMore ? itemsWithSentinel.slice(0, boundedLimit) : itemsWithSentinel;
  if (!hasMore || pageItems.length === 0) {
    return { items: pageItems, nextCursor: null };
  }
  return {
    items: pageItems,
    nextCursor: encodeKeysetCursor({
      resource: input.resource,
      sort: input.sort,
      order: input.order,
      offset: nextCursorOffset(parsedCursor, pageItems.length),
      values: input.toCursorValues(pageItems[pageItems.length - 1] as T)
    })
  };
};

export const queryTasksDirect = async (
  prisma: PrismaClient,
  query: TaskListQuery
): Promise<PaginatedResponse<Task>> => {
  const boundedLimit = clampPageLimit(query.limit);
  const parsedCursor: ParsedCursor = query.paged
    ? parseListCursor(resolveCursorInput(query.cursor, query.offset), {
        resource: "tasks",
        sort: query.sort,
        order: query.order
      })
    : { mode: "start", offset: 0 };

  const primaryField: "updatedAt" | "createdAt" | "deadlineUtc" | "rewardPerSlot" =
    query.sort === "created"
      ? "createdAt"
      : query.sort === "deadline"
        ? "deadlineUtc"
        : query.sort === "reward"
          ? "rewardPerSlot"
          : "updatedAt";

  const whereClauses: Prisma.Sql[] = [];
  if (query.status) {
    whereClauses.push(Prisma.sql`t."status" = CAST(${query.status} AS "TaskStatus")`);
  }
  if (query.publisher) {
    whereClauses.push(Prisma.sql`lower(t."publisherAddress") = lower(${query.publisher})`);
  }
  if (query.q) {
    const pattern = `%${escapeLikePattern(query.q)}%`;
    whereClauses.push(Prisma.sql`(
      t.id ILIKE ${pattern} ESCAPE '\\'
      OR t.title ILIKE ${pattern} ESCAPE '\\'
      OR t."descriptionMd" ILIKE ${pattern} ESCAPE '\\'
      OR t."acceptanceCriteria" ILIKE ${pattern} ESCAPE '\\'
      OR t."publisherAddress" ILIKE ${pattern} ESCAPE '\\'
    )`);
  }

  if (query.paged && parsedCursor.mode === "keyset") {
    const cursorId = requireCursorString(parsedCursor.values.id, "id");
    const primaryValue =
      primaryField === "rewardPerSlot"
        ? requireCursorNumber(parsedCursor.values.primary, "primary")
        : requireCursorDate(parsedCursor.values.primary, "primary");
    const compareSql = Prisma.raw(query.order === "asc" ? ">" : "<");
    const primaryColumnSql =
      primaryField === "createdAt"
        ? Prisma.raw('t."createdAt"')
        : primaryField === "deadlineUtc"
          ? Prisma.raw('t."deadlineUtc"')
          : primaryField === "rewardPerSlot"
            ? Prisma.raw('t."rewardPerSlot"')
            : Prisma.raw('t."updatedAt"');
    whereClauses.push(Prisma.sql`(
      ${primaryColumnSql} ${compareSql} ${primaryValue}
      OR (${primaryColumnSql} = ${primaryValue} AND t.id ${compareSql} ${cursorId})
    )`);
  }

  const directionSql = Prisma.raw(query.order.toUpperCase());
  const orderBySql =
    query.sort === "created"
      ? Prisma.sql`ORDER BY t."createdAt" ${directionSql}, t.id ${directionSql}`
      : query.sort === "deadline"
        ? Prisma.sql`ORDER BY t."deadlineUtc" ${directionSql}, t.id ${directionSql}`
        : query.sort === "reward"
          ? Prisma.sql`ORDER BY t."rewardPerSlot" ${directionSql}, t.id ${directionSql}`
          : Prisma.sql`ORDER BY t."updatedAt" ${directionSql}, t.id ${directionSql}`;
  const rows = await prisma.$queryRaw<TaskQueryRow[]>(Prisma.sql`
    SELECT
      t.id,
      t."publisherAddress",
      t.title,
      t."descriptionMd",
      t."acceptanceCriteria",
      t."status",
      t."deadlineUtc",
      t."displayTimezone",
      t."slotsTotal",
      t."rewardPerSlot",
      t."allowRepeatCompletionsBySameAgent",
      t."taxAmount",
      t."rewardEscrowRemaining",
      t."intentCount",
      t."completedAgents",
      t."createdAt",
      t."updatedAt"
    FROM "Task" t
    ${buildWhereSql(whereClauses)}
    ${orderBySql}
    ${buildPaginationSql(query.paged, parsedCursor, boundedLimit)}
  `);

  const taskIds = rows.map((item) => item.id);
  const mentions = taskIds.length > 0
    ? await prisma.taskTargetMention.findMany({
        where: { taskId: { in: taskIds } },
        orderBy: { createdAt: "asc" }
      })
    : [];
  const mentionsByTaskId = new Map<string, typeof mentions>();
  for (const mention of mentions) {
    const existing = mentionsByTaskId.get(mention.taskId) ?? [];
    existing.push(mention);
    mentionsByTaskId.set(mention.taskId, existing);
  }
  const mapped = rows.map((item) =>
    mapTask({
      ...item,
      targetMentions: mentionsByTaskId.get(item.id) ?? []
    })
  );
  return query.paged
    ? buildPaginatedResponse(mapped, boundedLimit, parsedCursor, {
        resource: "tasks",
        sort: query.sort,
        order: query.order,
        toCursorValues: (item) => ({
          primary:
            query.sort === "created"
              ? item.createdAt
              : query.sort === "deadline"
                ? item.deadlineUtc
                : query.sort === "reward"
                  ? item.rewardPerSlot
                  : item.updatedAt,
          id: item.id
        })
      })
    : { items: mapped, nextCursor: null };
};

export const queryDisputesDirect = async (
  prisma: PrismaClient,
  query: DisputeListQuery
): Promise<PaginatedResponse<Dispute>> => {
  const boundedLimit = clampPageLimit(query.limit);
  const parsedCursor: ParsedCursor = query.paged
    ? parseListCursor(resolveCursorInput(query.cursor, query.offset), {
        resource: "disputes",
        sort: query.sort,
        order: query.order
      })
    : { mode: "start", offset: 0 };
  const primaryField: "createdAt" | "updatedAt" = query.sort === "created" ? "createdAt" : "updatedAt";
  const whereClauses: Prisma.Sql[] = [];
  if (query.taskId) {
    whereClauses.push(Prisma.sql`d."taskId" = ${query.taskId}`);
  }
  if (query.status) {
    whereClauses.push(Prisma.sql`d."status" = CAST(${query.status} AS "DisputeStatus")`);
  }
  if (query.opener) {
    whereClauses.push(Prisma.sql`lower(d."openerAddress") = lower(${query.opener})`);
  }
  if (query.q) {
    const pattern = `%${escapeLikePattern(query.q)}%`;
    whereClauses.push(Prisma.sql`(
      d.id ILIKE ${pattern} ESCAPE '\\'
      OR d."taskId" ILIKE ${pattern} ESCAPE '\\'
      OR d."submissionId" ILIKE ${pattern} ESCAPE '\\'
      OR d."openerAddress" ILIKE ${pattern} ESCAPE '\\'
      OR d."reasonMd" ILIKE ${pattern} ESCAPE '\\'
      OR d."counterpartyReasonMd" ILIKE ${pattern} ESCAPE '\\'
    )`);
  }

  if (query.paged && parsedCursor.mode === "keyset") {
    const cursorId = requireCursorString(parsedCursor.values.id, "id");
    const primaryValue = requireCursorDate(parsedCursor.values.primary, "primary");
    const compareSql = Prisma.raw(query.order === "asc" ? ">" : "<");
    const primaryColumnSql =
      primaryField === "createdAt" ? Prisma.raw('d."createdAt"') : Prisma.raw('d."updatedAt"');
    whereClauses.push(Prisma.sql`(
      ${primaryColumnSql} ${compareSql} ${primaryValue}
      OR (${primaryColumnSql} = ${primaryValue} AND d.id ${compareSql} ${cursorId})
    )`);
  }

  const directionSql = Prisma.raw(query.order.toUpperCase());
  const orderBySql =
    query.sort === "created"
      ? Prisma.sql`ORDER BY d."createdAt" ${directionSql}, d.id ${directionSql}`
      : Prisma.sql`ORDER BY d."updatedAt" ${directionSql}, d.id ${directionSql}`;
  const rows = await prisma.$queryRaw<DisputeQueryRow[]>(Prisma.sql`
    SELECT
      d.id,
      d."taskId",
      d."submissionId",
      d."openerAddress",
      d."reasonMd",
      d."counterpartyResponderAddress",
      d."counterpartyReasonMd",
      d."status",
      d."createdAt",
      d."updatedAt"
    FROM "Dispute" d
    ${buildWhereSql(whereClauses)}
    ${orderBySql}
    ${buildPaginationSql(query.paged, parsedCursor, boundedLimit)}
  `);

  const mapped = rows.map((item) => mapDispute(item));
  return query.paged
    ? buildPaginatedResponse(mapped, boundedLimit, parsedCursor, {
        resource: "disputes",
        sort: query.sort,
        order: query.order,
        toCursorValues: (item) => ({
          primary: query.sort === "created" ? item.createdAt : item.updatedAt,
          id: item.id
        })
      })
    : { items: mapped, nextCursor: null };
};

export const querySubmissionsDirect = async (
  prisma: PrismaClient,
  query: SubmissionListQuery
): Promise<PaginatedResponse<Submission>> => {
  const boundedLimit = clampPageLimit(query.limit);
  const parsedCursor: ParsedCursor = query.paged
    ? parseListCursor(resolveCursorInput(query.cursor, query.offset), {
        resource: "submissions",
        sort: query.sort,
        order: query.order
      })
    : { mode: "start", offset: 0 };
  const primaryField: "createdAt" | "updatedAt" = query.sort === "created" ? "createdAt" : "updatedAt";
  const whereClauses: Prisma.Sql[] = [];
  if (query.taskId) {
    whereClauses.push(Prisma.sql`s."taskId" = ${query.taskId}`);
  }
  if (query.status) {
    whereClauses.push(Prisma.sql`s."status" = CAST(${query.status} AS "SubmissionStatus")`);
  }
  if (query.agent) {
    whereClauses.push(Prisma.sql`lower(s."agentAddress") = lower(${query.agent})`);
  }
  if (query.q) {
    const pattern = `%${escapeLikePattern(query.q)}%`;
    whereClauses.push(Prisma.sql`(
      s.id ILIKE ${pattern} ESCAPE '\\'
      OR s."taskId" ILIKE ${pattern} ESCAPE '\\'
      OR s."agentAddress" ILIKE ${pattern} ESCAPE '\\'
      OR s."payloadMd" ILIKE ${pattern} ESCAPE '\\'
    )`);
  }

  if (query.paged && parsedCursor.mode === "keyset") {
    const cursorId = requireCursorString(parsedCursor.values.id, "id");
    const primaryValue = requireCursorDate(parsedCursor.values.primary, "primary");
    const compareSql = Prisma.raw(query.order === "asc" ? ">" : "<");
    const primaryColumnSql =
      primaryField === "createdAt" ? Prisma.raw('s."createdAt"') : Prisma.raw('s."updatedAt"');
    whereClauses.push(Prisma.sql`(
      ${primaryColumnSql} ${compareSql} ${primaryValue}
      OR (${primaryColumnSql} = ${primaryValue} AND s.id ${compareSql} ${cursorId})
    )`);
  }

  const directionSql = Prisma.raw(query.order.toUpperCase());
  const orderBySql =
    query.sort === "created"
      ? Prisma.sql`ORDER BY s."createdAt" ${directionSql}, s.id ${directionSql}`
      : Prisma.sql`ORDER BY s."updatedAt" ${directionSql}, s.id ${directionSql}`;
  const rows = await prisma.$queryRaw<SubmissionQueryRow[]>(Prisma.sql`
    SELECT
      s.id,
      s."taskId",
      s."agentAddress",
      s."payloadMd",
      s.attachments,
      s."rejectReasonMd",
      s."status",
      s."createdAt",
      s."updatedAt"
    FROM "Submission" s
    ${buildWhereSql(whereClauses)}
    ${orderBySql}
    ${buildPaginationSql(query.paged, parsedCursor, boundedLimit)}
  `);

  const mapped = rows.map((item) => mapSubmission(item));
  return query.paged
    ? buildPaginatedResponse(mapped, boundedLimit, parsedCursor, {
        resource: "submissions",
        sort: query.sort,
        order: query.order,
        toCursorValues: (item) => ({
          primary: query.sort === "created" ? item.createdAt : item.updatedAt,
          id: item.id
        })
      })
    : { items: mapped, nextCursor: null };
};

export const queryAgentsDirect = async (
  prisma: PrismaClient,
  query: AgentListQuery,
  config: AppConfig
): Promise<PaginatedResponse<AgentDirectoryItem>> => {
  const boundedLimit = clampPageLimit(query.limit);
  const parsedCursor: ParsedCursor = query.paged
    ? parseListCursor(resolveCursorInput(query.cursor, query.offset), {
        resource: "agents",
        sort: query.sort,
        order: query.order
      })
    : { mode: "start", offset: 0 };
  const whereClauses: Prisma.Sql[] = [];
  if (query.activeOnly) {
    whereClauses.push(Prisma.sql`ranked."isActive" = true`);
  }
  if (query.q) {
    const pattern = `%${escapeLikePattern(query.q)}%`;
    whereClauses.push(
      Prisma.sql`(
        ranked.address ILIKE ${pattern} ESCAPE '\\'
        OR ranked.name ILIKE ${pattern} ESCAPE '\\'
        OR ranked.bio ILIKE ${pattern} ESCAPE '\\'
      )`
    );
  }

  if (query.paged && parsedCursor.mode === "keyset") {
    const cursorAddress = requireCursorString(parsedCursor.values.address, "address");
    const compareSql = Prisma.raw(query.order === "asc" ? ">" : "<");
    if (query.sort === "latest") {
      const cursorPrimary = parsedCursor.values.primary;
      if (cursorPrimary === null) {
        if (query.order === "asc") {
          whereClauses.push(
            Prisma.sql`(
              (ranked."latestActivityAt" IS NULL AND ranked.address ${compareSql} ${cursorAddress})
              OR ranked."latestActivityAt" IS NOT NULL
            )`
          );
        } else {
          whereClauses.push(
            Prisma.sql`(
              ranked."latestActivityAt" IS NULL
              AND ranked.address ${compareSql} ${cursorAddress}
            )`
          );
        }
      } else {
        const cursorLatestAt = requireCursorDate(cursorPrimary, "primary");
        if (query.order === "asc") {
          whereClauses.push(
            Prisma.sql`(
              ranked."latestActivityAt" > ${cursorLatestAt}
              OR (ranked."latestActivityAt" = ${cursorLatestAt} AND ranked.address ${compareSql} ${cursorAddress})
            )`
          );
        } else {
          whereClauses.push(
            Prisma.sql`(
              ranked."latestActivityAt" IS NULL
              OR ranked."latestActivityAt" < ${cursorLatestAt}
              OR (ranked."latestActivityAt" = ${cursorLatestAt} AND ranked.address ${compareSql} ${cursorAddress})
            )`
          );
        }
      }
    } else {
      const cursorPrimary =
        query.sort === "reputation"
          ? requireAgentReputationCursorSum(parsedCursor.values)
          : requireCursorNumber(parsedCursor.values.primary, "primary");
      const metricColumnSql =
        query.sort === "score"
          ? Prisma.raw("ranked.score")
          : query.sort === "reputation"
            ? Prisma.raw('ranked."reputationSum"')
            : query.sort === "completed"
              ? Prisma.raw('ranked."tasksCompletedCount"')
              : query.sort === "published"
                ? Prisma.raw('ranked."tasksPublishedCount"')
                : Prisma.raw('ranked."tasksIntentedCount"');
      whereClauses.push(
        Prisma.sql`(
          ${metricColumnSql} ${compareSql} ${cursorPrimary}
          OR (${metricColumnSql} = ${cursorPrimary} AND ranked.address ${compareSql} ${cursorAddress})
        )`
      );
    }
  }

  const whereSql =
    whereClauses.length > 0
      ? Prisma.sql`WHERE ${Prisma.join(whereClauses, " AND ")}`
      : Prisma.empty;
  const directionSql = Prisma.raw(query.order.toUpperCase());
  const nullsSql = Prisma.raw(query.order === "asc" ? "NULLS FIRST" : "NULLS LAST");
  const orderBySql =
    query.sort === "score"
      ? Prisma.sql`ORDER BY ranked.score ${directionSql}, ranked.address ${directionSql}`
      : query.sort === "reputation"
        ? Prisma.sql`ORDER BY ranked."reputationSum" ${directionSql}, ranked.address ${directionSql}`
        : query.sort === "completed"
          ? Prisma.sql`ORDER BY ranked."tasksCompletedCount" ${directionSql}, ranked.address ${directionSql}`
          : query.sort === "published"
            ? Prisma.sql`ORDER BY ranked."tasksPublishedCount" ${directionSql}, ranked.address ${directionSql}`
            : query.sort === "intented"
              ? Prisma.sql`ORDER BY ranked."tasksIntentedCount" ${directionSql}, ranked.address ${directionSql}`
              : Prisma.sql`ORDER BY ranked."latestActivityAt" ${directionSql} ${nullsSql}, ranked.address ${directionSql}`;
  const paginationSql = query.paged
    ? parsedCursor.mode === "legacy-offset"
      ? Prisma.sql`LIMIT ${boundedLimit + 1} OFFSET ${parsedCursor.offset}`
      : Prisma.sql`LIMIT ${boundedLimit + 1}`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<AgentDirectoryRow[]>(Prisma.sql`
    SELECT *
    FROM (
      SELECT
        ap.address,
        ap.name,
        ap.bio,
        ap.status,
        ap."bannedAt" AS "bannedAt",
        ap."banReasonCode" AS "banReasonCode",
        ap."publisherRep" AS "publisherRep",
        ap."workerRep" AS "workerRep",
        ap."supervisorRep" AS "supervisorRep",
        ap."tasksPublishedCount" AS "tasksPublishedCount",
        ap."tasksIntentedCount" AS "tasksIntentedCount",
        ap."tasksCompletedCount" AS "tasksCompletedCount",
        ap."tasksTerminatedCount" AS "tasksTerminatedCount",
        ap."submissionsRejectedCount" AS "submissionsRejectedCount",
        ap."supervisionVotesCount" AS "supervisionVotesCount",
        ap."createdAt" AS "createdAt",
        ap."updatedAt" AS "updatedAt",
        ap."latestActivityAt" AS "latestActivityAt",
        (ap."publisherRep" + ap."workerRep" + ap."supervisorRep") AS "reputationSum",
        ((ap."publisherRep" + ap."workerRep" + ap."supervisorRep") / 3.0) AS "reputationAverage",
        ROUND(
          ((
            ${config.scoreWeightReputationBps} * ((ap."publisherRep" + ap."workerRep" + ap."supervisorRep") / 3.0)
            + ${config.scoreWeightCompletionBps} * CASE
              WHEN ap."tasksIntentedCount" > 0 THEN LEAST(1.0, ap."tasksCompletedCount"::float / ap."tasksIntentedCount") * 100
              ELSE 0
            END
            + ${config.scoreWeightQualityBps} * CASE
              WHEN ap."tasksIntentedCount" > 0 THEN GREATEST(0.0, 1.0 - ap."submissionsRejectedCount"::float / ap."tasksIntentedCount") * 100
              ELSE 100
            END
          ) / 10000.0)::numeric,
          2
        ) AS score,
        (
          ap."latestActivityAt" IS NOT NULL
          OR ap."tasksIntentedCount" > 0
          OR ap."tasksPublishedCount" > 0
          OR ap."tasksCompletedCount" > 0
          OR ap."submissionsRejectedCount" > 0
          OR ap."supervisionVotesCount" > 0
        ) AS "isActive"
      FROM "AgentProfile" ap
    ) ranked
    ${whereSql}
    ${orderBySql}
    ${paginationSql}
  `);

  const mapped = rows.map((item) => mapAgentDirectoryItem(item));
  return query.paged
    ? buildPaginatedResponse(mapped, boundedLimit, parsedCursor, {
        resource: "agents",
        sort: query.sort,
        order: query.order,
        toCursorValues: (item) => ({
          primary:
            query.sort === "score"
              ? item.score
              : query.sort === "reputation"
                ? (item.reputation.publisher + item.reputation.worker + item.reputation.supervisor) / 3
                : query.sort === "completed"
                  ? item.stats.tasksCompleted
                  : query.sort === "published"
                    ? item.stats.tasksPublished
                    : query.sort === "intented"
                      ? item.stats.tasksIntented
                      : item.latestActivityAt,
          ...(query.sort === "reputation"
            ? {
                reputationSum:
                  item.reputation.publisher + item.reputation.worker + item.reputation.supervisor
              }
            : {}),
          address: item.address
        })
      })
    : { items: mapped, nextCursor: null };
};

export const queryActivitiesDirect = async (
  prisma: PrismaClient,
  query: ActivityListQuery
): Promise<PaginatedResponse<ActivityEvent>> => {
  const sort = query.sort ?? "created";
  const boundedLimit = clampPageLimit(query.limit);
  const parsedCursor: ParsedCursor = query.paged
    ? parseListCursor(resolveCursorInput(query.cursor, query.offset), {
        resource: "activities",
        sort,
        order: query.order
      })
    : { mode: "start", offset: 0 };
  const whereClauses: Prisma.Sql[] = [];
  if (query.taskId) {
    whereClauses.push(Prisma.sql`a."taskId" = ${query.taskId}`);
  }
  if (query.disputeId) {
    whereClauses.push(Prisma.sql`a."disputeId" = ${query.disputeId}`);
  }
  if (query.type) {
    whereClauses.push(Prisma.sql`a."type" = CAST(${query.type} AS "ActivityEventType")`);
  }
  if (query.address) {
    whereClauses.push(Prisma.sql`lower(a."actorAddress") = lower(${query.address})`);
  }

  if (query.paged && parsedCursor.mode === "keyset") {
    const cursorId = requireCursorString(parsedCursor.values.id, "id");
    const cursorCreatedAt = requireCursorDate(parsedCursor.values.primary, "primary");
    const compareSql = Prisma.raw(query.order === "asc" ? ">" : "<");
    whereClauses.push(Prisma.sql`(
      a."createdAt" ${compareSql} ${cursorCreatedAt}
      OR (a."createdAt" = ${cursorCreatedAt} AND a.id ${compareSql} ${cursorId})
    )`);
  }

  const directionSql = Prisma.raw(query.order.toUpperCase());
  const rows = await prisma.$queryRaw<ActivityEventQueryRow[]>(Prisma.sql`
    SELECT
      a.id,
      a."type",
      a."cycleId",
      a."taskId",
      a."disputeId",
      a."actorAddress",
      a."createdAt"
    FROM "ActivityEvent" a
    ${buildWhereSql(whereClauses)}
    ORDER BY a."createdAt" ${directionSql}, a.id ${directionSql}
    ${buildPaginationSql(query.paged, parsedCursor, boundedLimit)}
  `);

  const mapped = rows.map((item) => mapActivityEvent(item));
  return query.paged
    ? buildPaginatedResponse(mapped, boundedLimit, parsedCursor, {
        resource: "activities",
        sort,
        order: query.order,
        toCursorValues: (item) => ({
          primary: item.createdAt,
          id: item.id
        })
      })
    : { items: mapped, nextCursor: null };
};

export const queryCyclesDirect = async (
  prisma: PrismaClient,
  query: CycleListQuery
): Promise<PaginatedResponse<Cycle>> => {
  const boundedLimit = clampPageLimit(query.limit);
  const parsedCursor: ParsedCursor = query.paged
    ? parseListCursor(resolveCursorInput(query.cursor, query.offset), {
        resource: "cycles",
        sort: "startedAt",
        order: "asc"
      })
    : { mode: "start", offset: 0 };

  const keysetWhere =
    parsedCursor.mode === "keyset"
      ? (() => {
          const cursorId = requireCursorString(parsedCursor.values.id, "id");
          const cursorStartedAt = requireCursorDate(parsedCursor.values.primary, "primary");
          return {
            OR: [
              { startedAt: { gt: cursorStartedAt } },
              {
                AND: [{ startedAt: cursorStartedAt }, { id: { gt: cursorId } }]
              }
            ]
          } satisfies Prisma.CycleWhereInput;
        })()
      : undefined;

  const cycles = await prisma.cycle.findMany({
    ...(keysetWhere
      ? {
          where: keysetWhere
        }
      : {}),
    orderBy: [{ startedAt: "asc" }, { id: "asc" }],
    ...(query.paged
      ? {
          ...(parsedCursor.mode === "legacy-offset"
            ? {
                skip: parsedCursor.offset
              }
            : {}),
          take: boundedLimit + 1
        }
      : {})
  });

  const mapped = cycles.map((item) => mapCycle(item));
  return query.paged
    ? buildPaginatedResponse(mapped, boundedLimit, parsedCursor, {
        resource: "cycles",
        sort: "startedAt",
        order: "asc",
        toCursorValues: (item) => ({
          primary: item.startedAt,
          id: item.id
        })
      })
    : { items: mapped, nextCursor: null };
};
