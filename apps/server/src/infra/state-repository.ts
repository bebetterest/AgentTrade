import { Prisma, PrismaClient } from "@prisma/client";
import { defaultConfig, type AppConfig } from "@agentrade/config";
import type { EngineStateSnapshot } from "../domain/engine.js";
import {
  type ActivityEvent,
  type AgentDirectoryItem,
  ActivityEventType as DomainActivityEventType,
  type AgentProfile,
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
  type DisputeResolutionSummary,
  DisputeStatus as DomainDisputeStatus,
  type LedgerBalance,
  type PaginatedResponse,
  type Submission,
  SubmissionStatus as DomainSubmissionStatus,
  type SupervisionVote,
  type Task,
  type TaskIntention,
  TaskStatus as DomainTaskStatus,
  VoteChoice as DomainVoteChoice,
  VoteChoice,
  type Address
} from "@agentrade/types";
import {
  allocateIntegerPool
} from "../domain/helpers.js";
import { DomainError } from "../domain/errors.js";
import {
  computeTaskCompetitionRatio,
  mapAgentProfile,
  mapCycle,
  mapCycleWorkload,
  mapDispute,
  mapLedgerBalance,
  mapSubmission,
  mapTask,
  mapTaskIntention,
  mapVote
} from "./state-repository-mappers.js";
import {
  appendActivityEventWithTx,
  applyProfileDeltaWithTx,
  ensureAgentAndLedgerWithTx,
  getConfirmedSlots,
  lockRuntimeWithTx,
  touchRuntimeStateWithTx
} from "./state-repository-tx-helpers.js";
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
  encodeKeysetCursor,
  nextCursorOffset,
  parseListCursor
} from "../pagination/cursor.js";
import {
  type OpenDisputeDirectInput,
  type PublishTaskDirectInput,
  type SubmitTaskDirectInput,
  type VoteDisputeDirectInput,
  writeAddTaskIntentionDirect,
  writeCloseCurrentCycleDirect,
  writeConfirmSubmissionDirect,
  writeOpenDisputeDirect,
  writeOverrideDisputeDirect,
  writePublishTaskDirect,
  writeRejectSubmissionDirect,
  writeSubmitTaskDirect,
  writeTerminateTaskDirect,
  writeVoteDisputeDirect,
  writeUpdateAgentProfileDirect
} from "./state-repository-write-helpers.js";

const RUNTIME_ID = "singleton";
const OPEN_DISPUTE_UNIQUE_INDEX = "uq_dispute_open_submission";
const MAX_SERIALIZABLE_RETRIES = 20;
const SERIALIZABLE_RETRY_BACKOFF_MS = 10;
const MAX_SERIALIZABLE_RETRY_BACKOFF_MS = 200;

const toDate = (value: string): Date => new Date(value);
const toIso = (value: Date): string => value.toISOString();
const asAddress = (value: string): Address => value as Address;
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

interface DashboardMetricRow {
  tasksPublished: number | bigint | Prisma.Decimal | string | null;
  tasksIntented: number | bigint | Prisma.Decimal | string | null;
  tasksCompleted: number | bigint | Prisma.Decimal | string | null;
  disputesOpened: number | bigint | Prisma.Decimal | string | null;
}

interface DashboardTrendRow extends DashboardMetricRow {
  label: string;
  bucketStart: string;
}

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

export class PersistenceConflictError extends Error {
  readonly code = "PERSISTENCE_CONFLICT";

  constructor(message = "persistence state changed concurrently") {
    super(message);
    this.name = "PersistenceConflictError";
  }
}

export class PrismaStateRepository {
  private prisma: PrismaClient;
  private readonly config: AppConfig;
  private persistenceGuardsPromise: Promise<void> | null = null;

  constructor(databaseUrl: string, config: AppConfig = defaultConfig) {
    this.prisma = new PrismaClient({
      datasources: {
        db: {
          url: databaseUrl
        }
      }
    });
    this.config = config;
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

  async queryAgentsDirect(query: AgentListQuery): Promise<PaginatedResponse<AgentDirectoryItem>> {
    return queryAgentsDirect(this.prisma, query, this.config);
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
        submissionId: true
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
        select: { publisherAddress: true }
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

    return {
      totalVotes: completedVotes + notCompletedVotes,
      completedVotes,
      notCompletedVotes,
      outcome,
      winnerRole,
      winnerAddress
    };
  }

  async getAgentDirect(address: Address): Promise<AgentProfile | null> {
    return readGetAgentDirect(this.prisma, address);
  }

  async updateAgentProfileDirect(
    address: Address,
    payload: { name?: string; bio?: string }
  ): Promise<AgentProfile> {
    const profile = await writeUpdateAgentProfileDirect(
      this.prisma,
      {
        executeWithRetry: (operation) => this.executeWithRetry(operation),
        lockRuntimeWithTx: (tx) => this.lockRuntimeWithTx(tx),
        ensureAgentAndLedgerWithTx: (tx, nextAddress, now) =>
          this.ensureAgentAndLedgerWithTx(tx, nextAddress, now),
        touchRuntimeStateWithTx: (tx) => this.touchRuntimeStateWithTx(tx)
      },
      address,
      payload
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
    const [activeCycle, today, totals, currentCycle] = await Promise.all([
      this.getActiveCycleDirect(),
      this.queryActivityMetrics(
        Prisma.sql`WHERE timezone(${timeZone}, "createdAt")::date = timezone(${timeZone}, CURRENT_TIMESTAMP)::date`
      ),
      Promise.all([
        this.prisma.task.count(),
        this.prisma.dispute.count(),
        this.prisma.agentProfile.count()
      ]),
      this.getActiveCycleDirect().then((cycle) =>
        this.queryActivityMetrics(
          cycle ? Prisma.sql`WHERE "cycleId" = ${cycle.id}` : Prisma.sql`WHERE 1 = 0`
        )
      )
    ]);

    if (!activeCycle) {
      throw new Error("active cycle is unavailable");
    }

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
    const rows = await this.prisma.$queryRaw<DashboardTrendRow[]>(Prisma.sql`
      WITH day_series AS (
        SELECT generate_series(
          date_trunc('day', timezone(${timeZone}, CURRENT_TIMESTAMP)) - (${windowSize - 1} * interval '1 day'),
          date_trunc('day', timezone(${timeZone}, CURRENT_TIMESTAMP)),
          interval '1 day'
        ) AS local_day
      ),
      activity_counts AS (
        SELECT
          date_trunc('day', timezone(${timeZone}, "createdAt")) AS local_day,
          COUNT(*) FILTER (WHERE type = CAST(${DomainActivityEventType.TASK_PUBLISHED} AS "ActivityEventType")) AS "tasksPublished",
          COUNT(*) FILTER (WHERE type = CAST(${DomainActivityEventType.TASK_INTENDED} AS "ActivityEventType")) AS "tasksIntented",
          COUNT(*) FILTER (WHERE type = CAST(${DomainActivityEventType.TASK_COMPLETED} AS "ActivityEventType")) AS "tasksCompleted",
          COUNT(*) FILTER (WHERE type = CAST(${DomainActivityEventType.DISPUTE_OPENED} AS "ActivityEventType")) AS "disputesOpened"
        FROM "ActivityEvent"
        WHERE timezone(${timeZone}, "createdAt") >=
          date_trunc('day', timezone(${timeZone}, CURRENT_TIMESTAMP)) - (${windowSize - 1} * interval '1 day')
        GROUP BY 1
      )
      SELECT
        to_char(ds.local_day, 'YYYY-MM-DD') AS label,
        to_char(ds.local_day, 'YYYY-MM-DD') || 'T00:00:00.000Z' AS "bucketStart",
        COALESCE(ac."tasksPublished", 0) AS "tasksPublished",
        COALESCE(ac."tasksIntented", 0) AS "tasksIntented",
        COALESCE(ac."tasksCompleted", 0) AS "tasksCompleted",
        COALESCE(ac."disputesOpened", 0) AS "disputesOpened"
      FROM day_series ds
      LEFT JOIN activity_counts ac ON ac.local_day = ds.local_day
      ORDER BY ds.local_day ASC
    `);

    const points: DashboardTrendPoint[] = rows.map((item) => ({
      bucketStart: item.bucketStart,
      label: item.label,
      tasksPublished: toNumber(item.tasksPublished),
      tasksIntented: toNumber(item.tasksIntented),
      tasksCompleted: toNumber(item.tasksCompleted),
      disputesOpened: toNumber(item.disputesOpened)
    }));

    return {
      timezone: timeZone,
      generatedAt: new Date().toISOString(),
      window,
      points
    };
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
        ensureAgentAndLedgerWithTx: (tx, address, now) =>
          this.ensureAgentAndLedgerWithTx(tx, address, now),
        touchRuntimeStateWithTx: (tx) => this.touchRuntimeStateWithTx(tx),
        applyProfileDeltaWithTx: (tx, address, now, delta) =>
          this.applyProfileDeltaWithTx(tx, address, now, delta),
        appendActivityEventWithTx: (tx, activity) => this.appendActivityEventWithTx(tx, activity)
      },
      input
    );
    return mapTask({ ...task, intentCount: 0 });
  }

  async rejectSubmissionDirect(submissionId: string, publisher: Address): Promise<Submission> {
    const submission = await writeRejectSubmissionDirect(
      this.prisma,
      {
        executeWithRetry: (operation) => this.executeWithRetry(operation),
        lockRuntimeWithTx: (tx) => this.lockRuntimeWithTx(tx),
        ensureAgentAndLedgerWithTx: (tx, address, now) =>
          this.ensureAgentAndLedgerWithTx(tx, address, now),
        touchRuntimeStateWithTx: (tx) => this.touchRuntimeStateWithTx(tx),
        applyProfileDeltaWithTx: (tx, address, now, input) =>
          this.applyProfileDeltaWithTx(tx, address, now, input),
        appendActivityEventWithTx: (tx, input) => this.appendActivityEventWithTx(tx, input)
      },
      submissionId,
      publisher
    );

    return mapSubmission(submission);
  }

  async terminateTaskDirect(taskId: string, publisher: Address, config: AppConfig): Promise<Task> {
    const task = await writeTerminateTaskDirect(
      this.prisma,
      {
        executeWithRetry: (operation) => this.executeWithRetry(operation),
        lockRuntimeWithTx: (tx) => this.lockRuntimeWithTx(tx),
        ensureAgentAndLedgerWithTx: (tx, address, now) =>
          this.ensureAgentAndLedgerWithTx(tx, address, now),
        touchRuntimeStateWithTx: (tx) => this.touchRuntimeStateWithTx(tx),
        applyProfileDeltaWithTx: (tx, address, now, delta) =>
          this.applyProfileDeltaWithTx(tx, address, now, delta),
        appendActivityEventWithTx: (tx, activity) => this.appendActivityEventWithTx(tx, activity)
      },
      taskId,
      publisher,
      config
    );
    const intentCount = await this.prisma.taskIntention.count({ where: { taskId: task.id } });
    return mapTask({ ...task, intentCount });
  }

  async openDisputeDirect(input: OpenDisputeDirectInput): Promise<Dispute> {
    const dispute = await writeOpenDisputeDirect(
      this.prisma,
      {
        executeWithRetry: (operation) => this.executeWithRetry(operation),
        lockRuntimeWithTx: (tx) => this.lockRuntimeWithTx(tx),
        ensureAgentAndLedgerWithTx: (tx, address, now) =>
          this.ensureAgentAndLedgerWithTx(tx, address, now),
        touchRuntimeStateWithTx: (tx) => this.touchRuntimeStateWithTx(tx),
        applyProfileDeltaWithTx: (tx, address, now, delta) =>
          this.applyProfileDeltaWithTx(tx, address, now, delta),
        appendActivityEventWithTx: (tx, activity) => this.appendActivityEventWithTx(tx, activity)
      },
      input
    );
    return mapDispute(dispute);
  }

  async closeCurrentCycleDirect(config: AppConfig): Promise<CloseCycleResult> {
    return writeCloseCurrentCycleDirect(
      this.prisma,
      {
        executeWithRetry: (operation) => this.executeWithRetry(operation),
        lockRuntimeWithTx: (tx) => this.lockRuntimeWithTx(tx),
        ensureAgentAndLedgerWithTx: (tx, address, now) =>
          this.ensureAgentAndLedgerWithTx(tx, address, now),
        touchRuntimeStateWithTx: (tx, activeCycleId) =>
          this.touchRuntimeStateWithTx(tx, activeCycleId),
        getConfirmedSlots: (slotsTotal, rewardPerSlot, rewardEscrowRemaining) =>
          this.getConfirmedSlots(slotsTotal, rewardPerSlot, rewardEscrowRemaining),
        confirmSubmissionInternalWithTx: (tx, submission, task, now, cycleId, actor) =>
          this.confirmSubmissionInternalWithTx(tx, submission, task, now, cycleId, actor),
        evaluateDisputeWithTx: (tx, disputeId, nextConfig, now, cycleId) =>
          this.evaluateDisputeWithTx(tx, disputeId, nextConfig, now, cycleId),
        nextCycleId: (currentCycleId) => this.nextCycleId(currentCycleId)
      },
      config
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
          this.finalizeDisputeWithOutcomeWithTx(tx, nextDisputeId, outcome, now, cycleId)
      },
      disputeId,
      result
    );

    return mapDispute(dispute);
  }

  async addTaskIntentionDirect(taskId: string, agent: Address): Promise<TaskIntention> {
    const intention = await writeAddTaskIntentionDirect(
      this.prisma,
      {
        executeWithRetry: (operation) => this.executeWithRetry(operation),
        lockRuntimeWithTx: (tx) => this.lockRuntimeWithTx(tx),
        ensureAgentAndLedgerWithTx: (tx, address, now) =>
          this.ensureAgentAndLedgerWithTx(tx, address, now),
        touchRuntimeStateWithTx: (tx) => this.touchRuntimeStateWithTx(tx),
        applyProfileDeltaWithTx: (tx, address, now, input) =>
          this.applyProfileDeltaWithTx(tx, address, now, input),
        appendActivityEventWithTx: (tx, input) => this.appendActivityEventWithTx(tx, input)
      },
      taskId,
      agent
    );

    return mapTaskIntention(intention);
  }

  async submitTaskDirect(input: SubmitTaskDirectInput): Promise<Submission> {
    const submission = await writeSubmitTaskDirect(
      this.prisma,
      {
        executeWithRetry: (operation) => this.executeWithRetry(operation),
        lockRuntimeWithTx: (tx) => this.lockRuntimeWithTx(tx),
        ensureAgentAndLedgerWithTx: (tx, address, now) =>
          this.ensureAgentAndLedgerWithTx(tx, address, now),
        touchRuntimeStateWithTx: (tx) => this.touchRuntimeStateWithTx(tx),
        getConfirmedSlots: (slotsTotal, rewardPerSlot, rewardEscrowRemaining) =>
          this.getConfirmedSlots(slotsTotal, rewardPerSlot, rewardEscrowRemaining),
        appendActivityEventWithTx: (tx, input) => this.appendActivityEventWithTx(tx, input)
      },
      input
    );

    return mapSubmission(submission);
  }

  async confirmSubmissionDirect(submissionId: string, publisher: Address): Promise<Submission> {
    const submission = await writeConfirmSubmissionDirect(
      this.prisma,
      {
        executeWithRetry: (operation) => this.executeWithRetry(operation),
        lockRuntimeWithTx: (tx) => this.lockRuntimeWithTx(tx),
        ensureAgentAndLedgerWithTx: (tx, address, now) =>
          this.ensureAgentAndLedgerWithTx(tx, address, now),
        touchRuntimeStateWithTx: (tx) => this.touchRuntimeStateWithTx(tx),
        getConfirmedSlots: (slotsTotal, rewardPerSlot, rewardEscrowRemaining) =>
          this.getConfirmedSlots(slotsTotal, rewardPerSlot, rewardEscrowRemaining),
        confirmSubmissionInternalWithTx: (tx, nextSubmission, task, now, cycleId, actor) =>
          this.confirmSubmissionInternalWithTx(tx, nextSubmission, task, now, cycleId, actor)
      },
      submissionId,
      publisher
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
        ensureAgentAndLedgerWithTx: (tx, address, now) =>
          this.ensureAgentAndLedgerWithTx(tx, address, now),
        touchRuntimeStateWithTx: (tx) => this.touchRuntimeStateWithTx(tx),
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
  ): Promise<{ id: string; activeCycleId: string; updatedAt: Date }> {
    return lockRuntimeWithTx(tx, RUNTIME_ID);
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
    actor: Address
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

    const confirmedSlotsBefore = this.getConfirmedSlots(
      task.slotsTotal,
      task.rewardPerSlot,
      task.rewardEscrowRemaining
    );
    if (confirmedSlotsBefore >= task.slotsTotal || task.rewardEscrowRemaining < task.rewardPerSlot) {
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

    await this.ensureAgentAndLedgerWithTx(tx, submissionAgent, now);
    await this.ensureAgentAndLedgerWithTx(tx, asAddress(task.publisherAddress), now);
    await tx.ledgerBalance.update({
      where: { address: submission.agentAddress },
      data: {
        available: {
          increment: task.rewardPerSlot
        },
        updatedAt: now
      }
    });
    await this.applyProfileDeltaWithTx(tx, submissionAgent, now, {
      workerReputationDelta: 2,
      tasksCompleted: 1
    });
    await this.applyProfileDeltaWithTx(tx, asAddress(task.publisherAddress), now, {
      publisherReputationDelta: 1
    });
    await this.appendActivityEventWithTx(tx, {
      type: DomainActivityEventType.TASK_COMPLETED,
      cycleId,
      taskId: task.id,
      disputeId: null,
      actor,
      createdAt: now
    });
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

    if (outcome === DomainVoteChoice.COMPLETED && submission.status !== DomainSubmissionStatus.CONFIRMED) {
      await this.confirmSubmissionInternalWithTx(
        tx,
        submission,
        task,
        now,
        cycleId,
        asAddress(task.publisherAddress)
      );
    }

    const votes = await tx.supervisionVote.findMany({ where: { disputeId } });
    for (const vote of votes) {
      await this.applyProfileDeltaWithTx(tx, asAddress(vote.agentAddress), now, {
        supervisorReputationDelta: vote.vote === outcome ? 1 : -1
      });
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
    const voteDiff = includeVotes
      ? diffByKey(currentSnapshot?.votes ?? [], nextSnapshot.votes, (item) => item.id)
      : { upserts: [], deletes: [] };
    const workloadDiff = includeCycleWorkloads
      ? diffByKey(currentSnapshot?.cycleWorkloads ?? [], nextSnapshot.cycleWorkloads, (item) => item.id)
      : { upserts: [], deletes: [] };
    const activityDiff = includeActivities
      ? diffByKey(currentSnapshot?.activities ?? [], nextSnapshot.activities, (item) => item.id)
      : { upserts: [], deletes: [] };

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
          publisherRep: item.reputation.publisher,
          workerRep: item.reputation.worker,
          supervisorRep: item.reputation.supervisor,
          tasksPublishedCount: item.stats.tasksPublished,
          tasksIntentedCount: item.stats.tasksIntented,
          tasksCompletedCount: item.stats.tasksCompleted,
          tasksTerminatedCount: item.stats.tasksTerminated,
          submissionsRejectedCount: item.stats.submissionsRejected,
          supervisionVotesCount: item.stats.supervisionVotes,
          createdAt: toDate(item.createdAt),
          updatedAt: toDate(item.updatedAt)
        },
        update: {
          name: item.name,
          bio: item.bio,
          publisherRep: item.reputation.publisher,
          workerRep: item.reputation.worker,
          supervisorRep: item.reputation.supervisor,
          tasksPublishedCount: item.stats.tasksPublished,
          tasksIntentedCount: item.stats.tasksIntented,
          tasksCompletedCount: item.stats.tasksCompleted,
          tasksTerminatedCount: item.stats.tasksTerminated,
          submissionsRejectedCount: item.stats.submissionsRejected,
          supervisionVotesCount: item.stats.supervisionVotes,
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
          status: item.status,
          createdAt: toDate(item.createdAt),
          updatedAt: toDate(item.updatedAt)
        },
        update: {
          taskId: item.taskId,
          agentAddress: item.agent,
          payloadMd: item.payloadMd,
          attachments: toJsonSubmissionAttachments(item.attachments),
          status: item.status,
          createdAt: toDate(item.createdAt),
          updatedAt: toDate(item.updatedAt)
        }
      });
    }

    for (const item of disputeDiff.upserts) {
      await tx.dispute.upsert({
        where: { id: item.id },
        create: {
          id: item.id,
          taskId: item.taskId,
          submissionId: item.submissionId,
          openerAddress: item.opener,
          reasonMd: item.reasonMd,
          status: item.status,
          createdAt: toDate(item.createdAt),
          updatedAt: toDate(item.updatedAt)
        },
        update: {
          taskId: item.taskId,
          submissionId: item.submissionId,
          openerAddress: item.opener,
          reasonMd: item.reasonMd,
          status: item.status,
          createdAt: toDate(item.createdAt),
          updatedAt: toDate(item.updatedAt)
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
          agentAddress: item.agent,
          workload: item.workload,
          createdAt: toDate(item.createdAt),
          settledAt: item.settledAt ? toDate(item.settledAt) : null
        },
        update: {
          cycleId: item.cycleId,
          disputeId: item.disputeId,
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

    if (workloadDiff.deletes.length > 0) {
      await tx.cycleWorkload.deleteMany({ where: { id: { in: workloadDiff.deletes } } });
    }
    if (activityDiff.deletes.length > 0) {
      await tx.activityEvent.deleteMany({ where: { id: { in: activityDiff.deletes } } });
    }
    if (voteDiff.deletes.length > 0) {
      await tx.supervisionVote.deleteMany({ where: { id: { in: voteDiff.deletes } } });
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
    await ensureAgentAndLedgerWithTx(tx, address, now);
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

  async close(): Promise<void> {
    await this.prisma.$disconnect();
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

  private cloneSnapshot(snapshot: EngineStateSnapshot): EngineStateSnapshot {
    return JSON.parse(JSON.stringify(snapshot)) as EngineStateSnapshot;
  }

  private async loadWithTx(tx: Prisma.TransactionClient): Promise<EngineStateSnapshot | null> {
    const runtime = await tx.runtimeState.findUnique({ where: { id: RUNTIME_ID } });
    if (!runtime) {
      return null;
    }

    const [profiles, balances, tasks, taskIntentions, submissions, disputes, votes, cycleWorkloads, cycles, activities] =
      await Promise.all([
        tx.agentProfile.findMany(),
        tx.ledgerBalance.findMany(),
        tx.task.findMany(),
        tx.taskIntention.findMany(),
        tx.submission.findMany(),
        tx.dispute.findMany(),
        tx.supervisionVote.findMany(),
        tx.cycleWorkload.findMany(),
        tx.cycle.findMany(),
        tx.activityEvent.findMany()
      ]);

    const mappedProfiles = profiles.map((item) => ({
      address: asAddress(item.address),
      name: item.name,
      bio: item.bio,
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

    const mappedBalances = balances.map((item) => ({
      address: asAddress(item.address),
      available: item.available,
      updatedAt: toIso(item.updatedAt)
    })) satisfies EngineStateSnapshot["balances"];

    const intentionCountByTaskId = new Map<string, number>();
    for (const item of taskIntentions) {
      intentionCountByTaskId.set(item.taskId, (intentionCountByTaskId.get(item.taskId) ?? 0) + 1);
    }

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
      intentCount: intentionCountByTaskId.get(item.id) ?? 0,
      competitionRatio: computeTaskCompetitionRatio({
        slotsTotal: item.slotsTotal,
        rewardPerSlot: item.rewardPerSlot,
        rewardEscrowRemaining: item.rewardEscrowRemaining,
        intentCount: intentionCountByTaskId.get(item.id) ?? 0
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
      status: item.status as unknown as DomainDisputeStatus,
      createdAt: toIso(item.createdAt),
      updatedAt: toIso(item.updatedAt)
    })) satisfies EngineStateSnapshot["disputes"];

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
      votes: mappedVotes,
      votesByDisputeAndAgent,
      cycleWorkloads: mappedCycleWorkloads,
      cycles: mappedCycles,
      activities: mappedActivities,
      intentions: mappedIntentions,
      latestSubmissionByTaskAndAgent
    };
  }
}
