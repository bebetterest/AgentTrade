import type {
  AgentProfile as PrismaAgentProfile,
  CycleWorkload as PrismaCycleWorkload,
  Dispute as PrismaDispute,
  Submission as PrismaSubmission,
  SupervisionVote as PrismaSupervisionVote,
  Task as PrismaTask,
  TaskIntention as PrismaTaskIntention,
  Prisma,
  PrismaClient
} from "@prisma/client";
import type { AppConfig } from "@agentrade/config";
import {
  ActivityEventType as DomainActivityEventType,
  CycleStatus as DomainCycleStatus,
  DisputeStatus as DomainDisputeStatus,
  SubmissionStatus as DomainSubmissionStatus,
  TaskStatus as DomainTaskStatus,
  VoteChoice as DomainVoteChoice,
  type CloseCycleResult,
  type Address,
  type SubmissionAttachment
} from "@agentrade/types";
import { nanoid } from "nanoid";
import { DomainError } from "../domain/errors.js";
import {
  buildWriteSuccessAuditLog,
  type AuditLogCreateInput,
  type WriteAuditContext
} from "../observability/server-logs.js";
import {
  allocateIntegerPool,
  computeSupervisorVoteWeight,
  computeTaxAmount,
  computeTerminationPenalty
} from "../domain/helpers.js";

interface RuntimeLockResult {
  id: string;
  activeCycleId: string;
  updatedAt: Date;
  config: AppConfig;
}

interface UpdateAgentProfileWriteDeps {
  executeWithRetry<T>(operation: () => Promise<T>): Promise<T>;
  lockRuntimeWithTx(tx: Prisma.TransactionClient): Promise<RuntimeLockResult>;
  assertAgentActiveForWriteWithTx(
    tx: Prisma.TransactionClient,
    address: Address,
    now: Date
  ): Promise<void>;
  ensureAgentAndLedgerWithTx(
    tx: Prisma.TransactionClient,
    address: Address,
    now: Date
  ): Promise<void>;
  touchRuntimeStateWithTx(tx: Prisma.TransactionClient): Promise<void>;
  appendAuditLogWithTx(
    tx: Prisma.TransactionClient,
    input: AuditLogCreateInput
  ): Promise<void>;
}

interface CommonWriteDeps {
  executeWithRetry<T>(operation: () => Promise<T>): Promise<T>;
  lockRuntimeWithTx(tx: Prisma.TransactionClient): Promise<RuntimeLockResult>;
  assertAgentActiveForWriteWithTx(
    tx: Prisma.TransactionClient,
    address: Address,
    now: Date
  ): Promise<void>;
  ensureAgentAndLedgerWithTx(
    tx: Prisma.TransactionClient,
    address: Address,
    now: Date
  ): Promise<void>;
  touchRuntimeStateWithTx(tx: Prisma.TransactionClient, activeCycleId?: string): Promise<void>;
  appendAuditLogWithTx(
    tx: Prisma.TransactionClient,
    input: AuditLogCreateInput
  ): Promise<void>;
}

interface RejectSubmissionWriteDeps extends CommonWriteDeps {
  applyProfileDeltaWithTx(
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
  ): Promise<void>;
}

interface AddTaskIntentionWriteDeps extends RejectSubmissionWriteDeps {
  appendActivityEventWithTx(
    tx: Prisma.TransactionClient,
    input: {
      type: DomainActivityEventType;
      cycleId: string;
      taskId: string | null;
      disputeId: string | null;
      actor: Address;
      createdAt: Date;
    }
  ): Promise<void>;
}

interface SubmitTaskWriteDeps extends CommonWriteDeps {
  getConfirmedSlots(slotsTotal: number, rewardPerSlot: number, rewardEscrowRemaining: number): number;
  appendActivityEventWithTx(
    tx: Prisma.TransactionClient,
    input: {
      type: DomainActivityEventType;
      cycleId: string;
      taskId: string | null;
      disputeId: string | null;
      actor: Address;
      createdAt: Date;
    }
  ): Promise<void>;
}

interface ActivityWriteDeps extends RejectSubmissionWriteDeps {
  appendActivityEventWithTx(
    tx: Prisma.TransactionClient,
    input: {
      type: DomainActivityEventType;
      cycleId: string;
      taskId: string | null;
      disputeId: string | null;
      actor: Address;
      createdAt: Date;
    }
  ): Promise<void>;
}

interface ConfirmSubmissionWriteDeps extends CommonWriteDeps {
  getConfirmedSlots(slotsTotal: number, rewardPerSlot: number, rewardEscrowRemaining: number): number;
  confirmSubmissionInternalWithTx(
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
  ): Promise<void>;
}

interface VoteDisputeWriteDeps extends RejectSubmissionWriteDeps {}

interface CloseCycleWriteDeps extends ConfirmSubmissionWriteDeps {
  refreshCycleCloseConfigWithTx(
    tx: Prisma.TransactionClient,
    config: AppConfig
  ): Promise<AppConfig>;
  applyPendingRuntimeRulesForOpenedCycleWithTx(
    tx: Prisma.TransactionClient,
    input: {
      openedCycleId: string;
      actor?: string;
    }
  ): Promise<void>;
  evaluateDisputeWithTx(
    tx: Prisma.TransactionClient,
    disputeId: string,
    config: AppConfig,
    now: Date,
    cycleId: string
  ): Promise<boolean>;
  sweepBannedPublisherCleanTasksWithTx(
    tx: Prisma.TransactionClient,
    now: Date,
    cycleId: string
  ): Promise<void>;
  autoTerminateExpiredCleanTasksWithTx(
    tx: Prisma.TransactionClient,
    now: Date,
    cycleId: string
  ): Promise<void>;
  nextCycleId(currentCycleId: string): string;
}

interface OverrideDisputeWriteDeps {
  executeWithRetry<T>(operation: () => Promise<T>): Promise<T>;
  lockRuntimeWithTx(tx: Prisma.TransactionClient): Promise<RuntimeLockResult>;
  touchRuntimeStateWithTx(tx: Prisma.TransactionClient, activeCycleId?: string): Promise<void>;
  finalizeDisputeWithOutcomeWithTx(
    tx: Prisma.TransactionClient,
    disputeId: string,
    outcome: DomainVoteChoice,
    now: Date,
    cycleId: string
  ): Promise<void>;
  reopenDisputeAsNotCompletedWithTx(
    tx: Prisma.TransactionClient,
    disputeId: string,
    now: Date,
    activeCycleId: string
  ): Promise<void>;
}

export interface PublishTaskDirectInput {
  publisher: Address;
  title: string;
  descriptionMd: string;
  acceptanceCriteria: string;
  deadlineUtc: string;
  displayTimezone: string;
  slotsTotal: number;
  rewardPerSlot: number;
  allowRepeatCompletionsBySameAgent: boolean;
  auditContext?: WriteAuditContext;
}

export interface OpenDisputeDirectInput {
  taskId: string;
  submissionId: string;
  opener: Address;
  reasonMd: string;
  auditContext?: WriteAuditContext;
}

export interface SubmitTaskDirectInput {
  taskId: string;
  agent: Address;
  payloadMd: string;
  attachments?: SubmissionAttachment[];
  auditContext?: WriteAuditContext;
}

export interface RejectSubmissionDirectInput {
  submissionId: string;
  publisher: Address;
  reasonMd: string;
  auditContext?: WriteAuditContext;
}

export interface TaskIntentionListDirectInput {
  taskId: string;
  cursor?: string;
  limit: number;
}

export interface VoteDisputeDirectInput {
  disputeId: string;
  agent: Address;
  vote: DomainVoteChoice;
  auditContext?: WriteAuditContext;
}

export interface RespondDisputeDirectInput {
  disputeId: string;
  responder: Address;
  reasonMd: string;
  auditContext?: WriteAuditContext;
}

const asAddress = (value: string): Address => value as Address;
const asStringArray = (value: Prisma.JsonValue): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
};
const asAddressArray = (value: Prisma.JsonValue): Address[] =>
  asStringArray(value).map((item) => asAddress(item));
const toJsonAddressArray = (value: string[]): Prisma.InputJsonValue =>
  value as unknown as Prisma.InputJsonValue;
const toJsonSubmissionAttachments = (
  value: SubmissionAttachment[]
): Prisma.InputJsonValue => value as unknown as Prisma.InputJsonValue;

const appendSuccessAuditIfPresent = async (
  tx: Prisma.TransactionClient,
  deps: {
    appendAuditLogWithTx(tx: Prisma.TransactionClient, input: AuditLogCreateInput): Promise<void>;
  },
  auditContext: WriteAuditContext | undefined,
  input: {
    targetId?: string | null;
    cycleId?: string | null;
    message?: string;
    details?: Record<string, unknown> | null;
  } = {}
): Promise<void> => {
  if (!auditContext) {
    return;
  }
  await deps.appendAuditLogWithTx(
    tx,
    buildWriteSuccessAuditLog(auditContext, {
      targetId: input.targetId,
      cycleId: input.cycleId,
      message: input.message,
      details: input.details
    })
  );
};

const validateSubmissionAttachments = (
  attachments: SubmissionAttachment[],
  input: {
    taskSubmissionAttachmentMaxCount: number;
    taskSubmissionAttachmentNameMaxLength: number;
    taskSubmissionAttachmentUrlMaxLength: number;
    taskSubmissionAttachmentMaxSizeBytes: number;
  }
): void => {
  if (attachments.length > input.taskSubmissionAttachmentMaxCount) {
    throw new DomainError(
      "INVALID_SUBMISSION_ATTACHMENTS",
      `attachments must contain <= ${input.taskSubmissionAttachmentMaxCount} items`,
      400
    );
  }
  for (const attachment of attachments) {
    if (attachment.name.trim().length === 0) {
      throw new DomainError(
        "INVALID_SUBMISSION_ATTACHMENTS",
        "attachment name must be non-empty",
        400
      );
    }
    if (attachment.name.length > input.taskSubmissionAttachmentNameMaxLength) {
      throw new DomainError(
        "INVALID_SUBMISSION_ATTACHMENTS",
        `attachment name must be <= ${input.taskSubmissionAttachmentNameMaxLength} chars`,
        400
      );
    }
    if (attachment.url.length > input.taskSubmissionAttachmentUrlMaxLength) {
      throw new DomainError(
        "INVALID_SUBMISSION_ATTACHMENTS",
        `attachment url must be <= ${input.taskSubmissionAttachmentUrlMaxLength} chars`,
        400
      );
    }
    try {
      const parsed = new URL(attachment.url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("invalid protocol");
      }
    } catch {
      throw new DomainError(
        "INVALID_SUBMISSION_ATTACHMENTS",
        "attachment url must be a valid http(s) URL",
        400
      );
    }
    if (attachment.mimeType && attachment.mimeType.trim().length === 0) {
      throw new DomainError(
        "INVALID_SUBMISSION_ATTACHMENTS",
        "attachment mimeType must be non-empty when provided",
        400
      );
    }
    if (attachment.sizeBytes !== undefined) {
      if (!Number.isSafeInteger(attachment.sizeBytes) || attachment.sizeBytes < 0) {
        throw new DomainError(
          "INVALID_SUBMISSION_ATTACHMENTS",
          "attachment sizeBytes must be a non-negative safe integer",
          400
        );
      }
      if (attachment.sizeBytes > input.taskSubmissionAttachmentMaxSizeBytes) {
        throw new DomainError(
          "INVALID_SUBMISSION_ATTACHMENTS",
          `attachment sizeBytes must be <= ${input.taskSubmissionAttachmentMaxSizeBytes}`,
          400
        );
      }
    }
  }
};

export const writeUpdateAgentProfileDirect = async (
  prisma: PrismaClient,
  deps: UpdateAgentProfileWriteDeps,
  address: Address,
  payload: { name?: string; bio?: string },
  auditContext?: WriteAuditContext
): Promise<PrismaAgentProfile> => {
  return deps.executeWithRetry(async () =>
    prisma.$transaction(async (tx) => {
      const now = new Date();
      const runtime = await deps.lockRuntimeWithTx(tx);
      await deps.assertAgentActiveForWriteWithTx(tx, address, now);
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
      await deps.touchRuntimeStateWithTx(tx);
      await appendSuccessAuditIfPresent(tx, deps, auditContext, {
        targetId: address,
        cycleId: runtime.activeCycleId,
        message: "agents.update-profile succeeded",
        details: {
          updatedFields: [
            ...(payload.name !== undefined ? ["name"] : []),
            ...(payload.bio !== undefined ? ["bio"] : [])
          ]
        }
      });
      return updated;
    })
  );
};

export const writeRejectSubmissionDirect = async (
  prisma: PrismaClient,
  deps: ActivityWriteDeps,
  input: RejectSubmissionDirectInput
): Promise<PrismaSubmission> => {
  return deps.executeWithRetry(async () =>
    prisma.$transaction(async (tx) => {
      const runtime = await deps.lockRuntimeWithTx(tx);
      const now = new Date();
      await deps.assertAgentActiveForWriteWithTx(tx, input.publisher, now);
      await tx.$queryRaw`SELECT id FROM "Submission" WHERE id = ${input.submissionId} FOR UPDATE`;
      const submissionRow = await tx.submission.findUnique({ where: { id: input.submissionId } });
      if (!submissionRow) {
        throw new DomainError("SUBMISSION_NOT_FOUND", `Submission ${input.submissionId} not found`, 404);
      }
      const task = await tx.task.findUnique({ where: { id: submissionRow.taskId } });
      if (!task) {
        throw new DomainError("TASK_NOT_FOUND", `Task ${submissionRow.taskId} does not exist`, 404);
      }
      if (task.publisherAddress !== input.publisher) {
        throw new DomainError("FORBIDDEN", "only the publisher can reject submission", 403);
      }
      if (input.reasonMd.trim().length === 0 || input.reasonMd.length > runtime.config.disputeReasonMaxLength) {
        throw new DomainError(
          "INVALID_REJECT_REASON",
          `reasonMd must be non-empty and <= ${runtime.config.disputeReasonMaxLength} chars`,
          400
        );
      }
      if (submissionRow.status !== DomainSubmissionStatus.SUBMITTED) {
        throw new DomainError("SUBMISSION_NOT_PENDING", "submission is not in submitted state", 409);
      }

      await deps.ensureAgentAndLedgerWithTx(tx, asAddress(submissionRow.agentAddress), now);
      const updated = await tx.submission.update({
        where: { id: input.submissionId },
        data: {
          status: DomainSubmissionStatus.REJECTED,
          rejectReasonMd: input.reasonMd,
          updatedAt: now
        }
      });
      await deps.applyProfileDeltaWithTx(tx, asAddress(submissionRow.agentAddress), now, {
        workerReputationDelta: -1,
        submissionsRejected: 1
      });
      await deps.appendActivityEventWithTx(tx, {
        type: DomainActivityEventType.SUBMISSION_REJECTED,
        cycleId: runtime.activeCycleId,
        taskId: task.id,
        disputeId: null,
        actor: input.publisher,
        createdAt: now
      });
      await deps.touchRuntimeStateWithTx(tx);
      await appendSuccessAuditIfPresent(tx, deps, input.auditContext, {
        targetId: updated.id,
        cycleId: runtime.activeCycleId,
        message: "submissions.reject succeeded",
        details: {
          taskId: task.id,
          submissionId: updated.id,
          status: updated.status
        }
      });
      return updated;
    })
  );
};

export const writeAddTaskIntentionDirect = async (
  prisma: PrismaClient,
  deps: AddTaskIntentionWriteDeps,
  taskId: string,
  agent: Address,
  auditContext?: WriteAuditContext
): Promise<PrismaTaskIntention> => {
  return deps.executeWithRetry(async () =>
    prisma.$transaction(async (tx) => {
      const now = new Date();
      const runtime = await deps.lockRuntimeWithTx(tx);
      await deps.assertAgentActiveForWriteWithTx(tx, agent, now);

      await tx.$queryRaw`SELECT id FROM "Task" WHERE id = ${taskId} FOR UPDATE`;
      const taskRow = await tx.task.findUnique({ where: { id: taskId } });
      if (!taskRow) {
        throw new DomainError("TASK_NOT_FOUND", `Task ${taskId} does not exist`, 404);
      }
      const publisher = await tx.agentProfile.findUnique({
        where: { address: taskRow.publisherAddress },
        select: { status: true }
      });
      if (publisher?.status === "BANNED") {
        throw new DomainError("TASK_FROZEN", "task is frozen because publisher account is banned", 409);
      }

      if (taskRow.status === DomainTaskStatus.TERMINATED || taskRow.status === DomainTaskStatus.CLOSED) {
        throw new DomainError("TASK_NOT_INTENTABLE", "task is not open for intentions", 409);
      }
      if (taskRow.deadlineUtc.getTime() <= now.getTime()) {
        throw new DomainError("TASK_NOT_INTENTABLE", "task deadline has passed", 409);
      }

      const completedAgents = asAddressArray(taskRow.completedAgents);

      if (!taskRow.allowRepeatCompletionsBySameAgent && completedAgents.includes(agent)) {
        throw new DomainError("REPEAT_NOT_ALLOWED", "agent already completed this task", 409);
      }
      const existing = await tx.taskIntention.findFirst({
        where: {
          taskId,
          agentAddress: agent
        },
        select: { id: true }
      });
      if (existing) {
        throw new DomainError(
          "TASK_INTENT_ALREADY_EXISTS",
          "agent already added intention for this task",
          409
        );
      }

      const created = await tx.taskIntention.create({
        data: {
          id: nanoid(),
          taskId,
          agentAddress: agent,
          createdAt: now
        }
      });
      await tx.task.update({
        where: { id: taskRow.id },
        data: {
          intentCount: {
            increment: 1
          },
          updatedAt: now
        }
      });
      await deps.applyProfileDeltaWithTx(tx, agent, now, {
        tasksIntented: 1
      });
      await deps.appendActivityEventWithTx(tx, {
        type: DomainActivityEventType.TASK_INTENDED,
        cycleId: runtime.activeCycleId,
        taskId: taskRow.id,
        disputeId: null,
        actor: agent,
        createdAt: now
      });
      await deps.touchRuntimeStateWithTx(tx);
      await appendSuccessAuditIfPresent(tx, deps, auditContext, {
        targetId: created.id,
        cycleId: runtime.activeCycleId,
        message: "tasks.intend succeeded",
        details: {
          taskId,
          intentionId: created.id
        }
      });
      return created;
    })
  );
};

export const writeSubmitTaskDirect = async (
  prisma: PrismaClient,
  deps: SubmitTaskWriteDeps,
  input: SubmitTaskDirectInput
): Promise<PrismaSubmission> => {
  const txResult = await deps.executeWithRetry(async () =>
    prisma.$transaction(async (tx) => {
      const now = new Date();
      const runtime = await deps.lockRuntimeWithTx(tx);
      const config = runtime.config;
      await deps.assertAgentActiveForWriteWithTx(tx, input.agent, now);

      await tx.$queryRaw`SELECT id FROM "Task" WHERE id = ${input.taskId} FOR UPDATE`;
      const taskRow = await tx.task.findUnique({ where: { id: input.taskId } });
      if (!taskRow) {
        throw new DomainError("TASK_NOT_FOUND", `Task ${input.taskId} does not exist`, 404);
      }
      const publisher = await tx.agentProfile.findUnique({
        where: { address: taskRow.publisherAddress },
        select: { status: true }
      });
      if (publisher?.status === "BANNED") {
        throw new DomainError("TASK_FROZEN", "task is frozen because publisher account is banned", 409);
      }
      if (
        input.payloadMd.trim().length === 0 ||
        input.payloadMd.length > config.taskSubmissionPayloadMaxLength
      ) {
        throw new DomainError(
          "INVALID_SUBMISSION_PAYLOAD",
          `payloadMd must be non-empty and <= ${config.taskSubmissionPayloadMaxLength} chars`,
          400
        );
      }
      const attachments = input.attachments ?? [];
      validateSubmissionAttachments(attachments, config);
      if (taskRow.status === DomainTaskStatus.TERMINATED || taskRow.status === DomainTaskStatus.CLOSED) {
        throw new DomainError("TASK_NOT_SUBMITTABLE", "task is not open for submissions", 409);
      }
      const confirmedSlots = deps.getConfirmedSlots(
        taskRow.slotsTotal,
        taskRow.rewardPerSlot,
        taskRow.rewardEscrowRemaining
      );
      if (confirmedSlots >= taskRow.slotsTotal || taskRow.rewardEscrowRemaining < taskRow.rewardPerSlot) {
        await tx.task.update({
          where: { id: taskRow.id },
          data: {
            status: DomainTaskStatus.CLOSED,
            updatedAt: now
          }
        });
        await deps.touchRuntimeStateWithTx(tx);
        return { kind: "noSlots" as const };
      }
      if (taskRow.deadlineUtc.getTime() <= now.getTime()) {
        throw new DomainError("TASK_EXPIRED", "task deadline has passed", 409);
      }

      const intention = await tx.taskIntention.findFirst({
        where: {
          taskId: taskRow.id,
          agentAddress: input.agent
        },
        select: { id: true }
      });
      if (!intention) {
        throw new DomainError("TASK_INTENT_REQUIRED", "agent must add task intention before submission", 403);
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
        const cooldownMs = config.resubmitCooldownMinutes * 60_000;
        if (elapsedMs < cooldownMs) {
          throw new DomainError(
            "RESUBMIT_COOLDOWN",
            `resubmission cooldown not reached (${config.resubmitCooldownMinutes} minutes)`,
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
          attachments: toJsonSubmissionAttachments(attachments),
          rejectReasonMd: null,
          status: DomainSubmissionStatus.SUBMITTED,
          createdAt: now,
          updatedAt: now
        }
      });
      if (taskRow.status === DomainTaskStatus.OPEN) {
        await tx.task.update({
          where: { id: taskRow.id },
          data: {
            status: DomainTaskStatus.IN_PROGRESS,
            updatedAt: now
          }
        });
      }
      await deps.appendActivityEventWithTx(tx, {
        type: DomainActivityEventType.TASK_SUBMITTED,
        cycleId: runtime.activeCycleId,
        taskId: taskRow.id,
        disputeId: null,
        actor: input.agent,
        createdAt: now
      });
      await deps.touchRuntimeStateWithTx(tx);
      await appendSuccessAuditIfPresent(tx, deps, input.auditContext, {
        targetId: created.id,
        cycleId: runtime.activeCycleId,
        message: "tasks.submit succeeded",
        details: {
          taskId: taskRow.id,
          submissionId: created.id,
          attachmentCount: attachments.length
        }
      });
      return { kind: "created" as const, submission: created };
    })
  );

  if (txResult.kind === "noSlots") {
    throw new DomainError("TASK_NOT_SUBMITTABLE", "task is not open for submissions", 409);
  }
  return txResult.submission;
};

export const writePublishTaskDirect = async (
  prisma: PrismaClient,
  deps: ActivityWriteDeps,
  input: PublishTaskDirectInput
): Promise<PrismaTask> => {
  return deps.executeWithRetry(async () =>
    prisma.$transaction(async (tx) => {
      const now = new Date();
      const runtime = await deps.lockRuntimeWithTx(tx);
      const config = runtime.config;
      await deps.assertAgentActiveForWriteWithTx(tx, input.publisher, now);

      const normalizedTitle = input.title.trim();
      if (normalizedTitle.length === 0 || input.title.length > config.taskTitleMaxLength) {
        throw new DomainError(
          "INVALID_TASK_TITLE",
          `title must be non-empty and <= ${config.taskTitleMaxLength} chars`,
          400
        );
      }
      if (
        input.descriptionMd.trim().length === 0 ||
        input.descriptionMd.length > config.taskDescriptionMaxLength
      ) {
        throw new DomainError(
          "INVALID_TASK_DESCRIPTION",
          `description must be non-empty and <= ${config.taskDescriptionMaxLength} chars`,
          400
        );
      }
      if (
        input.acceptanceCriteria.trim().length === 0 ||
        input.acceptanceCriteria.length > config.taskAcceptanceCriteriaMaxLength
      ) {
        throw new DomainError(
          "INVALID_ACCEPTANCE_CRITERIA",
          `acceptanceCriteria must be non-empty and <= ${config.taskAcceptanceCriteriaMaxLength} chars`,
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
      const maxDeadlineMs = now.getTime() + config.taskDeadlineMaxHours * 3_600_000;
      if (deadlineMs > maxDeadlineMs) {
        throw new DomainError(
          "INVALID_DEADLINE",
          `deadlineUtc must be within ${config.taskDeadlineMaxHours} hours`,
          400
        );
      }

      if (
        !Number.isSafeInteger(input.slotsTotal) ||
        input.slotsTotal <= 0 ||
        input.slotsTotal > config.taskSlotsMax
      ) {
        throw new DomainError(
          "INVALID_SLOTS",
          `slotsTotal must be a safe integer in [1, ${config.taskSlotsMax}]`,
          400
        );
      }
      if (
        !Number.isSafeInteger(input.rewardPerSlot) ||
        input.rewardPerSlot < config.rewardMin ||
        input.rewardPerSlot > config.taskRewardPerSlotMax
      ) {
        throw new DomainError(
          "INVALID_REWARD",
          `rewardPerSlot must be a safe integer in [${config.rewardMin}, ${config.taskRewardPerSlotMax}]`,
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

      const taxAmount = computeTaxAmount(totalReward, config);
      if (!Number.isSafeInteger(taxAmount) || taxAmount < 0) {
        throw new DomainError("INVALID_TASK_BUDGET", "task tax amount is invalid", 400);
      }
      const totalCost = totalReward + taxAmount;
      if (!Number.isSafeInteger(totalCost) || totalCost <= 0) {
        throw new DomainError("INVALID_TASK_BUDGET", "task total cost is outside supported integer range", 400);
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
          intentCount: 0,
          completedAgents: toJsonAddressArray([]),
          createdAt: now,
          updatedAt: now
        }
      });

      await deps.applyProfileDeltaWithTx(tx, input.publisher, now, {
        publisherReputationDelta: 1,
        tasksPublished: 1
      });
      await deps.appendActivityEventWithTx(tx, {
        type: DomainActivityEventType.TASK_PUBLISHED,
        cycleId: runtime.activeCycleId,
        taskId: created.id,
        disputeId: null,
        actor: input.publisher,
        createdAt: now
      });
      await deps.touchRuntimeStateWithTx(tx);
      await appendSuccessAuditIfPresent(tx, deps, input.auditContext, {
        targetId: created.id,
        cycleId: runtime.activeCycleId,
        message: "tasks.create succeeded",
        details: {
          taskId: created.id,
          slotsTotal: input.slotsTotal,
          rewardPerSlot: input.rewardPerSlot
        }
      });
      return created;
    })
  );
};

export const writeTerminateTaskDirect = async (
  prisma: PrismaClient,
  deps: ActivityWriteDeps,
  taskId: string,
  publisher: Address,
  auditContext?: WriteAuditContext
): Promise<PrismaTask> => {
  return deps.executeWithRetry(async () =>
    prisma.$transaction(async (tx) => {
      const runtime = await deps.lockRuntimeWithTx(tx);
      const now = new Date();
      await deps.assertAgentActiveForWriteWithTx(tx, publisher, now);
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
      const hasOpenDispute = await tx.dispute.findFirst({
        where: {
          taskId: taskRow.id,
          status: DomainDisputeStatus.OPEN
        },
        select: { id: true }
      });
      if (hasOpenDispute) {
        throw new DomainError(
          "TASK_NOT_TERMINABLE",
          "task has an open dispute and cannot be manually terminated",
          409
        );
      }

      const penalty = computeTerminationPenalty(taskRow.rewardEscrowRemaining, runtime.config);
      const refund = Math.max(0, taskRow.rewardEscrowRemaining - penalty);
      await deps.ensureAgentAndLedgerWithTx(tx, asAddress(taskRow.publisherAddress), now);
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
      await deps.applyProfileDeltaWithTx(tx, asAddress(taskRow.publisherAddress), now, {
        publisherReputationDelta: -1,
        tasksTerminated: 1
      });
      await deps.appendActivityEventWithTx(tx, {
        type: DomainActivityEventType.TASK_TERMINATED,
        cycleId: runtime.activeCycleId,
        taskId: taskRow.id,
        disputeId: null,
        actor: publisher,
        createdAt: now
      });
      await deps.touchRuntimeStateWithTx(tx);
      await appendSuccessAuditIfPresent(tx, deps, auditContext, {
        targetId: updated.id,
        cycleId: runtime.activeCycleId,
        message: "tasks.terminate succeeded",
        details: {
          taskId: updated.id,
          penalty,
          refund
        }
      });
      return updated;
    })
  );
};

export const writeOpenDisputeDirect = async (
  prisma: PrismaClient,
  deps: ActivityWriteDeps,
  input: OpenDisputeDirectInput
): Promise<PrismaDispute> => {
  try {
    return await deps.executeWithRetry(async () =>
      prisma.$transaction(async (tx) => {
        const runtime = await deps.lockRuntimeWithTx(tx);
        const now = new Date();
        await deps.assertAgentActiveForWriteWithTx(tx, input.opener, now);
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
        if (task.status === DomainTaskStatus.TERMINATED) {
          throw new DomainError(
            "SUBMISSION_NOT_DISPUTABLE",
            "submission task is terminated and can no longer be disputed",
            409
          );
        }
        if (input.reasonMd.trim().length === 0 || input.reasonMd.length > runtime.config.disputeReasonMaxLength) {
          throw new DomainError(
            "INVALID_DISPUTE_REASON",
            `reasonMd must be non-empty and <= ${runtime.config.disputeReasonMaxLength} chars`,
            400
          );
        }
        if (
          input.opener !== asAddress(task.publisherAddress) &&
          input.opener !== asAddress(submission.agentAddress)
        ) {
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
        await deps.appendActivityEventWithTx(tx, {
          type: DomainActivityEventType.DISPUTE_OPENED,
          cycleId: runtime.activeCycleId,
          taskId: task.id,
          disputeId: created.id,
          actor: input.opener,
          createdAt: now
        });
        await deps.touchRuntimeStateWithTx(tx);
        await appendSuccessAuditIfPresent(tx, deps, input.auditContext, {
          targetId: created.id,
          cycleId: runtime.activeCycleId,
          message: "disputes.open succeeded",
          details: {
            taskId: task.id,
            submissionId: submission.id,
            disputeId: created.id
          }
        });
        return created;
      })
    );
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code ?? "") : "";
    if (code === "P2002") {
      throw new DomainError(
        "OPEN_DISPUTE_ALREADY_EXISTS",
        "an open dispute already exists for this submission",
        409
      );
    }
    throw error;
  }
};

export const writeRespondDisputeDirect = async (
  prisma: PrismaClient,
  deps: CommonWriteDeps,
  input: RespondDisputeDirectInput
): Promise<PrismaDispute> => {
  return deps.executeWithRetry(async () =>
    prisma.$transaction(async (tx) => {
      const now = new Date();
      const runtime = await deps.lockRuntimeWithTx(tx);
      await deps.assertAgentActiveForWriteWithTx(tx, input.responder, now);
      await tx.$queryRaw`SELECT id FROM "Dispute" WHERE id = ${input.disputeId} FOR UPDATE`;
      const dispute = await tx.dispute.findUnique({ where: { id: input.disputeId } });
      if (!dispute) {
        throw new DomainError("DISPUTE_NOT_FOUND", `Dispute ${input.disputeId} does not exist`, 404);
      }
      if (dispute.status !== DomainDisputeStatus.OPEN) {
        throw new DomainError("DISPUTE_CLOSED", "dispute is already resolved", 409);
      }
      if (input.reasonMd.trim().length === 0 || input.reasonMd.length > runtime.config.disputeReasonMaxLength) {
        throw new DomainError(
          "INVALID_DISPUTE_REASON",
          `reasonMd must be non-empty and <= ${runtime.config.disputeReasonMaxLength} chars`,
          400
        );
      }
      const task = await tx.task.findUnique({
        where: { id: dispute.taskId },
        select: { id: true, publisherAddress: true }
      });
      if (!task) {
        throw new DomainError("TASK_NOT_FOUND", `Task ${dispute.taskId} does not exist`, 404);
      }
      const submission = await tx.submission.findUnique({
        where: { id: dispute.submissionId },
        select: { id: true, taskId: true, agentAddress: true }
      });
      if (!submission) {
        throw new DomainError("SUBMISSION_NOT_FOUND", `Submission ${dispute.submissionId} not found`, 404);
      }
      if (submission.taskId !== task.id) {
        throw new DomainError("MISMATCH", "submission does not belong to task", 400);
      }
      const opener = asAddress(dispute.openerAddress);
      const publisher = asAddress(task.publisherAddress);
      const submissionAgent = asAddress(submission.agentAddress);
      if (opener !== publisher && opener !== submissionAgent) {
        throw new DomainError("MISMATCH", "dispute opener does not match task/submission parties", 400);
      }
      const counterparty = opener === publisher ? submissionAgent : publisher;
      if (input.responder !== counterparty) {
        throw new DomainError(
          "DISPUTE_COUNTERPARTY_ONLY",
          "only the non-opener party can submit dispute counterparty reason",
          403
        );
      }
      if (dispute.counterpartyReasonMd && dispute.counterpartyReasonMd.trim().length > 0) {
        throw new DomainError(
          "DISPUTE_COUNTERPARTY_REASON_ALREADY_EXISTS",
          "counterparty reason already submitted",
          409
        );
      }

      const updated = await tx.dispute.update({
        where: { id: dispute.id },
        data: {
          counterpartyResponderAddress: input.responder,
          counterpartyReasonMd: input.reasonMd,
          updatedAt: now
        }
      });
      await deps.touchRuntimeStateWithTx(tx);
      await appendSuccessAuditIfPresent(tx, deps, input.auditContext, {
        targetId: updated.id,
        cycleId: runtime.activeCycleId,
        message: "disputes.respond succeeded",
        details: {
          disputeId: updated.id,
          taskId: task.id,
          submissionId: submission.id
        }
      });
      return updated;
    })
  );
};

export const writeConfirmSubmissionDirect = async (
  prisma: PrismaClient,
  deps: ConfirmSubmissionWriteDeps,
  submissionId: string,
  publisher: Address,
  auditContext?: WriteAuditContext
): Promise<PrismaSubmission> => {
  const txResult = await deps.executeWithRetry(async () =>
    prisma.$transaction(async (tx) => {
      const now = new Date();
      const runtime = await deps.lockRuntimeWithTx(tx);
      await deps.assertAgentActiveForWriteWithTx(tx, publisher, now);
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
      const hasOpenDispute = await tx.dispute.findFirst({
        where: {
          submissionId: submissionRow.id,
          status: DomainDisputeStatus.OPEN
        },
        select: { id: true }
      });
      if (hasOpenDispute) {
        throw new DomainError(
          "SUBMISSION_NOT_CONFIRMABLE",
          "submission has an open dispute and cannot be manually confirmed",
          409
        );
      }
      if (submissionRow.status === DomainSubmissionStatus.CONFIRMED) {
        await appendSuccessAuditIfPresent(tx, deps, auditContext, {
          targetId: submissionRow.id,
          cycleId: runtime.activeCycleId,
          message: "submissions.confirm succeeded",
          details: {
            taskId: taskRow.id,
            submissionId: submissionRow.id,
            alreadyConfirmed: true
          }
        });
        return { kind: "confirmed" as const, submission: submissionRow };
      }
      if (
        submissionRow.status !== DomainSubmissionStatus.SUBMITTED &&
        submissionRow.status !== DomainSubmissionStatus.REJECTED
      ) {
        throw new DomainError(
          "SUBMISSION_NOT_CONFIRMABLE",
          "submission cannot be confirmed from this state",
          409
        );
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

      const confirmedSlotsBefore = deps.getConfirmedSlots(
        taskRow.slotsTotal,
        taskRow.rewardPerSlot,
        taskRow.rewardEscrowRemaining
      );
      if (confirmedSlotsBefore >= taskRow.slotsTotal || taskRow.rewardEscrowRemaining < taskRow.rewardPerSlot) {
        await tx.task.update({
          where: { id: taskRow.id },
          data: {
            status: DomainTaskStatus.CLOSED,
            updatedAt: now
          }
        });
        await deps.touchRuntimeStateWithTx(tx);
        return { kind: "noSlots" as const };
      }

      await deps.confirmSubmissionInternalWithTx(
        tx,
        submissionRow,
        taskRow,
        now,
        runtime.activeCycleId,
        publisher
      );
      await deps.touchRuntimeStateWithTx(tx);
      const submission = await tx.submission.findUniqueOrThrow({ where: { id: submissionRow.id } });
      await appendSuccessAuditIfPresent(tx, deps, auditContext, {
        targetId: submission.id,
        cycleId: runtime.activeCycleId,
        message: "submissions.confirm succeeded",
        details: {
          taskId: taskRow.id,
          submissionId: submission.id,
          alreadyConfirmed: false
        }
      });
      return { kind: "confirmed" as const, submission };
    })
  );

  if (txResult.kind === "noSlots") {
    throw new DomainError("SUBMISSION_NOT_CONFIRMABLE", "task has no remaining payable slots", 409);
  }
  return txResult.submission;
};

export const writeVoteDisputeDirect = async (
  prisma: PrismaClient,
  deps: VoteDisputeWriteDeps,
  input: VoteDisputeDirectInput
): Promise<{ vote: PrismaSupervisionVote; workload: PrismaCycleWorkload }> => {
  try {
    return await deps.executeWithRetry(async () =>
      prisma.$transaction(async (tx) => {
        const now = new Date();
        const runtime = await deps.lockRuntimeWithTx(tx);
        await deps.assertAgentActiveForWriteWithTx(tx, input.agent, now);

        await tx.$queryRaw`SELECT id FROM "Dispute" WHERE id = ${input.disputeId} FOR UPDATE`;
        const dispute = await tx.dispute.findUnique({ where: { id: input.disputeId } });
        if (!dispute) {
          throw new DomainError("DISPUTE_NOT_FOUND", `Dispute ${input.disputeId} does not exist`, 404);
        }
        if (dispute.status !== DomainDisputeStatus.OPEN) {
          throw new DomainError("DISPUTE_CLOSED", "dispute is already resolved", 409);
        }
        const task = await tx.task.findUnique({
          where: { id: dispute.taskId },
          select: { id: true, publisherAddress: true }
        });
        if (!task) {
          throw new DomainError("TASK_NOT_FOUND", `Task ${dispute.taskId} does not exist`, 404);
        }
        const submission = await tx.submission.findUnique({
          where: { id: dispute.submissionId },
          select: { id: true, taskId: true, agentAddress: true }
        });
        if (!submission) {
          throw new DomainError("SUBMISSION_NOT_FOUND", `Submission ${dispute.submissionId} not found`, 404);
        }
        if (submission.taskId !== task.id) {
          throw new DomainError("MISMATCH", "submission does not belong to task", 400);
        }
        const opener = asAddress(dispute.openerAddress);
        const publisher = asAddress(task.publisherAddress);
        const submissionAgent = asAddress(submission.agentAddress);
        if (opener !== publisher && opener !== submissionAgent) {
          throw new DomainError("MISMATCH", "dispute opener does not match task/submission parties", 400);
        }
        if (
          input.agent === publisher ||
          input.agent === submissionAgent
        ) {
          throw new DomainError(
            "DISPUTE_PARTY_CANNOT_VOTE",
            "dispute parties cannot vote; only third-party supervisors can vote",
            403
          );
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
          runtime.config
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
            taskId: null,
            agentAddress: input.agent,
            workload: 1,
            createdAt: now,
            settledAt: null
          }
        });

        await deps.applyProfileDeltaWithTx(tx, input.agent, now, {
          supervisorReputationDelta: 0.5,
          supervisionVotes: 1
        });
        await deps.touchRuntimeStateWithTx(tx);
        await appendSuccessAuditIfPresent(tx, deps, input.auditContext, {
          targetId: vote.id,
          cycleId: runtime.activeCycleId,
          message: "disputes.vote succeeded",
          details: {
            disputeId: input.disputeId,
            voteId: vote.id,
            workloadId: workload.id,
            vote: input.vote
          }
        });
        return { vote, workload };
      })
    );
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
};

const writeCloseCurrentCycleInternal = async (
  prisma: PrismaClient,
  deps: CloseCycleWriteDeps,
  options: { closeOnlyWhenDue: boolean }
): Promise<CloseCycleResult | null> => {
  return deps.executeWithRetry(async () =>
    prisma.$transaction(async (tx) => {
      const runtime = await deps.lockRuntimeWithTx(tx);
      const cycleConfig = await deps.refreshCycleCloseConfigWithTx(tx, runtime.config);
      const now = new Date();
      const cycle = await tx.cycle.findUnique({ where: { id: runtime.activeCycleId } });
      if (!cycle) {
        throw new DomainError("CYCLE_NOT_FOUND", `Cycle ${runtime.activeCycleId} not found`, 404);
      }
      if (options.closeOnlyWhenDue) {
        const closeDueAtMs = cycle.startedAt.getTime() + cycleConfig.cycleDurationHours * 3_600_000;
        if (!Number.isFinite(closeDueAtMs) || now.getTime() < closeDueAtMs) {
          return null;
        }
      }

      const staleThreshold = new Date(now.getTime() - cycleConfig.submissionTimeoutHours * 3_600_000);
      const staleSubmissions = await tx.submission.findMany({
        where: {
          status: DomainSubmissionStatus.SUBMITTED,
          createdAt: { lte: staleThreshold }
        },
        orderBy: { createdAt: "asc" }
      });
      const staleTaskIds = [...new Set(staleSubmissions.map((item) => item.taskId))];
      const staleTasks =
        staleTaskIds.length > 0
          ? await tx.task.findMany({
              where: {
                id: {
                  in: staleTaskIds
                }
              }
            })
          : [];
      const staleTaskById = new Map(staleTasks.map((item) => [item.id, item]));

      for (const stale of staleSubmissions) {
        const task = staleTaskById.get(stale.taskId);
        if (!task) {
          throw new DomainError("TASK_NOT_FOUND", `Task ${stale.taskId} does not exist`, 404);
        }
        if (task.status === DomainTaskStatus.TERMINATED || task.status === DomainTaskStatus.CLOSED) {
          continue;
        }
        const confirmedSlots = deps.getConfirmedSlots(task.slotsTotal, task.rewardPerSlot, task.rewardEscrowRemaining);
        if (confirmedSlots >= task.slotsTotal || task.rewardEscrowRemaining < task.rewardPerSlot) {
          await tx.task.update({
            where: { id: task.id },
            data: {
              status: DomainTaskStatus.CLOSED,
              updatedAt: now
            }
          });
          continue;
        }

        await deps.confirmSubmissionInternalWithTx(
          tx,
          stale,
          task,
          now,
          runtime.activeCycleId,
          asAddress(task.publisherAddress)
        );
        const completedAgents = asAddressArray(task.completedAgents);
        if (!completedAgents.includes(asAddress(stale.agentAddress))) {
          completedAgents.push(asAddress(stale.agentAddress));
        }
        const nextRewardEscrowRemaining = task.rewardEscrowRemaining - task.rewardPerSlot;
        const nextConfirmedSlots = deps.getConfirmedSlots(
          task.slotsTotal,
          task.rewardPerSlot,
          nextRewardEscrowRemaining
        );
        staleTaskById.set(task.id, {
          ...task,
          rewardEscrowRemaining: nextRewardEscrowRemaining,
          completedAgents: completedAgents as unknown as Prisma.JsonValue,
          status:
            nextConfirmedSlots >= task.slotsTotal
              ? DomainTaskStatus.CLOSED
              : (task.status as DomainTaskStatus),
          updatedAt: now
        });
      }

      await deps.sweepBannedPublisherCleanTasksWithTx(tx, now, runtime.activeCycleId);

      const finalizedDisputes: string[] = [];
      const openDisputes = await tx.dispute.findMany({
        where: { status: DomainDisputeStatus.OPEN },
        orderBy: { createdAt: "asc" }
      });
      const openDisputeIds = openDisputes.map((item) => item.id);
      const openDisputeVotes =
        openDisputeIds.length > 0
          ? await tx.supervisionVote.findMany({
              where: {
                disputeId: {
                  in: openDisputeIds
                }
              },
              select: {
                disputeId: true,
                vote: true,
                weightSnapshot: true
              }
            })
          : [];
      const openDisputeVoteStats = new Map<
        string,
        { voteCount: number; totalWeight: number; completedWeight: number }
      >();
      for (const vote of openDisputeVotes) {
        const stats = openDisputeVoteStats.get(vote.disputeId) ?? {
          voteCount: 0,
          totalWeight: 0,
          completedWeight: 0
        };
        stats.voteCount += 1;
        stats.totalWeight += vote.weightSnapshot;
        if (vote.vote === DomainVoteChoice.COMPLETED) {
          stats.completedWeight += vote.weightSnapshot;
        }
        openDisputeVoteStats.set(vote.disputeId, stats);
      }
      for (const dispute of openDisputes) {
        const stats = openDisputeVoteStats.get(dispute.id);
        if (!stats || stats.voteCount < cycleConfig.disputeQuorum || stats.totalWeight <= 0) {
          continue;
        }
        const completedBps = Math.floor((stats.completedWeight * 10_000) / stats.totalWeight);
        if (completedBps < cycleConfig.disputeApprovalBps) {
          continue;
        }
        const changed = await deps.evaluateDisputeWithTx(
          tx,
          dispute.id,
          cycleConfig,
          now,
          runtime.activeCycleId
        );
        if (changed) {
          finalizedDisputes.push(dispute.id);
        }
      }

      await deps.sweepBannedPublisherCleanTasksWithTx(tx, now, runtime.activeCycleId);
      await deps.autoTerminateExpiredCleanTasksWithTx(tx, now, runtime.activeCycleId);

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
      const distributionEntries = [...distributionsMap.entries()];

      if (distributionEntries.length > 0) {
        await tx.agentProfile.createMany({
          data: distributionEntries.map(([agent]) => ({
            address: agent,
            name: "",
            bio: "",
            status: "ACTIVE",
            bannedAt: null,
            banReasonCode: null,
            latestActivityAt: null,
            publisherRep: 50,
            workerRep: 50,
            supervisorRep: 50,
            tasksPublishedCount: 0,
            tasksIntentedCount: 0,
            tasksCompletedCount: 0,
            tasksTerminatedCount: 0,
            submissionsRejectedCount: 0,
            supervisionVotesCount: 0,
            createdAt: now,
            updatedAt: now
          })),
          skipDuplicates: true
        });
        await tx.ledgerBalance.createMany({
          data: distributionEntries.map(([agent]) => ({
            address: agent,
            available: cycleConfig.initialAgentBalance,
            updatedAt: now
          })),
          skipDuplicates: true
        });
      }

      for (const [agent, amount] of distributionEntries) {
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
      const nextCycleId = deps.nextCycleId(cycle.id);
      await tx.cycle.create({
        data: {
          id: nextCycleId,
          status: DomainCycleStatus.OPEN,
          mintedAmount: cycleConfig.mintPerCycle,
          taxPool: 0,
          penaltyPool: 0,
          startedAt: now,
          closedAt: null
        }
      });
      await deps.applyPendingRuntimeRulesForOpenedCycleWithTx(tx, {
        openedCycleId: nextCycleId,
        actor: "system"
      });
      await deps.touchRuntimeStateWithTx(tx, nextCycleId);

      return {
        closedCycleId: cycle.id,
        openedCycleId: nextCycleId,
        rewardPool,
        distributions: distributionEntries.map(([agent, amount]) => ({
          agent: asAddress(agent),
          amount
        })),
        finalizedDisputes
      };
    })
  );
};

export const writeCloseCurrentCycleDirect = async (
  prisma: PrismaClient,
  deps: CloseCycleWriteDeps
): Promise<CloseCycleResult> => {
  const result = await writeCloseCurrentCycleInternal(prisma, deps, {
    closeOnlyWhenDue: false
  });
  if (!result) {
    throw new DomainError("CYCLE_CLOSE_FORBIDDEN", "cycle close is not due yet", 409);
  }
  return result;
};

export const writeCloseCurrentCycleIfDueDirect = async (
  prisma: PrismaClient,
  deps: CloseCycleWriteDeps
): Promise<CloseCycleResult | null> =>
  writeCloseCurrentCycleInternal(prisma, deps, {
    closeOnlyWhenDue: true
  });

export const writeOverrideDisputeDirect = async (
  prisma: PrismaClient,
  deps: OverrideDisputeWriteDeps,
  disputeId: string,
  result: "COMPLETED" | "NOT_COMPLETED"
): Promise<PrismaDispute> => {
  try {
    return await deps.executeWithRetry(async () =>
      prisma.$transaction(async (tx) => {
        const runtime = await deps.lockRuntimeWithTx(tx);
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
            await deps.finalizeDisputeWithOutcomeWithTx(
              tx,
              disputeId,
              DomainVoteChoice.COMPLETED,
              now,
              runtime.activeCycleId
            );
          }
        } else {
          await deps.reopenDisputeAsNotCompletedWithTx(tx, disputeId, now, runtime.activeCycleId);
        }

        await deps.touchRuntimeStateWithTx(tx);
        return tx.dispute.findUniqueOrThrow({ where: { id: disputeId } });
      })
    );
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code ?? "") : "";
    if (code === "P2002") {
      throw new DomainError(
        "OPEN_DISPUTE_ALREADY_EXISTS",
        "an open dispute already exists for this submission",
        409
      );
    }
    throw error;
  }
};
