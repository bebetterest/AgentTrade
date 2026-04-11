import { VoteChoice } from "@agentrade/types";
import type { Address, RuntimeEditableRulesPatch } from "@agentrade/types";
import { CliValidationError } from "./errors.js";

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
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

export const ensureAddress = (raw: string, flag: string): Address => {
  if (!ADDRESS_REGEX.test(raw)) {
    throw new CliValidationError(`${flag} must be a valid EVM address`);
  }
  return raw as Address;
};

export const ensureNonEmpty = (raw: string, flag: string): string => {
  if (raw.trim().length === 0) {
    throw new CliValidationError(`${flag} must be non-empty`);
  }
  return raw;
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

export const ensureNonNegativeInteger = (raw: string, flag: string): number => {
  const value = parseInteger(raw, flag);
  if (value < 0) {
    throw new CliValidationError(`${flag} must be >= 0`);
  }
  return value;
};

export const ensureVoteChoice = (raw: string): VoteChoice => {
  const normalized = raw.trim().toUpperCase();
  if (normalized !== VoteChoice.COMPLETED && normalized !== VoteChoice.NOT_COMPLETED) {
    throw new CliValidationError("--vote must be COMPLETED or NOT_COMPLETED");
  }
  return normalized as VoteChoice;
};

export const ensureOverrideResult = (raw: string): "COMPLETED" | "NOT_COMPLETED" => {
  const normalized = raw.trim().toUpperCase();
  if (normalized !== "COMPLETED" && normalized !== "NOT_COMPLETED") {
    throw new CliValidationError("--result must be COMPLETED or NOT_COMPLETED");
  }
  return normalized;
};

export const ensureRuntimeSettingsApplyTo = (raw: string, flag = "--apply-to"): "current" | "next" => {
  const normalized = raw.trim().toLowerCase();
  if (normalized !== "current" && normalized !== "next") {
    throw new CliValidationError(`${flag} must be current or next`);
  }
  return normalized;
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
