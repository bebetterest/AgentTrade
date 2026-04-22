import {
  ActivityEventType,
  DisputeStatus,
  SubmissionStatus,
  TaskStatus,
  VoteChoice
} from "@agentrade/types";
import type { Address, RuntimeEditableRulesPatch } from "@agentrade/types";
import { CliValidationError } from "./errors.js";

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const PRIVATE_KEY_REGEX = /^0x[a-fA-F0-9]{64}$/;
const ISO_DATETIME_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const RUNTIME_EDITABLE_KEYS = new Set<keyof RuntimeEditableRulesPatch>([
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
]);

const parseInteger = (raw: string, flag: string): number => {
  if (!/^[-]?\d+$/.test(raw.trim())) {
    throw new CliValidationError(`${flag} must be an integer`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    throw new CliValidationError(`${flag} must be a safe integer`);
  }
  return parsed;
};

const ensureEnumValue = <T extends string>(
  raw: string,
  flag: string,
  values: readonly T[],
  normalize: "none" | "upper" | "lower" = "none"
): T => {
  const trimmed = raw.trim();
  const normalized =
    normalize === "upper" ? trimmed.toUpperCase() : normalize === "lower" ? trimmed.toLowerCase() : trimmed;

  if (!values.includes(normalized as T)) {
    throw new CliValidationError(`${flag} must be ${values.join("|")}`);
  }

  return normalized as T;
};

const TASK_STATUS_VALUES = Object.values(TaskStatus) as TaskStatus[];
const SUBMISSION_STATUS_VALUES = Object.values(SubmissionStatus) as SubmissionStatus[];
const DISPUTE_STATUS_VALUES = Object.values(DisputeStatus) as DisputeStatus[];
const ACTIVITY_EVENT_TYPE_VALUES = Object.values(ActivityEventType) as ActivityEventType[];
const TASK_LIST_SORT_VALUES = ["latest", "created", "deadline", "reward"] as const;
const SUBMISSION_LIST_SORT_VALUES = ["latest", "created"] as const;
const DISPUTE_LIST_SORT_VALUES = ["latest", "created"] as const;
const AGENT_LIST_SORT_VALUES = [
  "latest",
  "score",
  "reputation",
  "completed",
  "published",
  "intented"
] as const;
const QUERY_ORDER_VALUES = ["asc", "desc"] as const;
const TREND_WINDOW_VALUES = ["7d", "30d"] as const;

export const ensureAddress = (raw: string, flag: string): Address => {
  if (!ADDRESS_REGEX.test(raw)) {
    throw new CliValidationError(`${flag} must be a valid EVM address`);
  }
  return raw as Address;
};

export const ensurePrivateKey = (raw: string, flag: string): `0x${string}` => {
  if (!PRIVATE_KEY_REGEX.test(raw)) {
    throw new CliValidationError(`${flag} must be a valid hex private key`);
  }
  return raw as `0x${string}`;
};

export const ensureNonEmpty = (raw: string, flag: string): string => {
  if (raw.trim().length === 0) {
    throw new CliValidationError(`${flag} must be non-empty`);
  }
  return raw;
};

export const ensureMaxLength = (raw: string, max: number, flag: string): string => {
  if (raw.length > max) {
    throw new CliValidationError(`${flag} must be <= ${max} characters`);
  }
  return raw;
};

export const ensureTrimmedNonEmptyMaxLength = (raw: string, max: number, flag: string): string => {
  const value = raw.trim();
  if (value.length === 0) {
    throw new CliValidationError(`${flag} must be non-empty`);
  }
  if (value.length > max) {
    throw new CliValidationError(`${flag} must be <= ${max} characters`);
  }
  return value;
};

export const ensureIsoDate = (raw: string, flag: string): string => {
  const value = raw.trim();
  if (!ISO_DATETIME_REGEX.test(value)) {
    throw new CliValidationError(`${flag} must be a valid ISO datetime with timezone`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new CliValidationError(`${flag} must be a valid ISO datetime`);
  }
  return new Date(timestamp).toISOString();
};

export const ensureIanaTimeZone = (raw: string, flag: string): string => {
  const value = raw.trim();
  if (value.length === 0) {
    throw new CliValidationError(`${flag} must be non-empty`);
  }
  try {
    Intl.DateTimeFormat("en-US", { timeZone: value });
  } catch {
    throw new CliValidationError(`${flag} must be a valid IANA timezone`);
  }
  return value;
};

export const ensureHttpUrl = (raw: string, flag: string): string => {
  const value = raw.trim();
  if (value.length === 0) {
    throw new CliValidationError(`${flag} must be non-empty`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new CliValidationError(`${flag} must be a valid URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new CliValidationError(`${flag} must start with http:// or https://`);
  }
  return value;
};

export const ensurePositiveInteger = (raw: string, flag: string): number => {
  const value = parseInteger(raw, flag);
  if (value <= 0) {
    throw new CliValidationError(`${flag} must be > 0`);
  }
  return value;
};

export const ensurePageLimit = (raw: string, flag = "--limit"): number => {
  const value = ensurePositiveInteger(raw, flag);
  if (value > 100) {
    throw new CliValidationError(`${flag} must be <= 100`);
  }
  return value;
};

export const ensureNonNegativeInteger = (raw: string, flag: string): number => {
  const value = parseInteger(raw, flag);
  if (value < 0) {
    throw new CliValidationError(`${flag} must be >= 0`);
  }
  return value;
};

export const ensureVoteChoice = (raw: string): VoteChoice => {
  return ensureEnumValue(raw, "--vote", Object.values(VoteChoice) as VoteChoice[], "upper");
};

export const ensureOverrideResult = (raw: string): "COMPLETED" | "NOT_COMPLETED" => {
  return ensureEnumValue(raw, "--result", ["COMPLETED", "NOT_COMPLETED"], "upper");
};

export const ensureTaskStatus = (raw: string, flag = "--status"): TaskStatus => {
  return ensureEnumValue(raw, flag, TASK_STATUS_VALUES, "upper");
};

export const ensureSubmissionStatus = (raw: string, flag = "--status"): SubmissionStatus => {
  return ensureEnumValue(raw, flag, SUBMISSION_STATUS_VALUES, "upper");
};

export const ensureDisputeStatus = (raw: string, flag = "--status"): DisputeStatus => {
  return ensureEnumValue(raw, flag, DISPUTE_STATUS_VALUES, "upper");
};

export const ensureActivityType = (raw: string, flag = "--type"): ActivityEventType => {
  return ensureEnumValue(raw, flag, ACTIVITY_EVENT_TYPE_VALUES, "upper");
};

export const ensureTaskListSort = (
  raw: string,
  flag = "--sort"
): (typeof TASK_LIST_SORT_VALUES)[number] => {
  return ensureEnumValue(raw, flag, TASK_LIST_SORT_VALUES, "lower");
};

export const ensureSubmissionListSort = (
  raw: string,
  flag = "--sort"
): (typeof SUBMISSION_LIST_SORT_VALUES)[number] => {
  return ensureEnumValue(raw, flag, SUBMISSION_LIST_SORT_VALUES, "lower");
};

export const ensureDisputeListSort = (
  raw: string,
  flag = "--sort"
): (typeof DISPUTE_LIST_SORT_VALUES)[number] => {
  return ensureEnumValue(raw, flag, DISPUTE_LIST_SORT_VALUES, "lower");
};

export const ensureAgentListSort = (
  raw: string,
  flag = "--sort"
): (typeof AGENT_LIST_SORT_VALUES)[number] => {
  return ensureEnumValue(raw, flag, AGENT_LIST_SORT_VALUES, "lower");
};

export const ensureQueryOrder = (
  raw: string,
  flag = "--order"
): (typeof QUERY_ORDER_VALUES)[number] => {
  return ensureEnumValue(raw, flag, QUERY_ORDER_VALUES, "lower");
};

export const ensureTrendWindow = (
  raw: string,
  flag = "--window"
): (typeof TREND_WINDOW_VALUES)[number] => {
  return ensureEnumValue(raw, flag, TREND_WINDOW_VALUES, "lower");
};

export const ensureRuntimeSettingsApplyTo = (raw: string, flag = "--apply-to"): "current" | "next" => {
  return ensureEnumValue(raw, flag, ["current", "next"], "lower");
};

export const ensureRuntimeSettingsPatchJson = (
  raw: string,
  flag = "--patch-json"
): RuntimeEditableRulesPatch => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CliValidationError(`${flag} must be a valid JSON object`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CliValidationError(`${flag} must be a JSON object`);
  }
  const patch: RuntimeEditableRulesPatch = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!RUNTIME_EDITABLE_KEYS.has(key as keyof RuntimeEditableRulesPatch)) {
      throw new CliValidationError(`${flag} contains unsupported key: ${key}`);
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new CliValidationError(`${flag}.${key} must be a finite number`);
    }
    patch[key as keyof RuntimeEditableRulesPatch] = value;
  }
  if (Object.keys(patch).length === 0) {
    throw new CliValidationError(`${flag} must include at least one editable rule`);
  }
  return patch;
};

export const parseOptionalAddressList = (raw: string | undefined, flag: string): Address[] | undefined => {
  if (!raw || raw.trim().length === 0) {
    return undefined;
  }
  const values = raw
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (values.length === 0) {
    return undefined;
  }
  const unique = [...new Set(values)];
  return unique.map((value) => ensureAddress(value, flag));
};
