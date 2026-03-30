export interface AppConfig {
  appName: string;
  host: string;
  port: number;
  databaseUrl: string;
  redisUrl: string;
  enablePersistence: boolean;
  enableRedisRateLimit: boolean;
  jwtSecret: string;
  adminServiceKey: string;
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

const envNumber = (key: string, fallback: number): number => {
  const raw = process.env[key];
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
};

const envString = (key: string, fallback: string): string => {
  const raw = process.env[key];
  return raw && raw.length > 0 ? raw : fallback;
};

const envBoolean = (key: string, fallback: boolean): boolean => {
  const raw = process.env[key];
  if (!raw) {
    return fallback;
  }
  const lower = raw.toLowerCase();
  if (lower === "true" || lower === "1" || lower === "yes") {
    return true;
  }
  if (lower === "false" || lower === "0" || lower === "no") {
    return false;
  }
  return fallback;
};

export const defaultConfig: AppConfig = {
  appName: "Agentrade",
  host: "0.0.0.0",
  port: 3000,
  databaseUrl: "postgresql://postgres:postgres@localhost:5432/agentrade",
  redisUrl: "redis://localhost:6379",
  enablePersistence: true,
  enableRedisRateLimit: true,
  jwtSecret: "replace-this-secret",
  adminServiceKey: "replace-this-admin-key",
  authChallengeTtlMinutes: 10,
  rateLimitPerMinute: 60,
  rateLimitBurst: 10,
  taskTitleMaxLength: 120,
  taskDescriptionMaxLength: 20_000,
  taskAcceptanceCriteriaMaxLength: 8_000,
  taskSubmissionPayloadMaxLength: 20_000,
  disputeReasonMaxLength: 4_000,
  taskSlotsMax: 100,
  taskRewardPerSlotMax: 1_000_000,
  taskDeadlineMaxHours: 4_320,
  taxRateBps: 500,
  taxMin: 1,
  rewardMin: 1,
  mintPerCycle: 10000,
  terminationPenaltyBps: 1000,
  submissionTimeoutHours: 72,
  resubmitCooldownMinutes: 30,
  disputeQuorum: 5,
  disputeApprovalBps: 6000,
  reputationWeightPublisherBps: 2000,
  reputationWeightWorkerBps: 3000,
  reputationWeightSupervisorBps: 5000,
  bridgeChain: "Base Sepolia",
  bridgeMode: "OFFCHAIN_EXPORT_ONLY"
};

export const loadConfig = (): AppConfig => ({
  appName: envString("APP_NAME", defaultConfig.appName),
  host: envString("HOST", defaultConfig.host),
  port: envNumber("PORT", defaultConfig.port),
  databaseUrl: envString("DATABASE_URL", defaultConfig.databaseUrl),
  redisUrl: envString("REDIS_URL", defaultConfig.redisUrl),
  enablePersistence: envBoolean("ENABLE_PERSISTENCE", defaultConfig.enablePersistence),
  enableRedisRateLimit: envBoolean("ENABLE_REDIS_RATE_LIMIT", defaultConfig.enableRedisRateLimit),
  jwtSecret: envString("JWT_SECRET", defaultConfig.jwtSecret),
  adminServiceKey: envString("ADMIN_SERVICE_KEY", defaultConfig.adminServiceKey),
  authChallengeTtlMinutes: envNumber(
    "AUTH_CHALLENGE_TTL_MINUTES",
    defaultConfig.authChallengeTtlMinutes
  ),
  rateLimitPerMinute: envNumber("RATE_LIMIT_PER_MINUTE", defaultConfig.rateLimitPerMinute),
  rateLimitBurst: envNumber("RATE_LIMIT_BURST", defaultConfig.rateLimitBurst),
  taskTitleMaxLength: envNumber("TASK_TITLE_MAX_LENGTH", defaultConfig.taskTitleMaxLength),
  taskDescriptionMaxLength: envNumber(
    "TASK_DESCRIPTION_MAX_LENGTH",
    defaultConfig.taskDescriptionMaxLength
  ),
  taskAcceptanceCriteriaMaxLength: envNumber(
    "TASK_ACCEPTANCE_CRITERIA_MAX_LENGTH",
    defaultConfig.taskAcceptanceCriteriaMaxLength
  ),
  taskSubmissionPayloadMaxLength: envNumber(
    "TASK_SUBMISSION_PAYLOAD_MAX_LENGTH",
    defaultConfig.taskSubmissionPayloadMaxLength
  ),
  disputeReasonMaxLength: envNumber("DISPUTE_REASON_MAX_LENGTH", defaultConfig.disputeReasonMaxLength),
  taskSlotsMax: envNumber("TASK_SLOTS_MAX", defaultConfig.taskSlotsMax),
  taskRewardPerSlotMax: envNumber(
    "TASK_REWARD_PER_SLOT_MAX",
    defaultConfig.taskRewardPerSlotMax
  ),
  taskDeadlineMaxHours: envNumber("TASK_DEADLINE_MAX_HOURS", defaultConfig.taskDeadlineMaxHours),
  taxRateBps: envNumber("TAX_RATE_BPS", defaultConfig.taxRateBps),
  taxMin: envNumber("TAX_MIN", defaultConfig.taxMin),
  rewardMin: envNumber("REWARD_MIN", defaultConfig.rewardMin),
  mintPerCycle: envNumber("MINT_PER_CYCLE", defaultConfig.mintPerCycle),
  terminationPenaltyBps: envNumber("TERMINATION_PENALTY_BPS", defaultConfig.terminationPenaltyBps),
  submissionTimeoutHours: envNumber("SUBMISSION_TIMEOUT_HOURS", defaultConfig.submissionTimeoutHours),
  resubmitCooldownMinutes: envNumber("RESUBMIT_COOLDOWN_MINUTES", defaultConfig.resubmitCooldownMinutes),
  disputeQuorum: envNumber("DISPUTE_QUORUM", defaultConfig.disputeQuorum),
  disputeApprovalBps: envNumber("DISPUTE_APPROVAL_BPS", defaultConfig.disputeApprovalBps),
  reputationWeightPublisherBps: envNumber(
    "REPUTATION_WEIGHT_PUBLISHER_BPS",
    defaultConfig.reputationWeightPublisherBps
  ),
  reputationWeightWorkerBps: envNumber(
    "REPUTATION_WEIGHT_WORKER_BPS",
    defaultConfig.reputationWeightWorkerBps
  ),
  reputationWeightSupervisorBps: envNumber(
    "REPUTATION_WEIGHT_SUPERVISOR_BPS",
    defaultConfig.reputationWeightSupervisorBps
  ),
  bridgeChain: envString("BRIDGE_CHAIN", defaultConfig.bridgeChain),
  bridgeMode: "OFFCHAIN_EXPORT_ONLY"
});
