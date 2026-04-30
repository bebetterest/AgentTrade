export type Address = `0x${string}`;
export type IsoDateString = string;

export enum AgentStatus {
  ACTIVE = "ACTIVE",
  BANNED = "BANNED"
}

export enum AgentBanReason {
  DISPUTE_INSOLVENCY = "DISPUTE_INSOLVENCY",
  REOPEN_NEGATIVE_BALANCE = "REOPEN_NEGATIVE_BALANCE"
}

export enum TaskStatus {
  OPEN = "OPEN",
  IN_PROGRESS = "IN_PROGRESS",
  TERMINATED = "TERMINATED",
  CLOSED = "CLOSED"
}

export enum SubmissionStatus {
  SUBMITTED = "SUBMITTED",
  CONFIRMED = "CONFIRMED",
  REJECTED = "REJECTED",
  DISPUTE_COMPLETED = "DISPUTE_COMPLETED"
}

export enum DisputeStatus {
  OPEN = "OPEN",
  RESOLVED_COMPLETED = "RESOLVED_COMPLETED"
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
  TASK_INTENDED = "TASK_INTENDED",
  TASK_SUBMITTED = "TASK_SUBMITTED",
  SUBMISSION_REJECTED = "SUBMISSION_REJECTED",
  TASK_COMPLETED = "TASK_COMPLETED",
  DISPUTE_OPENED = "DISPUTE_OPENED",
  TASK_TERMINATED = "TASK_TERMINATED",
  ADMIN_AUDIT = "ADMIN_AUDIT"
}

export enum ServerAuditCategory {
  RUNTIME = "RUNTIME",
  AUTH = "AUTH",
  SECURITY = "SECURITY",
  ADMIN = "ADMIN",
  DOMAIN_WRITE = "DOMAIN_WRITE",
  BACKGROUND_JOB = "BACKGROUND_JOB"
}

export enum ServerAuditSeverity {
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR"
}

export enum ServerAuditOutcome {
  SUCCESS = "SUCCESS",
  FAILURE = "FAILURE",
  REJECTED = "REJECTED"
}

export interface ReputationTriple {
  publisher: number;
  worker: number;
  supervisor: number;
}

export interface AgentStats {
  tasksPublished: number;
  tasksIntented: number;
  tasksCompleted: number;
  tasksTerminated: number;
  submissionsRejected: number;
  supervisionVotes: number;
}

export interface AgentProfile {
  address: Address;
  name: string;
  bio: string;
  status: AgentStatus;
  bannedAt: IsoDateString | null;
  banReasonCode: AgentBanReason | null;
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
  intentCount: number;
  competitionRatio: number;
  completedAgents: Address[];
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

export interface TaskIntention {
  id: string;
  taskId: string;
  agent: Address;
  createdAt: IsoDateString;
}

export interface SubmissionAttachment {
  name: string;
  url: string;
  mimeType?: string;
  sizeBytes?: number;
}

export interface Submission {
  id: string;
  taskId: string;
  agent: Address;
  payloadMd: string;
  attachments: SubmissionAttachment[];
  rejectReasonMd?: string | null;
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
  counterpartyResponder?: Address | null;
  counterpartyReasonMd?: string | null;
  status: DisputeStatus;
  resolution?: DisputeResolutionSummary;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

export type DisputeWinnerRole = "PUBLISHER" | "SUBMISSION_AGENT";

export enum DisputePayoutSource {
  ESCROW = "ESCROW",
  PUBLISHER_WALLET = "PUBLISHER_WALLET",
  PUBLISHER_WALLET_PARTIAL = "PUBLISHER_WALLET_PARTIAL"
}

export interface DisputeResolutionSummary {
  totalVotes: number;
  completedVotes: number;
  notCompletedVotes: number;
  outcome: VoteChoice;
  winnerRole: DisputeWinnerRole;
  winnerAddress: Address;
  payoutSource: DisputePayoutSource;
  payoutAmount: number;
  payoutShortfallAmount: number;
  publisherBanned: boolean;
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
  disputeId: string | null;
  taskId?: string | null;
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
  tasksIntented: number;
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
  tasksIntented: number;
  tasksCompleted: number;
  disputesOpened: number;
}

export interface DashboardTrendsResponse {
  timezone: string;
  generatedAt: IsoDateString;
  window: "7d" | "30d";
  points: DashboardTrendPoint[];
}

export const TODO_SCOPE_VALUES = ["all", "action_required", "waiting"] as const;
export type TodoScope = (typeof TODO_SCOPE_VALUES)[number];

export const TODO_GROUP_SCOPE_VALUES = ["action_required", "waiting"] as const;
export type TodoGroupScope = (typeof TODO_GROUP_SCOPE_VALUES)[number];

export const TODO_ACTION_REQUIRED_TYPES = [
  "latest_rejected_submission_no_followup",
  "open_dispute_counterparty_response_required",
  "published_task_submission_pending_review",
  "expired_published_task_cleanup_required",
  "intended_task_never_submitted"
] as const;
export type TodoActionRequiredType = (typeof TODO_ACTION_REQUIRED_TYPES)[number];

export const TODO_WAITING_TYPES = [
  "submitted_submission_waiting_review",
  "published_task_waiting_new_submission",
  "open_dispute_waiting_resolution"
] as const;
export type TodoWaitingType = (typeof TODO_WAITING_TYPES)[number];

export const TODO_GROUP_TYPE_VALUES = [...TODO_ACTION_REQUIRED_TYPES, ...TODO_WAITING_TYPES] as const;
export type TodoGroupType = (typeof TODO_GROUP_TYPE_VALUES)[number];

export const TODO_RESOURCE_KIND_VALUES = ["task", "submission", "dispute"] as const;
export type TodoResourceKind = (typeof TODO_RESOURCE_KIND_VALUES)[number];

export interface TodoItemSummary {
  resourceKind: TodoResourceKind;
  primaryId: string;
  title: string;
  taskId: string;
  submissionId: string | null;
  disputeId: string | null;
  status: TaskStatus | SubmissionStatus | DisputeStatus;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
  deadlineUtc: IsoDateString | null;
}

export interface TodoGroup {
  scope: TodoGroupScope;
  type: TodoGroupType;
  resourceKind: TodoResourceKind;
  title: string;
  description: string;
  totalCount: number;
  nextCursor: string | null;
  items: TodoItemSummary[];
}

export interface TodosResponse {
  address: Address;
  scope: TodoScope;
  selectedType: TodoGroupType | null;
  generatedAt: IsoDateString;
  groups: TodoGroup[];
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
    requestLogDroppedTotal: number;
    requestLogFlushTotal: number;
    requestLogFlushErrorTotal: number;
    workerJobSuccessTotal: number;
    workerJobErrorTotal: number;
    workerJobLockMissTotal: number;
    workerJobSuccessTotalExact: string;
    workerJobErrorTotalExact: string;
    workerJobLockMissTotalExact: string;
  };
  gauges: {
    requestLogBufferSize: number;
  };
  latencies: {
    requests: LatencySummary;
    writes: LatencySummary;
  };
}

export interface ServerRequestLogRecord {
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
  actorAddress: Address | null;
  errorCode: string | null;
  createdAt: IsoDateString;
}

export interface ServerAuditLogRecord {
  id: string;
  category: ServerAuditCategory;
  action: string;
  severity: ServerAuditSeverity;
  outcome: ServerAuditOutcome;
  requestId: string | null;
  clientIp: string | null;
  actorAddress: Address | null;
  method: string | null;
  routeId: string | null;
  targetType: string | null;
  targetId: string | null;
  cycleId: string | null;
  message: string;
  details: Record<string, unknown> | null;
  createdAt: IsoDateString;
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
  taskSubmissionAttachmentMaxCount: number;
  taskSubmissionAttachmentNameMaxLength: number;
  taskSubmissionAttachmentUrlMaxLength: number;
  taskSubmissionAttachmentMaxSizeBytes: number;
  disputeReasonMaxLength: number;
  taskSlotsMax: number;
  taskRewardPerSlotMax: number;
  taskDeadlineMaxHours: number;
  taxRateBps: number;
  taxMin: number;
  rewardMin: number;
  initialAgentBalance: number;
  mintPerCycle: number;
  cycleDurationHours: number;
  terminationPenaltyBps: number;
  submissionTimeoutHours: number;
  resubmitCooldownMinutes: number;
  disputeQuorum: number;
  disputeApprovalBps: number;
  reputationWeightPublisherBps: number;
  reputationWeightWorkerBps: number;
  reputationWeightSupervisorBps: number;
  scoreWeightReputationBps: number;
  scoreWeightCompletionBps: number;
  scoreWeightQualityBps: number;
  bridgeChain: string;
  bridgeMode: "OFFCHAIN_EXPORT_ONLY";
}

export interface RuntimeEditableRules {
  cycleDurationHours: number;
  mintPerCycle: number;
  taxRateBps: number;
  taskCompletionPublisherWorkload: number;
  taskCompletionWorkerWorkload: number;
  disputeQuorum: number;
  disputeApprovalBps: number;
  terminationPenaltyBps: number;
  submissionTimeoutHours: number;
  resubmitCooldownMinutes: number;
  reputationWeightPublisherBps: number;
  reputationWeightWorkerBps: number;
  reputationWeightSupervisorBps: number;
  scoreWeightReputationBps: number;
  scoreWeightCompletionBps: number;
  scoreWeightQualityBps: number;
}

export type RuntimeEditableRulesPatch = Partial<RuntimeEditableRules>;
export type RuntimeSettingsApplyTarget = "current" | "next";
export type RuntimeRuleAuditEventType = "UPDATE" | "RESET" | "AUTO_APPLY_NEXT";

export interface RuntimeRuleAuditRecord {
  id: string;
  eventType: RuntimeRuleAuditEventType;
  applyTo: RuntimeSettingsApplyTarget | null;
  reason: string | null;
  actor: string | null;
  cycleId: string | null;
  beforeRules: RuntimeEditableRules | null;
  afterRules: RuntimeEditableRules | null;
  patch: RuntimeEditableRulesPatch | null;
  pendingNextPatch: RuntimeEditableRulesPatch | null;
  createdAt: IsoDateString;
}

export interface RuntimeSettingsState {
  currentRules: RuntimeEditableRules;
  pendingNextPatch: RuntimeEditableRulesPatch | null;
  nextRules: RuntimeEditableRules;
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

export interface AddTaskIntentionInput {
  taskId: string;
  agent: Address;
}

export interface SubmitTaskInput {
  taskId: string;
  agent: Address;
  payloadMd: string;
  attachments?: SubmissionAttachment[];
}

export interface DisputeVoteInput {
  disputeId: string;
  agent: Address;
  vote: VoteChoice;
}
