import { Prisma, PrismaClient } from "@prisma/client";
import { nanoid } from "nanoid";
import type { AppConfig } from "@agentrade/config";
import type { EngineStateSnapshot } from "../domain/engine.js";
import { INITIAL_AGENT_BALANCE } from "../domain/engine.js";
import {
  type ActivityEvent,
  ActivityEventType as DomainActivityEventType,
  type AgentProfile,
  type Cycle,
  type CycleWorkload,
  CycleStatus as DomainCycleStatus,
  type Dispute,
  DisputeStatus as DomainDisputeStatus,
  type LedgerBalance,
  type Submission,
  SubmissionStatus as DomainSubmissionStatus,
  type SupervisionVote,
  type Task,
  TaskStatus as DomainTaskStatus,
  VoteChoice as DomainVoteChoice,
  type Address
} from "@agentrade/types";
import {
  allocateIntegerPool,
  clampReputation,
  computeSupervisorVoteWeight,
  computeTaxAmount,
  computeTerminationPenalty
} from "../domain/helpers.js";
import { DomainError } from "../domain/errors.js";

const RUNTIME_ID = "singleton";
const MAX_SERIALIZABLE_RETRIES = 20;
const SERIALIZABLE_RETRY_BACKOFF_MS = 10;
const MAX_SERIALIZABLE_RETRY_BACKOFF_MS = 200;

const toDate = (value: string): Date => new Date(value);
const toIso = (value: Date): string => value.toISOString();
const asAddress = (value: string): Address => value as Address;
const toJsonAddressArray = (value: string[]): Prisma.InputJsonValue =>
  value as unknown as Prisma.InputJsonValue;

const asStringArray = (value: Prisma.JsonValue): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
};

const asAddressArray = (value: Prisma.JsonValue): Address[] =>
  asStringArray(value).map((item) => asAddress(item));

interface SnapshotDiff<T> {
  upserts: T[];
  deletes: string[];
}

export type PersistenceMutationScope =
  | "profiles"
  | "balances"
  | "tasks"
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

export class PersistenceConflictError extends Error {
  readonly code = "PERSISTENCE_CONFLICT";

  constructor(message = "persistence state changed concurrently") {
    super(message);
    this.name = "PersistenceConflictError";
  }
}

export class PrismaStateRepository {
  private prisma: PrismaClient;

  constructor(databaseUrl: string) {
    this.prisma = new PrismaClient({
      datasources: {
        db: {
          url: databaseUrl
        }
      }
    });
  }

  async ensureInitialized(initialSnapshot: EngineStateSnapshot): Promise<void> {
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
    let attempt = 0;

    while (true) {
      try {
        return await this.prisma.$transaction(
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
        );
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

  async sync(snapshot: EngineStateSnapshot): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const current = await this.loadWithTx(tx);
      await this.applySnapshotDiffWithTx(tx, current, snapshot, null);
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

    const runtime = await this.prisma.$transaction(async (tx) => {
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
    });
    return runtime.updatedAt.toISOString();
  }

  async listTasksDirect(): Promise<Task[]> {
    const tasks = await this.prisma.task.findMany({ orderBy: { createdAt: "asc" } });
    return tasks.map((item) => this.mapTask(item));
  }

  async getTaskDirect(taskId: string): Promise<Task | null> {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    return task ? this.mapTask(task) : null;
  }

  async listDisputesDirect(): Promise<Dispute[]> {
    const disputes = await this.prisma.dispute.findMany({ orderBy: { createdAt: "asc" } });
    return disputes.map((item) => this.mapDispute(item));
  }

  async listAgentsDirect(): Promise<AgentProfile[]> {
    const profiles = await this.prisma.agentProfile.findMany({ orderBy: { createdAt: "asc" } });
    return profiles.map((item) => this.mapAgentProfile(item));
  }

  async listActivitiesDirect(): Promise<ActivityEvent[]> {
    const events = await this.prisma.activityEvent.findMany({ orderBy: { createdAt: "asc" } });
    return events.map((item) => this.mapActivityEvent(item));
  }

  async getDisputeDirect(disputeId: string): Promise<Dispute | null> {
    const dispute = await this.prisma.dispute.findUnique({ where: { id: disputeId } });
    return dispute ? this.mapDispute(dispute) : null;
  }

  async getAgentDirect(address: Address): Promise<AgentProfile | null> {
    const profile = await this.prisma.agentProfile.findUnique({ where: { address } });
    return profile ? this.mapAgentProfile(profile) : null;
  }

  async updateAgentProfileDirect(
    address: Address,
    payload: { name?: string; bio?: string }
  ): Promise<AgentProfile> {
    const profile = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await this.lockRuntimeWithTx(tx);
      await this.ensureAgentAndLedgerWithTx(tx, address, now);
      const current = await tx.agentProfile.findUnique({ where: { address } });
      if (!current) {
        throw new DomainError("AGENT_NOT_FOUND", `Agent ${address} not found`, 404);
      }
      const updated = await tx.agentProfile.update({
        where: { address },
        data: {
          name: payload.name ?? current.name,
          bio: payload.bio ?? current.bio,
          updatedAt: now
        }
      });
      await this.touchRuntimeStateWithTx(tx);
      return updated;
    });
    return this.mapAgentProfile(profile);
  }

  async getLedgerDirect(address: Address): Promise<LedgerBalance | null> {
    const balance = await this.prisma.ledgerBalance.findUnique({ where: { address } });
    return balance ? this.mapLedgerBalance(balance) : null;
  }

  async listCyclesDirect(): Promise<Cycle[]> {
    const cycles = await this.prisma.cycle.findMany({ orderBy: { startedAt: "asc" } });
    return cycles.map((item) => this.mapCycle(item));
  }

  async getCycleDirect(cycleId: string): Promise<Cycle | null> {
    const cycle = await this.prisma.cycle.findUnique({ where: { id: cycleId } });
    return cycle ? this.mapCycle(cycle) : null;
  }

  async getActiveCycleDirect(): Promise<Cycle | null> {
    const runtime = await this.prisma.runtimeState.findUnique({ where: { id: RUNTIME_ID } });
    if (!runtime) {
      return null;
    }
    return this.getCycleDirect(runtime.activeCycleId);
  }

  async getCycleRewardsDirect(cycleId: string): Promise<{ cycle: Cycle; workloads: CycleWorkload[] } | null> {
    const cycle = await this.prisma.cycle.findUnique({ where: { id: cycleId } });
    if (!cycle) {
      return null;
    }
    const workloads = await this.prisma.cycleWorkload.findMany({
      where: { cycleId },
      orderBy: { createdAt: "asc" }
    });
    return {
      cycle: this.mapCycle(cycle),
      workloads: workloads.map((item) => this.mapCycleWorkload(item))
    };
  }

  async exportBridgeBatchDirect(input: { addresses?: Address[] }): Promise<Array<{ address: Address; amount: number }>> {
    const balances = await this.prisma.ledgerBalance.findMany({
      where: input.addresses ? { address: { in: input.addresses } } : undefined,
      orderBy: { address: "asc" }
    });
    return balances.map((item) => ({ address: asAddress(item.address), amount: item.available }));
  }

  async publishTaskDirect(input: {
    publisher: Address;
    title: string;
    descriptionMd: string;
    acceptanceCriteria: string;
    deadlineUtc: string;
    displayTimezone: string;
    slotsTotal: number;
    rewardPerSlot: number;
    allowRepeatCompletionsBySameAgent: boolean;
    config: AppConfig;
  }): Promise<Task> {
    const task = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const runtime = await this.lockRuntimeWithTx(tx);
      await this.ensureAgentAndLedgerWithTx(tx, input.publisher, now);

      const normalizedTitle = input.title.trim();
      if (normalizedTitle.length === 0 || input.title.length > input.config.taskTitleMaxLength) {
        throw new DomainError(
          "INVALID_TASK_TITLE",
          `title must be non-empty and <= ${input.config.taskTitleMaxLength} chars`,
          400
        );
      }
      if (
        input.descriptionMd.trim().length === 0 ||
        input.descriptionMd.length > input.config.taskDescriptionMaxLength
      ) {
        throw new DomainError(
          "INVALID_TASK_DESCRIPTION",
          `description must be non-empty and <= ${input.config.taskDescriptionMaxLength} chars`,
          400
        );
      }
      if (
        input.acceptanceCriteria.trim().length === 0 ||
        input.acceptanceCriteria.length > input.config.taskAcceptanceCriteriaMaxLength
      ) {
        throw new DomainError(
          "INVALID_ACCEPTANCE_CRITERIA",
          `acceptanceCriteria must be non-empty and <= ${input.config.taskAcceptanceCriteriaMaxLength} chars`,
          400
        );
      }
      const deadlineMs = new Date(input.deadlineUtc).getTime();
      if (!Number.isFinite(deadlineMs)) {
        throw new DomainError("INVALID_DEADLINE", "deadlineUtc must be a valid ISO datetime", 400);
      }
      if (deadlineMs <= now.getTime()) {
        throw new DomainError("INVALID_DEADLINE", "deadlineUtc must be in the future", 400);
      }
      const maxDeadlineMs = now.getTime() + input.config.taskDeadlineMaxHours * 3_600_000;
      if (deadlineMs > maxDeadlineMs) {
        throw new DomainError(
          "INVALID_DEADLINE",
          `deadlineUtc must be within ${input.config.taskDeadlineMaxHours} hours`,
          400
        );
      }
      if (
        !Number.isSafeInteger(input.slotsTotal) ||
        input.slotsTotal <= 0 ||
        input.slotsTotal > input.config.taskSlotsMax
      ) {
        throw new DomainError(
          "INVALID_SLOTS",
          `slotsTotal must be a safe integer in [1, ${input.config.taskSlotsMax}]`,
          400
        );
      }
      if (
        !Number.isSafeInteger(input.rewardPerSlot) ||
        input.rewardPerSlot < input.config.rewardMin ||
        input.rewardPerSlot > input.config.taskRewardPerSlotMax
      ) {
        throw new DomainError(
          "INVALID_REWARD",
          `rewardPerSlot must be a safe integer in [${input.config.rewardMin}, ${input.config.taskRewardPerSlotMax}]`,
          400
        );
      }
      const totalReward = input.slotsTotal * input.rewardPerSlot;
      if (!Number.isSafeInteger(totalReward) || totalReward <= 0) {
        throw new DomainError(
          "INVALID_TASK_BUDGET",
          "task reward budget is outside supported integer range",
          400
        );
      }
      const taxAmount = computeTaxAmount(totalReward, input.config);
      if (!Number.isSafeInteger(taxAmount) || taxAmount < 0) {
        throw new DomainError("INVALID_TASK_BUDGET", "task tax amount is invalid", 400);
      }
      const totalCost = totalReward + taxAmount;
      if (!Number.isSafeInteger(totalCost) || totalCost <= 0) {
        throw new DomainError(
          "INVALID_TASK_BUDGET",
          "task total cost is outside supported integer range",
          400
        );
      }

      await tx.$queryRaw`SELECT address FROM "LedgerBalance" WHERE address = ${input.publisher} FOR UPDATE`;
      const balance = await tx.ledgerBalance.findUnique({ where: { address: input.publisher } });
      if (!balance) {
        throw new DomainError("LEDGER_NOT_FOUND", `Ledger for ${input.publisher} not found`, 404);
      }
      if (balance.available < totalCost) {
        throw new DomainError("INSUFFICIENT_BALANCE", "insufficient balance for task escrow and tax", 409);
      }

      await tx.ledgerBalance.update({
        where: { address: input.publisher },
        data: {
          available: {
            decrement: totalCost
          },
          updatedAt: now
        }
      });

      await tx.cycle.update({
        where: { id: runtime.activeCycleId },
        data: {
          taxPool: {
            increment: taxAmount
          }
        }
      });

      const created = await tx.task.create({
        data: {
          id: nanoid(),
          publisherAddress: input.publisher,
          title: normalizedTitle,
          descriptionMd: input.descriptionMd,
          acceptanceCriteria: input.acceptanceCriteria,
          status: DomainTaskStatus.OPEN,
          deadlineUtc: new Date(input.deadlineUtc),
          displayTimezone: input.displayTimezone,
          slotsTotal: input.slotsTotal,
          rewardPerSlot: input.rewardPerSlot,
          allowRepeatCompletionsBySameAgent: input.allowRepeatCompletionsBySameAgent,
          taxAmount,
          rewardEscrowRemaining: totalReward,
          acceptedAgents: toJsonAddressArray([]),
          completedAgents: toJsonAddressArray([]),
          createdAt: now,
          updatedAt: now
        }
      });

      await this.applyProfileDeltaWithTx(tx, input.publisher, now, {
        publisherReputationDelta: 1,
        tasksPublished: 1
      });
      await this.appendActivityEventWithTx(tx, {
        type: DomainActivityEventType.TASK_PUBLISHED,
        cycleId: runtime.activeCycleId,
        taskId: created.id,
        disputeId: null,
        actor: input.publisher,
        createdAt: now
      });
      await this.touchRuntimeStateWithTx(tx);
      return created;
    });

    return this.mapTask(task);
  }

  async rejectSubmissionDirect(submissionId: string, publisher: Address): Promise<Submission> {
    const submission = await this.prisma.$transaction(async (tx) => {
      await this.lockRuntimeWithTx(tx);
      const now = new Date();
      await tx.$queryRaw`SELECT id FROM "Submission" WHERE id = ${submissionId} FOR UPDATE`;
      const submissionRow = await tx.submission.findUnique({ where: { id: submissionId } });
      if (!submissionRow) {
        throw new DomainError("SUBMISSION_NOT_FOUND", `Submission ${submissionId} not found`, 404);
      }
      const task = await tx.task.findUnique({ where: { id: submissionRow.taskId } });
      if (!task) {
        throw new DomainError("TASK_NOT_FOUND", `Task ${submissionRow.taskId} does not exist`, 404);
      }
      if (task.publisherAddress !== publisher) {
        throw new DomainError("FORBIDDEN", "only the publisher can reject submission", 403);
      }
      if (submissionRow.status !== DomainSubmissionStatus.SUBMITTED) {
        throw new DomainError("SUBMISSION_NOT_PENDING", "submission is not in submitted state", 409);
      }

      await this.ensureAgentAndLedgerWithTx(tx, asAddress(submissionRow.agentAddress), now);
      const updated = await tx.submission.update({
        where: { id: submissionId },
        data: {
          status: DomainSubmissionStatus.REJECTED,
          updatedAt: now
        }
      });
      await this.applyProfileDeltaWithTx(tx, asAddress(submissionRow.agentAddress), now, {
        workerReputationDelta: -1,
        submissionsRejected: 1
      });
      await this.touchRuntimeStateWithTx(tx);
      return updated;
    });

    return this.mapSubmission(submission);
  }

  async terminateTaskDirect(taskId: string, publisher: Address, config: AppConfig): Promise<Task> {
    const task = await this.prisma.$transaction(async (tx) => {
      const runtime = await this.lockRuntimeWithTx(tx);
      const now = new Date();
      await tx.$queryRaw`SELECT id FROM "Task" WHERE id = ${taskId} FOR UPDATE`;
      const taskRow = await tx.task.findUnique({ where: { id: taskId } });
      if (!taskRow) {
        throw new DomainError("TASK_NOT_FOUND", `Task ${taskId} does not exist`, 404);
      }
      if (taskRow.publisherAddress !== publisher) {
        throw new DomainError("FORBIDDEN", "only the publisher can terminate task", 403);
      }
      if (taskRow.status === DomainTaskStatus.TERMINATED || taskRow.status === DomainTaskStatus.CLOSED) {
        throw new DomainError("TASK_NOT_TERMINABLE", "task is already closed", 409);
      }

      const penalty = computeTerminationPenalty(taskRow.rewardEscrowRemaining, config);
      const refund = Math.max(0, taskRow.rewardEscrowRemaining - penalty);
      await this.ensureAgentAndLedgerWithTx(tx, asAddress(taskRow.publisherAddress), now);
      await tx.ledgerBalance.update({
        where: { address: taskRow.publisherAddress },
        data: {
          available: {
            increment: refund
          },
          updatedAt: now
        }
      });

      await tx.cycle.update({
        where: { id: runtime.activeCycleId },
        data: {
          penaltyPool: {
            increment: penalty
          }
        }
      });

      const updated = await tx.task.update({
        where: { id: taskRow.id },
        data: {
          rewardEscrowRemaining: 0,
          status: DomainTaskStatus.TERMINATED,
          updatedAt: now
        }
      });
      await this.applyProfileDeltaWithTx(tx, asAddress(taskRow.publisherAddress), now, {
        publisherReputationDelta: -1,
        tasksTerminated: 1
      });
      await this.appendActivityEventWithTx(tx, {
        type: DomainActivityEventType.TASK_TERMINATED,
        cycleId: runtime.activeCycleId,
        taskId: taskRow.id,
        disputeId: null,
        actor: publisher,
        createdAt: now
      });
      await this.touchRuntimeStateWithTx(tx);
      return updated;
    });

    return this.mapTask(task);
  }

  async openDisputeDirect(input: {
    taskId: string;
    submissionId: string;
    opener: Address;
    reasonMd: string;
    disputeReasonMaxLength: number;
  }): Promise<Dispute> {
    const dispute = await this.prisma.$transaction(async (tx) => {
      const runtime = await this.lockRuntimeWithTx(tx);
      const now = new Date();
      await this.ensureAgentAndLedgerWithTx(tx, input.opener, now);
      const task = await tx.task.findUnique({ where: { id: input.taskId } });
      if (!task) {
        throw new DomainError("TASK_NOT_FOUND", `Task ${input.taskId} does not exist`, 404);
      }
      const submission = await tx.submission.findUnique({ where: { id: input.submissionId } });
      if (!submission) {
        throw new DomainError("SUBMISSION_NOT_FOUND", `Submission ${input.submissionId} not found`, 404);
      }
      if (submission.taskId !== task.id) {
        throw new DomainError("MISMATCH", "submission does not belong to task", 400);
      }
      if (input.reasonMd.trim().length === 0 || input.reasonMd.length > input.disputeReasonMaxLength) {
        throw new DomainError(
          "INVALID_DISPUTE_REASON",
          `reasonMd must be non-empty and <= ${input.disputeReasonMaxLength} chars`,
          400
        );
      }
      if (input.opener !== asAddress(task.publisherAddress) && input.opener !== asAddress(submission.agentAddress)) {
        throw new DomainError(
          "DISPUTE_FORBIDDEN_OPENER",
          "only task publisher or submission agent can open dispute",
          403
        );
      }
      if (submission.status !== DomainSubmissionStatus.REJECTED) {
        throw new DomainError(
          "SUBMISSION_NOT_DISPUTABLE",
          "submission must be rejected before dispute can be opened",
          409
        );
      }

      const hasOpenDispute = await tx.dispute.findFirst({
        where: {
          submissionId: submission.id,
          status: DomainDisputeStatus.OPEN
        },
        select: { id: true }
      });
      if (hasOpenDispute) {
        throw new DomainError(
          "OPEN_DISPUTE_ALREADY_EXISTS",
          "an open dispute already exists for this submission",
          409
        );
      }

      const created = await tx.dispute.create({
        data: {
          id: nanoid(),
          taskId: task.id,
          submissionId: submission.id,
          openerAddress: input.opener,
          reasonMd: input.reasonMd,
          status: DomainDisputeStatus.OPEN,
          createdAt: now,
          updatedAt: now
        }
      });
      await this.appendActivityEventWithTx(tx, {
        type: DomainActivityEventType.DISPUTE_OPENED,
        cycleId: runtime.activeCycleId,
        taskId: task.id,
        disputeId: created.id,
        actor: input.opener,
        createdAt: now
      });
      await this.touchRuntimeStateWithTx(tx);
      return created;
    });

    return this.mapDispute(dispute);
  }

  async closeCurrentCycleDirect(config: AppConfig): Promise<{
    closedCycleId: string;
    openedCycleId: string;
    rewardPool: number;
    distributions: Array<{ agent: Address; amount: number }>;
    finalizedDisputes: string[];
  }> {
    return this.prisma.$transaction(async (tx) => {
      const runtime = await this.lockRuntimeWithTx(tx);
      const now = new Date();
      const cycle = await tx.cycle.findUnique({ where: { id: runtime.activeCycleId } });
      if (!cycle) {
        throw new DomainError("CYCLE_NOT_FOUND", `Cycle ${runtime.activeCycleId} not found`, 404);
      }

      const staleThreshold = new Date(now.getTime() - config.submissionTimeoutHours * 3_600_000);
      const staleSubmissions = await tx.submission.findMany({
        where: {
          status: DomainSubmissionStatus.SUBMITTED,
          createdAt: { lte: staleThreshold }
        },
        orderBy: { createdAt: "asc" }
      });
      for (const stale of staleSubmissions) {
        const submission = await tx.submission.findUnique({ where: { id: stale.id } });
        if (!submission || submission.status !== DomainSubmissionStatus.SUBMITTED) {
          continue;
        }
        const task = await tx.task.findUnique({ where: { id: submission.taskId } });
        if (!task) {
          throw new DomainError("TASK_NOT_FOUND", `Task ${submission.taskId} does not exist`, 404);
        }
        if (task.status === DomainTaskStatus.TERMINATED || task.status === DomainTaskStatus.CLOSED) {
          continue;
        }
        const confirmedSlots = this.getConfirmedSlots(task.slotsTotal, task.rewardPerSlot, task.rewardEscrowRemaining);
        if (confirmedSlots >= task.slotsTotal || task.rewardEscrowRemaining < task.rewardPerSlot) {
          await tx.task.update({
            where: { id: task.id },
            data: {
              status: DomainTaskStatus.CLOSED,
              acceptedAgents: toJsonAddressArray([]),
              updatedAt: now
            }
          });
          continue;
        }
        await this.confirmSubmissionInternalWithTx(
          tx,
          submission,
          task,
          now,
          runtime.activeCycleId,
          asAddress(task.publisherAddress)
        );
      }

      const finalizedDisputes: string[] = [];
      const openDisputes = await tx.dispute.findMany({
        where: { status: DomainDisputeStatus.OPEN },
        orderBy: { createdAt: "asc" }
      });
      for (const dispute of openDisputes) {
        const changed = await this.evaluateDisputeWithTx(
          tx,
          dispute.id,
          config,
          now,
          runtime.activeCycleId
        );
        if (changed) {
          finalizedDisputes.push(dispute.id);
        }
      }

      const rewardPool = cycle.mintedAmount + cycle.taxPool + cycle.penaltyPool;
      const workloads = await tx.cycleWorkload.findMany({
        where: {
          cycleId: cycle.id,
          settledAt: null
        },
        orderBy: { createdAt: "asc" }
      });
      const grouped = new Map<string, number>();
      for (const workload of workloads) {
        grouped.set(workload.agentAddress, (grouped.get(workload.agentAddress) ?? 0) + workload.workload);
      }
      const distributionsMap = allocateIntegerPool(rewardPool, grouped);
      for (const [agent, amount] of distributionsMap.entries()) {
        await this.ensureAgentAndLedgerWithTx(tx, asAddress(agent), now);
        await tx.ledgerBalance.update({
          where: { address: agent },
          data: {
            available: {
              increment: amount
            },
            updatedAt: now
          }
        });
      }
      if (workloads.length > 0) {
        await tx.cycleWorkload.updateMany({
          where: {
            id: {
              in: workloads.map((item) => item.id)
            }
          },
          data: {
            settledAt: now
          }
        });
      }

      await tx.cycle.update({
        where: { id: cycle.id },
        data: {
          status: DomainCycleStatus.CLOSED,
          closedAt: now
        }
      });
      const nextCycleId = this.nextCycleId(cycle.id);
      await tx.cycle.create({
        data: {
          id: nextCycleId,
          status: DomainCycleStatus.OPEN,
          mintedAmount: config.mintPerCycle,
          taxPool: 0,
          penaltyPool: 0,
          startedAt: now,
          closedAt: null
        }
      });
      await this.touchRuntimeStateWithTx(tx, nextCycleId);

      return {
        closedCycleId: cycle.id,
        openedCycleId: nextCycleId,
        rewardPool,
        distributions: [...distributionsMap.entries()].map(([agent, amount]) => ({
          agent: asAddress(agent),
          amount
        })),
        finalizedDisputes
      };
    });
  }

  async overrideDisputeDirect(
    disputeId: string,
    result: "COMPLETED" | "NOT_COMPLETED"
  ): Promise<Dispute> {
    const dispute = await this.prisma.$transaction(async (tx) => {
      const runtime = await this.lockRuntimeWithTx(tx);
      const now = new Date();
      await tx.$queryRaw`SELECT id FROM "Dispute" WHERE id = ${disputeId} FOR UPDATE`;
      const row = await tx.dispute.findUnique({ where: { id: disputeId } });
      if (!row) {
        throw new DomainError("DISPUTE_NOT_FOUND", `Dispute ${disputeId} does not exist`, 404);
      }

      if (result === "COMPLETED") {
        if (row.status !== DomainDisputeStatus.RESOLVED_COMPLETED) {
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
            runtime.activeCycleId
          );
        }
      } else {
        await tx.dispute.update({
          where: { id: disputeId },
          data: {
            status: DomainDisputeStatus.OPEN,
            updatedAt: now
          }
        });
      }

      await this.touchRuntimeStateWithTx(tx);
      return tx.dispute.findUniqueOrThrow({ where: { id: disputeId } });
    });

    return this.mapDispute(dispute);
  }

  async acceptTaskDirect(taskId: string, agent: Address): Promise<Task> {
    const task = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const runtime = await this.lockRuntimeWithTx(tx);
      await this.ensureAgentAndLedgerWithTx(tx, agent, now);

      await tx.$queryRaw`SELECT id FROM "Task" WHERE id = ${taskId} FOR UPDATE`;
      const taskRow = await tx.task.findUnique({ where: { id: taskId } });
      if (!taskRow) {
        throw new DomainError("TASK_NOT_FOUND", `Task ${taskId} does not exist`, 404);
      }

      if (taskRow.status === DomainTaskStatus.TERMINATED || taskRow.status === DomainTaskStatus.CLOSED) {
        throw new DomainError("TASK_NOT_ACCEPTABLE", "task is not open for acceptance", 409);
      }
      if (taskRow.deadlineUtc.getTime() <= now.getTime()) {
        throw new DomainError("TASK_EXPIRED", "task deadline has passed", 409);
      }

      const acceptedAgents = asAddressArray(taskRow.acceptedAgents);
      const completedAgents = asAddressArray(taskRow.completedAgents);
      const confirmedSlots = this.getConfirmedSlots(taskRow.slotsTotal, taskRow.rewardPerSlot, taskRow.rewardEscrowRemaining);

      if (confirmedSlots >= taskRow.slotsTotal || acceptedAgents.length + confirmedSlots >= taskRow.slotsTotal) {
        throw new DomainError("TASK_SLOTS_FULL", "task has no available slots", 409);
      }
      if (!taskRow.allowRepeatCompletionsBySameAgent && completedAgents.includes(agent)) {
        throw new DomainError("REPEAT_NOT_ALLOWED", "agent already completed this task", 409);
      }
      if (acceptedAgents.includes(agent)) {
        throw new DomainError("ALREADY_ACCEPTED", "agent already accepted this task", 409);
      }

      acceptedAgents.push(agent);
      const updatedTask = await tx.task.update({
        where: { id: taskRow.id },
        data: {
          acceptedAgents: toJsonAddressArray(acceptedAgents),
          status: DomainTaskStatus.IN_PROGRESS,
          updatedAt: now
        }
      });
      await this.applyProfileDeltaWithTx(tx, agent, now, {
        tasksAccepted: 1
      });
      await this.appendActivityEventWithTx(tx, {
        type: DomainActivityEventType.TASK_ACCEPTED,
        cycleId: runtime.activeCycleId,
        taskId: taskRow.id,
        disputeId: null,
        actor: agent,
        createdAt: now
      });
      await this.touchRuntimeStateWithTx(tx);
      return updatedTask;
    });

    return this.mapTask(task);
  }

  async submitTaskDirect(input: {
    taskId: string;
    agent: Address;
    payloadMd: string;
    taskSubmissionPayloadMaxLength: number;
    resubmitCooldownMinutes: number;
  }): Promise<Submission> {
    const submission = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await this.lockRuntimeWithTx(tx);
      await this.ensureAgentAndLedgerWithTx(tx, input.agent, now);

      await tx.$queryRaw`SELECT id FROM "Task" WHERE id = ${input.taskId} FOR UPDATE`;
      const taskRow = await tx.task.findUnique({ where: { id: input.taskId } });
      if (!taskRow) {
        throw new DomainError("TASK_NOT_FOUND", `Task ${input.taskId} does not exist`, 404);
      }
      if (
        input.payloadMd.trim().length === 0 ||
        input.payloadMd.length > input.taskSubmissionPayloadMaxLength
      ) {
        throw new DomainError(
          "INVALID_SUBMISSION_PAYLOAD",
          `payloadMd must be non-empty and <= ${input.taskSubmissionPayloadMaxLength} chars`,
          400
        );
      }
      if (taskRow.status === DomainTaskStatus.TERMINATED || taskRow.status === DomainTaskStatus.CLOSED) {
        throw new DomainError("TASK_NOT_SUBMITTABLE", "task is not open for submissions", 409);
      }
      const confirmedSlots = this.getConfirmedSlots(taskRow.slotsTotal, taskRow.rewardPerSlot, taskRow.rewardEscrowRemaining);
      if (confirmedSlots >= taskRow.slotsTotal || taskRow.rewardEscrowRemaining < taskRow.rewardPerSlot) {
        throw new DomainError("TASK_NOT_SUBMITTABLE", "task is not open for submissions", 409);
      }
      if (taskRow.deadlineUtc.getTime() <= now.getTime()) {
        throw new DomainError("TASK_EXPIRED", "task deadline has passed", 409);
      }

      const acceptedAgents = asAddressArray(taskRow.acceptedAgents);
      if (!acceptedAgents.includes(input.agent)) {
        throw new DomainError("TASK_NOT_ACCEPTED_BY_AGENT", "agent has not accepted this task", 403);
      }

      const lastSubmission = await tx.submission.findFirst({
        where: {
          taskId: taskRow.id,
          agentAddress: input.agent
        },
        orderBy: { createdAt: "desc" }
      });
      if (lastSubmission) {
        const elapsedMs = now.getTime() - lastSubmission.createdAt.getTime();
        const cooldownMs = input.resubmitCooldownMinutes * 60_000;
        if (elapsedMs < cooldownMs) {
          throw new DomainError(
            "RESUBMIT_COOLDOWN",
            `resubmission cooldown not reached (${input.resubmitCooldownMinutes} minutes)`,
            429
          );
        }
      }

      const created = await tx.submission.create({
        data: {
          id: nanoid(),
          taskId: taskRow.id,
          agentAddress: input.agent,
          payloadMd: input.payloadMd,
          status: DomainSubmissionStatus.SUBMITTED,
          createdAt: now,
          updatedAt: now
        }
      });
      await this.touchRuntimeStateWithTx(tx);
      return created;
    });

    return this.mapSubmission(submission);
  }

  async confirmSubmissionDirect(submissionId: string, publisher: Address): Promise<Submission> {
    const submission = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const runtime = await this.lockRuntimeWithTx(tx);
      await tx.$queryRaw`SELECT id FROM "Submission" WHERE id = ${submissionId} FOR UPDATE`;
      const submissionRow = await tx.submission.findUnique({ where: { id: submissionId } });
      if (!submissionRow) {
        throw new DomainError("SUBMISSION_NOT_FOUND", `Submission ${submissionId} not found`, 404);
      }

      await tx.$queryRaw`SELECT id FROM "Task" WHERE id = ${submissionRow.taskId} FOR UPDATE`;
      const taskRow = await tx.task.findUnique({ where: { id: submissionRow.taskId } });
      if (!taskRow) {
        throw new DomainError("TASK_NOT_FOUND", `Task ${submissionRow.taskId} does not exist`, 404);
      }
      if (taskRow.publisherAddress !== publisher) {
        throw new DomainError("FORBIDDEN", "only the publisher can confirm submission", 403);
      }

      if (submissionRow.status === DomainSubmissionStatus.CONFIRMED) {
        return submissionRow;
      }
      if (
        submissionRow.status !== DomainSubmissionStatus.SUBMITTED &&
        submissionRow.status !== DomainSubmissionStatus.REJECTED
      ) {
        throw new DomainError("SUBMISSION_NOT_CONFIRMABLE", "submission cannot be confirmed from this state", 409);
      }

      const completedAgents = asAddressArray(taskRow.completedAgents);
      if (
        !taskRow.allowRepeatCompletionsBySameAgent &&
        completedAgents.includes(asAddress(submissionRow.agentAddress))
      ) {
        throw new DomainError(
          "REPEAT_COMPLETION_NOT_ALLOWED",
          "agent already completed this non-repeatable task",
          409
        );
      }

      const confirmedSlotsBefore = this.getConfirmedSlots(
        taskRow.slotsTotal,
        taskRow.rewardPerSlot,
        taskRow.rewardEscrowRemaining
      );
      if (confirmedSlotsBefore >= taskRow.slotsTotal || taskRow.rewardEscrowRemaining < taskRow.rewardPerSlot) {
        throw new DomainError("SUBMISSION_NOT_CONFIRMABLE", "task has no remaining payable slots", 409);
      }

      await this.confirmSubmissionInternalWithTx(
        tx,
        submissionRow,
        taskRow,
        now,
        runtime.activeCycleId,
        publisher
      );

      await this.touchRuntimeStateWithTx(tx);
      return tx.submission.findUniqueOrThrow({ where: { id: submissionRow.id } });
    });

    return this.mapSubmission(submission);
  }

  async voteDisputeDirect(input: {
    disputeId: string;
    agent: Address;
    vote: DomainVoteChoice;
    config: AppConfig;
  }): Promise<{ vote: SupervisionVote; workload: CycleWorkload }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const runtime = await this.lockRuntimeWithTx(tx);
        await this.ensureAgentAndLedgerWithTx(tx, input.agent, now);

        await tx.$queryRaw`SELECT id FROM "Dispute" WHERE id = ${input.disputeId} FOR UPDATE`;
        const dispute = await tx.dispute.findUnique({ where: { id: input.disputeId } });
        if (!dispute) {
          throw new DomainError("DISPUTE_NOT_FOUND", `Dispute ${input.disputeId} does not exist`, 404);
        }
        if (dispute.status !== DomainDisputeStatus.OPEN) {
          throw new DomainError("DISPUTE_CLOSED", "dispute is already resolved", 409);
        }

        const existingVote = await tx.supervisionVote.findFirst({
          where: {
            disputeId: input.disputeId,
            agentAddress: input.agent
          },
          select: { id: true }
        });
        if (existingVote) {
          throw new DomainError(
            "DUPLICATE_SUPERVISION_PARTICIPATION",
            "agent can participate only once per dispute across all cycles",
            409
          );
        }

        const cycle = await tx.cycle.findUnique({ where: { id: runtime.activeCycleId } });
        if (!cycle) {
          throw new DomainError("CYCLE_NOT_FOUND", `Cycle ${runtime.activeCycleId} not found`, 404);
        }

        const profile = await tx.agentProfile.findUniqueOrThrow({ where: { address: input.agent } });
        const weightSnapshot = computeSupervisorVoteWeight(
          {
            publisher: profile.publisherRep,
            worker: profile.workerRep,
            supervisor: profile.supervisorRep
          },
          input.config
        );

        const vote = await tx.supervisionVote.create({
          data: {
            id: nanoid(),
            disputeId: input.disputeId,
            agentAddress: input.agent,
            vote: input.vote,
            weightSnapshot,
            createdCycleId: runtime.activeCycleId,
            createdAt: now
          }
        });

        const workload = await tx.cycleWorkload.create({
          data: {
            id: nanoid(),
            cycleId: runtime.activeCycleId,
            disputeId: input.disputeId,
            agentAddress: input.agent,
            workload: 1,
            createdAt: now,
            settledAt: null
          }
        });

        await this.applyProfileDeltaWithTx(tx, input.agent, now, {
          supervisorReputationDelta: 0.5,
          supervisionVotes: 1
        });
        await this.touchRuntimeStateWithTx(tx);

        return {
          vote: this.mapVote(vote),
          workload: this.mapCycleWorkload(workload)
        };
      });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code ?? "") : "";
      if (code === "P2002") {
        throw new DomainError(
          "DUPLICATE_SUPERVISION_PARTICIPATION",
          "agent can participate only once per dispute across all cycles",
          409
        );
      }
      throw error;
    }
  }

  private async lockRuntimeWithTx(
    tx: Prisma.TransactionClient
  ): Promise<{ id: string; activeCycleId: string; updatedAt: Date }> {
    await tx.$queryRaw`SELECT id FROM "RuntimeState" WHERE id = ${RUNTIME_ID} FOR UPDATE`;
    const runtime = await tx.runtimeState.findUnique({ where: { id: RUNTIME_ID } });
    if (!runtime) {
      throw new DomainError("RUNTIME_NOT_INITIALIZED", "runtime state is not initialized", 500);
    }
    return runtime;
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
      acceptedAgents: Prisma.JsonValue;
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
          acceptedAgents: toJsonAddressArray([]),
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
    const acceptedAgents = asAddressArray(task.acceptedAgents).filter((agent) => agent !== submissionAgent);
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
        acceptedAgents: toJsonAddressArray(shouldClose ? [] : acceptedAgents),
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
          tasksAcceptedCount: item.stats.tasksAccepted,
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
          tasksAcceptedCount: item.stats.tasksAccepted,
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
          acceptedAgents: toJsonAddressArray(item.acceptedAgents),
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
          acceptedAgents: toJsonAddressArray(item.acceptedAgents),
          completedAgents: toJsonAddressArray(item.completedAgents),
          createdAt: toDate(item.createdAt),
          updatedAt: toDate(item.updatedAt)
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
          status: item.status,
          createdAt: toDate(item.createdAt),
          updatedAt: toDate(item.updatedAt)
        },
        update: {
          taskId: item.taskId,
          agentAddress: item.agent,
          payloadMd: item.payloadMd,
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
    if (taskDiff.deletes.length > 0) {
      await tx.task.deleteMany({ where: { id: { in: taskDiff.deletes } } });
    }
    if (balanceDiff.deletes.length > 0) {
      await tx.ledgerBalance.deleteMany({ where: { address: { in: balanceDiff.deletes } } });
    }
    if (profileDiff.deletes.length > 0) {
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
    const existingProfile = await tx.agentProfile.findUnique({ where: { address } });
    if (!existingProfile) {
      await tx.agentProfile.create({
        data: {
          address,
          name: "",
          bio: "",
          publisherRep: 50,
          workerRep: 50,
          supervisorRep: 50,
          tasksPublishedCount: 0,
          tasksAcceptedCount: 0,
          tasksCompletedCount: 0,
          tasksTerminatedCount: 0,
          submissionsRejectedCount: 0,
          supervisionVotesCount: 0,
          createdAt: now,
          updatedAt: now
        }
      });
    }

    const existingLedger = await tx.ledgerBalance.findUnique({ where: { address } });
    if (!existingLedger) {
      await tx.ledgerBalance.create({
        data: {
          address,
          available: INITIAL_AGENT_BALANCE,
          updatedAt: now
        }
      });
    }
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
    await tx.activityEvent.create({
      data: {
        id: nanoid(),
        type: input.type,
        cycleId: input.cycleId,
        taskId: input.taskId,
        disputeId: input.disputeId,
        actorAddress: input.actor,
        createdAt: input.createdAt
      }
    });
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
      tasksAccepted?: number;
      tasksCompleted?: number;
      tasksTerminated?: number;
      submissionsRejected?: number;
      supervisionVotes?: number;
    }
  ): Promise<void> {
    const profile = await tx.agentProfile.findUnique({ where: { address } });
    if (!profile) {
      throw new DomainError("AGENT_NOT_FOUND", `Agent ${address} not found`, 404);
    }
    const nextPublisherRep = clampReputation(
      profile.publisherRep + (input.publisherReputationDelta ?? 0)
    );
    const nextWorkerRep = clampReputation(profile.workerRep + (input.workerReputationDelta ?? 0));
    const nextSupervisorRep = clampReputation(
      profile.supervisorRep + (input.supervisorReputationDelta ?? 0)
    );

    await tx.agentProfile.update({
      where: { address },
      data: {
        publisherRep: nextPublisherRep,
        workerRep: nextWorkerRep,
        supervisorRep: nextSupervisorRep,
        tasksPublishedCount: {
          increment: input.tasksPublished ?? 0
        },
        tasksAcceptedCount: {
          increment: input.tasksAccepted ?? 0
        },
        tasksCompletedCount: {
          increment: input.tasksCompleted ?? 0
        },
        tasksTerminatedCount: {
          increment: input.tasksTerminated ?? 0
        },
        submissionsRejectedCount: {
          increment: input.submissionsRejected ?? 0
        },
        supervisionVotesCount: {
          increment: input.supervisionVotes ?? 0
        },
        updatedAt: now
      }
    });
  }

  private getConfirmedSlots(
    slotsTotal: number,
    rewardPerSlot: number,
    rewardEscrowRemaining: number
  ): number {
    if (rewardPerSlot <= 0 || slotsTotal <= 0) {
      throw new DomainError(
        "TASK_SETTLEMENT_INVARIANT_BROKEN",
        "task slot or reward invariant is invalid",
        500
      );
    }
    const totalEscrow = slotsTotal * rewardPerSlot;
    if (rewardEscrowRemaining < 0 || rewardEscrowRemaining > totalEscrow) {
      throw new DomainError(
        "TASK_ESCROW_INVARIANT_BROKEN",
        "task escrow remaining is outside allowed bounds",
        500
      );
    }
    const spent = totalEscrow - rewardEscrowRemaining;
    if (spent % rewardPerSlot !== 0) {
      throw new DomainError(
        "TASK_SETTLEMENT_INVARIANT_BROKEN",
        "task reward escrow is not aligned to slot reward",
        500
      );
    }
    const confirmedSlots = Math.floor(spent / rewardPerSlot);
    if (confirmedSlots < 0 || confirmedSlots > slotsTotal) {
      throw new DomainError(
        "TASK_SETTLEMENT_INVARIANT_BROKEN",
        "confirmed slot count is outside allowed bounds",
        500
      );
    }
    return confirmedSlots;
  }

  private async touchRuntimeStateWithTx(
    tx: Prisma.TransactionClient,
    activeCycleId?: string
  ): Promise<void> {
    if (typeof activeCycleId === "string") {
      await tx.$executeRaw`
        UPDATE "RuntimeState"
        SET "activeCycleId" = ${activeCycleId}, "updatedAt" = NOW()
        WHERE "id" = ${RUNTIME_ID}
      `;
      return;
    }
    await tx.$executeRaw`
      UPDATE "RuntimeState"
      SET "updatedAt" = NOW()
      WHERE "id" = ${RUNTIME_ID}
    `;
  }

  private mapAgentProfile(item: {
    address: string;
    name: string;
    bio: string;
    publisherRep: number;
    workerRep: number;
    supervisorRep: number;
    tasksPublishedCount: number;
    tasksAcceptedCount: number;
    tasksCompletedCount: number;
    tasksTerminatedCount: number;
    submissionsRejectedCount: number;
    supervisionVotesCount: number;
    createdAt: Date;
    updatedAt: Date;
  }): AgentProfile {
    return {
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
        tasksAccepted: item.tasksAcceptedCount,
        tasksCompleted: item.tasksCompletedCount,
        tasksTerminated: item.tasksTerminatedCount,
        submissionsRejected: item.submissionsRejectedCount,
        supervisionVotes: item.supervisionVotesCount
      },
      createdAt: toIso(item.createdAt),
      updatedAt: toIso(item.updatedAt)
    };
  }

  private mapLedgerBalance(item: {
    address: string;
    available: number;
    updatedAt: Date;
  }): LedgerBalance {
    return {
      address: asAddress(item.address),
      available: item.available,
      updatedAt: toIso(item.updatedAt)
    };
  }

  private mapTask(item: {
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
    acceptedAgents: Prisma.JsonValue;
    completedAgents: Prisma.JsonValue;
    createdAt: Date;
    updatedAt: Date;
  }): Task {
    return {
      id: item.id,
      publisher: asAddress(item.publisherAddress),
      title: item.title,
      descriptionMd: item.descriptionMd,
      acceptanceCriteria: item.acceptanceCriteria,
      status: item.status as DomainTaskStatus,
      deadlineUtc: toIso(item.deadlineUtc),
      displayTimezone: item.displayTimezone,
      slotsTotal: item.slotsTotal,
      rewardPerSlot: item.rewardPerSlot,
      allowRepeatCompletionsBySameAgent: item.allowRepeatCompletionsBySameAgent,
      taxAmount: item.taxAmount,
      rewardEscrowRemaining: item.rewardEscrowRemaining,
      acceptedAgents: asAddressArray(item.acceptedAgents),
      completedAgents: asAddressArray(item.completedAgents),
      createdAt: toIso(item.createdAt),
      updatedAt: toIso(item.updatedAt)
    };
  }

  private mapSubmission(item: {
    id: string;
    taskId: string;
    agentAddress: string;
    payloadMd: string;
    status: unknown;
    createdAt: Date;
    updatedAt: Date;
  }): Submission {
    return {
      id: item.id,
      taskId: item.taskId,
      agent: asAddress(item.agentAddress),
      payloadMd: item.payloadMd,
      status: item.status as DomainSubmissionStatus,
      createdAt: toIso(item.createdAt),
      updatedAt: toIso(item.updatedAt)
    };
  }

  private mapDispute(item: {
    id: string;
    taskId: string;
    submissionId: string;
    openerAddress: string;
    reasonMd: string;
    status: unknown;
    createdAt: Date;
    updatedAt: Date;
  }): Dispute {
    return {
      id: item.id,
      taskId: item.taskId,
      submissionId: item.submissionId,
      opener: asAddress(item.openerAddress),
      reasonMd: item.reasonMd,
      status: item.status as DomainDisputeStatus,
      createdAt: toIso(item.createdAt),
      updatedAt: toIso(item.updatedAt)
    };
  }

  private mapVote(item: {
    id: string;
    disputeId: string;
    agentAddress: string;
    vote: unknown;
    weightSnapshot: number;
    createdCycleId: string;
    createdAt: Date;
  }): SupervisionVote {
    return {
      id: item.id,
      disputeId: item.disputeId,
      agent: asAddress(item.agentAddress),
      vote: item.vote as DomainVoteChoice,
      weightSnapshot: item.weightSnapshot,
      createdCycleId: item.createdCycleId,
      createdAt: toIso(item.createdAt)
    };
  }

  private mapCycleWorkload(item: {
    id: string;
    cycleId: string;
    disputeId: string;
    agentAddress: string;
    workload: number;
    createdAt: Date;
    settledAt: Date | null;
  }): CycleWorkload {
    return {
      id: item.id,
      cycleId: item.cycleId,
      disputeId: item.disputeId,
      agent: asAddress(item.agentAddress),
      workload: item.workload,
      createdAt: toIso(item.createdAt),
      settledAt: item.settledAt ? toIso(item.settledAt) : null
    };
  }

  private mapCycle(item: {
    id: string;
    status: unknown;
    mintedAmount: number;
    taxPool: number;
    penaltyPool: number;
    startedAt: Date;
    closedAt: Date | null;
  }): Cycle {
    return {
      id: item.id,
      status: item.status as DomainCycleStatus,
      mintedAmount: item.mintedAmount,
      taxPool: item.taxPool,
      penaltyPool: item.penaltyPool,
      startedAt: toIso(item.startedAt),
      closedAt: item.closedAt ? toIso(item.closedAt) : null
    };
  }

  private mapActivityEvent(item: {
    id: string;
    type: unknown;
    cycleId: string;
    taskId: string | null;
    disputeId: string | null;
    actorAddress: string;
    createdAt: Date;
  }): ActivityEvent {
    return {
      id: item.id,
      type: item.type as DomainActivityEventType,
      cycleId: item.cycleId,
      taskId: item.taskId,
      disputeId: item.disputeId,
      actor: asAddress(item.actorAddress),
      createdAt: toIso(item.createdAt)
    };
  }

  async close(): Promise<void> {
    await this.prisma.$disconnect();
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
      String(error.meta.code ?? "") === "40001"
    ) {
      return true;
    }

    const message = String(
      error && typeof error === "object" && "message" in error ? error.message ?? "" : ""
    );
    return message.includes("40001") || message.includes("could not serialize access");
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private cloneSnapshot(snapshot: EngineStateSnapshot): EngineStateSnapshot {
    return JSON.parse(JSON.stringify(snapshot)) as EngineStateSnapshot;
  }

  private async loadWithTx(tx: Prisma.TransactionClient): Promise<EngineStateSnapshot | null> {
    const runtime = await tx.runtimeState.findUnique({ where: { id: RUNTIME_ID } });
    if (!runtime) {
      return null;
    }

    const [profiles, balances, tasks, submissions, disputes, votes, cycleWorkloads, cycles, activities] =
      await Promise.all([
        tx.agentProfile.findMany(),
        tx.ledgerBalance.findMany(),
        tx.task.findMany(),
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
        tasksAccepted: item.tasksAcceptedCount,
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
      acceptedAgents: asAddressArray(item.acceptedAgents),
      completedAgents: asAddressArray(item.completedAgents),
      createdAt: toIso(item.createdAt),
      updatedAt: toIso(item.updatedAt)
    })) satisfies EngineStateSnapshot["tasks"];

    const mappedSubmissions = submissions.map((item) => ({
      id: item.id,
      taskId: item.taskId,
      agent: asAddress(item.agentAddress),
      payloadMd: item.payloadMd,
      status: item.status as unknown as DomainSubmissionStatus,
      createdAt: toIso(item.createdAt),
      updatedAt: toIso(item.updatedAt)
    })) satisfies EngineStateSnapshot["submissions"];

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
      latestSubmissionByTaskAndAgent
    };
  }
}
