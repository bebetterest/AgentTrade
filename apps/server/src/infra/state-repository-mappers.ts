import { Prisma } from "@prisma/client";
import type {
  ActivityEvent,
  ActivityEventType,
  Address,
  AgentDirectoryItem,
  AgentProfile,
  Cycle,
  CycleStatus,
  CycleWorkload,
  Dispute,
  DisputeStatus,
  LedgerBalance,
  Submission,
  SubmissionStatus,
  SupervisionVote,
  Task,
  TaskIntention,
  TaskStatus,
  VoteChoice
} from "@agentrade/types";

export interface AgentDirectoryRow {
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

interface AgentProfileRow {
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
}

interface LedgerBalanceRow {
  address: string;
  available: number;
  updatedAt: Date;
}

interface TaskRow {
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

interface TaskCompetitionInput {
  slotsTotal: number;
  rewardPerSlot: number;
  rewardEscrowRemaining: number;
  intentCount: number;
}

interface SubmissionRow {
  id: string;
  taskId: string;
  agentAddress: string;
  payloadMd: string;
  status: unknown;
  createdAt: Date;
  updatedAt: Date;
}

interface DisputeRow {
  id: string;
  taskId: string;
  submissionId: string;
  openerAddress: string;
  reasonMd: string;
  status: unknown;
  createdAt: Date;
  updatedAt: Date;
}

interface VoteRow {
  id: string;
  disputeId: string;
  agentAddress: string;
  vote: unknown;
  weightSnapshot: number;
  createdCycleId: string;
  createdAt: Date;
}

interface CycleWorkloadRow {
  id: string;
  cycleId: string;
  disputeId: string;
  agentAddress: string;
  workload: number;
  createdAt: Date;
  settledAt: Date | null;
}

interface CycleRow {
  id: string;
  status: unknown;
  mintedAmount: number;
  taxPool: number;
  penaltyPool: number;
  startedAt: Date;
  closedAt: Date | null;
}

interface ActivityEventRow {
  id: string;
  type: unknown;
  cycleId: string;
  taskId: string | null;
  disputeId: string | null;
  actorAddress: string;
  createdAt: Date;
}

interface TaskIntentionRow {
  id: string;
  taskId: string;
  agentAddress: string;
  createdAt: Date;
}

const asAddress = (value: string): Address => value as Address;

const asStringArray = (value: Prisma.JsonValue): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
};

export const asAddressArray = (value: Prisma.JsonValue): Address[] =>
  asStringArray(value).map((item) => asAddress(item));

export const toIso = (value: Date): string => value.toISOString();

export const toNumber = (value: unknown): number => {
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

export const mapAgentProfile = (item: AgentProfileRow): AgentProfile => ({
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
});

export const mapLedgerBalance = (item: LedgerBalanceRow): LedgerBalance => ({
  address: asAddress(item.address),
  available: item.available,
  updatedAt: toIso(item.updatedAt)
});

export const computeTaskCompetitionRatio = (input: TaskCompetitionInput): number => {
  const { slotsTotal, rewardPerSlot, rewardEscrowRemaining, intentCount } = input;
  if (slotsTotal <= 0 || rewardPerSlot <= 0) {
    return 0;
  }

  const totalEscrow = slotsTotal * rewardPerSlot;
  if (!Number.isFinite(totalEscrow) || totalEscrow <= 0) {
    return 0;
  }

  const clampedEscrowRemaining = Math.min(Math.max(rewardEscrowRemaining, 0), totalEscrow);
  const spent = totalEscrow - clampedEscrowRemaining;
  const confirmedSlots = Math.min(slotsTotal, Math.max(0, Math.floor(spent / rewardPerSlot)));
  const remainingSlots = Math.max(0, slotsTotal - confirmedSlots);
  if (remainingSlots === 0) {
    return 0;
  }
  return Number((intentCount / remainingSlots).toFixed(4));
};

export const mapTask = (item: TaskRow): Task => ({
  id: item.id,
  publisher: asAddress(item.publisherAddress),
  title: item.title,
  descriptionMd: item.descriptionMd,
  acceptanceCriteria: item.acceptanceCriteria,
  status: item.status as TaskStatus,
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
});

export const mapSubmission = (item: SubmissionRow): Submission => ({
  id: item.id,
  taskId: item.taskId,
  agent: asAddress(item.agentAddress),
  payloadMd: item.payloadMd,
  status: item.status as SubmissionStatus,
  createdAt: toIso(item.createdAt),
  updatedAt: toIso(item.updatedAt)
});

export const mapDispute = (item: DisputeRow): Dispute => ({
  id: item.id,
  taskId: item.taskId,
  submissionId: item.submissionId,
  opener: asAddress(item.openerAddress),
  reasonMd: item.reasonMd,
  status: item.status as DisputeStatus,
  createdAt: toIso(item.createdAt),
  updatedAt: toIso(item.updatedAt)
});

export const mapVote = (item: VoteRow): SupervisionVote => ({
  id: item.id,
  disputeId: item.disputeId,
  agent: asAddress(item.agentAddress),
  vote: item.vote as VoteChoice,
  weightSnapshot: item.weightSnapshot,
  createdCycleId: item.createdCycleId,
  createdAt: toIso(item.createdAt)
});

export const mapCycleWorkload = (item: CycleWorkloadRow): CycleWorkload => ({
  id: item.id,
  cycleId: item.cycleId,
  disputeId: item.disputeId,
  agent: asAddress(item.agentAddress),
  workload: item.workload,
  createdAt: toIso(item.createdAt),
  settledAt: item.settledAt ? toIso(item.settledAt) : null
});

export const mapCycle = (item: CycleRow): Cycle => ({
  id: item.id,
  status: item.status as CycleStatus,
  mintedAmount: item.mintedAmount,
  taxPool: item.taxPool,
  penaltyPool: item.penaltyPool,
  startedAt: toIso(item.startedAt),
  closedAt: item.closedAt ? toIso(item.closedAt) : null
});

export const mapActivityEvent = (item: ActivityEventRow): ActivityEvent => ({
  id: item.id,
  type: item.type as ActivityEventType,
  cycleId: item.cycleId,
  taskId: item.taskId,
  disputeId: item.disputeId,
  actor: asAddress(item.actorAddress),
  createdAt: toIso(item.createdAt)
});

export const mapTaskIntention = (item: TaskIntentionRow): TaskIntention => ({
  id: item.id,
  taskId: item.taskId,
  agent: asAddress(item.agentAddress),
  createdAt: toIso(item.createdAt)
});

export const mapAgentDirectoryItem = (item: AgentDirectoryRow): AgentDirectoryItem => ({
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
  updatedAt: toIso(item.updatedAt),
  latestActivityAt: item.latestActivityAt ? toIso(item.latestActivityAt) : null,
  score: toNumber(item.score),
  isActive: item.isActive
});
