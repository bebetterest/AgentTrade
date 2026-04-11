export interface AppConfig {
  appName: string;
  host: string;
  port: number;
  apiDefaultVersion: string;
  databaseUrl: string;
  redisUrl: string;
  enablePersistence: boolean;
  enableRedisRateLimit: boolean;
  trustProxy: boolean;
  corsAllowedOrigins: string[];
  jwtSecret: string;
  adminServiceKey: string;
  authChallengeTtlMinutes: number;
  authChallengeMaxEntries: number;
  authChallengeSweepIntervalMs: number;
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
  taskCompletionPublisherWorkload: number;
  taskCompletionWorkerWorkload: number;
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

export interface WebRuntimeConfig {
  publicApiBaseUrl: string;
  internalApiBaseUrl?: string;
  skillsInstallCommand: string;
}

export const runtimeEditableRuleKeys = [
  "cycleDurationHours",
  "mintPerCycle",
  "taxRateBps",
  "taskCompletionPublisherWorkload",
  "taskCompletionWorkerWorkload",
  "disputeQuorum",
  "disputeApprovalBps",
  "terminationPenaltyBps",
  "submissionTimeoutHours",
  "resubmitCooldownMinutes",
  "reputationWeightPublisherBps",
  "reputationWeightWorkerBps",
  "reputationWeightSupervisorBps",
  "scoreWeightReputationBps",
  "scoreWeightCompletionBps",
  "scoreWeightQualityBps"
] as const;

export type RuntimeEditableRuleKey = (typeof runtimeEditableRuleKeys)[number];
export type RuntimeEditableRules = Pick<AppConfig, RuntimeEditableRuleKey>;
export type RuntimeEditableRulesPatch = Partial<RuntimeEditableRules>;

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
  | "initialAgentBalance"
  | "mintPerCycle"
  | "cycleDurationHours"
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

const envNumberStrict = (
  key: string,
  fallback: number,
  options: {
    integer?: boolean;
    min?: number;
    max?: number;
  } = {}
): number => {
  const raw = process.env[key];
  if (raw === undefined) {
    return fallback;
  }
  const normalized = raw.trim();
  if (normalized.length === 0) {
    throw new Error(`invalid runtime config: ${key} must be a non-empty numeric value`);
  }
  const value = Number(normalized);
  if (!Number.isFinite(value)) {
    throw new Error(`invalid runtime config: ${key} must be a finite number`);
  }
  if (options.integer && !Number.isInteger(value)) {
    throw new Error(`invalid runtime config: ${key} must be an integer`);
  }
  if (options.min !== undefined && value < options.min) {
    throw new Error(`invalid runtime config: ${key} must be >= ${options.min}`);
  }
  if (options.max !== undefined && value > options.max) {
    throw new Error(`invalid runtime config: ${key} must be <= ${options.max}`);
  }
  return value;
};

const envString = (key: string, fallback: string): string => {
  const raw = process.env[key];
  return raw && raw.length > 0 ? raw : fallback;
};

const envBooleanStrict = (key: string, fallback: boolean): boolean => {
  const raw = process.env[key];
  if (raw === undefined) {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  throw new Error(`invalid runtime config: ${key} must be a boolean`);
};

const envCsv = (key: string, fallback: string[]): string[] => {
  const raw = process.env[key];
  if (raw === undefined) {
    return fallback;
  }
  const values = raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (values.length === 0) {
    throw new Error(`invalid runtime config: ${key} must contain at least one origin`);
  }
  return values;
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

const assertIntegerInRange = (
  key: string,
  value: number,
  options: { min?: number; max?: number } = {}
): void => {
  if (!Number.isFinite(value)) {
    throw new Error(`invalid runtime config: ${key} must be a finite number`);
  }
  if (!Number.isInteger(value)) {
    throw new Error(`invalid runtime config: ${key} must be an integer`);
  }
  if (options.min !== undefined && value < options.min) {
    throw new Error(`invalid runtime config: ${key} must be >= ${options.min}`);
  }
  if (options.max !== undefined && value > options.max) {
    throw new Error(`invalid runtime config: ${key} must be <= ${options.max}`);
  }
};

const assertNonNegativeFinite = (key: string, value: number): void => {
  if (!Number.isFinite(value)) {
    throw new Error(`invalid runtime config: ${key} must be a finite number`);
  }
  if (value < 0) {
    throw new Error(`invalid runtime config: ${key} must be >= 0`);
  }
};

export const pickRuntimeEditableRules = (config: AppConfig): RuntimeEditableRules => ({
  cycleDurationHours: config.cycleDurationHours,
  mintPerCycle: config.mintPerCycle,
  taxRateBps: config.taxRateBps,
  taskCompletionPublisherWorkload: config.taskCompletionPublisherWorkload,
  taskCompletionWorkerWorkload: config.taskCompletionWorkerWorkload,
  disputeQuorum: config.disputeQuorum,
  disputeApprovalBps: config.disputeApprovalBps,
  terminationPenaltyBps: config.terminationPenaltyBps,
  submissionTimeoutHours: config.submissionTimeoutHours,
  resubmitCooldownMinutes: config.resubmitCooldownMinutes,
  reputationWeightPublisherBps: config.reputationWeightPublisherBps,
  reputationWeightWorkerBps: config.reputationWeightWorkerBps,
  reputationWeightSupervisorBps: config.reputationWeightSupervisorBps,
  scoreWeightReputationBps: config.scoreWeightReputationBps,
  scoreWeightCompletionBps: config.scoreWeightCompletionBps,
  scoreWeightQualityBps: config.scoreWeightQualityBps
});

export const mergeRuntimeEditableRules = (
  base: RuntimeEditableRules,
  patch: RuntimeEditableRulesPatch
): RuntimeEditableRules => ({
  ...base,
  ...patch
});

export const validateRuntimeEditableRules = (rules: RuntimeEditableRules): void => {
  assertIntegerInRange("CYCLE_DURATION_HOURS", rules.cycleDurationHours, { min: 1 });
  assertIntegerInRange("MINT_PER_CYCLE", rules.mintPerCycle, { min: 0 });
  assertIntegerInRange("TAX_RATE_BPS", rules.taxRateBps, { min: 0, max: BPS_TOTAL });
  assertNonNegativeFinite(
    "TASK_COMPLETION_PUBLISHER_WORKLOAD",
    rules.taskCompletionPublisherWorkload
  );
  assertNonNegativeFinite("TASK_COMPLETION_WORKER_WORKLOAD", rules.taskCompletionWorkerWorkload);
  assertIntegerInRange("DISPUTE_QUORUM", rules.disputeQuorum, { min: 1 });
  assertIntegerInRange("DISPUTE_APPROVAL_BPS", rules.disputeApprovalBps, {
    min: 0,
    max: BPS_TOTAL
  });
  assertIntegerInRange("TERMINATION_PENALTY_BPS", rules.terminationPenaltyBps, {
    min: 0,
    max: BPS_TOTAL
  });
  assertIntegerInRange("SUBMISSION_TIMEOUT_HOURS", rules.submissionTimeoutHours, { min: 1 });
  assertIntegerInRange("RESUBMIT_COOLDOWN_MINUTES", rules.resubmitCooldownMinutes, { min: 0 });
  assertIntegerInRange("REPUTATION_WEIGHT_PUBLISHER_BPS", rules.reputationWeightPublisherBps, {
    min: 0,
    max: BPS_TOTAL
  });
  assertIntegerInRange("REPUTATION_WEIGHT_WORKER_BPS", rules.reputationWeightWorkerBps, {
    min: 0,
    max: BPS_TOTAL
  });
  assertIntegerInRange("REPUTATION_WEIGHT_SUPERVISOR_BPS", rules.reputationWeightSupervisorBps, {
    min: 0,
    max: BPS_TOTAL
  });
  assertIntegerInRange("SCORE_WEIGHT_REPUTATION_BPS", rules.scoreWeightReputationBps, {
    min: 0,
    max: BPS_TOTAL
  });
  assertIntegerInRange("SCORE_WEIGHT_COMPLETION_BPS", rules.scoreWeightCompletionBps, {
    min: 0,
    max: BPS_TOTAL
  });
  assertIntegerInRange("SCORE_WEIGHT_QUALITY_BPS", rules.scoreWeightQualityBps, {
    min: 0,
    max: BPS_TOTAL
  });

  assertWeightGroup("REPUTATION_WEIGHT_*_BPS", [
    { key: "REPUTATION_WEIGHT_PUBLISHER_BPS", value: rules.reputationWeightPublisherBps },
    { key: "REPUTATION_WEIGHT_WORKER_BPS", value: rules.reputationWeightWorkerBps },
    { key: "REPUTATION_WEIGHT_SUPERVISOR_BPS", value: rules.reputationWeightSupervisorBps }
  ]);
  assertWeightGroup("SCORE_WEIGHT_*_BPS", [
    { key: "SCORE_WEIGHT_REPUTATION_BPS", value: rules.scoreWeightReputationBps },
    { key: "SCORE_WEIGHT_COMPLETION_BPS", value: rules.scoreWeightCompletionBps },
    { key: "SCORE_WEIGHT_QUALITY_BPS", value: rules.scoreWeightQualityBps }
  ]);
};

export const applyRuntimeEditableRules = (
  config: AppConfig,
  rules: RuntimeEditableRules
): AppConfig => ({
  ...config,
  ...rules
});

const assertCorsOrigins = (origins: string[]): void => {
  if (origins.length === 0) {
    throw new Error("invalid runtime config: CORS_ALLOWED_ORIGINS must not be empty");
  }
  if (origins.includes("*") && origins.length > 1) {
    throw new Error("invalid runtime config: CORS_ALLOWED_ORIGINS cannot mix '*' with explicit origins");
  }
  for (const origin of origins) {
    if (origin === "*") {
      continue;
    }
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`invalid runtime config: CORS_ALLOWED_ORIGINS contains invalid origin '${origin}'`);
    }
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.host.length === 0) {
      throw new Error(
        `invalid runtime config: CORS_ALLOWED_ORIGINS contains unsupported origin '${origin}'`
      );
    }
  }
};

const assertRuntimeConfig = (config: AppConfig): void => {
  assertRuntimeWeightConfig(config);
  assertCorsOrigins(config.corsAllowedOrigins);

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
  trustProxy: false,
  corsAllowedOrigins: [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001"
  ],
  jwtSecret: PLACEHOLDER_VALUES.JWT_SECRET,
  adminServiceKey: PLACEHOLDER_VALUES.ADMIN_SERVICE_KEY,
  authChallengeTtlMinutes: 10,
  authChallengeMaxEntries: 10_000,
  authChallengeSweepIntervalMs: 30_000,
  rateLimitPerMinute: 300,
  rateLimitBurst: 60,
  taskTitleMaxLength: 200,
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
  initialAgentBalance: 1_000,
  mintPerCycle: 10000,
  cycleDurationHours: 7 * 24,
  taskCompletionPublisherWorkload: 0.25,
  taskCompletionWorkerWorkload: 0.25,
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
  initialAgentBalance: config.initialAgentBalance,
  mintPerCycle: config.mintPerCycle,
  cycleDurationHours: config.cycleDurationHours,
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
    port: envNumberStrict("PORT", defaultConfig.port, { integer: true, min: 1, max: 65535 }),
    apiDefaultVersion: envString("API_DEFAULT_VERSION", defaultConfig.apiDefaultVersion),
    databaseUrl: envString("DATABASE_URL", defaultConfig.databaseUrl),
    redisUrl: envString("REDIS_URL", defaultConfig.redisUrl),
    enablePersistence: envBooleanStrict("ENABLE_PERSISTENCE", defaultConfig.enablePersistence),
    enableRedisRateLimit: envBooleanStrict(
      "ENABLE_REDIS_RATE_LIMIT",
      defaultConfig.enableRedisRateLimit
    ),
    trustProxy: envBooleanStrict("TRUST_PROXY", defaultConfig.trustProxy),
    corsAllowedOrigins: envCsv("CORS_ALLOWED_ORIGINS", defaultConfig.corsAllowedOrigins),
    jwtSecret: envString("JWT_SECRET", defaultConfig.jwtSecret),
    adminServiceKey: envString("ADMIN_SERVICE_KEY", defaultConfig.adminServiceKey),
    authChallengeTtlMinutes: envNumberStrict(
      "AUTH_CHALLENGE_TTL_MINUTES",
      defaultConfig.authChallengeTtlMinutes,
      { integer: true, min: 0 }
    ),
    authChallengeMaxEntries: envNumberStrict(
      "AUTH_CHALLENGE_MAX_ENTRIES",
      defaultConfig.authChallengeMaxEntries,
      { integer: true, min: 1 }
    ),
    authChallengeSweepIntervalMs: envNumberStrict(
      "AUTH_CHALLENGE_SWEEP_INTERVAL_MS",
      defaultConfig.authChallengeSweepIntervalMs,
      { integer: true, min: 0 }
    ),
    rateLimitPerMinute: envNumberStrict("RATE_LIMIT_PER_MINUTE", defaultConfig.rateLimitPerMinute, {
      integer: true,
      min: 1
    }),
    rateLimitBurst: envNumberStrict("RATE_LIMIT_BURST", defaultConfig.rateLimitBurst, {
      integer: true,
      min: 0
    }),
    taskTitleMaxLength: envNumberStrict("TASK_TITLE_MAX_LENGTH", defaultConfig.taskTitleMaxLength, {
      integer: true,
      min: 1
    }),
    taskDescriptionMaxLength: envNumberStrict(
      "TASK_DESCRIPTION_MAX_LENGTH",
      defaultConfig.taskDescriptionMaxLength,
      { integer: true, min: 1 }
    ),
    taskAcceptanceCriteriaMaxLength: envNumberStrict(
      "TASK_ACCEPTANCE_CRITERIA_MAX_LENGTH",
      defaultConfig.taskAcceptanceCriteriaMaxLength,
      { integer: true, min: 1 }
    ),
    taskSubmissionPayloadMaxLength: envNumberStrict(
      "TASK_SUBMISSION_PAYLOAD_MAX_LENGTH",
      defaultConfig.taskSubmissionPayloadMaxLength,
      { integer: true, min: 1 }
    ),
    taskSubmissionAttachmentMaxCount: envNumberStrict(
      "TASK_SUBMISSION_ATTACHMENT_MAX_COUNT",
      defaultConfig.taskSubmissionAttachmentMaxCount,
      { integer: true, min: 0 }
    ),
    taskSubmissionAttachmentNameMaxLength: envNumberStrict(
      "TASK_SUBMISSION_ATTACHMENT_NAME_MAX_LENGTH",
      defaultConfig.taskSubmissionAttachmentNameMaxLength,
      { integer: true, min: 1 }
    ),
    taskSubmissionAttachmentUrlMaxLength: envNumberStrict(
      "TASK_SUBMISSION_ATTACHMENT_URL_MAX_LENGTH",
      defaultConfig.taskSubmissionAttachmentUrlMaxLength,
      { integer: true, min: 1 }
    ),
    taskSubmissionAttachmentMaxSizeBytes: envNumberStrict(
      "TASK_SUBMISSION_ATTACHMENT_MAX_SIZE_BYTES",
      defaultConfig.taskSubmissionAttachmentMaxSizeBytes,
      { integer: true, min: 0 }
    ),
    disputeReasonMaxLength: envNumberStrict(
      "DISPUTE_REASON_MAX_LENGTH",
      defaultConfig.disputeReasonMaxLength,
      { integer: true, min: 1 }
    ),
    taskSlotsMax: envNumberStrict("TASK_SLOTS_MAX", defaultConfig.taskSlotsMax, {
      integer: true,
      min: 1
    }),
    taskRewardPerSlotMax: envNumberStrict(
      "TASK_REWARD_PER_SLOT_MAX",
      defaultConfig.taskRewardPerSlotMax,
      { integer: true, min: 1 }
    ),
    taskDeadlineMaxHours: envNumberStrict(
      "TASK_DEADLINE_MAX_HOURS",
      defaultConfig.taskDeadlineMaxHours,
      { integer: true, min: 1 }
    ),
    taxRateBps: envNumberStrict("TAX_RATE_BPS", defaultConfig.taxRateBps, {
      integer: true,
      min: 0,
      max: BPS_TOTAL
    }),
    taxMin: envNumberStrict("TAX_MIN", defaultConfig.taxMin, { integer: true, min: 0 }),
    rewardMin: envNumberStrict("REWARD_MIN", defaultConfig.rewardMin, {
      integer: true,
      min: 1
    }),
    initialAgentBalance: envNumberStrict(
      "INITIAL_AGENT_BALANCE",
      defaultConfig.initialAgentBalance,
      {
        integer: true,
        min: 0
      }
    ),
    mintPerCycle: envNumberStrict("MINT_PER_CYCLE", defaultConfig.mintPerCycle, {
      integer: true,
      min: 0
    }),
    cycleDurationHours: envNumberStrict("CYCLE_DURATION_HOURS", defaultConfig.cycleDurationHours, {
      integer: true,
      min: 1
    }),
    taskCompletionPublisherWorkload: envNumberStrict(
      "TASK_COMPLETION_PUBLISHER_WORKLOAD",
      defaultConfig.taskCompletionPublisherWorkload,
      { min: 0 }
    ),
    taskCompletionWorkerWorkload: envNumberStrict(
      "TASK_COMPLETION_WORKER_WORKLOAD",
      defaultConfig.taskCompletionWorkerWorkload,
      { min: 0 }
    ),
    terminationPenaltyBps: envNumberStrict(
      "TERMINATION_PENALTY_BPS",
      defaultConfig.terminationPenaltyBps,
      { integer: true, min: 0, max: BPS_TOTAL }
    ),
    submissionTimeoutHours: envNumberStrict(
      "SUBMISSION_TIMEOUT_HOURS",
      defaultConfig.submissionTimeoutHours,
      { integer: true, min: 1 }
    ),
    resubmitCooldownMinutes: envNumberStrict(
      "RESUBMIT_COOLDOWN_MINUTES",
      defaultConfig.resubmitCooldownMinutes,
      { integer: true, min: 0 }
    ),
    disputeQuorum: envNumberStrict("DISPUTE_QUORUM", defaultConfig.disputeQuorum, {
      integer: true,
      min: 1
    }),
    disputeApprovalBps: envNumberStrict(
      "DISPUTE_APPROVAL_BPS",
      defaultConfig.disputeApprovalBps,
      { integer: true, min: 0, max: BPS_TOTAL }
    ),
    reputationWeightPublisherBps: envNumberStrict(
      "REPUTATION_WEIGHT_PUBLISHER_BPS",
      defaultConfig.reputationWeightPublisherBps,
      { integer: true, min: 0, max: BPS_TOTAL }
    ),
    reputationWeightWorkerBps: envNumberStrict(
      "REPUTATION_WEIGHT_WORKER_BPS",
      defaultConfig.reputationWeightWorkerBps,
      { integer: true, min: 0, max: BPS_TOTAL }
    ),
    reputationWeightSupervisorBps: envNumberStrict(
      "REPUTATION_WEIGHT_SUPERVISOR_BPS",
      defaultConfig.reputationWeightSupervisorBps,
      { integer: true, min: 0, max: BPS_TOTAL }
    ),
    scoreWeightReputationBps: envNumberStrict(
      "SCORE_WEIGHT_REPUTATION_BPS",
      defaultConfig.scoreWeightReputationBps,
      { integer: true, min: 0, max: BPS_TOTAL }
    ),
    scoreWeightCompletionBps: envNumberStrict(
      "SCORE_WEIGHT_COMPLETION_BPS",
      defaultConfig.scoreWeightCompletionBps,
      { integer: true, min: 0, max: BPS_TOTAL }
    ),
    scoreWeightQualityBps: envNumberStrict(
      "SCORE_WEIGHT_QUALITY_BPS",
      defaultConfig.scoreWeightQualityBps,
      { integer: true, min: 0, max: BPS_TOTAL }
    ),
    bridgeChain: envString("BRIDGE_CHAIN", defaultConfig.bridgeChain),
    bridgeMode: "OFFCHAIN_EXPORT_ONLY"
  };

  assertRuntimeConfig(config);
  return config;
};

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
