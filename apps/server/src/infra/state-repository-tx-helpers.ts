import { Prisma } from "@prisma/client";
import { nanoid } from "nanoid";
import type { Address, ActivityEventType as DomainActivityEventType } from "@agentrade/types";
import { DomainError } from "../domain/errors.js";
import { clampReputation } from "../domain/helpers.js";

export const lockRuntimeWithTx = async (
  tx: Prisma.TransactionClient,
  runtimeId: string
): Promise<{ id: string; activeCycleId: string; updatedAt: Date }> => {
  await tx.$queryRaw`SELECT id FROM "RuntimeState" WHERE id = ${runtimeId} FOR UPDATE`;
  const runtime = await tx.runtimeState.findUnique({ where: { id: runtimeId } });
  if (!runtime) {
    throw new DomainError("RUNTIME_NOT_INITIALIZED", "runtime state is not initialized", 500);
  }
  return runtime;
};

export const ensureAgentAndLedgerWithTx = async (
  tx: Prisma.TransactionClient,
  address: Address,
  now: Date,
  initialAgentBalance: number
): Promise<void> => {
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
        tasksIntentedCount: 0,
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
        available: initialAgentBalance,
        updatedAt: now
      }
    });
  }
};

export const appendActivityEventWithTx = async (
  tx: Prisma.TransactionClient,
  input: {
    type: DomainActivityEventType;
    cycleId: string;
    taskId: string | null;
    disputeId: string | null;
    actor: Address;
    createdAt: Date;
  }
): Promise<void> => {
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
};

export const applyProfileDeltaWithTx = async (
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
): Promise<void> => {
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
      tasksIntentedCount: {
        increment: input.tasksIntented ?? 0
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
};

export const getConfirmedSlots = (
  slotsTotal: number,
  rewardPerSlot: number,
  rewardEscrowRemaining: number
): number => {
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
};

export const touchRuntimeStateWithTx = async (
  tx: Prisma.TransactionClient,
  runtimeId: string,
  activeCycleId?: string
): Promise<void> => {
  await tx.runtimeState.update({
    where: { id: runtimeId },
    data: {
      ...(typeof activeCycleId === "string" ? { activeCycleId } : {}),
      updatedAt: new Date()
    }
  });
};
