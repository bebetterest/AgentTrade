import { Prisma, PrismaClient } from "@prisma/client";
import {
  applyRuntimeEditableRules,
  defaultConfig,
  mergeRuntimeEditableRules,
  pickRuntimeEditableRules,
  validateRuntimeEditableRules,
  type AppConfig,
  type RuntimeEditableRules,
  type RuntimeEditableRulesPatch
} from "@agentrade/config";
import { nanoid } from "nanoid";
import type { EngineStateSnapshot } from "../domain/engine.js";
import {
  type ActivityEvent,
  type AgentDirectoryItem,
  AgentBanReason,
  AgentStatus,
  ActivityEventType as DomainActivityEventType,
  type AgentProfile,
  type ServerAuditLogRecord,
  type ServerRequestLogRecord,
  type CloseCycleResult,
  type Cycle,
  type CycleRewardsResponse,
  type CycleWorkload,
  CycleStatus as DomainCycleStatus,
  type DashboardMetricSnapshot,
  type DashboardSummaryResponse,
  type DashboardTrendPoint,
  type DashboardTrendsResponse,
  type Dispute,
  DisputePayoutSource,
  type DisputeResolutionSummary,
  DisputeStatus as DomainDisputeStatus,
  type FeedbackReport,
  type FeedbackReportType,
  type LedgerBalance,
  type PaginatedResponse,
  type Submission,
  SubmissionStatus as DomainSubmissionStatus,
  type SupervisionVote,
  type Task,
  type TaskIntention,
  type RuntimeRuleAuditRecord,
  type RuntimeSettingsState,
  TaskStatus as DomainTaskStatus,
  type TodoGroupType,
  type TodoScope,
  type TodosResponse,
  VoteChoice as DomainVoteChoice,
  VoteChoice,
  type Address
} from "@agentrade/types";
import {
  allocateIntegerPool,
  computeTerminationPenalty
} from "../domain/helpers.js";
import { DomainError } from "../domain/errors.js";
import {
  mapActivityEvent,
  computeTaskCompetitionRatio,
  mapAgentProfile,
  mapCycle,
  mapCycleWorkload,
  mapDispute,
  mapSubmission,
  mapTask,
  mapTaskIntention,
  mapVote
} from "./state-repository-mappers.js";
import {
  queryTodosDirect
} from "./state-repository-todo-helpers.js";
import {
  appendActivityEventWithTx,
  applyProfileDeltaWithTx,
  ensureAgentAndLedgerWithTx,
  getConfirmedSlots,
  lockRuntimeWithTx,
  touchRuntimeStateWithTx
} from "./state-repository-tx-helpers.js";
import {
  buildDashboardDayWindow,
  dayKeyToUtcStart
} from "../utils/timezone.js";
import {
  readGetActiveCycleDirect,
  readGetAgentDirect,
  readGetCycleDirect,
  readGetDisputeDirect,
  readGetLedgerDirect,
  readGetSubmissionDirect,
  readGetTaskDirect,
  readListActivitiesDirect,
  readListAgentsDirect,
  readListCyclesDirect,
  readListDisputesDirect,
  readListSubmissionsDirect,
  readListTasksDirect
} from "./state-repository-read-helpers.js";
import {
  type ActivityListQuery,
  type AgentListQuery,
  type CycleListQuery,
  type DisputeListQuery,
  type SubmissionListQuery,
  queryActivitiesDirect,
  queryAgentsDirect,
  queryCyclesDirect,
  queryDisputesDirect,
  querySubmissionsDirect,
  queryTasksDirect,
  type TaskListQuery
} from "./state-repository-query-helpers.js";
import {
  type AuditLogCreateInput,
  type AuditLogQuery,
  buildAuditLogRecord,
  type CleanupLogsResult,
  type RequestLogCreateInput,
  type RequestLogQuery,
  buildRequestLogRecord,
  buildWriteSuccessAuditLog,
  type WriteAuditContext,
  sanitizeAuditDetails
} from "../observability/server-logs.js";
import {
  buildFeedbackReportRecord,
  FEEDBACK_REPORT_RESOURCE,
  type FeedbackReportCreateInput,
  type FeedbackReportQuery
} from "../feedback/reports.js";
import {
  workerJobMetricCountersFromBigInts,
  type WorkerJobMetricCounters,
  type WorkerJobMetricOutcome
} from "../observability/metrics.js";
import {
  encodeKeysetCursor,
  clampPageLimit,
  nextCursorOffset,
  parseListCursor
} from "../pagination/cursor.js";
import {
  type OpenDisputeDirectInput,
  type PublishTaskDirectInput,
  type RejectSubmissionDirectInput,
  type RespondDisputeDirectInput,
  type SubmitTaskDirectInput,
  type VoteDisputeDirectInput,
  writeAddTaskIntentionDirect,
  writeCloseCurrentCycleIfDueDirect,
  writeCloseCurrentCycleDirect,
  writeConfirmSubmissionDirect,
  writeOpenDisputeDirect,
  writeOverrideDisputeDirect,
  writePublishTaskDirect,
  writeRejectSubmissionDirect,
  writeRespondDisputeDirect,
  writeSubmitTaskDirect,
  writeTerminateTaskDirect,
  writeVoteDisputeDirect,
  writeUpdateAgentProfileDirect
} from "./state-repository-write-helpers.js";

interface ForcedTerminationRollbackRecord {
  taskId: string;
  cycleId: string;
  previousStatus: DomainTaskStatus;
  previousRewardEscrowRemaining: number;
  penalty: number;
  refund: number;
}

interface DisputeResolutionRollbackRecord {
  resolutionCycleId: string;
  taskStatusBeforeResolution: DomainTaskStatus;
  taskRewardEscrowRemainingBeforeResolution: number;
  publisherWasBannedBeforeResolution: boolean;
  publisherBanSourceDisputeIdBeforeResolution: string | null;
  forcedTerminations: ForcedTerminationRollbackRecord[];
}

interface DisputeRollbackHistoryRecord {
  id: string;
  disputeId: string;
  previousStatus: DomainDisputeStatus;
  previousResolution: {
    disputeId: string;
    payoutSource: DisputePayoutSource;
    payoutAmount: number;
    payoutShortfallAmount: number;
    publisherBanned: boolean;
    rollback?: DisputeResolutionRollbackRecord | null;
  } | null;
  archivedVotes: SupervisionVote[];
  archivedWorkloads: CycleWorkload[];
  archivedActivities: ActivityEvent[];
  reopenedAt: string;
}

const RUNTIME_ID = "singleton";
const RUNTIME_RULE_STATE_ID = "singleton";
const OPEN_DISPUTE_UNIQUE_INDEX = "uq_dispute_open_submission";
const MAX_SERIALIZABLE_RETRIES = 20;
const SERIALIZABLE_RETRY_BACKOFF_MS = 10;
const MAX_SERIALIZABLE_RETRY_BACKOFF_MS = 200;
const PRISMA_TRANSACTION_MAX_WAIT_MS = 10_000;
const PRISMA_TRANSACTION_TIMEOUT_MS = 30_000;
const RUNTIME_AUDIT_PAGE_LIMIT_MAX = 100;
const CYCLE_CLOSE_WORKER_LOCK_KEY = 3_101;
const LOG_CLEANUP_WORKER_LOCK_KEY = 3_102;
const runtimeRuleDefaults = pickRuntimeEditableRules(defaultConfig);
const WORKER_JOB_METRIC_COUNTER_NAMES = [
  "workerJobSuccessTotal",
  "workerJobErrorTotal",
  "workerJobLockMissTotal"
] as const;
type WorkerJobMetricCounterName = (typeof WORKER_JOB_METRIC_COUNTER_NAMES)[number];
const WORKER_JOB_METRIC_NAME_BY_OUTCOME = {
  success: "workerJobSuccessTotal",
  error: "workerJobErrorTotal",
  lock_miss: "workerJobLockMissTotal"
} as const satisfies Record<WorkerJobMetricOutcome, WorkerJobMetricCounterName>;
const isWorkerJobMetricCounterName = (value: string): value is WorkerJobMetricCounterName =>
  (WORKER_JOB_METRIC_COUNTER_NAMES as readonly string[]).includes(value);

const toDate = (value: string): Date => new Date(value);
const toIso = (value: Date): string => value.toISOString();
const asAddress = (value: string): Address => value as Address;
const cloneAppConfig = (config: AppConfig): AppConfig => ({
  ...config,
  corsAllowedOrigins: [...config.corsAllowedOrigins]
});
const buildSingleConnectionDatabaseUrl = (databaseUrl: string): string => {
  try {
    const url = new URL(databaseUrl);
    url.searchParams.set("connection_limit", "1");
    return url.toString();
  } catch {
    const separator = databaseUrl.includes("?") ? "&" : "?";
    return `${databaseUrl}${separator}connection_limit=1`;
  }
};
const toJsonAddressArray = (value: string[]): Prisma.InputJsonValue =>
  value as unknown as Prisma.InputJsonValue;
const toJsonSubmissionAttachments = (
  value: Submission["attachments"]
): Prisma.InputJsonValue => value as unknown as Prisma.InputJsonValue;

const asStringArray = (value: Prisma.JsonValue): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
};

const asAddressArray = (value: Prisma.JsonValue): Address[] =>
  asStringArray(value).map((item) => asAddress(item));

const toJsonDisputeResolutionRollback = (
  value: DisputeResolutionRollbackRecord | null | undefined
): Prisma.InputJsonValue | typeof Prisma.JsonNull =>
  (value ?? Prisma.JsonNull) as Prisma.InputJsonValue | typeof Prisma.JsonNull;

const toJsonRollbackHistoryEntries = (
  value: SupervisionVote[] | CycleWorkload[] | ActivityEvent[]
): Prisma.InputJsonValue => value as unknown as Prisma.InputJsonValue;

const asDisputeResolutionRollback = (
  value: Prisma.JsonValue | null
): DisputeResolutionRollbackRecord | null =>
  value ? (value as unknown as DisputeResolutionRollbackRecord) : null;

const asDisputeRollbackHistoryArray = <T>(value: Prisma.JsonValue): T[] =>
  Array.isArray(value) ? (value as unknown as T[]) : [];

interface DashboardMetricRow {
  tasksPublished: number | bigint | Prisma.Decimal | string | null;
  tasksIntented: number | bigint | Prisma.Decimal | string | null;
  tasksCompleted: number | bigint | Prisma.Decimal | string | null;
  disputesOpened: number | bigint | Prisma.Decimal | string | null;
}

interface DashboardTrendAggregateRow {
  label: string;
  type: DomainActivityEventType;
  eventCount: number | bigint | Prisma.Decimal | string | null;
}

interface WorkerMetricCounterRow {
  name: string;
  value: number | bigint | Prisma.Decimal | string | null;
}

const emptyDashboardMetrics = (): DashboardMetricSnapshot => ({
  tasksPublished: 0,
  tasksIntented: 0,
  tasksCompleted: 0,
  disputesOpened: 0
});

interface SnapshotDiff<T> {
  upserts: T[];
  deletes: string[];
}

export type PersistenceMutationScope =
  | "profiles"
  | "balances"
  | "tasks"
  | "intentions"
  | "submissions"
  | "disputes"
  | "votes"
  | "cycleWorkloads"
  | "cycles"
  | "activities";

const snapshotItemEquals = <T>(a: T, b: T): boolean => JSON.stringify(a) === JSON.stringify(b);

const diffByKey = <T>(
  current: T[],
  next: T[],
  getKey: (item: T) => string
): SnapshotDiff<T> => {
  const currentMap = new Map(current.map((item) => [getKey(item), item]));
  const nextMap = new Map(next.map((item) => [getKey(item), item]));

  const upserts: T[] = [];
  for (const [key, nextItem] of nextMap.entries()) {
    const currentItem = currentMap.get(key);
    if (!currentItem || !snapshotItemEquals(currentItem, nextItem)) {
      upserts.push(nextItem);
    }
  }

  const deletes: string[] = [];
  for (const key of currentMap.keys()) {
    if (!nextMap.has(key)) {
      deletes.push(key);
    }
  }

  return { upserts, deletes };
};

const toNumber = (value: unknown): number => {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (value instanceof Prisma.Decimal) {
    return value.toNumber();
  }
  return Number(value ?? 0);
};

const toNonNegativeBigInt = (value: unknown): bigint => {
  if (typeof value === "bigint") {
    return value >= 0n ? value : 0n;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? BigInt(Math.floor(value)) : 0n;
  }
  if (value instanceof Prisma.Decimal) {
    const text = value.toString();
    return /^\d+$/.test(text) ? BigInt(text) : 0n;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return BigInt(value);
  }
  return 0n;
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const runtimeRuleKeys = Object.keys(runtimeRuleDefaults) as Array<keyof RuntimeEditableRules>;

const toRuntimeEditableRules = (value: unknown): RuntimeEditableRules => {
  if (!isObjectRecord(value)) {
    throw new Error("invalid runtime rule state payload: expected object");
  }
  const rules: Partial<RuntimeEditableRules> = {};
  for (const key of runtimeRuleKeys) {
    const raw = value[key];
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      throw new Error(`invalid runtime rule state payload: ${String(key)} must be a finite number`);
    }
    rules[key] = raw as RuntimeEditableRules[typeof key];
  }
  const normalized = rules as RuntimeEditableRules;
  validateRuntimeEditableRules(normalized);
  return normalized;
};

const toRuntimeEditableRulesPatch = (value: unknown): RuntimeEditableRulesPatch => {
  if (!isObjectRecord(value)) {
    return {};
  }
  const patch: RuntimeEditableRulesPatch = {};
  for (const key of runtimeRuleKeys) {
    if (!(key in value)) {
      continue;
    }
    const raw = value[key];
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      throw new Error(`invalid runtime rule patch payload: ${String(key)} must be a finite number`);
    }
    patch[key] = raw as RuntimeEditableRules[typeof key];
  }
  return patch;
};

const diffRuntimeEditableRules = (
  base: RuntimeEditableRules,
  target: RuntimeEditableRules
): RuntimeEditableRulesPatch => {
  const patch: RuntimeEditableRulesPatch = {};
  for (const key of runtimeRuleKeys) {
    if (base[key] !== target[key]) {
      patch[key] = target[key];
    }
  }
  return patch;
};

export class PersistenceConflictError extends Error {
  readonly code = "PERSISTENCE_CONFLICT";

  constructor(message = "persistence state changed concurrently") {
    super(message);
    this.name = "PersistenceConflictError";
  }
}

export class PrismaStateRepository {
  private prisma: PrismaClient;
  private workerLockPrisma: PrismaClient;
  private readonly config: AppConfig;
  private readonly ensurePersistenceGuardsEnabled: boolean;
  private readonly inProcessWorkerLocks = new Set<number>();
  private persistenceGuardsPromise: Promise<void> | null = null;

  constructor(
    databaseUrl: string,
    config: AppConfig = defaultConfig,
    options: { ensurePersistenceGuards?: boolean } = {}
  ) {
    this.prisma = new PrismaClient({
      datasources: {
        db: {
          url: databaseUrl
        }
      },
      transactionOptions: {
        maxWait: PRISMA_TRANSACTION_MAX_WAIT_MS,
        timeout: PRISMA_TRANSACTION_TIMEOUT_MS
      }
    });
    this.workerLockPrisma = new PrismaClient({
      datasources: {
        db: {
          url: buildSingleConnectionDatabaseUrl(databaseUrl)
        }
      }
    });
    this.config = cloneAppConfig(config);
    this.ensurePersistenceGuardsEnabled = options.ensurePersistenceGuards ?? true;
  }

  async ensureInitialized(initialSnapshot: EngineStateSnapshot): Promise<void> {
    await this.ensurePersistenceGuards();
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.runtimeState.findUnique({
        where: { id: RUNTIME_ID }
      });
      if (existing) {
        return;
      }
      await this.applySnapshotDiffWithTx(tx, null, initialSnapshot, null);
    });
  }

  async ensureRuntimeRulesInitialized(
    defaults: RuntimeEditableRules = pickRuntimeEditableRules(this.config)
  ): Promise<RuntimeSettingsState> {
    validateRuntimeEditableRules(defaults);
    return this.executeWithRetry(async () =>
      this.prisma.$transaction(async (tx) => {
        const runtime = await tx.runtimeState.findUnique({
          where: { id: RUNTIME_ID },
          select: { id: true }
        });
        if (!runtime) {
          throw new Error("runtime state is unavailable while initializing runtime rules");
        }
        await tx.$queryRaw`SELECT id FROM "RuntimeState" WHERE id = ${RUNTIME_ID} FOR UPDATE`;
        await tx.runtimeRuleState.upsert({
          where: { id: RUNTIME_RULE_STATE_ID },
          create: {
            id: RUNTIME_RULE_STATE_ID,
            currentRules: defaults,
            pendingNextPatch: Prisma.JsonNull
          },
          update: {}
        });
        const row = await tx.runtimeRuleState.findUniqueOrThrow({
          where: { id: RUNTIME_RULE_STATE_ID }
        });
        return this.toRuntimeSettingsState(row);
      })
    );
  }

  async getRuntimeSettingsDirect(): Promise<RuntimeSettingsState | null> {
    const row = await this.prisma.runtimeRuleState.findUnique({
      where: { id: RUNTIME_RULE_STATE_ID }
    });
    return row ? this.toRuntimeSettingsState(row) : null;
  }

  async listRuntimeRuleAuditsDirect(input: {
    cursor?: string;
    limit: number;
  }): Promise<PaginatedResponse<RuntimeRuleAuditRecord>> {
    const boundedLimit = Math.min(
      RUNTIME_AUDIT_PAGE_LIMIT_MAX,
      Math.max(1, Number.isFinite(input.limit) ? input.limit : 20)
    );
    const cursor = input.cursor
      ? parseListCursor(input.cursor, {
          resource: "runtime-rule-audits",
          sort: "createdAt",
          order: "desc"
        })
      : null;
    const keysetWhere =
      cursor?.mode === "keyset"
        ? (() => {
            const cursorId = cursor.values.id;
            const cursorPrimary = cursor.values.primary;
            if (typeof cursorId !== "string" || cursorId.length === 0) {
              throw new DomainError("INVALID_CURSOR", "cursor id must be a non-empty string", 400);
            }
            if (typeof cursorPrimary !== "string" || cursorPrimary.length === 0) {
              throw new DomainError(
                "INVALID_CURSOR",
                "cursor primary must be a non-empty ISO datetime string",
                400
              );
            }
            const createdAt = new Date(cursorPrimary);
            if (Number.isNaN(createdAt.getTime())) {
              throw new DomainError("INVALID_CURSOR", "cursor primary must be valid ISO datetime", 400);
            }
            return {
              OR: [
                { createdAt: { lt: createdAt } },
                {
                  AND: [{ createdAt }, { id: { lt: cursorId } }]
                }
              ]
            } satisfies Prisma.RuntimeRuleAuditWhereInput;
          })()
        : null;

    const rows = await this.prisma.runtimeRuleAudit.findMany({
      where: keysetWhere ? { AND: [keysetWhere] } : undefined,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...(cursor?.mode === "legacy-offset"
        ? { skip: cursor.offset, take: boundedLimit + 1 }
        : { take: boundedLimit + 1 })
    });

    const mapped = rows.map((item) => this.mapRuntimeRuleAudit(item));
    const hasMore = mapped.length > boundedLimit;
    const items = hasMore ? mapped.slice(0, boundedLimit) : mapped;
    const nextCursor =
      hasMore && items.length > 0
        ? encodeKeysetCursor({
            resource: "runtime-rule-audits",
            sort: "createdAt",
            order: "desc",
            offset: nextCursorOffset(cursor ?? { mode: "start", offset: 0 }, items.length),
            values: {
              primary: items[items.length - 1]!.createdAt,
              id: items[items.length - 1]!.id
            }
          })
        : null;

    return {
      items,
      nextCursor
    };
  }

  async appendRequestLogsDirect(inputs: RequestLogCreateInput[]): Promise<ServerRequestLogRecord[]> {
    if (inputs.length === 0) {
      return [];
    }
    const records = inputs.map((input) => buildRequestLogRecord(input));
    await this.prisma.serverRequestLog.createMany({
      data: records.map((record) => ({
        id: record.id,
        requestId: record.requestId,
        method: record.method,
        path: record.path,
        routeId: record.routeId,
        statusCode: record.statusCode,
        durationMs: record.durationMs,
        clientIp: record.clientIp,
        forwardedFor: record.forwardedFor ?? undefined,
        userAgent: record.userAgent ?? undefined,
        actorAddress: record.actorAddress ?? undefined,
        errorCode: record.errorCode ?? undefined,
        createdAt: new Date(record.createdAt)
      }))
    });
    return records;
  }

  async appendAuditLogDirect(input: AuditLogCreateInput): Promise<ServerAuditLogRecord> {
    const record = buildAuditLogRecord(input);
    await this.prisma.serverAuditLog.create({
      data: {
        id: record.id,
        category: record.category,
        action: record.action,
        severity: record.severity,
        outcome: record.outcome,
        requestId: record.requestId ?? undefined,
        clientIp: record.clientIp ?? undefined,
        actorAddress: record.actorAddress ?? undefined,
        method: record.method ?? undefined,
        routeId: record.routeId ?? undefined,
        targetType: record.targetType ?? undefined,
        targetId: record.targetId ?? undefined,
        cycleId: record.cycleId ?? undefined,
        message: record.message,
        details: record.details
          ? (sanitizeAuditDetails(record.details) as Prisma.InputJsonValue)
          : undefined,
        createdAt: new Date(record.createdAt)
      }
    });
    return record;
  }

  async queryRequestLogsDirect(query: RequestLogQuery): Promise<PaginatedResponse<ServerRequestLogRecord>> {
    const boundedLimit = clampPageLimit(query.limit);
    const cursor = query.cursor
      ? parseListCursor(query.cursor, {
          resource: "server-request-logs",
          sort: "createdAt",
          order: "desc"
        })
      : null;
    const filters: Prisma.Sql[] = [];
    const normalizedMethod = query.method?.trim().toUpperCase();
    if (cursor?.mode === "keyset") {
      const cursorId = cursor.values.id;
      const cursorPrimary = cursor.values.primary;
      if (typeof cursorId !== "string" || cursorId.length === 0) {
        throw new DomainError("INVALID_CURSOR", "cursor id must be a non-empty string", 400);
      }
      if (typeof cursorPrimary !== "string" || cursorPrimary.length === 0) {
        throw new DomainError(
          "INVALID_CURSOR",
          "cursor primary must be a non-empty ISO datetime string",
          400
        );
      }
      const createdAt = new Date(cursorPrimary);
      if (Number.isNaN(createdAt.getTime())) {
        throw new DomainError("INVALID_CURSOR", "cursor primary must be valid ISO datetime", 400);
      }
      filters.push(Prisma.sql`(
        l."createdAt" < ${createdAt}
        OR (l."createdAt" = ${createdAt} AND l.id < ${cursorId})
      )`);
    }
    if (query.from || query.to) {
      if (query.from) {
        filters.push(Prisma.sql`l."createdAt" >= ${new Date(query.from)}`);
      }
      if (query.to) {
        filters.push(Prisma.sql`l."createdAt" <= ${new Date(query.to)}`);
      }
    }
    if (query.requestId) {
      filters.push(Prisma.sql`l."requestId" = ${query.requestId}`);
    }
    if (query.actor) {
      filters.push(Prisma.sql`lower(l."actorAddress") = lower(${query.actor})`);
    }
    if (query.ip) {
      filters.push(Prisma.sql`l."clientIp" = ${query.ip}`);
    }
    if (normalizedMethod) {
      filters.push(Prisma.sql`l.method = ${normalizedMethod}`);
    }
    if (query.routeId) {
      filters.push(Prisma.sql`l."routeId" = ${query.routeId}`);
    }
    if (query.status !== undefined) {
      filters.push(Prisma.sql`l."statusCode" = ${query.status}`);
    }

    const whereSql =
      filters.length > 0 ? Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}` : Prisma.empty;
    const paginationSql =
      cursor?.mode === "legacy-offset"
        ? Prisma.sql`LIMIT ${boundedLimit + 1} OFFSET ${cursor.offset}`
        : Prisma.sql`LIMIT ${boundedLimit + 1}`;
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        requestId: string;
        method: string;
        path: string;
        routeId: string;
        statusCode: number;
        durationMs: number;
        clientIp: string;
        forwardedFor: string | null;
        userAgent: string | null;
        actorAddress: string | null;
        errorCode: string | null;
        createdAt: Date;
      }>
    >(Prisma.sql`
      SELECT
        l.id,
        l."requestId",
        l.method,
        l.path,
        l."routeId",
        l."statusCode",
        l."durationMs",
        l."clientIp",
        l."forwardedFor",
        l."userAgent",
        l."actorAddress",
        l."errorCode",
        l."createdAt"
      FROM "ServerRequestLog" l
      ${whereSql}
      ORDER BY l."createdAt" DESC, l.id DESC
      ${paginationSql}
    `);
    const mapped = rows.map((item) => this.mapServerRequestLog(item));
    const hasMore = mapped.length > boundedLimit;
    const items = hasMore ? mapped.slice(0, boundedLimit) : mapped;
    const nextCursor =
      hasMore && items.length > 0
        ? encodeKeysetCursor({
            resource: "server-request-logs",
            sort: "createdAt",
            order: "desc",
            offset: nextCursorOffset(cursor ?? { mode: "start", offset: 0 }, items.length),
            values: {
              primary: items[items.length - 1]!.createdAt,
              id: items[items.length - 1]!.id
            }
          })
        : null;
    return { items, nextCursor };
  }

  async queryAuditLogsDirect(query: AuditLogQuery): Promise<PaginatedResponse<ServerAuditLogRecord>> {
    const boundedLimit = clampPageLimit(query.limit);
    const cursor = query.cursor
      ? parseListCursor(query.cursor, {
          resource: "server-audit-logs",
          sort: "createdAt",
          order: "desc"
        })
      : null;
    const filters: Prisma.Sql[] = [];
    if (cursor?.mode === "keyset") {
      const cursorId = cursor.values.id;
      const cursorPrimary = cursor.values.primary;
      if (typeof cursorId !== "string" || cursorId.length === 0) {
        throw new DomainError("INVALID_CURSOR", "cursor id must be a non-empty string", 400);
      }
      if (typeof cursorPrimary !== "string" || cursorPrimary.length === 0) {
        throw new DomainError(
          "INVALID_CURSOR",
          "cursor primary must be a non-empty ISO datetime string",
          400
        );
      }
      const createdAt = new Date(cursorPrimary);
      if (Number.isNaN(createdAt.getTime())) {
        throw new DomainError("INVALID_CURSOR", "cursor primary must be valid ISO datetime", 400);
      }
      filters.push(Prisma.sql`(
        l."createdAt" < ${createdAt}
        OR (l."createdAt" = ${createdAt} AND l.id < ${cursorId})
      )`);
    }
    if (query.from || query.to) {
      if (query.from) {
        filters.push(Prisma.sql`l."createdAt" >= ${new Date(query.from)}`);
      }
      if (query.to) {
        filters.push(Prisma.sql`l."createdAt" <= ${new Date(query.to)}`);
      }
    }
    if (query.requestId) {
      filters.push(Prisma.sql`l."requestId" = ${query.requestId}`);
    }
    if (query.actor) {
      filters.push(Prisma.sql`lower(l."actorAddress") = lower(${query.actor})`);
    }
    if (query.ip) {
      filters.push(Prisma.sql`l."clientIp" = ${query.ip}`);
    }
    if (query.category) {
      filters.push(Prisma.sql`l.category = CAST(${query.category} AS "ServerAuditCategory")`);
    }
    if (query.action) {
      filters.push(Prisma.sql`l.action = ${query.action}`);
    }
    if (query.outcome) {
      filters.push(Prisma.sql`l.outcome = CAST(${query.outcome} AS "ServerAuditOutcome")`);
    }

    const whereSql =
      filters.length > 0 ? Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}` : Prisma.empty;
    const paginationSql =
      cursor?.mode === "legacy-offset"
        ? Prisma.sql`LIMIT ${boundedLimit + 1} OFFSET ${cursor.offset}`
        : Prisma.sql`LIMIT ${boundedLimit + 1}`;
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        category: string;
        action: string;
        severity: string;
        outcome: string;
        requestId: string | null;
        clientIp: string | null;
        actorAddress: string | null;
        method: string | null;
        routeId: string | null;
        targetType: string | null;
        targetId: string | null;
        cycleId: string | null;
        message: string;
        details: Prisma.JsonValue | null;
        createdAt: Date;
      }>
    >(Prisma.sql`
      SELECT
        l.id,
        l.category,
        l.action,
        l.severity,
        l.outcome,
        l."requestId",
        l."clientIp",
        l."actorAddress",
        l.method,
        l."routeId",
        l."targetType",
        l."targetId",
        l."cycleId",
        l.message,
        l.details,
        l."createdAt"
      FROM "ServerAuditLog" l
      ${whereSql}
      ORDER BY l."createdAt" DESC, l.id DESC
      ${paginationSql}
    `);
    const mapped = rows.map((item) => this.mapServerAuditLog(item));
    const hasMore = mapped.length > boundedLimit;
    const items = hasMore ? mapped.slice(0, boundedLimit) : mapped;
    const nextCursor =
      hasMore && items.length > 0
        ? encodeKeysetCursor({
            resource: "server-audit-logs",
            sort: "createdAt",
            order: "desc",
            offset: nextCursorOffset(cursor ?? { mode: "start", offset: 0 }, items.length),
            values: {
              primary: items[items.length - 1]!.createdAt,
              id: items[items.length - 1]!.id
            }
          })
        : null;
    return { items, nextCursor };
  }

  async createFeedbackReportDirect(
    input: FeedbackReportCreateInput & { auditContext?: WriteAuditContext }
  ): Promise<FeedbackReport> {
    const record = buildFeedbackReportRecord(input);
    return this.executeWithRetry(async () =>
      this.prisma.$transaction(async (tx) => {
        const runtime = await this.lockRuntimeWithTx(tx);
        await this.assertAgentActiveForWriteWithTx(
          tx,
          input.reporterAddress,
          new Date(record.createdAt)
        );
        await tx.feedbackReport.create({
          data: {
            id: record.id,
            type: record.type,
            title: record.title,
            bodyMd: record.bodyMd,
            reporterAddress: record.reporterAddress,
            createdAt: new Date(record.createdAt)
          }
        });
        await this.touchRuntimeStateWithTx(tx);
        if (input.auditContext) {
          await this.appendAuditLogWithTx(
            tx,
            buildWriteSuccessAuditLog(input.auditContext, {
              targetId: record.id,
              cycleId: runtime.activeCycleId,
              message: "feedback.submit succeeded",
              details: {
                type: record.type,
                titleLength: record.title.length,
                bodyLength: record.bodyMd.length
              }
            })
          );
        }
        return record;
      })
    );
  }

  async getFeedbackReportDirect(id: string): Promise<FeedbackReport | null> {
    const row = await this.prisma.feedbackReport.findUnique({ where: { id } });
    return row ? this.mapFeedbackReport(row) : null;
  }

  async queryFeedbackReportsDirect(query: FeedbackReportQuery): Promise<PaginatedResponse<FeedbackReport>> {
    const boundedLimit = clampPageLimit(query.limit);
    const cursor = query.cursor
      ? parseListCursor(query.cursor, {
          resource: FEEDBACK_REPORT_RESOURCE,
          sort: "createdAt",
          order: "desc"
        })
      : null;
    const filters: Prisma.Sql[] = [];
    if (cursor?.mode === "keyset") {
      const cursorId = cursor.values.id;
      const cursorPrimary = cursor.values.primary;
      if (typeof cursorId !== "string" || cursorId.length === 0) {
        throw new DomainError("INVALID_CURSOR", "cursor id must be a non-empty string", 400);
      }
      if (typeof cursorPrimary !== "string" || cursorPrimary.length === 0) {
        throw new DomainError(
          "INVALID_CURSOR",
          "cursor primary must be a non-empty ISO datetime string",
          400
        );
      }
      const createdAt = new Date(cursorPrimary);
      if (Number.isNaN(createdAt.getTime())) {
        throw new DomainError("INVALID_CURSOR", "cursor primary must be valid ISO datetime", 400);
      }
      filters.push(Prisma.sql`(
        f."createdAt" < ${createdAt}
        OR (f."createdAt" = ${createdAt} AND f.id < ${cursorId})
      )`);
    }
    if (query.type) {
      filters.push(Prisma.sql`f.type = CAST(${query.type} AS "FeedbackReportType")`);
    }
    if (query.reporter) {
      filters.push(Prisma.sql`lower(f."reporterAddress") = lower(${query.reporter})`);
    }

    const whereSql =
      filters.length > 0 ? Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}` : Prisma.empty;
    const paginationSql =
      cursor?.mode === "legacy-offset"
        ? Prisma.sql`LIMIT ${boundedLimit + 1} OFFSET ${cursor.offset}`
        : Prisma.sql`LIMIT ${boundedLimit + 1}`;
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        type: string;
        title: string;
        bodyMd: string;
        reporterAddress: string;
        createdAt: Date;
      }>
    >(Prisma.sql`
      SELECT
        f.id,
        f.type,
        f.title,
        f."bodyMd",
        f."reporterAddress",
        f."createdAt"
      FROM "FeedbackReport" f
      ${whereSql}
      ORDER BY f."createdAt" DESC, f.id DESC
      ${paginationSql}
    `);
    const mapped = rows.map((item) => this.mapFeedbackReport(item));
    const hasMore = mapped.length > boundedLimit;
    const items = hasMore ? mapped.slice(0, boundedLimit) : mapped;
    const nextCursor =
      hasMore && items.length > 0
        ? encodeKeysetCursor({
            resource: FEEDBACK_REPORT_RESOURCE,
            sort: "createdAt",
            order: "desc",
            offset: nextCursorOffset(cursor ?? { mode: "start", offset: 0 }, items.length),
            values: {
              primary: items[items.length - 1]!.createdAt,
              id: items[items.length - 1]!.id
            }
          })
        : null;
    return { items, nextCursor };
  }

  async cleanupExpiredLogs(now = new Date()): Promise<CleanupLogsResult> {
    const requestCutoff = new Date(
      now.getTime() - this.config.requestLogRetentionDays * 24 * 60 * 60 * 1000
    );
    const auditCutoff = new Date(
      now.getTime() - this.config.auditLogRetentionDays * 24 * 60 * 60 * 1000
    );
    return {
      deletedRequestLogs: await this.deleteExpiredRequestLogs(requestCutoff),
      deletedAuditLogs: await this.deleteExpiredAuditLogs(auditCutoff)
    };
  }

  private async deleteExpiredRequestLogs(cutoff: Date): Promise<number> {
    let total = 0;
    while (true) {
      const deleted = await this.prisma.$executeRaw(Prisma.sql`
        WITH expired AS (
          SELECT id
          FROM "ServerRequestLog"
          WHERE "createdAt" < ${cutoff}
          ORDER BY "createdAt" ASC, id ASC
          LIMIT ${this.config.logCleanupBatchSize}
        )
        DELETE FROM "ServerRequestLog" l
        USING expired
        WHERE l.id = expired.id
      `);
      total += deleted;
      if (deleted < this.config.logCleanupBatchSize) {
        return total;
      }
    }
  }

  private async deleteExpiredAuditLogs(cutoff: Date): Promise<number> {
    let total = 0;
    while (true) {
      const deleted = await this.prisma.$executeRaw(Prisma.sql`
        WITH expired AS (
          SELECT id
          FROM "ServerAuditLog"
          WHERE "createdAt" < ${cutoff}
          ORDER BY "createdAt" ASC, id ASC
          LIMIT ${this.config.logCleanupBatchSize}
        )
        DELETE FROM "ServerAuditLog" l
        USING expired
        WHERE l.id = expired.id
      `);
      total += deleted;
      if (deleted < this.config.logCleanupBatchSize) {
        return total;
      }
    }
  }

  async incrementWorkerJobMetricDirect(outcome: WorkerJobMetricOutcome): Promise<void> {
    const name = WORKER_JOB_METRIC_NAME_BY_OUTCOME[outcome];
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO "ServerMetricCounter" (name, value, "updatedAt")
      VALUES (${name}, 1, NOW())
      ON CONFLICT (name)
      DO UPDATE SET
        value = "ServerMetricCounter".value + 1,
        "updatedAt" = NOW()
    `);
  }

  async getWorkerJobMetricCountersDirect(): Promise<WorkerJobMetricCounters> {
    const values: Record<WorkerJobMetricCounterName, bigint> = {
      workerJobSuccessTotal: 0n,
      workerJobErrorTotal: 0n,
      workerJobLockMissTotal: 0n
    };
    const rows = await this.prisma.$queryRaw<WorkerMetricCounterRow[]>(Prisma.sql`
      SELECT name, value
      FROM "ServerMetricCounter"
      WHERE name IN (${Prisma.join(WORKER_JOB_METRIC_COUNTER_NAMES)})
    `);
    for (const row of rows) {
      if (isWorkerJobMetricCounterName(row.name)) {
        values[row.name] = toNonNegativeBigInt(row.value);
      }
    }
    return workerJobMetricCountersFromBigInts(values);
  }

  async closeDueCyclesWithWorkerLock(): Promise<{ acquired: boolean; result: CloseCycleResult[] | null }> {
    return this.withAdvisoryLock(CYCLE_CLOSE_WORKER_LOCK_KEY, async () => {
      const results: CloseCycleResult[] = [];
      while (true) {
        const result = await this.closeCurrentCycleIfDueDirect();
        if (!result) {
          return results;
        }
        results.push(result);
      }
    });
  }

  async cleanupExpiredLogsWithWorkerLock(
    now = new Date()
  ): Promise<{ acquired: boolean; result: CleanupLogsResult | null }> {
    return this.withAdvisoryLock(
      LOG_CLEANUP_WORKER_LOCK_KEY,
      async () => await this.cleanupExpiredLogs(now)
    );
  }

  async updateRuntimeRulesDirect(input: {
    applyTo: "current" | "next";
    patch: RuntimeEditableRulesPatch;
    reason?: string;
    actor?: string;
    auditContext?: WriteAuditContext;
  }): Promise<RuntimeSettingsState> {
    return this.executeWithRetry(async () =>
      this.prisma.$transaction(async (tx) => {
        const runtime = await this.lockRuntimeWithTx(tx);
        const { row, currentRules, pendingNextPatch } = await this.lockRuntimeRuleStateWithTx(tx);
        if (Object.keys(input.patch).length === 0) {
          return this.toRuntimeSettingsState(row);
        }

        let nextCurrentRules = currentRules;
        let nextPendingPatch = pendingNextPatch;

        if (input.applyTo === "current") {
          nextCurrentRules = mergeRuntimeEditableRules(currentRules, input.patch);
          validateRuntimeEditableRules(nextCurrentRules);
          if (input.patch.mintPerCycle !== undefined) {
            await tx.cycle.updateMany({
              where: { id: runtime.activeCycleId, status: DomainCycleStatus.OPEN },
              data: { mintedAmount: nextCurrentRules.mintPerCycle }
            });
          }
        } else {
          const currentNextRules = mergeRuntimeEditableRules(currentRules, pendingNextPatch);
          const mergedNext = mergeRuntimeEditableRules(currentNextRules, input.patch);
          validateRuntimeEditableRules(mergedNext);
          nextPendingPatch = diffRuntimeEditableRules(currentRules, mergedNext);
        }

        const normalizedPending = this.normalizePendingPatch(nextPendingPatch);
        const updated = await tx.runtimeRuleState.update({
          where: { id: RUNTIME_RULE_STATE_ID },
          data: {
            currentRules: nextCurrentRules,
            pendingNextPatch:
              normalizedPending === null ? Prisma.JsonNull : (normalizedPending as Prisma.InputJsonValue)
          }
        });

        await tx.runtimeRuleAudit.create({
          data: {
            id: nanoid(),
            eventType: "UPDATE",
            applyTo: input.applyTo === "current" ? "CURRENT" : "NEXT",
            reason: input.reason?.trim().length ? input.reason.trim() : null,
            actor: input.actor?.trim().length ? input.actor.trim() : null,
            cycleId: runtime.activeCycleId,
            beforeRules: currentRules,
            afterRules: nextCurrentRules,
            patch: input.patch as Prisma.InputJsonValue,
            pendingNextPatch:
              normalizedPending === null ? Prisma.JsonNull : (normalizedPending as Prisma.InputJsonValue)
          }
        });

        if (input.auditContext) {
          await this.appendAuditLogWithTx(
            tx,
            buildWriteSuccessAuditLog(input.auditContext, {
              targetId: RUNTIME_RULE_STATE_ID,
              cycleId: runtime.activeCycleId,
              message: "system.settings.update succeeded",
              details: {
                applyTo: input.applyTo,
                reason: input.reason?.trim().length ? input.reason.trim() : null,
                patchKeys: Object.keys(input.patch)
              }
            })
          );
        }

        return this.toRuntimeSettingsState(updated);
      })
    );
  }

  async resetRuntimeRulesDirect(input: {
    applyTo: "current" | "next";
    defaults: RuntimeEditableRules;
    reason?: string;
    actor?: string;
    auditContext?: WriteAuditContext;
  }): Promise<RuntimeSettingsState> {
    validateRuntimeEditableRules(input.defaults);
    return this.executeWithRetry(async () =>
      this.prisma.$transaction(async (tx) => {
        const runtime = await this.lockRuntimeWithTx(tx);
        const { currentRules, pendingNextPatch } = await this.lockRuntimeRuleStateWithTx(tx);

        let nextCurrentRules = currentRules;
        let nextPendingPatch = pendingNextPatch;
        if (input.applyTo === "current") {
          nextCurrentRules = input.defaults;
          if (nextCurrentRules.mintPerCycle !== currentRules.mintPerCycle) {
            await tx.cycle.updateMany({
              where: { id: runtime.activeCycleId, status: DomainCycleStatus.OPEN },
              data: { mintedAmount: nextCurrentRules.mintPerCycle }
            });
          }
        } else {
          nextPendingPatch = diffRuntimeEditableRules(currentRules, input.defaults);
        }

        const normalizedPending = this.normalizePendingPatch(nextPendingPatch);
        const patch =
          input.applyTo === "current"
            ? diffRuntimeEditableRules(currentRules, nextCurrentRules)
            : normalizedPending ?? {};
        const updated = await tx.runtimeRuleState.update({
          where: { id: RUNTIME_RULE_STATE_ID },
          data: {
            currentRules: nextCurrentRules,
            pendingNextPatch:
              normalizedPending === null ? Prisma.JsonNull : (normalizedPending as Prisma.InputJsonValue)
          }
        });

        await tx.runtimeRuleAudit.create({
          data: {
            id: nanoid(),
            eventType: "RESET",
            applyTo: input.applyTo === "current" ? "CURRENT" : "NEXT",
            reason: input.reason?.trim().length ? input.reason.trim() : null,
            actor: input.actor?.trim().length ? input.actor.trim() : null,
            cycleId: runtime.activeCycleId,
            beforeRules: currentRules,
            afterRules: nextCurrentRules,
            patch: patch as Prisma.InputJsonValue,
            pendingNextPatch:
              normalizedPending === null ? Prisma.JsonNull : (normalizedPending as Prisma.InputJsonValue)
          }
        });

        if (input.auditContext) {
          await this.appendAuditLogWithTx(
            tx,
            buildWriteSuccessAuditLog(input.auditContext, {
              targetId: RUNTIME_RULE_STATE_ID,
              cycleId: runtime.activeCycleId,
              message: "system.settings.reset succeeded",
              details: {
                applyTo: input.applyTo,
                reason: input.reason?.trim().length ? input.reason.trim() : null
              }
            })
          );
        }

        return this.toRuntimeSettingsState(updated);
      })
    );
  }

  async applyPendingRuntimeRulesForOpenedCycleDirect(input: {
    openedCycleId: string;
    actor?: string;
  }): Promise<RuntimeSettingsState> {
    return this.executeWithRetry(async () =>
      this.prisma.$transaction(async (tx) => {
        await this.lockRuntimeWithTx(tx);
        return this.applyPendingRuntimeRulesForOpenedCycleWithTx(tx, input);
      })
    );
  }

  async load(): Promise<EngineStateSnapshot | null> {
    return this.prisma.$transaction(async (tx) => this.loadWithTx(tx));
  }

  async runLocked<T>(
    initialSnapshot: EngineStateSnapshot,
    mutator: (
      snapshot: EngineStateSnapshot
    ) => Promise<{ result: T; nextSnapshot: EngineStateSnapshot }> | { result: T; nextSnapshot: EngineStateSnapshot }
  ): Promise<T> {
    return this.executeWithRetry(async () =>
      this.prisma.$transaction(
          async (tx) => {
            const existing = await tx.runtimeState.findUnique({ where: { id: RUNTIME_ID } });
            if (!existing) {
              await this.applySnapshotDiffWithTx(tx, null, initialSnapshot, null);
            }

            await tx.$queryRaw`SELECT id FROM "RuntimeState" WHERE id = ${RUNTIME_ID} FOR UPDATE`;
            const snapshot = (await this.loadWithTx(tx)) ?? initialSnapshot;
            const baselineSnapshot = this.cloneSnapshot(snapshot);
            const { result, nextSnapshot } = await mutator(snapshot);
            await this.applySnapshotDiffWithTx(tx, baselineSnapshot, nextSnapshot, null);
            return result;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
        )
    );
  }

  async sync(snapshot: EngineStateSnapshot): Promise<void> {
    await this.executeWithRetry(async () => {
      await this.prisma.$transaction(async (tx) => {
        const existing = await tx.runtimeState.findUnique({ where: { id: RUNTIME_ID } });
        if (!existing) {
          await this.applySnapshotDiffWithTx(tx, null, snapshot, null);
          return;
        }

        await tx.$queryRaw`SELECT id FROM "RuntimeState" WHERE id = ${RUNTIME_ID} FOR UPDATE`;
        const current = await this.loadWithTx(tx);
        await this.applySnapshotDiffWithTx(tx, current, snapshot, null);
      });
    });
  }

  async getRuntimeRevision(): Promise<string | null> {
    const runtime = await this.prisma.runtimeState.findUnique({ where: { id: RUNTIME_ID } });
    return runtime ? runtime.updatedAt.toISOString() : null;
  }

  async syncFromSnapshots(
    currentSnapshot: EngineStateSnapshot,
    nextSnapshot: EngineStateSnapshot,
    expectedRevision: string | null,
    scope?: PersistenceMutationScope[]
  ): Promise<string> {
    const scopeSet = scope ? new Set(scope) : null;
    if (
      scopeSet &&
      currentSnapshot.activeCycleId !== nextSnapshot.activeCycleId &&
      !scopeSet.has("cycles")
    ) {
      throw new Error("active cycle changed without including cycles in persistence scope");
    }

    const runtime = await this.executeWithRetry(async () =>
      this.prisma.$transaction(async (tx) => {
        const existing = await tx.runtimeState.findUnique({ where: { id: RUNTIME_ID } });
        if (!existing) {
          await this.applySnapshotDiffWithTx(tx, null, nextSnapshot, null);
          return tx.runtimeState.findUniqueOrThrow({ where: { id: RUNTIME_ID } });
        }

        await tx.$queryRaw`SELECT id FROM "RuntimeState" WHERE id = ${RUNTIME_ID} FOR UPDATE`;
        const locked = await tx.runtimeState.findUniqueOrThrow({ where: { id: RUNTIME_ID } });
        const lockedRevision = locked.updatedAt.toISOString();
        if (expectedRevision && lockedRevision !== expectedRevision) {
          throw new PersistenceConflictError();
        }

        await this.applySnapshotDiffWithTx(tx, currentSnapshot, nextSnapshot, scopeSet);
        return tx.runtimeState.findUniqueOrThrow({ where: { id: RUNTIME_ID } });
      })
    );
    return runtime.updatedAt.toISOString();
  }

  async listTasksDirect(): Promise<Task[]> {
    return readListTasksDirect(this.prisma);
  }

  async queryTasksDirect(query: TaskListQuery): Promise<PaginatedResponse<Task>> {
    return queryTasksDirect(this.prisma, query);
  }

  async getTaskDirect(taskId: string): Promise<Task | null> {
    return readGetTaskDirect(this.prisma, taskId);
  }

  async listSubmissionsDirect(): Promise<Submission[]> {
    return readListSubmissionsDirect(this.prisma);
  }

  async querySubmissionsDirect(query: SubmissionListQuery): Promise<PaginatedResponse<Submission>> {
    return querySubmissionsDirect(this.prisma, query);
  }

  async getSubmissionDirect(submissionId: string): Promise<Submission | null> {
    return readGetSubmissionDirect(this.prisma, submissionId);
  }

  async queryTaskIntentionsDirect(input: {
    taskId: string;
    cursor?: string;
    limit: number;
  }): Promise<PaginatedResponse<TaskIntention>> {
    const task = await this.prisma.task.findUnique({
      where: { id: input.taskId },
      select: { id: true }
    });
    if (!task) {
      throw new DomainError("TASK_NOT_FOUND", `Task ${input.taskId} does not exist`, 404);
    }

    const boundedLimit = Math.min(100, Math.max(1, input.limit));
    const cursor = input.cursor ? parseListCursor(input.cursor, { resource: "task-intentions" }) : null;
    const keysetWhere =
      cursor?.mode === "keyset"
        ? (() => {
            const cursorId = cursor.values.id;
            const cursorPrimary = cursor.values.primary;
            if (typeof cursorId !== "string" || cursorId.length === 0) {
              throw new DomainError("INVALID_CURSOR", "cursor id must be a non-empty string", 400);
            }
            if (typeof cursorPrimary !== "string" || cursorPrimary.length === 0) {
              throw new DomainError(
                "INVALID_CURSOR",
                "cursor primary must be a non-empty ISO datetime string",
                400
              );
            }
            const createdAt = new Date(cursorPrimary);
            if (Number.isNaN(createdAt.getTime())) {
              throw new DomainError("INVALID_CURSOR", "cursor primary must be valid ISO datetime", 400);
            }
            return {
              OR: [
                { createdAt: { gt: createdAt } },
                {
                  AND: [{ createdAt }, { id: { gt: cursorId } }]
                }
              ]
            } satisfies Prisma.TaskIntentionWhereInput;
          })()
        : null;

    const intentions = await this.prisma.taskIntention.findMany({
      where: {
        taskId: input.taskId,
        ...(keysetWhere ? { AND: [keysetWhere] } : {})
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      ...(cursor?.mode === "legacy-offset"
        ? { skip: cursor.offset, take: boundedLimit + 1 }
        : { take: boundedLimit + 1 })
    });
    const mapped = intentions.map((item) => mapTaskIntention(item));
    const hasMore = mapped.length > boundedLimit;
    const items = hasMore ? mapped.slice(0, boundedLimit) : mapped;
    const nextCursor =
      hasMore && items.length > 0
        ? encodeKeysetCursor({
            resource: "task-intentions",
            offset: nextCursorOffset(cursor ?? { mode: "start", offset: 0 }, items.length),
            values: {
              primary: items[items.length - 1]!.createdAt,
              id: items[items.length - 1]!.id
            }
          })
        : null;
    return { items, nextCursor };
  }

  async listDisputesDirect(): Promise<Dispute[]> {
    return readListDisputesDirect(this.prisma);
  }

  async queryDisputesDirect(query: DisputeListQuery): Promise<PaginatedResponse<Dispute>> {
    return queryDisputesDirect(this.prisma, query);
  }

  async listAgentsDirect(): Promise<AgentProfile[]> {
    return readListAgentsDirect(this.prisma);
  }

  async queryAgentsDirect(
    query: AgentListQuery,
    scoreConfig: AppConfig = this.config
  ): Promise<PaginatedResponse<AgentDirectoryItem>> {
    return queryAgentsDirect(this.prisma, query, scoreConfig);
  }

  async listActivitiesDirect(): Promise<ActivityEvent[]> {
    return readListActivitiesDirect(this.prisma);
  }

  async queryActivitiesDirect(query: ActivityListQuery): Promise<PaginatedResponse<ActivityEvent>> {
    return queryActivitiesDirect(this.prisma, query);
  }

  async getDisputeDirect(disputeId: string): Promise<Dispute | null> {
    return readGetDisputeDirect(this.prisma, disputeId);
  }

  async getDisputeResolutionDirect(disputeId: string): Promise<DisputeResolutionSummary | null> {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      select: {
        id: true,
        status: true,
        taskId: true,
        submissionId: true,
        resolutionPayoutSource: true,
        resolutionPayoutAmount: true,
        resolutionPayoutShortfallAmount: true,
        resolutionPublisherBanned: true
      }
    });
    if (!dispute) {
      throw new DomainError("DISPUTE_NOT_FOUND", `Dispute ${disputeId} does not exist`, 404);
    }
    if (dispute.status === DomainDisputeStatus.OPEN) {
      return null;
    }

    const [completedVotes, notCompletedVotes, task, submission] = await Promise.all([
      this.prisma.supervisionVote.count({
        where: { disputeId, vote: DomainVoteChoice.COMPLETED }
      }),
      this.prisma.supervisionVote.count({
        where: { disputeId, vote: DomainVoteChoice.NOT_COMPLETED }
      }),
      this.prisma.task.findUnique({
        where: { id: dispute.taskId },
        select: { publisherAddress: true, rewardPerSlot: true }
      }),
      this.prisma.submission.findUnique({
        where: { id: dispute.submissionId },
        select: { agentAddress: true }
      })
    ]);

    if (!task || !submission) {
      throw new DomainError(
        "DISPUTE_INVARIANT_BROKEN",
        "dispute task/submission reference is missing",
        500
      );
    }

    const outcome =
      dispute.status === DomainDisputeStatus.RESOLVED_COMPLETED
        ? VoteChoice.COMPLETED
        : VoteChoice.NOT_COMPLETED;
    const winnerRole = outcome === VoteChoice.COMPLETED ? "SUBMISSION_AGENT" : "PUBLISHER";
    const winnerAddress =
      outcome === VoteChoice.COMPLETED
        ? asAddress(submission.agentAddress)
        : asAddress(task.publisherAddress);
    const payoutSource = dispute.resolutionPayoutSource ?? DisputePayoutSource.ESCROW;
    const payoutAmount = dispute.resolutionPayoutAmount ?? task.rewardPerSlot;
    const payoutShortfallAmount = dispute.resolutionPayoutShortfallAmount ?? 0;
    const publisherBanned = dispute.resolutionPublisherBanned ?? false;

    return {
      totalVotes: completedVotes + notCompletedVotes,
      completedVotes,
      notCompletedVotes,
      outcome,
      winnerRole,
      winnerAddress,
      payoutSource: payoutSource as DisputePayoutSource,
      payoutAmount,
      payoutShortfallAmount,
      publisherBanned
    };
  }

  async getAgentDirect(address: Address): Promise<AgentProfile | null> {
    return readGetAgentDirect(this.prisma, address);
  }

  async updateAgentProfileDirect(
    address: Address,
    payload: { name?: string; bio?: string },
    auditContext?: WriteAuditContext
  ): Promise<AgentProfile> {
    const profile = await writeUpdateAgentProfileDirect(
      this.prisma,
      {
        executeWithRetry: (operation) => this.executeWithRetry(operation),
        lockRuntimeWithTx: (tx) => this.lockRuntimeWithTx(tx),
        assertAgentActiveForWriteWithTx: (tx, nextAddress, now) =>
          this.assertAgentActiveForWriteWithTx(tx, nextAddress, now),
        ensureAgentAndLedgerWithTx: (tx, nextAddress, now) =>
          this.ensureAgentAndLedgerWithTx(tx, nextAddress, now),
        touchRuntimeStateWithTx: (tx) => this.touchRuntimeStateWithTx(tx),
        appendAuditLogWithTx: (tx, input) => this.appendAuditLogWithTx(tx, input).then(() => undefined)
      },
      address,
      payload,
      auditContext
    );
    return mapAgentProfile(profile);
  }

  async getLedgerDirect(address: Address): Promise<LedgerBalance | null> {
    return readGetLedgerDirect(this.prisma, address);
  }

  async listCyclesDirect(): Promise<Cycle[]> {
    return readListCyclesDirect(this.prisma);
  }

  async queryCyclesDirect(query: CycleListQuery): Promise<PaginatedResponse<Cycle>> {
    return queryCyclesDirect(this.prisma, query);
  }

  async getCycleDirect(cycleId: string): Promise<Cycle | null> {
    return readGetCycleDirect(this.prisma, cycleId);
  }

  async getActiveCycleDirect(): Promise<Cycle | null> {
    return readGetActiveCycleDirect(this.prisma, RUNTIME_ID);
  }

  async getDashboardSummaryDirect(timeZone: string): Promise<DashboardSummaryResponse> {
    const dayWindow = buildDashboardDayWindow(timeZone, 1);
    const activeCyclePromise = this.getActiveCycleDirect();
    const todayPromise = this.queryActivityMetricsByCreatedAtRange(
      dayWindow.todayStartUtc,
      dayWindow.todayEndUtc
    );
    const totalsPromise = Promise.all([
      this.prisma.task.count(),
      this.prisma.dispute.count(),
      this.prisma.agentProfile.count()
    ]);
    const activeCycle = await activeCyclePromise;
    if (!activeCycle) {
      throw new Error("active cycle is unavailable");
    }

    const [today, totals, currentCycle] = await Promise.all([
      todayPromise,
      totalsPromise,
      this.queryActivityMetrics(Prisma.sql`WHERE "cycleId" = ${activeCycle.id}`)
    ]);

    return {
      timezone: timeZone,
      generatedAt: new Date().toISOString(),
      activeCycleId: activeCycle.id,
      today,
      currentCycle,
      totals: {
        tasks: totals[0],
        disputes: totals[1],
        agents: totals[2]
      }
    };
  }

  async getDashboardTrendsDirect(
    timeZone: string,
    window: "7d" | "30d"
  ): Promise<DashboardTrendsResponse> {
    const windowSize = window === "30d" ? 30 : 7;
    const dayWindow = buildDashboardDayWindow(timeZone, windowSize);
    const bucketWindows = dayWindow.labels.map((label, index) => {
      const nextLabel = dayWindow.labels[index + 1];
      return {
        label,
        startUtc: dayKeyToUtcStart(label, timeZone),
        endUtc: nextLabel ? dayKeyToUtcStart(nextLabel, timeZone) : dayWindow.endUtc
      };
    });
    const metricTypes = [
      DomainActivityEventType.TASK_PUBLISHED,
      DomainActivityEventType.TASK_INTENDED,
      DomainActivityEventType.TASK_COMPLETED,
      DomainActivityEventType.DISPUTE_OPENED
    ];
    const rows = await this.prisma.$queryRaw<DashboardTrendAggregateRow[]>(Prisma.sql`
      WITH buckets(label, "startUtc", "endUtc") AS (
        VALUES ${Prisma.join(
          bucketWindows.map(
            (bucket) => Prisma.sql`(${bucket.label}, ${bucket.startUtc}, ${bucket.endUtc})`
          )
        )}
      )
      SELECT
        buckets.label,
        events.type,
        COUNT(*)::bigint AS "eventCount"
      FROM buckets
      INNER JOIN "ActivityEvent" events
        ON events."createdAt" >= buckets."startUtc"
       AND events."createdAt" < buckets."endUtc"
       AND events.type IN (${Prisma.join(metricTypes.map((type) => Prisma.sql`CAST(${type} AS "ActivityEventType")`))})
      GROUP BY buckets.label, events.type
    `);
    const metricsByLabel = new Map<string, DashboardMetricSnapshot>();
    for (const row of rows) {
      const metrics = metricsByLabel.get(row.label) ?? emptyDashboardMetrics();
      const eventCount = toNumber(row.eventCount);
      if (row.type === DomainActivityEventType.TASK_PUBLISHED) {
        metrics.tasksPublished += eventCount;
      } else if (row.type === DomainActivityEventType.TASK_INTENDED) {
        metrics.tasksIntented += eventCount;
      } else if (row.type === DomainActivityEventType.TASK_COMPLETED) {
        metrics.tasksCompleted += eventCount;
      } else if (row.type === DomainActivityEventType.DISPUTE_OPENED) {
        metrics.disputesOpened += eventCount;
      }
      metricsByLabel.set(row.label, metrics);
    }

    const points: DashboardTrendPoint[] = dayWindow.labels.map((label) => {
      const metrics = metricsByLabel.get(label) ?? emptyDashboardMetrics();
      return {
        bucketStart: dayKeyToUtcStart(label, timeZone).toISOString(),
        label,
        tasksPublished: metrics.tasksPublished,
        tasksIntented: metrics.tasksIntented,
        tasksCompleted: metrics.tasksCompleted,
        disputesOpened: metrics.disputesOpened
      };
    });

    return {
      timezone: timeZone,
      generatedAt: new Date().toISOString(),
      window,
      points
    };
  }

  async getTodosDirect(input: {
    address: Address;
    scope: TodoScope;
    type?: TodoGroupType;
    cursor?: string;
    limit: number;
    generatedAt?: string;
  }): Promise<TodosResponse> {
    return queryTodosDirect(this.prisma, input);
  }

  async getCycleRewardsDirect(cycleId: string): Promise<CycleRewardsResponse | null> {
    const cycle = await this.prisma.cycle.findUnique({ where: { id: cycleId } });
    if (!cycle) {
      return null;
    }
    const workloads = await this.prisma.cycleWorkload.findMany({
      where: { cycleId },
      orderBy: { createdAt: "asc" }
    });
    const rewardPool = cycle.mintedAmount + cycle.taxPool + cycle.penaltyPool;
    const grouped = new Map<string, number>();
    for (const workload of workloads) {
      grouped.set(workload.agentAddress, (grouped.get(workload.agentAddress) ?? 0) + workload.workload);
    }
    const distributions = [...allocateIntegerPool(rewardPool, grouped).entries()].map(([agent, amount]) => ({
      agent: asAddress(agent),
      amount
    }));

    return {
      cycle: mapCycle(cycle),
      rewardPool,
      distributions,
      workloads: workloads.map((item) => mapCycleWorkload(item))
    };
  }

  async exportBridgeBatchDirect(input: { addresses?: Address[] }): Promise<Array<{ address: Address; amount: number }>> {
    const balances = await this.prisma.ledgerBalance.findMany({
      where: input.addresses ? { address: { in: input.addresses } } : undefined,
      orderBy: { address: "asc" }
    });
    return balances.map((item) => ({ address: asAddress(item.address), amount: item.available }));
  }

  async publishTaskDirect(input: PublishTaskDirectInput): Promise<Task> {
    const task = await writePublishTaskDirect(
      this.prisma,
      {
        executeWithRetry: (operation) => this.executeWithRetry(operation),
        lockRuntimeWithTx: (tx) => this.lockRuntimeWithTx(tx),
        assertAgentActiveForWriteWithTx: (tx, address, now) =>
          this.assertAgentActiveForWriteWithTx(tx, address, now),
        ensureAgentAndLedgerWithTx: (tx, address, now) =>
          this.ensureAgentAndLedgerWithTx(tx, address, now),
        touchRuntimeStateWithTx: (tx) => this.touchRuntimeStateWithTx(tx),
        applyProfileDeltaWithTx: (tx, address, now, delta) =>
          this.applyProfileDeltaWithTx(tx, address, now, delta),
        appendActivityEventWithTx: (tx, activity) => this.appendActivityEventWithTx(tx, activity),
        appendAuditLogWithTx: (tx, audit) => this.appendAuditLogWithTx(tx, audit).then(() => undefined)
      },
      input
    );
    return mapTask(task);
  }

  async rejectSubmissionDirect(input: RejectSubmissionDirectInput): Promise<Submission> {
    const submission = await writeRejectSubmissionDirect(
      this.prisma,
      {
        executeWithRetry: (operation) => this.executeWithRetry(operation),
        lockRuntimeWithTx: (tx) => this.lockRuntimeWithTx(tx),
        assertAgentActiveForWriteWithTx: (tx, address, now) =>
          this.assertAgentActiveForWriteWithTx(tx, address, now),
        ensureAgentAndLedgerWithTx: (tx, address, now) =>
          this.ensureAgentAndLedgerWithTx(tx, address, now),
        touchRuntimeStateWithTx: (tx) => this.touchRuntimeStateWithTx(tx),
        applyProfileDeltaWithTx: (tx, address, now, input) =>
          this.applyProfileDeltaWithTx(tx, address, now, input),
        appendActivityEventWithTx: (tx, input) => this.appendActivityEventWithTx(tx, input),
        appendAuditLogWithTx: (tx, audit) => this.appendAuditLogWithTx(tx, audit).then(() => undefined)
      },
      input
    );

    return mapSubmission(submission);
  }

  async terminateTaskDirect(
    taskId: string,
    publisher: Address,
    auditContext?: WriteAuditContext
  ): Promise<Task> {
    const task = await writeTerminateTaskDirect(
      this.prisma,
      {
        executeWithRetry: (operation) => this.executeWithRetry(operation),
        lockRuntimeWithTx: (tx) => this.lockRuntimeWithTx(tx),
        assertAgentActiveForWriteWithTx: (tx, address, now) =>
          this.assertAgentActiveForWriteWithTx(tx, address, now),
        ensureAgentAndLedgerWithTx: (tx, address, now) =>
          this.ensureAgentAndLedgerWithTx(tx, address, now),
        touchRuntimeStateWithTx: (tx) => this.touchRuntimeStateWithTx(tx),
        applyProfileDeltaWithTx: (tx, address, now, delta) =>
          this.applyProfileDeltaWithTx(tx, address, now, delta),
        appendActivityEventWithTx: (tx, activity) => this.appendActivityEventWithTx(tx, activity),
        appendAuditLogWithTx: (tx, audit) => this.appendAuditLogWithTx(tx, audit).then(() => undefined)
      },
      taskId,
      publisher,
      auditContext
    );
    return mapTask(task);
  }

  async openDisputeDirect(input: OpenDisputeDirectInput): Promise<Dispute> {
    const dispute = await writeOpenDisputeDirect(
      this.prisma,
      {
        executeWithRetry: (operation) => this.executeWithRetry(operation),
        lockRuntimeWithTx: (tx) => this.lockRuntimeWithTx(tx),
        assertAgentActiveForWriteWithTx: (tx, address, now) =>
          this.assertAgentActiveForWriteWithTx(tx, address, now),
        ensureAgentAndLedgerWithTx: (tx, address, now) =>
          this.ensureAgentAndLedgerWithTx(tx, address, now),
        touchRuntimeStateWithTx: (tx) => this.touchRuntimeStateWithTx(tx),
        applyProfileDeltaWithTx: (tx, address, now, delta) =>
          this.applyProfileDeltaWithTx(tx, address, now, delta),
        appendActivityEventWithTx: (tx, activity) => this.appendActivityEventWithTx(tx, activity),
        appendAuditLogWithTx: (tx, audit) => this.appendAuditLogWithTx(tx, audit).then(() => undefined)
      },
      input
    );
    return mapDispute(dispute);
  }

  async respondDisputeDirect(input: RespondDisputeDirectInput): Promise<Dispute> {
    const dispute = await writeRespondDisputeDirect(
      this.prisma,
      {
        executeWithRetry: (operation) => this.executeWithRetry(operation),
        lockRuntimeWithTx: (tx) => this.lockRuntimeWithTx(tx),
        assertAgentActiveForWriteWithTx: (tx, address, now) =>
          this.assertAgentActiveForWriteWithTx(tx, address, now),
        ensureAgentAndLedgerWithTx: (tx, address, now) =>
          this.ensureAgentAndLedgerWithTx(tx, address, now),
        touchRuntimeStateWithTx: (tx) => this.touchRuntimeStateWithTx(tx),
        appendAuditLogWithTx: (tx, audit) => this.appendAuditLogWithTx(tx, audit).then(() => undefined)
      },
      input
    );
    return mapDispute(dispute);
  }

  async closeCurrentCycleDirect(): Promise<CloseCycleResult> {
    return writeCloseCurrentCycleDirect(
      this.prisma,
      {
        executeWithRetry: (operation) => this.executeWithRetry(operation),
        lockRuntimeWithTx: (tx) => this.lockRuntimeWithTx(tx),
        assertAgentActiveForWriteWithTx: (tx, address, now) =>
          this.assertAgentActiveForWriteWithTx(tx, address, now),
        ensureAgentAndLedgerWithTx: (tx, address, now) =>
          this.ensureAgentAndLedgerWithTx(tx, address, now),
        touchRuntimeStateWithTx: (tx, activeCycleId) =>
          this.touchRuntimeStateWithTx(tx, activeCycleId),
        getConfirmedSlots: (slotsTotal, rewardPerSlot, rewardEscrowRemaining) =>
          this.getConfirmedSlots(slotsTotal, rewardPerSlot, rewardEscrowRemaining),
        appendAuditLogWithTx: (tx, audit) => this.appendAuditLogWithTx(tx, audit).then(() => undefined),
        confirmSubmissionInternalWithTx: (tx, submission, task, now, cycleId, actor, options) =>
          this.confirmSubmissionInternalWithTx(tx, submission, task, now, cycleId, actor, options),
        refreshCycleCloseConfigWithTx: (tx, nextConfig) =>
          this.refreshCycleCloseConfigWithTx(tx, nextConfig),
        applyPendingRuntimeRulesForOpenedCycleWithTx: (tx, input) =>
          this.applyPendingRuntimeRulesForOpenedCycleWithTx(tx, input).then(() => undefined),
        evaluateDisputeWithTx: (tx, disputeId, nextConfig, now, cycleId) =>
          this.evaluateDisputeWithTx(tx, disputeId, nextConfig, now, cycleId),
        sweepBannedPublisherCleanTasksWithTx: (tx, now, cycleId) =>
          this.sweepBannedPublisherCleanTasksWithTx(tx, now, cycleId),
        autoTerminateExpiredCleanTasksWithTx: (tx, now, cycleId) =>
          this.autoTerminateExpiredCleanTasksWithTx(tx, now, cycleId),
        nextCycleId: (currentCycleId) => this.nextCycleId(currentCycleId)
      }
    );
  }

  async closeCurrentCycleIfDueDirect(): Promise<CloseCycleResult | null> {
    return writeCloseCurrentCycleIfDueDirect(
      this.prisma,
      {
        executeWithRetry: (operation) => this.executeWithRetry(operation),
        lockRuntimeWithTx: (tx) => this.lockRuntimeWithTx(tx),
        assertAgentActiveForWriteWithTx: (tx, address, now) =>
          this.assertAgentActiveForWriteWithTx(tx, address, now),
        ensureAgentAndLedgerWithTx: (tx, address, now) =>
          this.ensureAgentAndLedgerWithTx(tx, address, now),
        touchRuntimeStateWithTx: (tx, activeCycleId) =>
          this.touchRuntimeStateWithTx(tx, activeCycleId),
        getConfirmedSlots: (slotsTotal, rewardPerSlot, rewardEscrowRemaining) =>
          this.getConfirmedSlots(slotsTotal, rewardPerSlot, rewardEscrowRemaining),
        appendAuditLogWithTx: (tx, audit) => this.appendAuditLogWithTx(tx, audit).then(() => undefined),
        confirmSubmissionInternalWithTx: (tx, submission, task, now, cycleId, actor, options) =>
          this.confirmSubmissionInternalWithTx(tx, submission, task, now, cycleId, actor, options),
        refreshCycleCloseConfigWithTx: (tx, nextConfig) =>
          this.refreshCycleCloseConfigWithTx(tx, nextConfig),
        applyPendingRuntimeRulesForOpenedCycleWithTx: (tx, input) =>
          this.applyPendingRuntimeRulesForOpenedCycleWithTx(tx, input).then(() => undefined),
        evaluateDisputeWithTx: (tx, disputeId, nextConfig, now, cycleId) =>
          this.evaluateDisputeWithTx(tx, disputeId, nextConfig, now, cycleId),
        sweepBannedPublisherCleanTasksWithTx: (tx, now, cycleId) =>
          this.sweepBannedPublisherCleanTasksWithTx(tx, now, cycleId),
        autoTerminateExpiredCleanTasksWithTx: (tx, now, cycleId) =>
          this.autoTerminateExpiredCleanTasksWithTx(tx, now, cycleId),
        nextCycleId: (currentCycleId) => this.nextCycleId(currentCycleId)
      }
    );
  }

  async overrideDisputeDirect(
    disputeId: string,
    result: "COMPLETED" | "NOT_COMPLETED"
  ): Promise<Dispute> {
    const dispute = await writeOverrideDisputeDirect(
      this.prisma,
      {
        executeWithRetry: (operation) => this.executeWithRetry(operation),
        lockRuntimeWithTx: (tx) => this.lockRuntimeWithTx(tx),
        touchRuntimeStateWithTx: (tx, activeCycleId) =>
          this.touchRuntimeStateWithTx(tx, activeCycleId),
        finalizeDisputeWithOutcomeWithTx: (tx, nextDisputeId, outcome, now, cycleId) =>
          this.finalizeDisputeWithOutcomeWithTx(tx, nextDisputeId, outcome, now, cycleId),
        reopenDisputeAsNotCompletedWithTx: (tx, nextDisputeId, now, activeCycleId) =>
          this.reopenDisputeAsNotCompletedWithTx(tx, nextDisputeId, now, activeCycleId)
      },
      disputeId,
      result
    );

    return mapDispute(dispute);
  }

  async addTaskIntentionDirect(
    taskId: string,
    agent: Address,
    auditContext?: WriteAuditContext
  ): Promise<TaskIntention> {
    const intention = await writeAddTaskIntentionDirect(
      this.prisma,
      {
        executeWithRetry: (operation) => this.executeWithRetry(operation),
        lockRuntimeWithTx: (tx) => this.lockRuntimeWithTx(tx),
        assertAgentActiveForWriteWithTx: (tx, address, now) =>
          this.assertAgentActiveForWriteWithTx(tx, address, now),
        ensureAgentAndLedgerWithTx: (tx, address, now) =>
          this.ensureAgentAndLedgerWithTx(tx, address, now),
        touchRuntimeStateWithTx: (tx) => this.touchRuntimeStateWithTx(tx),
        applyProfileDeltaWithTx: (tx, address, now, input) =>
          this.applyProfileDeltaWithTx(tx, address, now, input),
        appendActivityEventWithTx: (tx, input) => this.appendActivityEventWithTx(tx, input),
        appendAuditLogWithTx: (tx, audit) => this.appendAuditLogWithTx(tx, audit).then(() => undefined)
      },
      taskId,
      agent,
      auditContext
    );

    return mapTaskIntention(intention);
  }

  async submitTaskDirect(input: SubmitTaskDirectInput): Promise<Submission> {
    const submission = await writeSubmitTaskDirect(
      this.prisma,
      {
        executeWithRetry: (operation) => this.executeWithRetry(operation),
        lockRuntimeWithTx: (tx) => this.lockRuntimeWithTx(tx),
        assertAgentActiveForWriteWithTx: (tx, address, now) =>
          this.assertAgentActiveForWriteWithTx(tx, address, now),
        ensureAgentAndLedgerWithTx: (tx, address, now) =>
          this.ensureAgentAndLedgerWithTx(tx, address, now),
        touchRuntimeStateWithTx: (tx) => this.touchRuntimeStateWithTx(tx),
        getConfirmedSlots: (slotsTotal, rewardPerSlot, rewardEscrowRemaining) =>
          this.getConfirmedSlots(slotsTotal, rewardPerSlot, rewardEscrowRemaining),
        appendActivityEventWithTx: (tx, input) => this.appendActivityEventWithTx(tx, input),
        appendAuditLogWithTx: (tx, audit) => this.appendAuditLogWithTx(tx, audit).then(() => undefined)
      },
      input
    );

    return mapSubmission(submission);
  }

  async confirmSubmissionDirect(
    submissionId: string,
    publisher: Address,
    auditContext?: WriteAuditContext
  ): Promise<Submission> {
    const submission = await writeConfirmSubmissionDirect(
      this.prisma,
      {
        executeWithRetry: (operation) => this.executeWithRetry(operation),
        lockRuntimeWithTx: (tx) => this.lockRuntimeWithTx(tx),
        assertAgentActiveForWriteWithTx: (tx, address, now) =>
          this.assertAgentActiveForWriteWithTx(tx, address, now),
        ensureAgentAndLedgerWithTx: (tx, address, now) =>
          this.ensureAgentAndLedgerWithTx(tx, address, now),
        touchRuntimeStateWithTx: (tx) => this.touchRuntimeStateWithTx(tx),
        getConfirmedSlots: (slotsTotal, rewardPerSlot, rewardEscrowRemaining) =>
          this.getConfirmedSlots(slotsTotal, rewardPerSlot, rewardEscrowRemaining),
        appendAuditLogWithTx: (tx, audit) => this.appendAuditLogWithTx(tx, audit).then(() => undefined),
        confirmSubmissionInternalWithTx: (tx, nextSubmission, task, now, cycleId, actor, options) =>
          this.confirmSubmissionInternalWithTx(tx, nextSubmission, task, now, cycleId, actor, options)
      },
      submissionId,
      publisher,
      auditContext
    );
    return mapSubmission(submission);
  }

  async voteDisputeDirect(
    input: VoteDisputeDirectInput
  ): Promise<{ vote: SupervisionVote; workload: CycleWorkload }> {
    const result = await writeVoteDisputeDirect(
      this.prisma,
      {
        executeWithRetry: (operation) => this.executeWithRetry(operation),
        lockRuntimeWithTx: (tx) => this.lockRuntimeWithTx(tx),
        assertAgentActiveForWriteWithTx: (tx, address, now) =>
          this.assertAgentActiveForWriteWithTx(tx, address, now),
        ensureAgentAndLedgerWithTx: (tx, address, now) =>
          this.ensureAgentAndLedgerWithTx(tx, address, now),
        touchRuntimeStateWithTx: (tx) => this.touchRuntimeStateWithTx(tx),
        appendAuditLogWithTx: (tx, audit) => this.appendAuditLogWithTx(tx, audit).then(() => undefined),
        applyProfileDeltaWithTx: (tx, address, now, delta) =>
          this.applyProfileDeltaWithTx(tx, address, now, delta)
      },
      input
    );
    return {
      vote: mapVote(result.vote),
      workload: mapCycleWorkload(result.workload)
    };
  }

  private async lockRuntimeWithTx(
    tx: Prisma.TransactionClient
  ): Promise<{ id: string; activeCycleId: string; updatedAt: Date; config: AppConfig }> {
    const runtime = await lockRuntimeWithTx(tx, RUNTIME_ID);
    const config = await this.refreshCurrentRuntimeConfigWithTx(tx);
    return {
      ...runtime,
      config
    };
  }

  private async refreshCurrentRuntimeConfigWithTx(
    tx: Prisma.TransactionClient
  ): Promise<AppConfig> {
    const { currentRules } = await this.lockRuntimeRuleStateWithTx(tx);
    const currentConfig = applyRuntimeEditableRules(this.config, currentRules);
    Object.assign(this.config, currentConfig);
    return currentConfig;
  }

  private async confirmSubmissionInternalWithTx(
    tx: Prisma.TransactionClient,
    submission: {
      id: string;
      taskId: string;
      agentAddress: string;
      status: unknown;
    },
    task: {
      id: string;
      publisherAddress: string;
      status: unknown;
      slotsTotal: number;
      rewardPerSlot: number;
      rewardEscrowRemaining: number;
      allowRepeatCompletionsBySameAgent: boolean;
      completedAgents: Prisma.JsonValue;
    },
    now: Date,
    cycleId: string,
    actor: Address,
    options?: {
      grantPublisherCredits?: boolean;
      disputeId?: string | null;
    }
  ): Promise<void> {
    const submissionStatus = submission.status as DomainSubmissionStatus;
    if (submissionStatus === DomainSubmissionStatus.CONFIRMED) {
      return;
    }
    if (
      submissionStatus !== DomainSubmissionStatus.SUBMITTED &&
      submissionStatus !== DomainSubmissionStatus.REJECTED
    ) {
      throw new DomainError("SUBMISSION_NOT_CONFIRMABLE", "submission cannot be confirmed from this state", 409);
    }

    const submissionAgent = asAddress(submission.agentAddress);
    const completedAgents = asAddressArray(task.completedAgents);
    if (!task.allowRepeatCompletionsBySameAgent && completedAgents.includes(submissionAgent)) {
      throw new DomainError(
        "REPEAT_COMPLETION_NOT_ALLOWED",
        "agent already completed this non-repeatable task",
        409
      );
    }

    if (!this.hasPayableSlot(task)) {
      await tx.task.update({
        where: { id: task.id },
        data: {
          status: DomainTaskStatus.CLOSED,
          updatedAt: now
        }
      });
      throw new DomainError("SUBMISSION_NOT_CONFIRMABLE", "task has no remaining payable slots", 409);
    }

    const rewardEscrowRemaining = task.rewardEscrowRemaining - task.rewardPerSlot;
    if (!Number.isSafeInteger(rewardEscrowRemaining) || rewardEscrowRemaining < 0) {
      throw new DomainError(
        "TASK_SETTLEMENT_INVARIANT_BROKEN",
        "task reward escrow underflow while confirming submission",
        500
      );
    }

    if (!completedAgents.includes(submissionAgent)) {
      completedAgents.push(submissionAgent);
    }
    const confirmedSlots = this.getConfirmedSlots(
      task.slotsTotal,
      task.rewardPerSlot,
      rewardEscrowRemaining
    );
    const shouldClose = confirmedSlots >= task.slotsTotal;

    await tx.submission.update({
      where: { id: submission.id },
      data: {
        status: DomainSubmissionStatus.CONFIRMED,
        updatedAt: now
      }
    });
    await tx.task.update({
      where: { id: task.id },
      data: {
        rewardEscrowRemaining,
        completedAgents: toJsonAddressArray(completedAgents),
        status: shouldClose ? DomainTaskStatus.CLOSED : (task.status as DomainTaskStatus),
        updatedAt: now
      }
    });

    await this.settleConfirmedSubmissionWithTx(tx, {
      submissionAgent,
      publisher: asAddress(task.publisherAddress),
      rewardPerSlot: task.rewardPerSlot,
      taskId: task.id,
      cycleId,
      actor,
      now,
      grantPublisherCredits: options?.grantPublisherCredits ?? true,
      disputeId: options?.disputeId ?? null
    });
  }

  private async settleConfirmedSubmissionWithTx(
    tx: Prisma.TransactionClient,
    input: {
      submissionAgent: Address;
      publisher: Address;
      rewardPerSlot: number;
      taskId: string;
      cycleId: string;
      actor: Address;
      now: Date;
      grantPublisherCredits: boolean;
      disputeId: string | null;
    }
  ): Promise<void> {
    await this.ensureAgentAndLedgerWithTx(tx, input.submissionAgent, input.now);
    await this.ensureAgentAndLedgerWithTx(tx, input.publisher, input.now);
    await tx.ledgerBalance.update({
      where: { address: input.submissionAgent },
      data: {
        available: {
          increment: input.rewardPerSlot
        },
        updatedAt: input.now
      }
    });
    await this.applyProfileDeltaWithTx(tx, input.submissionAgent, input.now, {
      workerReputationDelta: 2,
      tasksCompleted: 1
    });
    if (input.grantPublisherCredits) {
      await this.applyProfileDeltaWithTx(tx, input.publisher, input.now, {
        publisherReputationDelta: 1
      });
      await this.recordCycleWorkloadWithTx(tx, {
        cycleId: input.cycleId,
        disputeId: null,
        taskId: input.taskId,
        agent: input.publisher,
        workload: this.config.taskCompletionPublisherWorkload,
        createdAt: input.now
      });
    }
    await this.recordCycleWorkloadWithTx(tx, {
      cycleId: input.cycleId,
      disputeId: input.disputeId,
      taskId: input.taskId,
      agent: input.submissionAgent,
      workload: this.config.taskCompletionWorkerWorkload,
      createdAt: input.now
    });
    await this.appendActivityEventWithTx(tx, {
      type: DomainActivityEventType.TASK_COMPLETED,
      cycleId: input.cycleId,
      taskId: input.taskId,
      disputeId: input.disputeId,
      actor: input.actor,
      createdAt: input.now
    });
  }

  private async recordCycleWorkloadWithTx(
    tx: Prisma.TransactionClient,
    input: {
      cycleId: string;
      disputeId: string | null;
      taskId: string | null;
      agent: Address;
      workload: number;
      createdAt: Date;
    }
  ): Promise<void> {
    if (!Number.isFinite(input.workload) || input.workload <= 0) {
      return;
    }
    await tx.cycleWorkload.create({
      data: {
        id: nanoid(),
        cycleId: input.cycleId,
        disputeId: input.disputeId,
        taskId: input.taskId,
        agentAddress: input.agent,
        workload: input.workload,
        createdAt: input.createdAt,
        settledAt: null
      }
    });
  }

  private hasPayableSlot(task: {
    slotsTotal: number;
    rewardPerSlot: number;
    rewardEscrowRemaining: number;
  }): boolean {
    return (
      this.getConfirmedSlots(task.slotsTotal, task.rewardPerSlot, task.rewardEscrowRemaining) < task.slotsTotal &&
      task.rewardEscrowRemaining >= task.rewardPerSlot
    );
  }

  private async assertAgentActiveForWriteWithTx(
    tx: Prisma.TransactionClient,
    address: Address,
    now: Date
  ): Promise<void> {
    await this.ensureAgentAndLedgerWithTx(tx, address, now);
    const profile = await tx.agentProfile.findUnique({
      where: { address },
      select: { status: true }
    });
    if (profile?.status === "BANNED") {
      throw new DomainError("ACCOUNT_BANNED", "account is banned from active operations", 403);
    }
  }

  private async banAgentWithTx(
    tx: Prisma.TransactionClient,
    address: Address,
    now: Date,
    reason: AgentBanReason,
    sourceDisputeId?: string
  ): Promise<boolean> {
    const profile = await tx.agentProfile.findUnique({
      where: { address },
      select: { status: true, banReasonCode: true, banSourceDisputeId: true }
    });
    if (!profile) {
      throw new DomainError("AGENT_NOT_FOUND", `Agent ${address} not found`, 404);
    }
    if (profile.status === "BANNED") {
      if (!profile.banReasonCode || (sourceDisputeId && !profile.banSourceDisputeId)) {
        await tx.agentProfile.update({
          where: { address },
          data: {
            banReasonCode: profile.banReasonCode ?? reason,
            banSourceDisputeId: sourceDisputeId ?? profile.banSourceDisputeId,
            updatedAt: now
          }
        });
      }
      return false;
    }
    await tx.agentProfile.update({
      where: { address },
      data: {
        status: AgentStatus.BANNED,
        bannedAt: now,
        banReasonCode: reason,
        banSourceDisputeId: sourceDisputeId ?? null,
        updatedAt: now
      }
    });
    return true;
  }

  private async isTaskCleanForForcedTerminationWithTx(
    tx: Prisma.TransactionClient,
    taskId: string
  ): Promise<boolean> {
    const [submittedCount, openDisputeCount] = await Promise.all([
      tx.submission.count({
        where: {
          taskId,
          status: DomainSubmissionStatus.SUBMITTED
        }
      }),
      tx.dispute.count({
        where: {
          taskId,
          status: DomainDisputeStatus.OPEN
        }
      })
    ]);
    return submittedCount === 0 && openDisputeCount === 0;
  }

  private async terminateTaskInternalWithTx(
    tx: Prisma.TransactionClient,
    task: {
      id: string;
      publisherAddress: string;
      status: string;
      rewardEscrowRemaining: number;
    },
    now: Date,
    cycleId: string,
    actor: Address,
    options?: { disputeId?: string | null }
  ): Promise<ForcedTerminationRollbackRecord | null> {
    if (task.status === DomainTaskStatus.TERMINATED || task.status === DomainTaskStatus.CLOSED) {
      throw new DomainError("TASK_NOT_TERMINABLE", "task is already closed", 409);
    }

    const previousStatus = task.status as DomainTaskStatus;
    const previousRewardEscrowRemaining = task.rewardEscrowRemaining;
    const penalty = computeTerminationPenalty(task.rewardEscrowRemaining, this.config);
    const refund = Math.max(0, task.rewardEscrowRemaining - penalty);

    await this.ensureAgentAndLedgerWithTx(tx, asAddress(task.publisherAddress), now);
    await tx.ledgerBalance.update({
      where: { address: task.publisherAddress },
      data: {
        available: {
          increment: refund
        },
        updatedAt: now
      }
    });
    await tx.cycle.update({
      where: { id: cycleId },
      data: {
        penaltyPool: {
          increment: penalty
        }
      }
    });
    await tx.task.update({
      where: { id: task.id },
      data: {
        rewardEscrowRemaining: 0,
        status: DomainTaskStatus.TERMINATED,
        updatedAt: now
      }
    });
    await this.applyProfileDeltaWithTx(tx, asAddress(task.publisherAddress), now, {
      publisherReputationDelta: -1,
      tasksTerminated: 1
    });
    await this.appendActivityEventWithTx(tx, {
      type: DomainActivityEventType.TASK_TERMINATED,
      cycleId,
      taskId: task.id,
      disputeId: options?.disputeId ?? null,
      actor,
      createdAt: now
    });
    return options?.disputeId
      ? {
          taskId: task.id,
          cycleId,
          previousStatus,
          previousRewardEscrowRemaining,
          penalty,
          refund
        }
      : null;
  }

  private async sweepBannedPublisherCleanTasksWithTx(
    tx: Prisma.TransactionClient,
    now: Date,
    cycleId: string
  ): Promise<void> {
    const tasks = await tx.task.findMany({
      where: {
        status: { in: [DomainTaskStatus.OPEN, DomainTaskStatus.IN_PROGRESS] },
        publisher: {
          status: AgentStatus.BANNED
        }
      },
      select: {
        id: true,
        publisherAddress: true,
        status: true,
        rewardEscrowRemaining: true,
        publisher: {
          select: {
            banSourceDisputeId: true
          }
        }
      }
    });
    for (const task of tasks) {
      if (!(await this.isTaskCleanForForcedTerminationWithTx(tx, task.id))) {
        continue;
      }
      const disputeId = task.publisher.banSourceDisputeId;
      const rollback = await this.terminateTaskInternalWithTx(
        tx,
        task,
        now,
        cycleId,
        asAddress(task.publisherAddress),
        { disputeId }
      );
      if (disputeId && rollback) {
        await this.appendForcedTerminationRollbackWithTx(tx, disputeId, rollback);
      }
    }
  }

  private async autoTerminateExpiredCleanTasksWithTx(
    tx: Prisma.TransactionClient,
    now: Date,
    cycleId: string
  ): Promise<void> {
    const tasks = await tx.task.findMany({
      where: {
        status: { in: [DomainTaskStatus.OPEN, DomainTaskStatus.IN_PROGRESS] },
        deadlineUtc: { lte: now }
      },
      select: {
        id: true,
        publisherAddress: true,
        status: true,
        rewardEscrowRemaining: true
      }
    });
    for (const task of tasks) {
      if (!(await this.isTaskCleanForForcedTerminationWithTx(tx, task.id))) {
        continue;
      }
      await this.terminateTaskInternalWithTx(tx, task, now, cycleId, asAddress(task.publisherAddress));
    }
  }

  private async resolveCompletedDisputeFromPublisherWalletWithTx(
    tx: Prisma.TransactionClient,
    input: {
      disputeId: string;
      submission: {
        id: string;
        agentAddress: string;
      };
      task: {
        id: string;
        publisherAddress: string;
        status: DomainTaskStatus;
        slotsTotal: number;
        rewardPerSlot: number;
        rewardEscrowRemaining: number;
        completedAgents: Prisma.JsonValue;
      };
      now: Date;
      cycleId: string;
      rollback: DisputeResolutionRollbackRecord;
    }
  ): Promise<void> {
    const submissionAgent = asAddress(input.submission.agentAddress);
    const publisher = asAddress(input.task.publisherAddress);
    const completedAgents = asAddressArray(input.task.completedAgents);
    const publisherLedger = await tx.ledgerBalance.findUniqueOrThrow({
      where: { address: input.task.publisherAddress }
    });
    const payoutAmount = Math.max(0, Math.min(input.task.rewardPerSlot, publisherLedger.available));
    const payoutShortfallAmount = Math.max(0, input.task.rewardPerSlot - payoutAmount);

    if (payoutAmount > 0) {
      await tx.ledgerBalance.update({
        where: { address: input.task.publisherAddress },
        data: {
          available: {
            decrement: payoutAmount
          },
          updatedAt: input.now
        }
      });
    } else {
      await tx.ledgerBalance.update({
        where: { address: input.task.publisherAddress },
        data: {
          updatedAt: input.now
        }
      });
    }

    if (!completedAgents.includes(submissionAgent)) {
      completedAgents.push(submissionAgent);
    }
    await tx.submission.update({
      where: { id: input.submission.id },
      data: {
        status: DomainSubmissionStatus.DISPUTE_COMPLETED,
        updatedAt: input.now
      }
    });
    await tx.task.update({
      where: { id: input.task.id },
      data: {
        completedAgents: toJsonAddressArray(completedAgents),
        status: this.hasPayableSlot(input.task) ? input.task.status : DomainTaskStatus.CLOSED,
        updatedAt: input.now
      }
    });

    await this.settleConfirmedSubmissionWithTx(tx, {
      submissionAgent,
      publisher,
      rewardPerSlot: payoutAmount,
      taskId: input.task.id,
      cycleId: input.cycleId,
      actor: publisher,
      now: input.now,
      grantPublisherCredits: false,
      disputeId: input.disputeId
    });

    await tx.dispute.update({
      where: { id: input.disputeId },
      data: {
        resolutionRollbackSnapshot: toJsonDisputeResolutionRollback(input.rollback)
      }
    });
    if (payoutShortfallAmount > 0) {
      await this.banAgentWithTx(tx, publisher, input.now, AgentBanReason.DISPUTE_INSOLVENCY, input.disputeId);
      await this.sweepBannedPublisherCleanTasksWithTx(tx, input.now, input.cycleId);
    }
    const publisherProfile = await tx.agentProfile.findUnique({
      where: { address: input.task.publisherAddress },
      select: { status: true }
    });

    await tx.dispute.update({
      where: { id: input.disputeId },
      data: {
        resolutionPayoutSource:
          payoutShortfallAmount > 0
            ? DisputePayoutSource.PUBLISHER_WALLET_PARTIAL
            : DisputePayoutSource.PUBLISHER_WALLET,
        resolutionPayoutAmount: payoutAmount,
        resolutionPayoutShortfallAmount: payoutShortfallAmount,
        resolutionPublisherBanned: publisherProfile?.status === AgentStatus.BANNED
      }
    });
  }

  private async appendForcedTerminationRollbackWithTx(
    tx: Prisma.TransactionClient,
    disputeId: string,
    rollback: ForcedTerminationRollbackRecord
  ): Promise<void> {
    const dispute = await tx.dispute.findUnique({
      where: { id: disputeId },
      select: { resolutionRollbackSnapshot: true }
    });
    if (!dispute) {
      throw new DomainError("DISPUTE_NOT_FOUND", `Dispute ${disputeId} does not exist`, 404);
    }
    const snapshot = asDisputeResolutionRollback(dispute.resolutionRollbackSnapshot);
    if (!snapshot) {
      return;
    }
    snapshot.forcedTerminations.push(rollback);
    await tx.dispute.update({
      where: { id: disputeId },
      data: {
        resolutionRollbackSnapshot: toJsonDisputeResolutionRollback(snapshot)
      }
    });
  }

  private async appendDisputeRollbackHistoryWithTx(
    tx: Prisma.TransactionClient,
    input: {
      dispute: {
        id: string;
        status: string;
        resolutionPayoutSource: string | null;
        resolutionPayoutAmount: number | null;
        resolutionPayoutShortfallAmount: number | null;
        resolutionPublisherBanned: boolean | null;
        resolutionRollbackSnapshot: Prisma.JsonValue | null;
      };
      reopenedAt: Date;
    }
  ): Promise<void> {
    const [votes, workloads, activities] = await Promise.all([
      tx.supervisionVote.findMany({
        where: { disputeId: input.dispute.id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      }),
      tx.cycleWorkload.findMany({
        where: { disputeId: input.dispute.id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      }),
      tx.activityEvent.findMany({
        where: {
          disputeId: input.dispute.id,
          type: {
            in: [DomainActivityEventType.TASK_COMPLETED, DomainActivityEventType.TASK_TERMINATED]
          }
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      })
    ]);
    const hasPreviousResolution =
      input.dispute.resolutionPayoutSource !== null ||
      input.dispute.resolutionPayoutAmount !== null ||
      input.dispute.resolutionPayoutShortfallAmount !== null ||
      input.dispute.resolutionPublisherBanned !== null ||
      input.dispute.resolutionRollbackSnapshot !== null;
    if (!hasPreviousResolution && votes.length === 0 && workloads.length === 0 && activities.length === 0) {
      return;
    }

    await tx.disputeRollbackHistory.create({
      data: {
        id: nanoid(),
        disputeId: input.dispute.id,
        previousStatus: input.dispute.status as DomainDisputeStatus,
        previousResolutionPayoutSource:
          (input.dispute.resolutionPayoutSource as DisputePayoutSource | null) ?? null,
        previousResolutionPayoutAmount: input.dispute.resolutionPayoutAmount,
        previousResolutionPayoutShortfallAmount: input.dispute.resolutionPayoutShortfallAmount,
        previousResolutionPublisherBanned: input.dispute.resolutionPublisherBanned,
        previousResolutionRollbackSnapshot: toJsonDisputeResolutionRollback(
          asDisputeResolutionRollback(input.dispute.resolutionRollbackSnapshot)
        ),
        archivedVotes: toJsonRollbackHistoryEntries(votes.map((item) => mapVote(item))),
        archivedWorkloads: toJsonRollbackHistoryEntries(workloads.map((item) => mapCycleWorkload(item))),
        archivedActivities: toJsonRollbackHistoryEntries(activities.map((item) => mapActivityEvent(item))),
        reopenedAt: input.reopenedAt
      }
    });
  }

  private async reopenDisputeAsNotCompletedWithTx(
    tx: Prisma.TransactionClient,
    disputeId: string,
    now: Date,
    activeCycleId: string
  ): Promise<void> {
    const dispute = await tx.dispute.findUnique({
      where: { id: disputeId },
      select: {
        id: true,
        taskId: true,
        submissionId: true,
        status: true,
        resolutionPayoutSource: true,
        resolutionPayoutAmount: true,
        resolutionPayoutShortfallAmount: true,
        resolutionPublisherBanned: true,
        resolutionRollbackSnapshot: true
      }
    });
    if (!dispute) {
      throw new DomainError("DISPUTE_NOT_FOUND", `Dispute ${disputeId} does not exist`, 404);
    }

    const affectedCycleIds = await this.collectDisputeAffectedCycleIdsWithTx(tx, disputeId);
    const distributionsBefore = await this.captureClosedCycleDistributionsWithTx(tx, affectedCycleIds);
    const wasResolvedCompleted = dispute.status === DomainDisputeStatus.RESOLVED_COMPLETED;
    await this.appendDisputeRollbackHistoryWithTx(tx, {
      dispute,
      reopenedAt: now
    });
    let publisherRemainsBanned = false;
    if (wasResolvedCompleted) {
      publisherRemainsBanned = await this.rollbackResolvedCompletedDisputeWithTx(tx, dispute, now);
    }
    await this.clearDisputeVotesWithTx(tx, disputeId, wasResolvedCompleted, now);
    await tx.dispute.update({
      where: { id: disputeId },
      data: {
        status: DomainDisputeStatus.OPEN,
        resolutionPayoutSource: null,
        resolutionPayoutAmount: null,
        resolutionPayoutShortfallAmount: null,
        resolutionPublisherBanned: null,
        resolutionRollbackSnapshot: Prisma.JsonNull,
        updatedAt: now
      }
    });
    await this.reconcileClosedCycleDistributionsWithTx(tx, distributionsBefore, now);
    if (publisherRemainsBanned) {
      await this.sweepBannedPublisherCleanTasksWithTx(tx, now, activeCycleId);
    }
  }

  private async collectDisputeAffectedCycleIdsWithTx(
    tx: Prisma.TransactionClient,
    disputeId: string
  ): Promise<Set<string>> {
    const [votes, workloads, dispute] = await Promise.all([
      tx.supervisionVote.findMany({
        where: { disputeId },
        select: { createdCycleId: true }
      }),
      tx.cycleWorkload.findMany({
        where: { disputeId },
        select: { cycleId: true }
      }),
      tx.dispute.findUnique({
        where: { id: disputeId },
        select: { resolutionRollbackSnapshot: true }
      })
    ]);
    const cycleIds = new Set<string>();
    for (const vote of votes) {
      cycleIds.add(vote.createdCycleId);
    }
    for (const workload of workloads) {
      cycleIds.add(workload.cycleId);
    }
    const rollback = asDisputeResolutionRollback(dispute?.resolutionRollbackSnapshot ?? null);
    for (const termination of rollback?.forcedTerminations ?? []) {
      cycleIds.add(termination.cycleId);
    }
    return cycleIds;
  }

  private async captureClosedCycleDistributionsWithTx(
    tx: Prisma.TransactionClient,
    cycleIds: Iterable<string>
  ): Promise<Map<string, Map<Address, number>>> {
    const snapshot = new Map<string, Map<Address, number>>();
    for (const cycleId of cycleIds) {
      const cycle = await tx.cycle.findUnique({
        where: { id: cycleId },
        select: { status: true }
      });
      if (!cycle || cycle.status !== DomainCycleStatus.CLOSED) {
        continue;
      }
      snapshot.set(cycleId, await this.computeCycleDistributionWithTx(tx, cycleId));
    }
    return snapshot;
  }

  private async computeCycleDistributionWithTx(
    tx: Prisma.TransactionClient,
    cycleId: string
  ): Promise<Map<Address, number>> {
    const cycle = await tx.cycle.findUnique({
      where: { id: cycleId },
      select: { mintedAmount: true, taxPool: true, penaltyPool: true }
    });
    if (!cycle) {
      throw new DomainError("CYCLE_NOT_FOUND", `Cycle ${cycleId} not found`, 404);
    }
    const workloads = await tx.cycleWorkload.findMany({
      where: { cycleId },
      select: { agentAddress: true, workload: true }
    });
    const grouped = new Map<string, number>();
    for (const workload of workloads) {
      grouped.set(workload.agentAddress, (grouped.get(workload.agentAddress) ?? 0) + workload.workload);
    }
    const rewardPool = cycle.mintedAmount + cycle.taxPool + cycle.penaltyPool;
    return new Map(
      [...allocateIntegerPool(rewardPool, grouped).entries()].map(([agent, amount]) => [asAddress(agent), amount])
    );
  }

  private async reconcileClosedCycleDistributionsWithTx(
    tx: Prisma.TransactionClient,
    distributionsBefore: Map<string, Map<Address, number>>,
    now: Date
  ): Promise<void> {
    for (const [cycleId, before] of distributionsBefore.entries()) {
      const after = await this.computeCycleDistributionWithTx(tx, cycleId);
      const agents = new Set<Address>([...before.keys(), ...after.keys()]);
      for (const agent of agents) {
        const delta = (after.get(agent) ?? 0) - (before.get(agent) ?? 0);
        if (delta === 0) {
          continue;
        }
        await this.ensureAgentAndLedgerWithTx(tx, agent, now);
        await tx.ledgerBalance.update({
          where: { address: agent },
          data: {
            available: {
              increment: delta
            },
            updatedAt: now
          }
        });
      }
    }
  }

  private async collectAddressesAffectedByReopenedDisputeWithTx(
    tx: Prisma.TransactionClient,
    disputeId: string
  ): Promise<Address[]> {
    const dispute = await tx.dispute.findUnique({
      where: { id: disputeId },
      select: {
        submissionId: true,
        task: {
          select: {
            publisherAddress: true
          }
        }
      }
    });
    if (!dispute) {
      throw new DomainError("DISPUTE_NOT_FOUND", `Dispute ${disputeId} does not exist`, 404);
    }
    const submission = await tx.submission.findUnique({
      where: { id: dispute.submissionId },
      select: { agentAddress: true }
    });
    if (!submission) {
      throw new DomainError("SUBMISSION_NOT_FOUND", `Submission ${dispute.submissionId} not found`, 404);
    }

    const addresses = new Set<Address>([asAddress(submission.agentAddress), asAddress(dispute.task.publisherAddress)]);
    const affectedCycleIds = new Set<string>();
    const rollbackHistory = await tx.disputeRollbackHistory.findMany({
      where: { disputeId },
      select: {
        archivedVotes: true,
        archivedWorkloads: true,
        previousResolutionRollbackSnapshot: true
      }
    });
    for (const history of rollbackHistory) {
      for (const vote of asDisputeRollbackHistoryArray<SupervisionVote>(history.archivedVotes)) {
        affectedCycleIds.add(vote.createdCycleId);
      }
      for (const workload of asDisputeRollbackHistoryArray<CycleWorkload>(history.archivedWorkloads)) {
        affectedCycleIds.add(workload.cycleId);
        addresses.add(workload.agent);
      }
      for (const forcedTermination of asDisputeResolutionRollback(history.previousResolutionRollbackSnapshot)
        ?.forcedTerminations ?? []) {
        affectedCycleIds.add(forcedTermination.cycleId);
      }
    }
    if (affectedCycleIds.size > 0) {
      const workloads = await tx.cycleWorkload.findMany({
        where: {
          cycleId: {
            in: [...affectedCycleIds]
          }
        },
        select: {
          agentAddress: true
        }
      });
      for (const workload of workloads) {
        addresses.add(asAddress(workload.agentAddress));
      }
    }
    return [...addresses];
  }

  private async banNegativeBalanceAgentsAffectedByReopenedDisputeSettlementWithTx(
    tx: Prisma.TransactionClient,
    disputeId: string,
    now: Date
  ): Promise<Address[]> {
    const affectedAddresses = await this.collectAddressesAffectedByReopenedDisputeWithTx(tx, disputeId);
    if (affectedAddresses.length === 0) {
      return [];
    }
    const balances = await tx.ledgerBalance.findMany({
      where: {
        address: {
          in: affectedAddresses
        },
        available: {
          lt: 0
        }
      },
      select: {
        address: true
      }
    });
    for (const balance of balances) {
      const address = asAddress(balance.address);
      await this.ensureAgentAndLedgerWithTx(tx, address, now);
      await this.banAgentWithTx(tx, address, now, AgentBanReason.REOPEN_NEGATIVE_BALANCE);
    }
    return balances.map((item) => asAddress(item.address));
  }

  private async hasReopenHistoryForDisputeWithTx(
    tx: Prisma.TransactionClient,
    disputeId: string
  ): Promise<boolean> {
    const history = await tx.disputeRollbackHistory.findFirst({
      where: { disputeId },
      select: { id: true }
    });
    return history !== null;
  }

  private async hasActiveTaskForAnyPublisherWithTx(
    tx: Prisma.TransactionClient,
    addresses: Address[]
  ): Promise<boolean> {
    if (addresses.length === 0) {
      return false;
    }
    const task = await tx.task.findFirst({
      where: {
        publisherAddress: {
          in: addresses
        },
        status: {
          in: [DomainTaskStatus.OPEN, DomainTaskStatus.IN_PROGRESS]
        }
      },
      select: {
        id: true
      }
    });
    return task !== null;
  }

  private async rollbackResolvedCompletedDisputeWithTx(
    tx: Prisma.TransactionClient,
    dispute: {
      id: string;
      taskId: string;
      submissionId: string;
      resolutionPayoutSource: string | null;
      resolutionPayoutAmount: number | null;
      resolutionRollbackSnapshot: Prisma.JsonValue | null;
    },
    now: Date
  ): Promise<boolean> {
    const submission = await tx.submission.findUnique({
      where: { id: dispute.submissionId },
      select: { id: true, taskId: true, agentAddress: true, status: true }
    });
    if (!submission) {
      throw new DomainError("SUBMISSION_NOT_FOUND", `Submission ${dispute.submissionId} not found`, 404);
    }
    const task = await tx.task.findUnique({
      where: { id: dispute.taskId },
      select: {
        id: true,
        publisherAddress: true,
        status: true,
        rewardPerSlot: true,
        rewardEscrowRemaining: true,
        completedAgents: true
      }
    });
    if (!task) {
      throw new DomainError("TASK_NOT_FOUND", `Task ${dispute.taskId} does not exist`, 404);
    }
    const rollback = asDisputeResolutionRollback(dispute.resolutionRollbackSnapshot);
    const payoutAmount =
      dispute.resolutionPayoutAmount ??
      ((submission.status as DomainSubmissionStatus) === DomainSubmissionStatus.CONFIRMED ? task.rewardPerSlot : 0);
    const payoutSource = dispute.resolutionPayoutSource ?? DisputePayoutSource.ESCROW;

    await tx.submission.update({
      where: { id: submission.id },
      data: {
        status: DomainSubmissionStatus.REJECTED,
        updatedAt: now
      }
    });

    const completedAgents = asAddressArray(task.completedAgents);
    const hasOtherCompletion =
      (await tx.submission.count({
        where: {
          taskId: task.id,
          agentAddress: submission.agentAddress,
          id: { not: submission.id },
          status: {
            in: [DomainSubmissionStatus.CONFIRMED, DomainSubmissionStatus.DISPUTE_COMPLETED]
          }
        }
      })) > 0;
    const nextCompletedAgents = hasOtherCompletion
      ? completedAgents
      : completedAgents.filter((item) => item !== asAddress(submission.agentAddress));
    await tx.task.update({
      where: { id: task.id },
      data: {
        rewardEscrowRemaining:
          rollback?.taskRewardEscrowRemainingBeforeResolution ?? task.rewardEscrowRemaining,
        status: rollback?.taskStatusBeforeResolution ?? DomainTaskStatus.IN_PROGRESS,
        completedAgents: toJsonAddressArray(nextCompletedAgents),
        updatedAt: now
      }
    });

    await this.ensureAgentAndLedgerWithTx(tx, asAddress(submission.agentAddress), now);
    await tx.ledgerBalance.update({
      where: { address: submission.agentAddress },
      data: {
        available: {
          decrement: payoutAmount
        },
        updatedAt: now
      }
    });
    if (payoutSource !== DisputePayoutSource.ESCROW) {
      await this.ensureAgentAndLedgerWithTx(tx, asAddress(task.publisherAddress), now);
      await tx.ledgerBalance.update({
        where: { address: task.publisherAddress },
        data: {
          available: {
            increment: payoutAmount
          },
          updatedAt: now
        }
      });
    }
    await this.applyProfileDeltaWithTx(tx, asAddress(submission.agentAddress), now, {
      workerReputationDelta: -2,
      tasksCompleted: -1
    });

    await tx.cycleWorkload.deleteMany({
      where: {
        disputeId: dispute.id,
        taskId: task.id
      }
    });
    await this.deleteActivityEventsAndRefreshLatestWithTx(tx, {
      type: DomainActivityEventType.TASK_COMPLETED,
      disputeId: dispute.id
    });
    for (const termination of rollback?.forcedTerminations ?? []) {
      await this.rollbackForcedTerminationWithTx(tx, dispute.id, termination, now);
    }
    return this.restorePublisherBanStateWithTx(
      tx,
      asAddress(task.publisherAddress),
      dispute.id,
      rollback,
      now
    );
  }

  private async rollbackForcedTerminationWithTx(
    tx: Prisma.TransactionClient,
    disputeId: string,
    rollback: ForcedTerminationRollbackRecord,
    now: Date
  ): Promise<void> {
    const task = await tx.task.findUnique({
      where: { id: rollback.taskId },
      select: { id: true, publisherAddress: true }
    });
    if (!task) {
      throw new DomainError("TASK_NOT_FOUND", `Task ${rollback.taskId} does not exist`, 404);
    }
    await this.ensureAgentAndLedgerWithTx(tx, asAddress(task.publisherAddress), now);
    await tx.ledgerBalance.update({
      where: { address: task.publisherAddress },
      data: {
        available: {
          decrement: rollback.refund
        },
        updatedAt: now
      }
    });
    await tx.cycle.update({
      where: { id: rollback.cycleId },
      data: {
        penaltyPool: {
          decrement: rollback.penalty
        }
      }
    });
    await tx.task.update({
      where: { id: rollback.taskId },
      data: {
        rewardEscrowRemaining: rollback.previousRewardEscrowRemaining,
        status: rollback.previousStatus,
        updatedAt: now
      }
    });
    await this.applyProfileDeltaWithTx(tx, asAddress(task.publisherAddress), now, {
      publisherReputationDelta: 1,
      tasksTerminated: -1
    });
    await this.deleteActivityEventsAndRefreshLatestWithTx(tx, {
      type: DomainActivityEventType.TASK_TERMINATED,
      disputeId,
      taskId: rollback.taskId
    });
  }

  private async clearDisputeVotesWithTx(
    tx: Prisma.TransactionClient,
    disputeId: string,
    reverseResolvedOutcome: boolean,
    now: Date
  ): Promise<void> {
    const votes = await tx.supervisionVote.findMany({
      where: { disputeId },
      select: { id: true, agentAddress: true, vote: true }
    });
    for (const vote of votes) {
      await this.applyProfileDeltaWithTx(tx, asAddress(vote.agentAddress), now, {
        supervisorReputationDelta:
          -0.5 + (reverseResolvedOutcome ? (vote.vote === DomainVoteChoice.COMPLETED ? -1 : 1) : 0),
        supervisionVotes: -1
      });
    }
    await tx.supervisionVote.deleteMany({ where: { disputeId } });
    await tx.cycleWorkload.deleteMany({
      where: {
        disputeId,
        taskId: null
      }
    });
  }

  private async restorePublisherBanStateWithTx(
    tx: Prisma.TransactionClient,
    publisher: Address,
    disputeId: string,
    rollback: DisputeResolutionRollbackRecord | null,
    now: Date
  ): Promise<boolean> {
    const alternateBanSourceDisputeId = await this.findAlternateBanSourceDisputeIdWithTx(tx, publisher, disputeId);
    if (rollback?.publisherWasBannedBeforeResolution) {
      await tx.agentProfile.update({
        where: { address: publisher },
        data: {
          banSourceDisputeId:
            rollback.publisherBanSourceDisputeIdBeforeResolution ?? alternateBanSourceDisputeId,
          updatedAt: now
        }
      });
      return true;
    }
    const profile = await tx.agentProfile.findUnique({
      where: { address: publisher },
      select: { banSourceDisputeId: true, status: true }
    });
    if (alternateBanSourceDisputeId) {
      await tx.agentProfile.update({
        where: { address: publisher },
        data: {
          status: AgentStatus.BANNED,
          banReasonCode: AgentBanReason.DISPUTE_INSOLVENCY,
          banSourceDisputeId: alternateBanSourceDisputeId,
          updatedAt: now
        }
      });
      return true;
    }
    if (!profile || profile.banSourceDisputeId !== disputeId) {
      return profile?.status === AgentStatus.BANNED;
    }
    await tx.agentProfile.update({
      where: { address: publisher },
      data: {
        status: AgentStatus.ACTIVE,
        bannedAt: null,
        banReasonCode: null,
        banSourceDisputeId: null,
        updatedAt: now
      }
    });
    return false;
  }

  private async findAlternateBanSourceDisputeIdWithTx(
    tx: Prisma.TransactionClient,
    publisher: Address,
    excludingDisputeId: string
  ): Promise<string | null> {
    const alternate = await tx.dispute.findFirst({
      where: {
        id: { not: excludingDisputeId },
        status: DomainDisputeStatus.RESOLVED_COMPLETED,
        resolutionPayoutSource: DisputePayoutSource.PUBLISHER_WALLET_PARTIAL,
        task: {
          publisherAddress: publisher
        }
      },
      orderBy: { updatedAt: "asc" },
      select: { id: true }
    });
    return alternate?.id ?? null;
  }

  private async evaluateDisputeWithTx(
    tx: Prisma.TransactionClient,
    disputeId: string,
    config: AppConfig,
    now: Date,
    cycleId: string
  ): Promise<boolean> {
    const dispute = await tx.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute) {
      throw new DomainError("DISPUTE_NOT_FOUND", `Dispute ${disputeId} does not exist`, 404);
    }
    if (dispute.status !== DomainDisputeStatus.OPEN) {
      return false;
    }

    const votes = await tx.supervisionVote.findMany({ where: { disputeId } });
    if (votes.length < config.disputeQuorum) {
      return false;
    }
    const totalWeight = votes.reduce((acc, item) => acc + item.weightSnapshot, 0);
    if (totalWeight <= 0) {
      return false;
    }
    const completedWeight = votes
      .filter((item) => item.vote === DomainVoteChoice.COMPLETED)
      .reduce((acc, item) => acc + item.weightSnapshot, 0);
    const completedBps = Math.floor((completedWeight * 10_000) / totalWeight);
    if (completedBps < config.disputeApprovalBps) {
      return false;
    }

    await tx.dispute.update({
      where: { id: disputeId },
      data: {
        status: DomainDisputeStatus.RESOLVED_COMPLETED,
        updatedAt: now
      }
    });
    await this.finalizeDisputeWithOutcomeWithTx(
      tx,
      disputeId,
      DomainVoteChoice.COMPLETED,
      now,
      cycleId
    );
    return true;
  }

  private async finalizeDisputeWithOutcomeWithTx(
    tx: Prisma.TransactionClient,
    disputeId: string,
    outcome: DomainVoteChoice,
    now: Date,
    cycleId: string
  ): Promise<void> {
    const dispute = await tx.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute) {
      throw new DomainError("DISPUTE_NOT_FOUND", `Dispute ${disputeId} does not exist`, 404);
    }
    const submission = await tx.submission.findUnique({ where: { id: dispute.submissionId } });
    if (!submission) {
      throw new DomainError("SUBMISSION_NOT_FOUND", `Submission ${dispute.submissionId} not found`, 404);
    }
    const task = await tx.task.findUnique({ where: { id: dispute.taskId } });
    if (!task) {
      throw new DomainError("TASK_NOT_FOUND", `Task ${dispute.taskId} does not exist`, 404);
    }

    if (outcome === DomainVoteChoice.COMPLETED) {
      if (
        submission.status !== DomainSubmissionStatus.CONFIRMED &&
        submission.status !== DomainSubmissionStatus.DISPUTE_COMPLETED
      ) {
        const publisherProfileBeforeResolution = await tx.agentProfile.findUnique({
          where: { address: task.publisherAddress },
          select: { status: true, banSourceDisputeId: true }
        });
        const rollback: DisputeResolutionRollbackRecord = {
          resolutionCycleId: cycleId,
          taskStatusBeforeResolution: task.status as DomainTaskStatus,
          taskRewardEscrowRemainingBeforeResolution: task.rewardEscrowRemaining,
          publisherWasBannedBeforeResolution: publisherProfileBeforeResolution?.status === AgentStatus.BANNED,
          publisherBanSourceDisputeIdBeforeResolution:
            publisherProfileBeforeResolution?.banSourceDisputeId ?? null,
          forcedTerminations: []
        };
        if (this.hasPayableSlot(task)) {
          await this.confirmSubmissionInternalWithTx(
            tx,
            submission,
            task,
            now,
            cycleId,
            asAddress(task.publisherAddress),
            {
              grantPublisherCredits: false,
              disputeId
            }
          );
          const publisher = await tx.agentProfile.findUnique({
            where: { address: task.publisherAddress },
            select: { status: true }
          });
          await tx.dispute.update({
            where: { id: disputeId },
            data: {
              resolutionPayoutSource: DisputePayoutSource.ESCROW,
              resolutionPayoutAmount: task.rewardPerSlot,
              resolutionPayoutShortfallAmount: 0,
              resolutionPublisherBanned: publisher?.status === AgentStatus.BANNED,
              resolutionRollbackSnapshot: toJsonDisputeResolutionRollback(rollback)
            }
          });
        } else {
          await this.resolveCompletedDisputeFromPublisherWalletWithTx(tx, {
            disputeId,
            submission,
            task: {
              id: task.id,
              publisherAddress: task.publisherAddress,
              status: task.status as DomainTaskStatus,
              slotsTotal: task.slotsTotal,
              rewardPerSlot: task.rewardPerSlot,
              rewardEscrowRemaining: task.rewardEscrowRemaining,
              completedAgents: task.completedAgents
            },
            now,
            cycleId,
            rollback
          });
        }
      }
    }

    const votes = await tx.supervisionVote.findMany({ where: { disputeId } });
    for (const vote of votes) {
      await this.applyProfileDeltaWithTx(tx, asAddress(vote.agentAddress), now, {
        supervisorReputationDelta: vote.vote === outcome ? 1 : -1
      });
    }
    if (outcome === DomainVoteChoice.COMPLETED && (await this.hasReopenHistoryForDisputeWithTx(tx, disputeId))) {
      const negativeBalanceAddresses =
        await this.banNegativeBalanceAgentsAffectedByReopenedDisputeSettlementWithTx(
        tx,
        disputeId,
        now
      );
      if (await this.hasActiveTaskForAnyPublisherWithTx(tx, negativeBalanceAddresses)) {
        await this.sweepBannedPublisherCleanTasksWithTx(tx, now, cycleId);
      }
    }
  }

  private nextCycleId(currentCycleId: string): string {
    const match = /^cycle-(\d+)$/.exec(currentCycleId);
    if (!match) {
      throw new DomainError(
        "CYCLE_ID_INVARIANT_BROKEN",
        `cycle id ${currentCycleId} is not in expected format cycle-<n>`,
        500
      );
    }
    const currentNumber = Number(match[1]);
    const nextNumber = currentNumber + 1;
    if (!Number.isSafeInteger(currentNumber) || !Number.isSafeInteger(nextNumber) || nextNumber <= 0) {
      throw new DomainError("CYCLE_ID_INVARIANT_BROKEN", "cycle sequence cannot advance safely", 500);
    }
    return `cycle-${nextNumber}`;
  }

  private normalizePendingPatch(
    patch: RuntimeEditableRulesPatch | null | undefined
  ): RuntimeEditableRulesPatch | null {
    if (!patch) {
      return null;
    }
    const normalized: RuntimeEditableRulesPatch = {};
    for (const key of runtimeRuleKeys) {
      if (patch[key] !== undefined) {
        normalized[key] = patch[key];
      }
    }
    return Object.keys(normalized).length > 0 ? normalized : null;
  }

  private toRuntimeSettingsState(row: {
    currentRules: Prisma.JsonValue;
    pendingNextPatch: Prisma.JsonValue | null;
    updatedAt: Date;
  }): RuntimeSettingsState {
    const currentRules = toRuntimeEditableRules(row.currentRules);
    const pendingNextPatch = this.normalizePendingPatch(toRuntimeEditableRulesPatch(row.pendingNextPatch));
    const nextRules = pendingNextPatch
      ? mergeRuntimeEditableRules(currentRules, pendingNextPatch)
      : currentRules;
    validateRuntimeEditableRules(nextRules);
    return {
      currentRules,
      pendingNextPatch,
      nextRules,
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private mapRuntimeRuleAudit(row: {
    id: string;
    eventType: string;
    applyTo: string | null;
    reason: string | null;
    actor: string | null;
    cycleId: string | null;
    beforeRules: Prisma.JsonValue | null;
    afterRules: Prisma.JsonValue | null;
    patch: Prisma.JsonValue | null;
    pendingNextPatch: Prisma.JsonValue | null;
    createdAt: Date;
  }): RuntimeRuleAuditRecord {
    return {
      id: row.id,
      eventType: row.eventType as RuntimeRuleAuditRecord["eventType"],
      applyTo:
        row.applyTo === "CURRENT" ? "current" : row.applyTo === "NEXT" ? "next" : null,
      reason: row.reason,
      actor: row.actor,
      cycleId: row.cycleId,
      beforeRules: row.beforeRules ? toRuntimeEditableRules(row.beforeRules) : null,
      afterRules: row.afterRules ? toRuntimeEditableRules(row.afterRules) : null,
      patch: row.patch ? this.normalizePendingPatch(toRuntimeEditableRulesPatch(row.patch)) : null,
      pendingNextPatch: row.pendingNextPatch
        ? this.normalizePendingPatch(toRuntimeEditableRulesPatch(row.pendingNextPatch))
        : null,
      createdAt: row.createdAt.toISOString()
    };
  }

  private mapFeedbackReport(row: {
    id: string;
    type: string;
    title: string;
    bodyMd: string;
    reporterAddress: string;
    createdAt: Date;
  }): FeedbackReport {
    return {
      id: row.id,
      type: row.type as FeedbackReportType,
      title: row.title,
      bodyMd: row.bodyMd,
      reporterAddress: asAddress(row.reporterAddress),
      createdAt: row.createdAt.toISOString()
    };
  }

  private mapServerRequestLog(row: {
    id: string;
    requestId: string;
    method: string;
    path: string;
    routeId: string;
    statusCode: number;
    durationMs: number;
    clientIp: string;
    forwardedFor: string | null;
    userAgent: string | null;
    actorAddress: string | null;
    errorCode: string | null;
    createdAt: Date;
  }): ServerRequestLogRecord {
    return {
      id: row.id,
      requestId: row.requestId,
      method: row.method,
      path: row.path,
      routeId: row.routeId,
      statusCode: row.statusCode,
      durationMs: Number(row.durationMs.toFixed(3)),
      clientIp: row.clientIp,
      forwardedFor: row.forwardedFor,
      userAgent: row.userAgent,
      actorAddress: row.actorAddress ? asAddress(row.actorAddress) : null,
      errorCode: row.errorCode,
      createdAt: row.createdAt.toISOString()
    };
  }

  private mapServerAuditLog(row: {
    id: string;
    category: string;
    action: string;
    severity: string;
    outcome: string;
    requestId: string | null;
    clientIp: string | null;
    actorAddress: string | null;
    method: string | null;
    routeId: string | null;
    targetType: string | null;
    targetId: string | null;
    cycleId: string | null;
    message: string;
    details: Prisma.JsonValue | null;
    createdAt: Date;
  }): ServerAuditLogRecord {
    return {
      id: row.id,
      category: row.category as ServerAuditLogRecord["category"],
      action: row.action,
      severity: row.severity as ServerAuditLogRecord["severity"],
      outcome: row.outcome as ServerAuditLogRecord["outcome"],
      requestId: row.requestId,
      clientIp: row.clientIp,
      actorAddress: row.actorAddress ? asAddress(row.actorAddress) : null,
      method: row.method,
      routeId: row.routeId,
      targetType: row.targetType,
      targetId: row.targetId,
      cycleId: row.cycleId,
      message: row.message,
      details:
        row.details && typeof row.details === "object" && !Array.isArray(row.details)
          ? (row.details as Record<string, unknown>)
          : null,
      createdAt: row.createdAt.toISOString()
    };
  }

  private async appendAuditLogWithTx(
    tx: Prisma.TransactionClient,
    input: AuditLogCreateInput
  ): Promise<ServerAuditLogRecord> {
    const record = buildAuditLogRecord(input);
    if (!this.config.enableAuditLogPersistence) {
      return record;
    }
    const row = await tx.serverAuditLog.create({
      data: {
        id: record.id,
        category: record.category,
        action: record.action,
        severity: record.severity,
        outcome: record.outcome,
        requestId: record.requestId ?? undefined,
        clientIp: record.clientIp ?? undefined,
        actorAddress: record.actorAddress ?? undefined,
        method: record.method ?? undefined,
        routeId: record.routeId ?? undefined,
        targetType: record.targetType ?? undefined,
        targetId: record.targetId ?? undefined,
        cycleId: record.cycleId ?? undefined,
        message: record.message,
        details: record.details
          ? (sanitizeAuditDetails(record.details) as Prisma.InputJsonValue)
          : undefined,
        createdAt: new Date(record.createdAt)
      }
    });
    return this.mapServerAuditLog(row);
  }

  private async refreshCycleCloseConfigWithTx(
    tx: Prisma.TransactionClient,
    baseConfig: AppConfig
  ): Promise<AppConfig> {
    const { currentRules, pendingNextPatch } = await this.lockRuntimeRuleStateWithTx(tx);
    const currentConfig = applyRuntimeEditableRules(baseConfig, currentRules);
    const nextRules =
      Object.keys(pendingNextPatch).length > 0
        ? mergeRuntimeEditableRules(currentRules, pendingNextPatch)
        : currentRules;
    validateRuntimeEditableRules(nextRules);
    Object.assign(this.config, currentConfig);
    return {
      ...currentConfig,
      mintPerCycle: nextRules.mintPerCycle
    };
  }

  private async applyPendingRuntimeRulesForOpenedCycleWithTx(
    tx: Prisma.TransactionClient,
    input: {
      openedCycleId: string;
      actor?: string;
    }
  ): Promise<RuntimeSettingsState> {
    const { row, currentRules, pendingNextPatch } = await this.lockRuntimeRuleStateWithTx(tx);
    if (Object.keys(pendingNextPatch).length === 0) {
      return this.toRuntimeSettingsState(row);
    }

    const nextCurrent = mergeRuntimeEditableRules(currentRules, pendingNextPatch);
    validateRuntimeEditableRules(nextCurrent);
    await tx.cycle.updateMany({
      where: { id: input.openedCycleId, status: DomainCycleStatus.OPEN },
      data: { mintedAmount: nextCurrent.mintPerCycle }
    });
    const updated = await tx.runtimeRuleState.update({
      where: { id: RUNTIME_RULE_STATE_ID },
      data: {
        currentRules: nextCurrent,
        pendingNextPatch: Prisma.JsonNull
      }
    });

    await tx.runtimeRuleAudit.create({
      data: {
        id: nanoid(),
        eventType: "AUTO_APPLY_NEXT",
        applyTo: null,
        reason: null,
        actor: input.actor?.trim().length ? input.actor.trim() : "system",
        cycleId: input.openedCycleId,
        beforeRules: currentRules,
        afterRules: nextCurrent,
        patch: pendingNextPatch as Prisma.InputJsonValue,
        pendingNextPatch: Prisma.JsonNull
      }
    });

    Object.assign(this.config, applyRuntimeEditableRules(this.config, nextCurrent));
    return this.toRuntimeSettingsState(updated);
  }

  private async lockRuntimeRuleStateWithTx(tx: Prisma.TransactionClient): Promise<{
    row: {
      id: string;
      currentRules: Prisma.JsonValue;
      pendingNextPatch: Prisma.JsonValue | null;
      updatedAt: Date;
    };
    currentRules: RuntimeEditableRules;
    pendingNextPatch: RuntimeEditableRulesPatch;
  }> {
    const defaults = pickRuntimeEditableRules(this.config);
    validateRuntimeEditableRules(defaults);
    await tx.runtimeRuleState.upsert({
      where: { id: RUNTIME_RULE_STATE_ID },
      create: {
        id: RUNTIME_RULE_STATE_ID,
        currentRules: defaults,
        pendingNextPatch: Prisma.JsonNull
      },
      update: {}
    });
    await tx.$queryRaw`SELECT id FROM "RuntimeRuleState" WHERE id = ${RUNTIME_RULE_STATE_ID} FOR UPDATE`;
    const row = await tx.runtimeRuleState.findUniqueOrThrow({
      where: { id: RUNTIME_RULE_STATE_ID },
      select: {
        id: true,
        currentRules: true,
        pendingNextPatch: true,
        updatedAt: true
      }
    });
    const currentRules = toRuntimeEditableRules(row.currentRules);
    const pendingNextPatch =
      this.normalizePendingPatch(toRuntimeEditableRulesPatch(row.pendingNextPatch)) ?? {};
    return {
      row,
      currentRules,
      pendingNextPatch
    };
  }

  private async applySnapshotDiffWithTx(
    tx: Prisma.TransactionClient,
    currentSnapshot: EngineStateSnapshot | null,
    nextSnapshot: EngineStateSnapshot,
    scopeSet: ReadonlySet<PersistenceMutationScope> | null
  ): Promise<void> {
    if (!currentSnapshot) {
      await tx.runtimeState.upsert({
        where: { id: RUNTIME_ID },
        create: { id: RUNTIME_ID, activeCycleId: nextSnapshot.activeCycleId },
        update: { activeCycleId: nextSnapshot.activeCycleId }
      });
    }

    const includeCycles = !scopeSet || scopeSet.has("cycles");
    const includeProfiles = !scopeSet || scopeSet.has("profiles");
    const includeBalances = !scopeSet || scopeSet.has("balances");
    const includeTasks = !scopeSet || scopeSet.has("tasks");
    const includeIntentions = !scopeSet || scopeSet.has("intentions");
    const includeSubmissions = !scopeSet || scopeSet.has("submissions");
    const includeDisputes = !scopeSet || scopeSet.has("disputes");
    const includeDisputeRollbackHistory = includeDisputes && nextSnapshot.disputeRollbackHistory !== undefined;
    const includeVotes = !scopeSet || scopeSet.has("votes");
    const includeCycleWorkloads = !scopeSet || scopeSet.has("cycleWorkloads");
    const includeActivities = !scopeSet || scopeSet.has("activities");

    const cycleDiff = includeCycles
      ? diffByKey(currentSnapshot?.cycles ?? [], nextSnapshot.cycles, (item) => item.id)
      : { upserts: [], deletes: [] };
    const profileDiff = includeProfiles
      ? diffByKey(currentSnapshot?.profiles ?? [], nextSnapshot.profiles, (item) => item.address)
      : { upserts: [], deletes: [] };
    const balanceDiff = includeBalances
      ? diffByKey(currentSnapshot?.balances ?? [], nextSnapshot.balances, (item) => item.address)
      : { upserts: [], deletes: [] };
    const taskDiff = includeTasks
      ? diffByKey(currentSnapshot?.tasks ?? [], nextSnapshot.tasks, (item) => item.id)
      : { upserts: [], deletes: [] };
    const intentionDiff = includeIntentions
      ? diffByKey(currentSnapshot?.intentions ?? [], nextSnapshot.intentions ?? [], (item) => item.id)
      : { upserts: [], deletes: [] };
    const submissionDiff = includeSubmissions
      ? diffByKey(currentSnapshot?.submissions ?? [], nextSnapshot.submissions, (item) => item.id)
      : { upserts: [], deletes: [] };
    const disputeDiff = includeDisputes
      ? diffByKey(currentSnapshot?.disputes ?? [], nextSnapshot.disputes, (item) => item.id)
      : { upserts: [], deletes: [] };
    const disputeResolutionDiff = includeDisputes
      ? diffByKey(
          currentSnapshot?.disputeResolutionMeta ?? [],
          nextSnapshot.disputeResolutionMeta ?? [],
          (item) => item.disputeId
        )
      : { upserts: [], deletes: [] };
    const disputeRollbackHistoryDiff = includeDisputeRollbackHistory
      ? diffByKey(
          currentSnapshot?.disputeRollbackHistory ?? [],
          nextSnapshot.disputeRollbackHistory ?? [],
          (item) => item.id
        )
      : { upserts: [], deletes: [] };
    const banSourceDiff = includeProfiles
      ? diffByKey(
          currentSnapshot?.banSourceDisputeByPublisher ?? [],
          nextSnapshot.banSourceDisputeByPublisher ?? [],
          (item) => item[0]
        )
      : { upserts: [], deletes: [] };
    const voteDiff = includeVotes
      ? diffByKey(currentSnapshot?.votes ?? [], nextSnapshot.votes, (item) => item.id)
      : { upserts: [], deletes: [] };
    const workloadDiff = includeCycleWorkloads
      ? diffByKey(currentSnapshot?.cycleWorkloads ?? [], nextSnapshot.cycleWorkloads, (item) => item.id)
      : { upserts: [], deletes: [] };
    const activityDiff = includeActivities
      ? diffByKey(currentSnapshot?.activities ?? [], nextSnapshot.activities, (item) => item.id)
      : { upserts: [], deletes: [] };
    const nextDisputeResolutionMetaById = new Map(
      (nextSnapshot.disputeResolutionMeta ?? []).map((item) => [item.disputeId, item])
    );
    const nextDisputeRollbackHistoryById = new Map(
      (nextSnapshot.disputeRollbackHistory ?? []).map((item) => [item.id, item])
    );
    const nextBanSourceByPublisher = new Map(nextSnapshot.banSourceDisputeByPublisher ?? []);
    const nextLatestActivityAtByAddress = new Map<string, string>();
    for (const activity of nextSnapshot.activities) {
      const previous = nextLatestActivityAtByAddress.get(activity.actor);
      if (!previous || previous < activity.createdAt) {
        nextLatestActivityAtByAddress.set(activity.actor, activity.createdAt);
      }
    }

    for (const item of cycleDiff.upserts) {
      await tx.cycle.upsert({
        where: { id: item.id },
        create: {
          id: item.id,
          status: item.status,
          mintedAmount: item.mintedAmount,
          taxPool: item.taxPool,
          penaltyPool: item.penaltyPool,
          startedAt: toDate(item.startedAt),
          closedAt: item.closedAt ? toDate(item.closedAt) : null
        },
        update: {
          status: item.status,
          mintedAmount: item.mintedAmount,
          taxPool: item.taxPool,
          penaltyPool: item.penaltyPool,
          startedAt: toDate(item.startedAt),
          closedAt: item.closedAt ? toDate(item.closedAt) : null
        }
      });
    }

    for (const item of profileDiff.upserts) {
      await tx.agentProfile.upsert({
        where: { address: item.address },
        create: {
          address: item.address,
          name: item.name,
          bio: item.bio,
          status: item.status,
          bannedAt: item.bannedAt ? toDate(item.bannedAt) : null,
          banReasonCode: item.banReasonCode,
          banSourceDisputeId: nextBanSourceByPublisher.get(item.address) ?? null,
          publisherRep: item.reputation.publisher,
          workerRep: item.reputation.worker,
          supervisorRep: item.reputation.supervisor,
          tasksPublishedCount: item.stats.tasksPublished,
          tasksIntentedCount: item.stats.tasksIntented,
          tasksCompletedCount: item.stats.tasksCompleted,
          tasksTerminatedCount: item.stats.tasksTerminated,
          submissionsRejectedCount: item.stats.submissionsRejected,
          supervisionVotesCount: item.stats.supervisionVotes,
          latestActivityAt: nextLatestActivityAtByAddress.get(item.address)
            ? toDate(nextLatestActivityAtByAddress.get(item.address)!)
            : null,
          createdAt: toDate(item.createdAt),
          updatedAt: toDate(item.updatedAt)
        },
        update: {
          name: item.name,
          bio: item.bio,
          status: item.status,
          bannedAt: item.bannedAt ? toDate(item.bannedAt) : null,
          banReasonCode: item.banReasonCode,
          banSourceDisputeId: nextBanSourceByPublisher.get(item.address) ?? null,
          publisherRep: item.reputation.publisher,
          workerRep: item.reputation.worker,
          supervisorRep: item.reputation.supervisor,
          tasksPublishedCount: item.stats.tasksPublished,
          tasksIntentedCount: item.stats.tasksIntented,
          tasksCompletedCount: item.stats.tasksCompleted,
          tasksTerminatedCount: item.stats.tasksTerminated,
          submissionsRejectedCount: item.stats.submissionsRejected,
          supervisionVotesCount: item.stats.supervisionVotes,
          latestActivityAt: nextLatestActivityAtByAddress.get(item.address)
            ? toDate(nextLatestActivityAtByAddress.get(item.address)!)
            : null,
          createdAt: toDate(item.createdAt),
          updatedAt: toDate(item.updatedAt)
        }
      });
    }

    for (const item of balanceDiff.upserts) {
      await tx.ledgerBalance.upsert({
        where: { address: item.address },
        create: {
          address: item.address,
          available: item.available,
          updatedAt: toDate(item.updatedAt)
        },
        update: {
          available: item.available,
          updatedAt: toDate(item.updatedAt)
        }
      });
    }

    for (const item of taskDiff.upserts) {
      await tx.task.upsert({
        where: { id: item.id },
        create: {
          id: item.id,
          publisherAddress: item.publisher,
          title: item.title,
          descriptionMd: item.descriptionMd,
          acceptanceCriteria: item.acceptanceCriteria,
          status: item.status,
          deadlineUtc: toDate(item.deadlineUtc),
          displayTimezone: item.displayTimezone,
          slotsTotal: item.slotsTotal,
          rewardPerSlot: item.rewardPerSlot,
          allowRepeatCompletionsBySameAgent: item.allowRepeatCompletionsBySameAgent,
          taxAmount: item.taxAmount,
          rewardEscrowRemaining: item.rewardEscrowRemaining,
          intentCount: item.intentCount,
          completedAgents: toJsonAddressArray(item.completedAgents),
          createdAt: toDate(item.createdAt),
          updatedAt: toDate(item.updatedAt)
        },
        update: {
          publisherAddress: item.publisher,
          title: item.title,
          descriptionMd: item.descriptionMd,
          acceptanceCriteria: item.acceptanceCriteria,
          status: item.status,
          deadlineUtc: toDate(item.deadlineUtc),
          displayTimezone: item.displayTimezone,
          slotsTotal: item.slotsTotal,
          rewardPerSlot: item.rewardPerSlot,
          allowRepeatCompletionsBySameAgent: item.allowRepeatCompletionsBySameAgent,
          taxAmount: item.taxAmount,
          rewardEscrowRemaining: item.rewardEscrowRemaining,
          intentCount: item.intentCount,
          completedAgents: toJsonAddressArray(item.completedAgents),
          createdAt: toDate(item.createdAt),
          updatedAt: toDate(item.updatedAt)
        }
      });
    }

    for (const item of intentionDiff.upserts) {
      await tx.taskIntention.upsert({
        where: { id: item.id },
        create: {
          id: item.id,
          taskId: item.taskId,
          agentAddress: item.agent,
          createdAt: toDate(item.createdAt)
        },
        update: {
          taskId: item.taskId,
          agentAddress: item.agent,
          createdAt: toDate(item.createdAt)
        }
      });
    }

    for (const item of submissionDiff.upserts) {
      await tx.submission.upsert({
        where: { id: item.id },
        create: {
          id: item.id,
          taskId: item.taskId,
          agentAddress: item.agent,
          payloadMd: item.payloadMd,
          attachments: toJsonSubmissionAttachments(item.attachments),
          rejectReasonMd: item.rejectReasonMd ?? null,
          status: item.status,
          createdAt: toDate(item.createdAt),
          updatedAt: toDate(item.updatedAt)
        },
        update: {
          taskId: item.taskId,
          agentAddress: item.agent,
          payloadMd: item.payloadMd,
          attachments: toJsonSubmissionAttachments(item.attachments),
          rejectReasonMd: item.rejectReasonMd ?? null,
          status: item.status,
          createdAt: toDate(item.createdAt),
          updatedAt: toDate(item.updatedAt)
        }
      });
    }

    for (const item of disputeDiff.upserts) {
      const resolutionMeta = nextDisputeResolutionMetaById.get(item.id);
      await tx.dispute.upsert({
        where: { id: item.id },
        create: {
          id: item.id,
          taskId: item.taskId,
          submissionId: item.submissionId,
          openerAddress: item.opener,
          reasonMd: item.reasonMd,
          counterpartyResponderAddress: item.counterpartyResponder ?? null,
          counterpartyReasonMd: item.counterpartyReasonMd ?? null,
          status: item.status,
          resolutionPayoutSource: resolutionMeta?.payoutSource ?? null,
          resolutionPayoutAmount: resolutionMeta?.payoutAmount ?? null,
          resolutionPayoutShortfallAmount: resolutionMeta?.payoutShortfallAmount ?? null,
          resolutionPublisherBanned: resolutionMeta?.publisherBanned ?? null,
          resolutionRollbackSnapshot: toJsonDisputeResolutionRollback(
            (resolutionMeta?.rollback as DisputeResolutionRollbackRecord | null | undefined) ?? null
          ),
          createdAt: toDate(item.createdAt),
          updatedAt: toDate(item.updatedAt)
        },
        update: {
          taskId: item.taskId,
          submissionId: item.submissionId,
          openerAddress: item.opener,
          reasonMd: item.reasonMd,
          counterpartyResponderAddress: item.counterpartyResponder ?? null,
          counterpartyReasonMd: item.counterpartyReasonMd ?? null,
          status: item.status,
          resolutionPayoutSource: resolutionMeta?.payoutSource ?? null,
          resolutionPayoutAmount: resolutionMeta?.payoutAmount ?? null,
          resolutionPayoutShortfallAmount: resolutionMeta?.payoutShortfallAmount ?? null,
          resolutionPublisherBanned: resolutionMeta?.publisherBanned ?? null,
          resolutionRollbackSnapshot: toJsonDisputeResolutionRollback(
            (resolutionMeta?.rollback as DisputeResolutionRollbackRecord | null | undefined) ?? null
          ),
          createdAt: toDate(item.createdAt),
          updatedAt: toDate(item.updatedAt)
        }
      });
    }

    const disputeIdsUpdatedByRow = new Set(disputeDiff.upserts.map((item) => item.id));
    const disputeMetaOnlyUpdateIds = new Set([
      ...disputeResolutionDiff.upserts.map((item) => item.disputeId),
      ...disputeResolutionDiff.deletes
    ]);
    for (const disputeId of disputeMetaOnlyUpdateIds) {
      if (disputeIdsUpdatedByRow.has(disputeId)) {
        continue;
      }
      const resolutionMeta = nextDisputeResolutionMetaById.get(disputeId);
      await tx.dispute.update({
        where: { id: disputeId },
        data: {
          resolutionPayoutSource: resolutionMeta?.payoutSource ?? null,
          resolutionPayoutAmount: resolutionMeta?.payoutAmount ?? null,
          resolutionPayoutShortfallAmount: resolutionMeta?.payoutShortfallAmount ?? null,
          resolutionPublisherBanned: resolutionMeta?.publisherBanned ?? null,
          resolutionRollbackSnapshot: toJsonDisputeResolutionRollback(
            (resolutionMeta?.rollback as DisputeResolutionRollbackRecord | null | undefined) ?? null
          )
        }
      });
    }

    for (const item of disputeRollbackHistoryDiff.upserts) {
      const rollbackHistory = nextDisputeRollbackHistoryById.get(item.id);
      if (!rollbackHistory) {
        continue;
      }
      await tx.disputeRollbackHistory.upsert({
        where: { id: rollbackHistory.id },
        create: {
          id: rollbackHistory.id,
          disputeId: rollbackHistory.disputeId,
          previousStatus: rollbackHistory.previousStatus,
          previousResolutionPayoutSource: rollbackHistory.previousResolution?.payoutSource ?? null,
          previousResolutionPayoutAmount: rollbackHistory.previousResolution?.payoutAmount ?? null,
          previousResolutionPayoutShortfallAmount:
            rollbackHistory.previousResolution?.payoutShortfallAmount ?? null,
          previousResolutionPublisherBanned: rollbackHistory.previousResolution?.publisherBanned ?? null,
          previousResolutionRollbackSnapshot: toJsonDisputeResolutionRollback(
            rollbackHistory.previousResolution?.rollback ?? null
          ),
          archivedVotes: toJsonRollbackHistoryEntries(rollbackHistory.archivedVotes),
          archivedWorkloads: toJsonRollbackHistoryEntries(rollbackHistory.archivedWorkloads),
          archivedActivities: toJsonRollbackHistoryEntries(rollbackHistory.archivedActivities),
          reopenedAt: toDate(rollbackHistory.reopenedAt)
        },
        update: {
          disputeId: rollbackHistory.disputeId,
          previousStatus: rollbackHistory.previousStatus,
          previousResolutionPayoutSource: rollbackHistory.previousResolution?.payoutSource ?? null,
          previousResolutionPayoutAmount: rollbackHistory.previousResolution?.payoutAmount ?? null,
          previousResolutionPayoutShortfallAmount:
            rollbackHistory.previousResolution?.payoutShortfallAmount ?? null,
          previousResolutionPublisherBanned: rollbackHistory.previousResolution?.publisherBanned ?? null,
          previousResolutionRollbackSnapshot: toJsonDisputeResolutionRollback(
            rollbackHistory.previousResolution?.rollback ?? null
          ),
          archivedVotes: toJsonRollbackHistoryEntries(rollbackHistory.archivedVotes),
          archivedWorkloads: toJsonRollbackHistoryEntries(rollbackHistory.archivedWorkloads),
          archivedActivities: toJsonRollbackHistoryEntries(rollbackHistory.archivedActivities),
          reopenedAt: toDate(rollbackHistory.reopenedAt)
        }
      });
    }

    const banSourceProfileIds = new Set([
      ...banSourceDiff.upserts.map((item) => item[0]),
      ...banSourceDiff.deletes
    ]);
    for (const address of banSourceProfileIds) {
      if (profileDiff.upserts.some((item) => item.address === address)) {
        continue;
      }
      await tx.agentProfile.update({
        where: { address },
        data: {
          banSourceDisputeId: nextBanSourceByPublisher.get(address as Address) ?? null
        }
      });
    }

    for (const item of voteDiff.upserts) {
      await tx.supervisionVote.upsert({
        where: { id: item.id },
        create: {
          id: item.id,
          disputeId: item.disputeId,
          agentAddress: item.agent,
          vote: item.vote,
          weightSnapshot: item.weightSnapshot,
          createdCycleId: item.createdCycleId,
          createdAt: toDate(item.createdAt)
        },
        update: {
          disputeId: item.disputeId,
          agentAddress: item.agent,
          vote: item.vote,
          weightSnapshot: item.weightSnapshot,
          createdCycleId: item.createdCycleId,
          createdAt: toDate(item.createdAt)
        }
      });
    }

    for (const item of workloadDiff.upserts) {
      await tx.cycleWorkload.upsert({
        where: { id: item.id },
        create: {
          id: item.id,
          cycleId: item.cycleId,
          disputeId: item.disputeId,
          taskId: item.taskId ?? null,
          agentAddress: item.agent,
          workload: item.workload,
          createdAt: toDate(item.createdAt),
          settledAt: item.settledAt ? toDate(item.settledAt) : null
        },
        update: {
          cycleId: item.cycleId,
          disputeId: item.disputeId,
          taskId: item.taskId ?? null,
          agentAddress: item.agent,
          workload: item.workload,
          createdAt: toDate(item.createdAt),
          settledAt: item.settledAt ? toDate(item.settledAt) : null
        }
      });
    }

    for (const item of activityDiff.upserts) {
      await tx.activityEvent.upsert({
        where: { id: item.id },
        create: {
          id: item.id,
          type: item.type,
          cycleId: item.cycleId,
          taskId: item.taskId,
          disputeId: item.disputeId,
          actorAddress: item.actor,
          createdAt: toDate(item.createdAt)
        },
        update: {
          type: item.type,
          cycleId: item.cycleId,
          taskId: item.taskId,
          disputeId: item.disputeId,
          actorAddress: item.actor,
          createdAt: toDate(item.createdAt)
        }
      });
    }

    if (includeProfiles || includeActivities) {
      const activityTouchedProfiles = new Set<Address>([
        ...activityDiff.upserts.map((item) => item.actor),
        ...activityDiff.deletes
          .map((id) => currentSnapshot?.activities.find((item) => item.id === id)?.actor ?? null)
          .filter((item): item is Address => item !== null)
      ]);
      for (const address of activityTouchedProfiles) {
        if (profileDiff.deletes.includes(address)) {
          continue;
        }
        await tx.agentProfile.update({
          where: { address },
          data: {
            latestActivityAt: nextLatestActivityAtByAddress.get(address)
              ? toDate(nextLatestActivityAtByAddress.get(address)!)
              : null
          }
        });
      }
    }

    if (workloadDiff.deletes.length > 0) {
      await tx.cycleWorkload.deleteMany({ where: { id: { in: workloadDiff.deletes } } });
    }
    if (activityDiff.deletes.length > 0) {
      await tx.activityEvent.deleteMany({ where: { id: { in: activityDiff.deletes } } });
    }
    if (voteDiff.deletes.length > 0) {
      await tx.supervisionVote.deleteMany({ where: { id: { in: voteDiff.deletes } } });
    }
    if (disputeRollbackHistoryDiff.deletes.length > 0) {
      await tx.disputeRollbackHistory.deleteMany({ where: { id: { in: disputeRollbackHistoryDiff.deletes } } });
    }
    if (disputeDiff.deletes.length > 0) {
      await tx.dispute.deleteMany({ where: { id: { in: disputeDiff.deletes } } });
    }
    if (submissionDiff.deletes.length > 0) {
      await tx.submission.deleteMany({ where: { id: { in: submissionDiff.deletes } } });
    }
    if (intentionDiff.deletes.length > 0) {
      await tx.taskIntention.deleteMany({ where: { id: { in: intentionDiff.deletes } } });
    }
    if (taskDiff.deletes.length > 0) {
      await tx.task.deleteMany({ where: { id: { in: taskDiff.deletes } } });
    }
    if (balanceDiff.deletes.length > 0) {
      await tx.ledgerBalance.deleteMany({ where: { address: { in: balanceDiff.deletes } } });
    }
    if (profileDiff.deletes.length > 0) {
      await tx.activityEvent.deleteMany({ where: { actorAddress: { in: profileDiff.deletes } } });
      await tx.agentProfile.deleteMany({ where: { address: { in: profileDiff.deletes } } });
    }
    if (cycleDiff.deletes.length > 0) {
      await tx.cycle.deleteMany({ where: { id: { in: cycleDiff.deletes } } });
    }

    await this.touchRuntimeStateWithTx(tx, nextSnapshot.activeCycleId);
  }

  private async ensureAgentAndLedgerWithTx(
    tx: Prisma.TransactionClient,
    address: Address,
    now: Date
  ): Promise<void> {
    await ensureAgentAndLedgerWithTx(tx, address, now, this.config.initialAgentBalance);
  }

  private async appendActivityEventWithTx(
    tx: Prisma.TransactionClient,
    input: {
      type: DomainActivityEventType;
      cycleId: string;
      taskId: string | null;
      disputeId: string | null;
      actor: Address;
      createdAt: Date;
    }
  ): Promise<void> {
    await appendActivityEventWithTx(tx, input);
  }

  private async deleteActivityEventsAndRefreshLatestWithTx(
    tx: Prisma.TransactionClient,
    where: Prisma.ActivityEventWhereInput
  ): Promise<void> {
    const affectedActors = await tx.activityEvent.findMany({
      where,
      select: { actorAddress: true }
    });
    if (affectedActors.length === 0) {
      return;
    }

    await tx.activityEvent.deleteMany({ where });
    await this.refreshLatestActivityForAgentsWithTx(
      tx,
      affectedActors.map((item) => asAddress(item.actorAddress))
    );
  }

  private async refreshLatestActivityForAgentsWithTx(
    tx: Prisma.TransactionClient,
    addresses: Address[]
  ): Promise<void> {
    const uniqueAddresses = [...new Set(addresses)];
    if (uniqueAddresses.length === 0) {
      return;
    }

    const latestRows = await tx.activityEvent.groupBy({
      by: ["actorAddress"],
      where: {
        actorAddress: {
          in: uniqueAddresses
        }
      },
      _max: {
        createdAt: true
      }
    });
    const latestByAddress = new Map(
      latestRows.map((item) => [item.actorAddress, item._max.createdAt ?? null])
    );

    for (const address of uniqueAddresses) {
      await tx.agentProfile.updateMany({
        where: { address },
        data: {
          latestActivityAt: latestByAddress.get(address) ?? null
        }
      });
    }
  }

  private async applyProfileDeltaWithTx(
    tx: Prisma.TransactionClient,
    address: Address,
    now: Date,
    input: {
      publisherReputationDelta?: number;
      workerReputationDelta?: number;
      supervisorReputationDelta?: number;
      tasksPublished?: number;
      tasksIntented?: number;
      tasksCompleted?: number;
      tasksTerminated?: number;
      submissionsRejected?: number;
      supervisionVotes?: number;
    }
  ): Promise<void> {
    await applyProfileDeltaWithTx(tx, address, now, input);
  }

  private getConfirmedSlots(
    slotsTotal: number,
    rewardPerSlot: number,
    rewardEscrowRemaining: number
  ): number {
    return getConfirmedSlots(slotsTotal, rewardPerSlot, rewardEscrowRemaining);
  }

  private async touchRuntimeStateWithTx(
    tx: Prisma.TransactionClient,
    activeCycleId?: string
  ): Promise<void> {
    await touchRuntimeStateWithTx(tx, RUNTIME_ID, activeCycleId);
  }

  private async queryActivityMetrics(whereSql: Prisma.Sql): Promise<DashboardMetricSnapshot> {
    const rows = await this.prisma.$queryRaw<DashboardMetricRow[]>(Prisma.sql`
      SELECT
        COUNT(*) FILTER (WHERE type = CAST(${DomainActivityEventType.TASK_PUBLISHED} AS "ActivityEventType")) AS "tasksPublished",
        COUNT(*) FILTER (WHERE type = CAST(${DomainActivityEventType.TASK_INTENDED} AS "ActivityEventType")) AS "tasksIntented",
        COUNT(*) FILTER (WHERE type = CAST(${DomainActivityEventType.TASK_COMPLETED} AS "ActivityEventType")) AS "tasksCompleted",
        COUNT(*) FILTER (WHERE type = CAST(${DomainActivityEventType.DISPUTE_OPENED} AS "ActivityEventType")) AS "disputesOpened"
      FROM "ActivityEvent"
      ${whereSql}
    `);

    const row = rows[0];
    return {
      tasksPublished: toNumber(row?.tasksPublished),
      tasksIntented: toNumber(row?.tasksIntented),
      tasksCompleted: toNumber(row?.tasksCompleted),
      disputesOpened: toNumber(row?.disputesOpened)
    };
  }

  private async queryActivityMetricsByCreatedAtRange(
    from: Date,
    to: Date
  ): Promise<DashboardMetricSnapshot> {
    return this.queryActivityMetrics(
      Prisma.sql`WHERE "createdAt" >= ${from} AND "createdAt" < ${to}`
    );
  }

  async close(): Promise<void> {
    await Promise.all([this.prisma.$disconnect(), this.workerLockPrisma.$disconnect()]);
  }

  private async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    await this.ensurePersistenceGuards();
    let attempt = 0;

    while (true) {
      try {
        return await operation();
      } catch (error) {
        if (!this.isRetryableSerializationError(error) || attempt >= MAX_SERIALIZABLE_RETRIES) {
          throw error;
        }
        attempt += 1;
        const baseDelay = SERIALIZABLE_RETRY_BACKOFF_MS * 2 ** (attempt - 1);
        const backoffMs = Math.min(MAX_SERIALIZABLE_RETRY_BACKOFF_MS, baseDelay);
        await this.sleep(backoffMs);
      }
    }
  }

  private isRetryableSerializationError(error: unknown): boolean {
    const prismaCode =
      error && typeof error === "object" && "code" in error ? String(error.code ?? "") : "";

    if (prismaCode === "P2034") {
      return true;
    }
    if (
      prismaCode === "P2010" &&
      error &&
      typeof error === "object" &&
      "meta" in error &&
      typeof error.meta === "object" &&
      error.meta !== null &&
      "code" in error.meta &&
      ["40001", "40P01"].includes(String(error.meta.code ?? ""))
    ) {
      return true;
    }

    const message = String(
      error && typeof error === "object" && "message" in error ? error.message ?? "" : ""
    );
    return (
      message.includes("40001") ||
      message.includes("40P01") ||
      message.includes("could not serialize access") ||
      message.includes("deadlock detected")
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async ensurePersistenceGuards(): Promise<void> {
    if (!this.ensurePersistenceGuardsEnabled) {
      return;
    }
    if (!this.persistenceGuardsPromise) {
      this.persistenceGuardsPromise = this.prisma
        .$executeRawUnsafe(
          `CREATE UNIQUE INDEX IF NOT EXISTS "${OPEN_DISPUTE_UNIQUE_INDEX}" ` +
            `ON "Dispute" ("submissionId") ` +
            `WHERE "status" = '${DomainDisputeStatus.OPEN}'::"DisputeStatus"`
        )
        .then(() => undefined);
    }
    await this.persistenceGuardsPromise;
  }

  private async withAdvisoryLock<T>(
    lockKey: number,
    operation: () => Promise<T>
  ): Promise<{ acquired: boolean; result: T | null }> {
    if (this.inProcessWorkerLocks.has(lockKey)) {
      return {
        acquired: false,
        result: null
      };
    }

    this.inProcessWorkerLocks.add(lockKey);
    // Session-scoped advisory locks must be acquired and released on the same connection.
    // PostgreSQL treats a repeated lock on the same session as reentrant, so
    // guard the process before touching the single worker-lock connection.
    let acquired = false;
    try {
      const rows = await this.workerLockPrisma.$queryRaw<Array<{ locked: boolean }>>(
        Prisma.sql`SELECT pg_try_advisory_lock(${lockKey}) AS locked`
      );
      acquired = rows[0]?.locked === true;
      if (!acquired) {
        return {
          acquired: false,
          result: null
        };
      }

      return {
        acquired: true,
        result: await operation()
      };
    } finally {
      try {
        if (acquired) {
          await this.workerLockPrisma.$queryRaw(Prisma.sql`SELECT pg_advisory_unlock(${lockKey})`);
        }
      } finally {
        this.inProcessWorkerLocks.delete(lockKey);
      }
    }
  }

  private cloneSnapshot(snapshot: EngineStateSnapshot): EngineStateSnapshot {
    return JSON.parse(JSON.stringify(snapshot)) as EngineStateSnapshot;
  }

  private async loadWithTx(tx: Prisma.TransactionClient): Promise<EngineStateSnapshot | null> {
    const runtime = await tx.runtimeState.findUnique({ where: { id: RUNTIME_ID } });
    if (!runtime) {
      return null;
    }

    const [
      profiles,
      balances,
      tasks,
      taskIntentions,
      submissions,
      disputes,
      disputeRollbackHistory,
      votes,
      cycleWorkloads,
      cycles,
      activities
    ] =
      await Promise.all([
        tx.agentProfile.findMany(),
        tx.ledgerBalance.findMany(),
        tx.task.findMany(),
        tx.taskIntention.findMany(),
        tx.submission.findMany(),
        tx.dispute.findMany(),
        tx.disputeRollbackHistory.findMany({ orderBy: [{ reopenedAt: "asc" }, { id: "asc" }] }),
        tx.supervisionVote.findMany(),
        tx.cycleWorkload.findMany(),
        tx.cycle.findMany(),
        tx.activityEvent.findMany()
      ]);

    const mappedProfiles = profiles.map((item) => ({
      address: asAddress(item.address),
      name: item.name,
      bio: item.bio,
      status: item.status as AgentStatus,
      bannedAt: item.bannedAt ? toIso(item.bannedAt) : null,
      banReasonCode: item.banReasonCode as AgentBanReason | null,
      reputation: {
        publisher: item.publisherRep,
        worker: item.workerRep,
        supervisor: item.supervisorRep
      },
      stats: {
        tasksPublished: item.tasksPublishedCount,
        tasksIntented: item.tasksIntentedCount,
        tasksCompleted: item.tasksCompletedCount,
        tasksTerminated: item.tasksTerminatedCount,
        submissionsRejected: item.submissionsRejectedCount,
        supervisionVotes: item.supervisionVotesCount
      },
      createdAt: toIso(item.createdAt),
      updatedAt: toIso(item.updatedAt)
    })) satisfies EngineStateSnapshot["profiles"];
    const banSourceDisputeByPublisher = (
      profiles
        .filter((item) => typeof item.banSourceDisputeId === "string" && item.banSourceDisputeId.length > 0)
        .map((item) => [asAddress(item.address), item.banSourceDisputeId as string] as [Address, string])
    ) satisfies NonNullable<EngineStateSnapshot["banSourceDisputeByPublisher"]>;

    const mappedBalances = balances.map((item) => ({
      address: asAddress(item.address),
      available: item.available,
      updatedAt: toIso(item.updatedAt)
    })) satisfies EngineStateSnapshot["balances"];

    const mappedTasks = tasks.map((item) => ({
      id: item.id,
      publisher: asAddress(item.publisherAddress),
      title: item.title,
      descriptionMd: item.descriptionMd,
      acceptanceCriteria: item.acceptanceCriteria,
      status: item.status as unknown as DomainTaskStatus,
      deadlineUtc: toIso(item.deadlineUtc),
      displayTimezone: item.displayTimezone,
      slotsTotal: item.slotsTotal,
      rewardPerSlot: item.rewardPerSlot,
      allowRepeatCompletionsBySameAgent: item.allowRepeatCompletionsBySameAgent,
      taxAmount: item.taxAmount,
      rewardEscrowRemaining: item.rewardEscrowRemaining,
      intentCount: item.intentCount,
      competitionRatio: computeTaskCompetitionRatio({
        slotsTotal: item.slotsTotal,
        rewardPerSlot: item.rewardPerSlot,
        rewardEscrowRemaining: item.rewardEscrowRemaining,
        intentCount: item.intentCount
      }),
      completedAgents: asAddressArray(item.completedAgents),
      createdAt: toIso(item.createdAt),
      updatedAt: toIso(item.updatedAt)
    })) satisfies EngineStateSnapshot["tasks"];

    const mappedIntentions = taskIntentions.map((item) => ({
      id: item.id,
      taskId: item.taskId,
      agent: asAddress(item.agentAddress),
      createdAt: toIso(item.createdAt)
    })) satisfies NonNullable<EngineStateSnapshot["intentions"]>;

    const mappedSubmissions = submissions.map((item) => mapSubmission(item)) satisfies EngineStateSnapshot["submissions"];

    const mappedDisputes = disputes.map((item) => ({
      id: item.id,
      taskId: item.taskId,
      submissionId: item.submissionId,
      opener: asAddress(item.openerAddress),
      reasonMd: item.reasonMd,
      counterpartyResponder: item.counterpartyResponderAddress
        ? asAddress(item.counterpartyResponderAddress)
        : null,
      counterpartyReasonMd: item.counterpartyReasonMd,
      status: item.status as unknown as DomainDisputeStatus,
      createdAt: toIso(item.createdAt),
      updatedAt: toIso(item.updatedAt)
    })) satisfies EngineStateSnapshot["disputes"];
    const disputeResolutionMeta = disputes
      .filter(
        (item) =>
          item.resolutionPayoutSource !== null ||
          item.resolutionPayoutAmount !== null ||
          item.resolutionPayoutShortfallAmount !== null ||
          item.resolutionPublisherBanned !== null
      )
      .map((item) => ({
        disputeId: item.id,
        payoutSource: (item.resolutionPayoutSource ?? DisputePayoutSource.ESCROW) as DisputePayoutSource,
        payoutAmount: item.resolutionPayoutAmount ?? 0,
        payoutShortfallAmount: item.resolutionPayoutShortfallAmount ?? 0,
        publisherBanned: item.resolutionPublisherBanned ?? false,
        rollback: asDisputeResolutionRollback(item.resolutionRollbackSnapshot)
      })) satisfies NonNullable<EngineStateSnapshot["disputeResolutionMeta"]>;
    const mappedDisputeRollbackHistory = disputeRollbackHistory.map((item) => ({
      id: item.id,
      disputeId: item.disputeId,
      previousStatus: item.previousStatus as DomainDisputeStatus,
      previousResolution:
        item.previousResolutionPayoutSource !== null ||
        item.previousResolutionPayoutAmount !== null ||
        item.previousResolutionPayoutShortfallAmount !== null ||
        item.previousResolutionPublisherBanned !== null
          ? {
              disputeId: item.disputeId,
              payoutSource: (item.previousResolutionPayoutSource ?? DisputePayoutSource.ESCROW) as DisputePayoutSource,
              payoutAmount: item.previousResolutionPayoutAmount ?? 0,
              payoutShortfallAmount: item.previousResolutionPayoutShortfallAmount ?? 0,
              publisherBanned: item.previousResolutionPublisherBanned ?? false,
              rollback: asDisputeResolutionRollback(item.previousResolutionRollbackSnapshot)
            }
          : null,
      archivedVotes: asDisputeRollbackHistoryArray<SupervisionVote>(item.archivedVotes),
      archivedWorkloads: asDisputeRollbackHistoryArray<CycleWorkload>(item.archivedWorkloads),
      archivedActivities: asDisputeRollbackHistoryArray<ActivityEvent>(item.archivedActivities),
      reopenedAt: toIso(item.reopenedAt)
    })) satisfies NonNullable<EngineStateSnapshot["disputeRollbackHistory"]>;

    const mappedVotes = votes.map((item) => ({
      id: item.id,
      disputeId: item.disputeId,
      agent: asAddress(item.agentAddress),
      vote: item.vote as unknown as DomainVoteChoice,
      weightSnapshot: item.weightSnapshot,
      createdCycleId: item.createdCycleId,
      createdAt: toIso(item.createdAt)
    })) satisfies EngineStateSnapshot["votes"];

    const mappedCycleWorkloads = cycleWorkloads.map((item) => ({
      id: item.id,
      cycleId: item.cycleId,
      disputeId: item.disputeId,
      taskId: item.taskId,
      agent: asAddress(item.agentAddress),
      workload: item.workload,
      createdAt: toIso(item.createdAt),
      settledAt: item.settledAt ? toIso(item.settledAt) : null
    })) satisfies EngineStateSnapshot["cycleWorkloads"];

    const mappedCycles = cycles.map((item) => ({
      id: item.id,
      status: item.status as unknown as DomainCycleStatus,
      mintedAmount: item.mintedAmount,
      taxPool: item.taxPool,
      penaltyPool: item.penaltyPool,
      startedAt: toIso(item.startedAt),
      closedAt: item.closedAt ? toIso(item.closedAt) : null
    })) satisfies EngineStateSnapshot["cycles"];

    const mappedActivities = activities.map((item) => ({
      id: item.id,
      type: item.type as unknown as DomainActivityEventType,
      cycleId: item.cycleId,
      taskId: item.taskId,
      disputeId: item.disputeId,
      actor: asAddress(item.actorAddress),
      createdAt: toIso(item.createdAt)
    })) satisfies EngineStateSnapshot["activities"];

    const votesByDisputeAndAgent = mappedVotes.map((item) => [`${item.disputeId}:${item.agent}`, item.id] as [string, string]);

    const latestSubmissionByTaskAndAgentMap = new Map<string, { submissionId: string; createdAt: string }>();
    for (const submission of mappedSubmissions) {
      const key = `${submission.taskId}:${submission.agent}`;
      const existing = latestSubmissionByTaskAndAgentMap.get(key);
      if (!existing || existing.createdAt < submission.createdAt) {
        latestSubmissionByTaskAndAgentMap.set(key, {
          submissionId: submission.id,
          createdAt: submission.createdAt
        });
      }
    }
    const latestSubmissionByTaskAndAgent = [...latestSubmissionByTaskAndAgentMap.entries()].map(
      ([key, value]) => [key, value.submissionId] as [string, string]
    );

    return {
      version: 1,
      activeCycleId: runtime.activeCycleId,
      profiles: mappedProfiles,
      balances: mappedBalances,
      tasks: mappedTasks,
      submissions: mappedSubmissions,
      disputes: mappedDisputes,
      disputeResolutionMeta,
      disputeRollbackHistory: mappedDisputeRollbackHistory,
      votes: mappedVotes,
      votesByDisputeAndAgent,
      cycleWorkloads: mappedCycleWorkloads,
      cycles: mappedCycles,
      activities: mappedActivities,
      intentions: mappedIntentions,
      latestSubmissionByTaskAndAgent,
      banSourceDisputeByPublisher
    };
  }
}
