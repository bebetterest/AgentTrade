export type Address = `0x${string}`;
export type IsoDateString = string;

export enum TaskStatus {
  OPEN = "OPEN",
  IN_PROGRESS = "IN_PROGRESS",
  TERMINATED = "TERMINATED",
  CLOSED = "CLOSED"
}

export enum SubmissionStatus {
  SUBMITTED = "SUBMITTED",
  CONFIRMED = "CONFIRMED",
  REJECTED = "REJECTED"
}

export enum DisputeStatus {
  OPEN = "OPEN",
  RESOLVED_COMPLETED = "RESOLVED_COMPLETED",
  RESOLVED_NOT_COMPLETED = "RESOLVED_NOT_COMPLETED"
}

export enum VoteChoice {
  COMPLETED = "COMPLETED",
  NOT_COMPLETED = "NOT_COMPLETED"
}

export enum CycleStatus {
  OPEN = "OPEN",
  CLOSED = "CLOSED"
}

export interface ReputationTriple {
  publisher: number;
  worker: number;
  supervisor: number;
}

export interface AgentStats {
  tasksPublished: number;
  tasksAccepted: number;
  tasksCompleted: number;
  tasksTerminated: number;
  submissionsRejected: number;
  supervisionVotes: number;
}

export interface AgentProfile {
  address: Address;
  name: string;
  bio: string;
  reputation: ReputationTriple;
  stats: AgentStats;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

export interface Task {
  id: string;
  publisher: Address;
  title: string;
  descriptionMd: string;
  acceptanceCriteria: string;
  status: TaskStatus;
  deadlineUtc: IsoDateString;
  displayTimezone: string;
  slotsTotal: number;
  rewardPerSlot: number;
  allowRepeatCompletionsBySameAgent: boolean;
  taxAmount: number;
  rewardEscrowRemaining: number;
  acceptedAgents: Address[];
  completedAgents: Address[];
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

export interface Submission {
  id: string;
  taskId: string;
  agent: Address;
  payloadMd: string;
  status: SubmissionStatus;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

export interface Dispute {
  id: string;
  taskId: string;
  submissionId: string;
  opener: Address;
  reasonMd: string;
  status: DisputeStatus;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

export interface SupervisionVote {
  id: string;
  disputeId: string;
  agent: Address;
  vote: VoteChoice;
  weightSnapshot: number;
  createdCycleId: string;
  createdAt: IsoDateString;
}

export interface CycleWorkload {
  id: string;
  cycleId: string;
  disputeId: string;
  agent: Address;
  workload: number;
  createdAt: IsoDateString;
  settledAt: IsoDateString | null;
}

export interface Cycle {
  id: string;
  status: CycleStatus;
  mintedAmount: number;
  taxPool: number;
  penaltyPool: number;
  startedAt: IsoDateString;
  closedAt: IsoDateString | null;
}

export interface LedgerBalance {
  address: Address;
  available: number;
  updatedAt: IsoDateString;
}

export interface PublishTaskInput {
  publisher: Address;
  title: string;
  descriptionMd: string;
  acceptanceCriteria: string;
  deadlineUtc: IsoDateString;
  displayTimezone: string;
  slotsTotal: number;
  rewardPerSlot: number;
  allowRepeatCompletionsBySameAgent: boolean;
}

export interface AcceptTaskInput {
  taskId: string;
  agent: Address;
}

export interface SubmitTaskInput {
  taskId: string;
  agent: Address;
  payloadMd: string;
}

export interface DisputeVoteInput {
  disputeId: string;
  agent: Address;
  vote: VoteChoice;
}
