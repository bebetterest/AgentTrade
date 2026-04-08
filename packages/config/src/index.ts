export interface AppConfig {
  appName: string;
  host: string;
  port: number;
  apiDefaultVersion: string;
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
  mintPerCycle: number;
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

export interface CliRuntimeConfig {
  apiBaseUrl: string;
  token?: string;
  adminServiceKey?: string;
  timeoutMs: string;
  retries: string;
}

export interface WebRuntimeConfig {
  publicApiBaseUrl: string;
  internalApiBaseUrl?: string;
  skillsInstallCommand: string;
}

export type PublicEconomyParams = Pick<
  AppConfig,
  | "appName"
  | "enablePersistence"
  | "enableRedisRateLimit"
  | "authChallengeTtlMinutes"
  | "rateLimitPerMinute"
  | "rateLimitBurst"
  | "taskTitleMaxLength"
  | "taskDescriptionMaxLength"
  | "taskAcceptanceCriteriaMaxLength"
  | "taskSubmissionPayloadMaxLength"
  | "taskSubmissionAttachmentMaxCount"
  | "taskSubmissionAttachmentNameMaxLength"
  | "taskSubmissionAttachmentUrlMaxLength"
  | "taskSubmissionAttachmentMaxSizeBytes"
  | "disputeReasonMaxLength"
  | "taskSlotsMax"
  | "taskRewardPerSlotMax"
  | "taskDeadlineMaxHours"
  | "taxRateBps"
  | "taxMin"
  | "rewardMin"
  | "mintPerCycle"
  | "terminationPenaltyBps"
  | "submissionTimeoutHours"
  | "resubmitCooldownMinutes"
  | "disputeQuorum"
  | "disputeApprovalBps"
  | "reputationWeightPublisherBps"
  | "reputationWeightWorkerBps"
  | "reputationWeightSupervisorBps"
  | "scoreWeightReputationBps"
  | "scoreWeightCompletionBps"
  | "scoreWeightQualityBps"
  | "bridgeChain"
  | "bridgeMode"
>;

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

const PLACEHOLDER_VALUES = {
  JWT_SECRET: "replace-this-secret",
  ADMIN_SERVICE_KEY: "replace-this-admin-key"
} as const;

const BPS_TOTAL = 10_000;

const assertWeightValue = (value: number, key: string): void => {
  if (!Number.isFinite(value)) {
    throw new Error(`invalid runtime config: ${key} must be a finite number`);
  }
  if (!Number.isInteger(value)) {
    throw new Error(`invalid runtime config: ${key} must be an integer`);
  }
  if (value < 0) {
    throw new Error(`invalid runtime config: ${key} must be >= 0`);
  }
};

const assertWeightGroup = (
  groupName: string,
  weights: Array<{ key: string; value: number }>
): void => {
  for (const weight of weights) {
    assertWeightValue(weight.value, weight.key);
  }
  const total = weights.reduce((sum, weight) => sum + weight.value, 0);
  if (total !== BPS_TOTAL) {
    throw new Error(
      `invalid runtime config: ${groupName} must sum to ${BPS_TOTAL} bps (got ${total})`
    );
  }
};

const assertRuntimeWeightConfig = (config: AppConfig): void => {
  assertWeightGroup("REPUTATION_WEIGHT_*_BPS", [
    { key: "REPUTATION_WEIGHT_PUBLISHER_BPS", value: config.reputationWeightPublisherBps },
    { key: "REPUTATION_WEIGHT_WORKER_BPS", value: config.reputationWeightWorkerBps },
    { key: "REPUTATION_WEIGHT_SUPERVISOR_BPS", value: config.reputationWeightSupervisorBps }
  ]);

  assertWeightGroup("SCORE_WEIGHT_*_BPS", [
    { key: "SCORE_WEIGHT_REPUTATION_BPS", value: config.scoreWeightReputationBps },
    { key: "SCORE_WEIGHT_COMPLETION_BPS", value: config.scoreWeightCompletionBps },
    { key: "SCORE_WEIGHT_QUALITY_BPS", value: config.scoreWeightQualityBps }
  ]);
};

const assertRuntimeConfig = (config: AppConfig): void => {
  assertRuntimeWeightConfig(config);

  if (process.env.NODE_ENV === "test") {
    return;
  }

  if (
    config.jwtSecret.trim().length === 0 ||
    config.jwtSecret === PLACEHOLDER_VALUES.JWT_SECRET
  ) {
    throw new Error("invalid runtime config: JWT_SECRET must be set to a non-placeholder value");
  }

  if (
    config.adminServiceKey.trim().length === 0 ||
    config.adminServiceKey === PLACEHOLDER_VALUES.ADMIN_SERVICE_KEY
  ) {
    throw new Error(
      "invalid runtime config: ADMIN_SERVICE_KEY must be set to a non-placeholder value"
    );
  }
};

export const defaultConfig: AppConfig = {
  appName: "Agentrade",
  host: "0.0.0.0",
  port: 3000,
  apiDefaultVersion: "v2",
  databaseUrl: "postgresql://postgres:postgres@localhost:5432/agentrade",
  redisUrl: "redis://localhost:6379",
  enablePersistence: true,
  enableRedisRateLimit: true,
  jwtSecret: PLACEHOLDER_VALUES.JWT_SECRET,
  adminServiceKey: PLACEHOLDER_VALUES.ADMIN_SERVICE_KEY,
  authChallengeTtlMinutes: 10,
  rateLimitPerMinute: 60,
  rateLimitBurst: 10,
  taskTitleMaxLength: 120,
  taskDescriptionMaxLength: 20_000,
  taskAcceptanceCriteriaMaxLength: 8_000,
  taskSubmissionPayloadMaxLength: 20_000,
  taskSubmissionAttachmentMaxCount: 10,
  taskSubmissionAttachmentNameMaxLength: 200,
  taskSubmissionAttachmentUrlMaxLength: 2_000,
  taskSubmissionAttachmentMaxSizeBytes: 100 * 1024 * 1024,
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
  scoreWeightReputationBps: 4500,
  scoreWeightCompletionBps: 3500,
  scoreWeightQualityBps: 2000,
  bridgeChain: "Base Sepolia",
  bridgeMode: "OFFCHAIN_EXPORT_ONLY"
};

export const toPublicEconomyParams = (config: AppConfig): PublicEconomyParams => ({
  appName: config.appName,
  enablePersistence: config.enablePersistence,
  enableRedisRateLimit: config.enableRedisRateLimit,
  authChallengeTtlMinutes: config.authChallengeTtlMinutes,
  rateLimitPerMinute: config.rateLimitPerMinute,
  rateLimitBurst: config.rateLimitBurst,
  taskTitleMaxLength: config.taskTitleMaxLength,
  taskDescriptionMaxLength: config.taskDescriptionMaxLength,
  taskAcceptanceCriteriaMaxLength: config.taskAcceptanceCriteriaMaxLength,
  taskSubmissionPayloadMaxLength: config.taskSubmissionPayloadMaxLength,
  taskSubmissionAttachmentMaxCount: config.taskSubmissionAttachmentMaxCount,
  taskSubmissionAttachmentNameMaxLength: config.taskSubmissionAttachmentNameMaxLength,
  taskSubmissionAttachmentUrlMaxLength: config.taskSubmissionAttachmentUrlMaxLength,
  taskSubmissionAttachmentMaxSizeBytes: config.taskSubmissionAttachmentMaxSizeBytes,
  disputeReasonMaxLength: config.disputeReasonMaxLength,
  taskSlotsMax: config.taskSlotsMax,
  taskRewardPerSlotMax: config.taskRewardPerSlotMax,
  taskDeadlineMaxHours: config.taskDeadlineMaxHours,
  taxRateBps: config.taxRateBps,
  taxMin: config.taxMin,
  rewardMin: config.rewardMin,
  mintPerCycle: config.mintPerCycle,
  terminationPenaltyBps: config.terminationPenaltyBps,
  submissionTimeoutHours: config.submissionTimeoutHours,
  resubmitCooldownMinutes: config.resubmitCooldownMinutes,
  disputeQuorum: config.disputeQuorum,
  disputeApprovalBps: config.disputeApprovalBps,
  reputationWeightPublisherBps: config.reputationWeightPublisherBps,
  reputationWeightWorkerBps: config.reputationWeightWorkerBps,
  reputationWeightSupervisorBps: config.reputationWeightSupervisorBps,
  scoreWeightReputationBps: config.scoreWeightReputationBps,
  scoreWeightCompletionBps: config.scoreWeightCompletionBps,
  scoreWeightQualityBps: config.scoreWeightQualityBps,
  bridgeChain: config.bridgeChain,
  bridgeMode: config.bridgeMode
});

export const loadConfig = (): AppConfig => {
  const config: AppConfig = {
    appName: envString("APP_NAME", defaultConfig.appName),
    host: envString("HOST", defaultConfig.host),
    port: envNumber("PORT", defaultConfig.port),
    apiDefaultVersion: envString("API_DEFAULT_VERSION", defaultConfig.apiDefaultVersion),
    databaseUrl: envString("DATABASE_URL", defaultConfig.databaseUrl),
    redisUrl: envString("REDIS_URL", defaultConfig.redisUrl),
    enablePersistence: envBoolean("ENABLE_PERSISTENCE", defaultConfig.enablePersistence),
    enableRedisRateLimit: envBoolean(
      "ENABLE_REDIS_RATE_LIMIT",
      defaultConfig.enableRedisRateLimit
    ),
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
    taskSubmissionAttachmentMaxCount: envNumber(
      "TASK_SUBMISSION_ATTACHMENT_MAX_COUNT",
      defaultConfig.taskSubmissionAttachmentMaxCount
    ),
    taskSubmissionAttachmentNameMaxLength: envNumber(
      "TASK_SUBMISSION_ATTACHMENT_NAME_MAX_LENGTH",
      defaultConfig.taskSubmissionAttachmentNameMaxLength
    ),
    taskSubmissionAttachmentUrlMaxLength: envNumber(
      "TASK_SUBMISSION_ATTACHMENT_URL_MAX_LENGTH",
      defaultConfig.taskSubmissionAttachmentUrlMaxLength
    ),
    taskSubmissionAttachmentMaxSizeBytes: envNumber(
      "TASK_SUBMISSION_ATTACHMENT_MAX_SIZE_BYTES",
      defaultConfig.taskSubmissionAttachmentMaxSizeBytes
    ),
    disputeReasonMaxLength: envNumber(
      "DISPUTE_REASON_MAX_LENGTH",
      defaultConfig.disputeReasonMaxLength
    ),
    taskSlotsMax: envNumber("TASK_SLOTS_MAX", defaultConfig.taskSlotsMax),
    taskRewardPerSlotMax: envNumber(
      "TASK_REWARD_PER_SLOT_MAX",
      defaultConfig.taskRewardPerSlotMax
    ),
    taskDeadlineMaxHours: envNumber(
      "TASK_DEADLINE_MAX_HOURS",
      defaultConfig.taskDeadlineMaxHours
    ),
    taxRateBps: envNumber("TAX_RATE_BPS", defaultConfig.taxRateBps),
    taxMin: envNumber("TAX_MIN", defaultConfig.taxMin),
    rewardMin: envNumber("REWARD_MIN", defaultConfig.rewardMin),
    mintPerCycle: envNumber("MINT_PER_CYCLE", defaultConfig.mintPerCycle),
    terminationPenaltyBps: envNumber(
      "TERMINATION_PENALTY_BPS",
      defaultConfig.terminationPenaltyBps
    ),
    submissionTimeoutHours: envNumber(
      "SUBMISSION_TIMEOUT_HOURS",
      defaultConfig.submissionTimeoutHours
    ),
    resubmitCooldownMinutes: envNumber(
      "RESUBMIT_COOLDOWN_MINUTES",
      defaultConfig.resubmitCooldownMinutes
    ),
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
    scoreWeightReputationBps: envNumber(
      "SCORE_WEIGHT_REPUTATION_BPS",
      defaultConfig.scoreWeightReputationBps
    ),
    scoreWeightCompletionBps: envNumber(
      "SCORE_WEIGHT_COMPLETION_BPS",
      defaultConfig.scoreWeightCompletionBps
    ),
    scoreWeightQualityBps: envNumber(
      "SCORE_WEIGHT_QUALITY_BPS",
      defaultConfig.scoreWeightQualityBps
    ),
    bridgeChain: envString("BRIDGE_CHAIN", defaultConfig.bridgeChain),
    bridgeMode: "OFFCHAIN_EXPORT_ONLY"
  };

  assertRuntimeConfig(config);
  return config;
};

export const loadCliRuntimeConfig = (): CliRuntimeConfig => ({
  apiBaseUrl: envString("AGENTRADE_API_BASE_URL", "http://localhost:3000"),
  token: process.env.AGENTRADE_TOKEN,
  adminServiceKey: process.env.AGENTRADE_ADMIN_SERVICE_KEY,
  timeoutMs: envString("AGENTRADE_TIMEOUT_MS", "10000"),
  retries: envString("AGENTRADE_RETRIES", "1")
});

const envPublicString = (value: string | undefined, fallback: string): string =>
  value && value.length > 0 ? value : fallback;

export const loadWebRuntimeConfig = (): WebRuntimeConfig => ({
  publicApiBaseUrl: envPublicString(process.env.NEXT_PUBLIC_API_BASE_URL, "http://localhost:3000"),
  internalApiBaseUrl: process.env.INTERNAL_API_BASE_URL,
  skillsInstallCommand: envPublicString(
    process.env.NEXT_PUBLIC_AGENT_SKILLS_INSTALL_COMMAND,
    "codex skill install ./apps/skill"
  )
});
