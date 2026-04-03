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

export enum ActivityEventType {
  TASK_PUBLISHED = "TASK_PUBLISHED",
  TASK_ACCEPTED = "TASK_ACCEPTED",
  TASK_COMPLETED = "TASK_COMPLETED",
  DISPUTE_OPENED = "DISPUTE_OPENED",
  TASK_TERMINATED = "TASK_TERMINATED"
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

export interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  cycleId: string;
  taskId: string | null;
  disputeId: string | null;
  actor: Address;
  createdAt: IsoDateString;
}

export interface DashboardMetricSnapshot {
  tasksPublished: number;
  tasksAccepted: number;
  tasksCompleted: number;
  disputesOpened: number;
}

export interface DashboardSummaryResponse {
  timezone: string;
  generatedAt: IsoDateString;
  activeCycleId: string;
  today: DashboardMetricSnapshot;
  currentCycle: DashboardMetricSnapshot;
  totals: {
    tasks: number;
    disputes: number;
    agents: number;
  };
}

export interface DashboardTrendPoint {
  bucketStart: IsoDateString;
  label: string;
  tasksPublished: number;
  tasksAccepted: number;
  tasksCompleted: number;
  disputesOpened: number;
}

export interface DashboardTrendsResponse {
  timezone: string;
  generatedAt: IsoDateString;
  window: "7d" | "30d";
  points: DashboardTrendPoint[];
}

export interface AgentDirectoryItem extends AgentProfile {
  latestActivityAt: IsoDateString | null;
  score: number;
  isActive: boolean;
}

export interface PaginatedResponse<T> {
  items: T[];
  nextCursor: string | null;
}

export interface LedgerBalance {
  address: Address;
  available: number;
  updatedAt: IsoDateString;
}

export interface ApiErrorEnvelope {
  error: string;
  message?: string;
  issues?: unknown;
}

export interface HealthStatus {
  ok: boolean;
  service: string;
}

export interface LatencySummary {
  count: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

export interface ServiceMetricsResponse {
  generatedAt: IsoDateString;
  startedAt: IsoDateString;
  counters: {
    requestsTotal: number;
    errorsTotal: number;
    rateLimitedTotal: number;
    writeTotal: number;
    writeErrorTotal: number;
    writeConflictTotal: number;
    writeDeadlockTotal: number;
  };
  latencies: {
    requests: LatencySummary;
    writes: LatencySummary;
  };
}

export interface AuthChallengeResponse {
  nonce: string;
  message: string;
}

export interface AuthVerifyResponse {
  token: string;
  expiresIn: string;
}

export interface VoteDisputeResult {
  vote: SupervisionVote;
  workload: CycleWorkload;
}

export interface CloseCycleResult {
  closedCycleId: string;
  openedCycleId: string;
  rewardPool: number;
  distributions: CycleDistribution[];
  finalizedDisputes: string[];
}

export interface CycleDistribution {
  agent: Address;
  amount: number;
}

export interface CycleRewardsResponse {
  cycle: Cycle;
  rewardPool: number;
  distributions: CycleDistribution[];
  workloads: CycleWorkload[];
}

export interface BridgeExportItem {
  address: Address;
  amount: number;
}

export interface BridgeExportResponse {
  chain: string;
  mode: "OFFCHAIN_EXPORT_ONLY";
  exports: BridgeExportItem[];
}

export interface PublicEconomyParams {
  appName: string;
  enablePersistence: boolean;
  enableRedisRateLimit: boolean;
  authChallengeTtlMinutes: number;
  rateLimitPerMinute: number;
  rateLimitBurst: number;
  taskTitleMaxLength: number;
  taskDescriptionMaxLength: number;
  taskAcceptanceCriteriaMaxLength: number;
  taskSubmissionPayloadMaxLength: number;
  disputeReasonMaxLength: number;
  taskSlotsMax: number;
  taskRewardPerSlotMax: number;
  taskDeadlineMaxHours: number;
  taxRateBps: number;
  taxMin: number;
  rewardMin: number;
  mintPerCycle: number;
  terminationPenaltyBps: number;
  submissionTimeoutHours: number;
  resubmitCooldownMinutes: number;
  disputeQuorum: number;
  disputeApprovalBps: number;
  reputationWeightPublisherBps: number;
  reputationWeightWorkerBps: number;
  reputationWeightSupervisorBps: number;
  bridgeChain: string;
  bridgeMode: "OFFCHAIN_EXPORT_ONLY";
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
