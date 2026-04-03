import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { isAddress as isEvmAddress } from "viem";
import type { ApiOperationDefinition } from "@agentrade/contracts";
import { ActivityEventType, type ActivityEvent, type Address, type AgentProfile, type Cycle, type DashboardMetricSnapshot, type Dispute, type LedgerBalance, type Task } from "@agentrade/types";
import type { AppConfig } from "@agentrade/config";
import type { AgentradeEngine } from "../domain/engine.js";
import type { PrismaStateRepository, PersistenceMutationScope } from "../infra/state-repository.js";
import type { ServiceMetricsCollector } from "../observability/metrics.js";
import {
  clampPageLimit,
  encodeKeysetCursor,
  nextCursorOffset,
  parseCursorOffset,
  parseListCursor,
  type CursorValues,
  type SortOrder
} from "../pagination/cursor.js";

export interface AuthChallenge {
  address: Address;
  nonce: string;
  message: string;
  createdAt: number;
}

export interface AppServices {
  config: AppConfig;
  stateRepository: PrismaStateRepository | null;
  metrics: ServiceMetricsCollector;
  challenges: Map<string, AuthChallenge>;
  writeMeta(input: { operation: string; actor?: Address; cycleId?: string }): WriteOperationMeta;
  read<T>(operation: (engine: AgentradeEngine) => T | Promise<T>): Promise<T>;
  mutate<T>(
    operation: (engine: AgentradeEngine) => T | Promise<T>,
    scope?: PersistenceMutationScope[],
    meta?: WriteOperationMeta
  ): Promise<T>;
  mutateDirect<T>(operation: () => Promise<T>, meta?: WriteOperationMeta): Promise<T>;
  readTasks(): Promise<Task[]>;
  readDisputes(): Promise<Dispute[]>;
  readAgents(): Promise<AgentProfile[]>;
  readActivities(): Promise<ActivityEvent[]>;
  readActiveCycle(): Promise<Cycle>;
  defaultAgentProfile(address: Address): AgentProfile;
  defaultLedger(address: Address): LedgerBalance;
}

export interface WriteOperationMeta {
  operation: string;
  actor?: Address;
  cycleId?: string;
}

export const isAddress = (value: string): value is Address => isEvmAddress(value);

export const isValidTimezone = (value: string): boolean => {
  if (value.trim().length === 0) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

export const toDayKey = (value: string | Date, timeZone: string): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(typeof value === "string" ? new Date(value) : value);

export const countMetrics = (events: ActivityEvent[]): DashboardMetricSnapshot => {
  const metrics: DashboardMetricSnapshot = {
    tasksPublished: 0,
    tasksAccepted: 0,
    tasksCompleted: 0,
    disputesOpened: 0
  };
  for (const event of events) {
    if (event.type === ActivityEventType.TASK_PUBLISHED) {
      metrics.tasksPublished += 1;
    } else if (event.type === ActivityEventType.TASK_ACCEPTED) {
      metrics.tasksAccepted += 1;
    } else if (event.type === ActivityEventType.TASK_COMPLETED) {
      metrics.tasksCompleted += 1;
    } else if (event.type === ActivityEventType.DISPUTE_OPENED) {
      metrics.disputesOpened += 1;
    }
  }
  return metrics;
};

export { parseCursorOffset };

export const paginateItemsByCursor = <T>(
  items: T[],
  input: {
    cursor: string | undefined;
    limit: number;
    resource: string;
    sort?: string;
    order?: SortOrder;
    toCursorValues: (item: T) => CursorValues;
    compareAfterCursor: (item: T, cursorValues: CursorValues) => number;
  }
) => {
  const parsed = parseListCursor(input.cursor, {
    resource: input.resource,
    sort: input.sort,
    order: input.order
  });
  const boundedLimit = clampPageLimit(input.limit);
  const startIndex =
    parsed.mode === "legacy-offset"
      ? Math.min(parsed.offset, items.length)
      : parsed.mode === "keyset"
        ? items.findIndex((item) => input.compareAfterCursor(item, parsed.values) > 0)
        : 0;
  const normalizedStart = startIndex < 0 ? items.length : startIndex;
  const pageWithSentinel = items.slice(normalizedStart, normalizedStart + boundedLimit + 1);
  const hasMore = pageWithSentinel.length > boundedLimit;
  const pageItems = hasMore ? pageWithSentinel.slice(0, boundedLimit) : pageWithSentinel;
  const nextCursor =
    hasMore && pageItems.length > 0
      ? encodeKeysetCursor({
          resource: input.resource,
          sort: input.sort,
          order: input.order,
          offset: nextCursorOffset(parsed, pageItems.length),
          values: input.toCursorValues(pageItems[pageItems.length - 1] as T)
        })
      : null;

  return { items: pageItems, nextCursor };
};

export const toAgentScore = (profile: AgentProfile): number => {
  const reputationAvg =
    (profile.reputation.publisher + profile.reputation.worker + profile.reputation.supervisor) / 3;
  const completionRate =
    profile.stats.tasksAccepted > 0
      ? Math.min(1, profile.stats.tasksCompleted / profile.stats.tasksAccepted) * 100
      : 0;
  const qualityRate =
    profile.stats.tasksAccepted > 0
      ? Math.max(0, 1 - profile.stats.submissionsRejected / profile.stats.tasksAccepted) * 100
      : 100;
  return Number((0.45 * reputationAvg + 0.35 * completionRate + 0.2 * qualityRate).toFixed(2));
};

export const parseOperationParams = <T = unknown>(
  operation: ApiOperationDefinition,
  request: FastifyRequest
): T => {
  if (!operation.pathParamsSchema) {
    return {} as T;
  }
  return operation.pathParamsSchema.parse(request.params) as T;
};

export const parseOperationQuery = <T = unknown>(
  operation: ApiOperationDefinition,
  request: FastifyRequest
): T => {
  if (!operation.querySchema) {
    return {} as T;
  }
  return operation.querySchema.parse(request.query ?? {}) as T;
};

export const parseOperationBody = <T = unknown>(
  operation: ApiOperationDefinition,
  request: FastifyRequest,
  fallbackBody: unknown = request.body
): T => {
  if (!operation.bodySchema) {
    return {} as T;
  }
  return operation.bodySchema.parse(fallbackBody) as T;
};

export const validateOperationResponse = <T>(
  operation: ApiOperationDefinition,
  payload: T
): T => operation.responseSchema.parse(payload) as T;

export const toServerRoutePath = (pathTemplate: string): string =>
  pathTemplate.replaceAll(/\{([^}]+)\}/g, ":$1");

const issue = (
  path: string[],
  message: string,
  code: "custom" | "too_big" = "custom",
  extras: Record<string, unknown> = {}
) => {
  if (code === "too_big") {
    return {
      code: z.ZodIssueCode.too_big,
      maximum: extras.maximum as number,
      type: extras.type as "string" | "number",
      inclusive: true,
      exact: false,
      message,
      path
    };
  }
  return {
    code: z.ZodIssueCode.custom,
    message,
    path
  };
};

export const createValidationError = (
  path: string[],
  message: string,
  options?: { maximum?: number; type?: "string" | "number" }
): z.ZodError =>
  new z.ZodError(
    options
      ? [issue(path, message, "too_big", options)]
      : [issue(path, message)]
  );

export const validateCreateTaskInput = (
  input: {
    title: string;
    descriptionMd: string;
    acceptanceCriteria: string;
    displayTimezone: string;
    slotsTotal: number;
    rewardPerSlot: number;
  },
  config: AppConfig
): void => {
  if (input.title.length > config.taskTitleMaxLength) {
    throw createValidationError(["title"], `title must be <= ${config.taskTitleMaxLength} chars`, {
      maximum: config.taskTitleMaxLength,
      type: "string"
    });
  }
  if (input.descriptionMd.length > config.taskDescriptionMaxLength) {
    throw createValidationError(
      ["descriptionMd"],
      `descriptionMd must be <= ${config.taskDescriptionMaxLength} chars`,
      {
        maximum: config.taskDescriptionMaxLength,
        type: "string"
      }
    );
  }
  if (input.acceptanceCriteria.length > config.taskAcceptanceCriteriaMaxLength) {
    throw createValidationError(
      ["acceptanceCriteria"],
      `acceptanceCriteria must be <= ${config.taskAcceptanceCriteriaMaxLength} chars`,
      {
        maximum: config.taskAcceptanceCriteriaMaxLength,
        type: "string"
      }
    );
  }
  if (!isValidTimezone(input.displayTimezone)) {
    throw createValidationError(
      ["displayTimezone"],
      "displayTimezone must be a valid IANA timezone"
    );
  }
  if (input.slotsTotal > config.taskSlotsMax) {
    throw createValidationError(["slotsTotal"], `slotsTotal must be <= ${config.taskSlotsMax}`, {
      maximum: config.taskSlotsMax,
      type: "number"
    });
  }
  if (input.rewardPerSlot > config.taskRewardPerSlotMax) {
    throw createValidationError(
      ["rewardPerSlot"],
      `rewardPerSlot must be <= ${config.taskRewardPerSlotMax}`,
      {
        maximum: config.taskRewardPerSlotMax,
        type: "number"
      }
    );
  }
};

export const validateSubmissionPayloadLength = (payloadMd: string, config: AppConfig): void => {
  if (payloadMd.length > config.taskSubmissionPayloadMaxLength) {
    throw createValidationError(
      ["payloadMd"],
      `payloadMd must be <= ${config.taskSubmissionPayloadMaxLength} chars`,
      {
        maximum: config.taskSubmissionPayloadMaxLength,
        type: "string"
      }
    );
  }
};

export const validateDisputeReasonLength = (reasonMd: string, config: AppConfig): void => {
  if (reasonMd.length > config.disputeReasonMaxLength) {
    throw createValidationError(
      ["reasonMd"],
      `reasonMd must be <= ${config.disputeReasonMaxLength} chars`,
      {
        maximum: config.disputeReasonMaxLength,
        type: "string"
      }
    );
  }
};

export const toV2ErrorEnvelope = (
  statusCode: number,
  code: string,
  message: string,
  requestId: string,
  details?: unknown
) => ({
  error: {
    code,
    message,
    details,
    requestId,
    retryable: statusCode === 429 || statusCode >= 500
  }
});
