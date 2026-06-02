import type { PrismaClient } from "@prisma/client";
import type {
  ActivityEvent,
  AgentProfile,
  Cycle,
  Dispute,
  LedgerBalance,
  Submission,
  Task,
  Address
} from "@agentrade/types";
import {
  mapActivityEvent,
  mapAgentProfile,
  mapCycle,
  mapDispute,
  mapLedgerBalance,
  mapSubmission,
  mapTask
} from "./state-repository-mappers.js";

export const readListTasksDirect = async (prisma: PrismaClient): Promise<Task[]> => {
  const tasks = await prisma.task.findMany({
    include: { targetMentions: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "asc" }
  });
  return tasks.map((item) => mapTask(item));
};

export const readGetTaskDirect = async (
  prisma: PrismaClient,
  taskId: string
): Promise<Task | null> => {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { targetMentions: { orderBy: { createdAt: "asc" } } }
  });
  return task ? mapTask(task) : null;
};

export const readListSubmissionsDirect = async (prisma: PrismaClient): Promise<Submission[]> => {
  const submissions = await prisma.submission.findMany({ orderBy: { createdAt: "asc" } });
  return submissions.map((item) => mapSubmission(item));
};

export const readGetSubmissionDirect = async (
  prisma: PrismaClient,
  submissionId: string
): Promise<Submission | null> => {
  const submission = await prisma.submission.findUnique({ where: { id: submissionId } });
  return submission ? mapSubmission(submission) : null;
};

export const readListDisputesDirect = async (prisma: PrismaClient): Promise<Dispute[]> => {
  const disputes = await prisma.dispute.findMany({ orderBy: { createdAt: "asc" } });
  return disputes.map((item) => mapDispute(item));
};

export const readGetDisputeDirect = async (
  prisma: PrismaClient,
  disputeId: string
): Promise<Dispute | null> => {
  const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } });
  return dispute ? mapDispute(dispute) : null;
};

export const readListAgentsDirect = async (prisma: PrismaClient): Promise<AgentProfile[]> => {
  const profiles = await prisma.agentProfile.findMany({ orderBy: { createdAt: "asc" } });
  return profiles.map((item) => mapAgentProfile(item));
};

export const readGetAgentDirect = async (
  prisma: PrismaClient,
  address: Address
): Promise<AgentProfile | null> => {
  const profile = await prisma.agentProfile.findUnique({ where: { address } });
  return profile ? mapAgentProfile(profile) : null;
};

export const readGetLedgerDirect = async (
  prisma: PrismaClient,
  address: Address
): Promise<LedgerBalance | null> => {
  const balance = await prisma.ledgerBalance.findUnique({ where: { address } });
  return balance ? mapLedgerBalance(balance) : null;
};

export const readListActivitiesDirect = async (
  prisma: PrismaClient
): Promise<ActivityEvent[]> => {
  const events = await prisma.activityEvent.findMany({ orderBy: { createdAt: "asc" } });
  return events.map((item) => mapActivityEvent(item));
};

export const readListCyclesDirect = async (prisma: PrismaClient): Promise<Cycle[]> => {
  const cycles = await prisma.cycle.findMany({ orderBy: { startedAt: "asc" } });
  return cycles.map((item) => mapCycle(item));
};

export const readGetCycleDirect = async (
  prisma: PrismaClient,
  cycleId: string
): Promise<Cycle | null> => {
  const cycle = await prisma.cycle.findUnique({ where: { id: cycleId } });
  return cycle ? mapCycle(cycle) : null;
};

export const readGetActiveCycleDirect = async (
  prisma: PrismaClient,
  runtimeId: string
): Promise<Cycle | null> => {
  const runtime = await prisma.runtimeState.findUnique({ where: { id: runtimeId } });
  if (!runtime) {
    return null;
  }
  return readGetCycleDirect(prisma, runtime.activeCycleId);
};
