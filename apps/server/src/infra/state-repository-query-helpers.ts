import { Prisma, type PrismaClient } from "@prisma/client";
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
  reputationAverage: number | Prisma.Decimal | string;
  score: number | Prisma.Decimal | string;
  isActive: boolean;
}

const escapeLikePattern = (value: string): string => value.replace(/[\\%_]/g, "\\$&");

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
  const where: Prisma.TaskWhereInput = {
    status: query.status,
    publisherAddress: query.publisher
      ? {
          equals: query.publisher,
          mode: "insensitive"
        }
      : undefined,
    OR: query.q
      ? [
          { id: { contains: query.q, mode: "insensitive" } },
          { title: { contains: query.q, mode: "insensitive" } },
          { descriptionMd: { contains: query.q, mode: "insensitive" } },
          { acceptanceCriteria: { contains: query.q, mode: "insensitive" } },
          { publisherAddress: { contains: query.q, mode: "insensitive" } }
        ]
      : undefined
  };

  const orderBy: Prisma.TaskOrderByWithRelationInput[] =
    query.sort === "created"
      ? [{ createdAt: query.order }, { id: query.order }]
      : query.sort === "deadline"
        ? [{ deadlineUtc: query.order }, { id: query.order }]
        : query.sort === "reward"
          ? [{ rewardPerSlot: query.order }, { id: query.order }]
          : [{ updatedAt: query.order }, { id: query.order }];

  const primaryField: "updatedAt" | "createdAt" | "deadlineUtc" | "rewardPerSlot" =
    query.sort === "created"
      ? "createdAt"
      : query.sort === "deadline"
        ? "deadlineUtc"
        : query.sort === "reward"
          ? "rewardPerSlot"
          : "updatedAt";

  const keysetWhere =
    parsedCursor.mode === "keyset"
      ? (() => {
          const cursorId = requireCursorString(parsedCursor.values.id, "id");
          const primaryValue =
            primaryField === "rewardPerSlot"
              ? requireCursorNumber(parsedCursor.values.primary, "primary")
              : requireCursorDate(parsedCursor.values.primary, "primary");
          const primaryCompare = query.order === "asc" ? "gt" : "lt";
          const idCompare = query.order === "asc" ? "gt" : "lt";
          return {
            OR: [
              { [primaryField]: { [primaryCompare]: primaryValue } } as Prisma.TaskWhereInput,
              {
                AND: [
                  { [primaryField]: primaryValue } as Prisma.TaskWhereInput,
                  { id: { [idCompare]: cursorId } }
                ]
              }
            ]
          } satisfies Prisma.TaskWhereInput;
        })()
      : null;

  const whereWithCursor =
    keysetWhere && query.paged
      ? ({
          AND: [where, keysetWhere]
        } satisfies Prisma.TaskWhereInput)
      : where;

  const tasks = await prisma.task.findMany({
    where: whereWithCursor,
    orderBy,
    include: {
      _count: {
        select: { intentions: true }
      }
    },
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

  const mapped = tasks.map((item) => mapTask({ ...item, intentCount: item._count.intentions }));
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
  const where: Prisma.DisputeWhereInput = {
    taskId: query.taskId,
    status: query.status,
    openerAddress: query.opener
      ? {
          equals: query.opener,
          mode: "insensitive"
        }
      : undefined,
    OR: query.q
      ? [
          { id: { contains: query.q, mode: "insensitive" } },
          { taskId: { contains: query.q, mode: "insensitive" } },
          { submissionId: { contains: query.q, mode: "insensitive" } },
          { openerAddress: { contains: query.q, mode: "insensitive" } },
          { reasonMd: { contains: query.q, mode: "insensitive" } }
        ]
      : undefined
  };

  const orderBy: Prisma.DisputeOrderByWithRelationInput[] =
    query.sort === "created"
      ? [{ createdAt: query.order }, { id: query.order }]
      : [{ updatedAt: query.order }, { id: query.order }];

  const primaryField: "createdAt" | "updatedAt" = query.sort === "created" ? "createdAt" : "updatedAt";
  const keysetWhere =
    parsedCursor.mode === "keyset"
      ? (() => {
          const cursorId = requireCursorString(parsedCursor.values.id, "id");
          const primaryValue = requireCursorDate(parsedCursor.values.primary, "primary");
          const primaryCompare = query.order === "asc" ? "gt" : "lt";
          const idCompare = query.order === "asc" ? "gt" : "lt";
          return {
            OR: [
              { [primaryField]: { [primaryCompare]: primaryValue } } as Prisma.DisputeWhereInput,
              {
                AND: [
                  { [primaryField]: primaryValue } as Prisma.DisputeWhereInput,
                  { id: { [idCompare]: cursorId } }
                ]
              }
            ]
          } satisfies Prisma.DisputeWhereInput;
        })()
      : null;

  const whereWithCursor =
    keysetWhere && query.paged
      ? ({
          AND: [where, keysetWhere]
        } satisfies Prisma.DisputeWhereInput)
      : where;

  const disputes = await prisma.dispute.findMany({
    where: whereWithCursor,
    orderBy,
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

  const mapped = disputes.map((item) => mapDispute(item));
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
  const where: Prisma.SubmissionWhereInput = {
    taskId: query.taskId,
    status: query.status,
    agentAddress: query.agent
      ? {
          equals: query.agent,
          mode: "insensitive"
        }
      : undefined,
    OR: query.q
      ? [
          { id: { contains: query.q, mode: "insensitive" } },
          { taskId: { contains: query.q, mode: "insensitive" } },
          { agentAddress: { contains: query.q, mode: "insensitive" } },
          { payloadMd: { contains: query.q, mode: "insensitive" } }
        ]
      : undefined
  };

  const orderBy: Prisma.SubmissionOrderByWithRelationInput[] =
    query.sort === "created"
      ? [{ createdAt: query.order }, { id: query.order }]
      : [{ updatedAt: query.order }, { id: query.order }];

  const primaryField: "createdAt" | "updatedAt" = query.sort === "created" ? "createdAt" : "updatedAt";
  const keysetWhere =
    parsedCursor.mode === "keyset"
      ? (() => {
          const cursorId = requireCursorString(parsedCursor.values.id, "id");
          const primaryValue = requireCursorDate(parsedCursor.values.primary, "primary");
          const primaryCompare = query.order === "asc" ? "gt" : "lt";
          const idCompare = query.order === "asc" ? "gt" : "lt";
          return {
            OR: [
              { [primaryField]: { [primaryCompare]: primaryValue } } as Prisma.SubmissionWhereInput,
              {
                AND: [
                  { [primaryField]: primaryValue } as Prisma.SubmissionWhereInput,
                  { id: { [idCompare]: cursorId } }
                ]
              }
            ]
          } satisfies Prisma.SubmissionWhereInput;
        })()
      : null;

  const whereWithCursor =
    keysetWhere && query.paged
      ? ({
          AND: [where, keysetWhere]
        } satisfies Prisma.SubmissionWhereInput)
      : where;

  const submissions = await prisma.submission.findMany({
    where: whereWithCursor,
    orderBy,
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

  const mapped = submissions.map((item) => mapSubmission(item));
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
  query: AgentListQuery
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
      const cursorPrimary = requireCursorNumber(parsedCursor.values.primary, "primary");
      const metricColumnSql =
        query.sort === "score"
          ? Prisma.raw("ranked.score")
          : query.sort === "reputation"
            ? Prisma.raw('ranked."reputationAverage"')
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
        ? Prisma.sql`ORDER BY ranked."reputationAverage" ${directionSql}, ranked.address ${directionSql}`
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
        MAX(ae."createdAt") AS "latestActivityAt",
        ((ap."publisherRep" + ap."workerRep" + ap."supervisorRep") / 3.0) AS "reputationAverage",
        ROUND(
          (
            0.45 * ((ap."publisherRep" + ap."workerRep" + ap."supervisorRep") / 3.0)
            + 0.35 * CASE
              WHEN ap."tasksIntentedCount" > 0 THEN LEAST(1.0, ap."tasksCompletedCount"::float / ap."tasksIntentedCount") * 100
              ELSE 0
            END
            + 0.2 * CASE
              WHEN ap."tasksIntentedCount" > 0 THEN GREATEST(0.0, 1.0 - ap."submissionsRejectedCount"::float / ap."tasksIntentedCount") * 100
              ELSE 100
            END
          )::numeric,
          2
        ) AS score,
        (
          MAX(ae."createdAt") IS NOT NULL
          OR ap."tasksIntentedCount" > 0
          OR ap."tasksPublishedCount" > 0
          OR ap."tasksCompletedCount" > 0
          OR ap."submissionsRejectedCount" > 0
          OR ap."supervisionVotesCount" > 0
        ) AS "isActive"
      FROM "AgentProfile" ap
      LEFT JOIN "ActivityEvent" ae ON ae."actorAddress" = ap.address
      GROUP BY
        ap.address,
        ap.name,
        ap.bio,
        ap."publisherRep",
        ap."workerRep",
        ap."supervisorRep",
        ap."tasksPublishedCount",
        ap."tasksIntentedCount",
        ap."tasksCompletedCount",
        ap."tasksTerminatedCount",
        ap."submissionsRejectedCount",
        ap."supervisionVotesCount",
        ap."createdAt",
        ap."updatedAt"
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
  const where: Prisma.ActivityEventWhereInput = {
    taskId: query.taskId,
    disputeId: query.disputeId,
    type: query.type,
    actorAddress: query.address
      ? {
          equals: query.address,
          mode: "insensitive"
        }
      : undefined
  };

  const keysetWhere =
    parsedCursor.mode === "keyset"
      ? (() => {
          const cursorId = requireCursorString(parsedCursor.values.id, "id");
          const cursorCreatedAt = requireCursorDate(parsedCursor.values.primary, "primary");
          const createdAtCompare = query.order === "asc" ? "gt" : "lt";
          const idCompare = query.order === "asc" ? "gt" : "lt";
          return {
            OR: [
              { createdAt: { [createdAtCompare]: cursorCreatedAt } },
              {
                AND: [{ createdAt: cursorCreatedAt }, { id: { [idCompare]: cursorId } }]
              }
            ]
          } satisfies Prisma.ActivityEventWhereInput;
        })()
      : null;

  const whereWithCursor =
    keysetWhere && query.paged
      ? ({
          AND: [where, keysetWhere]
        } satisfies Prisma.ActivityEventWhereInput)
      : where;

  const events = await prisma.activityEvent.findMany({
    where: whereWithCursor,
    orderBy: [{ createdAt: query.order }, { id: query.order }],
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

  const mapped = events.map((item) => mapActivityEvent(item));
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
