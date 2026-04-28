import type { FastifyRequest, FastifyServerOptions } from "fastify";
import type { AppConfig } from "@agentrade/config";
import {
  type Address,
  type PaginatedResponse,
  type ServerAuditCategory,
  ServerAuditOutcome,
  ServerAuditSeverity,
  type ServerAuditLogRecord,
  type ServerRequestLogRecord
} from "@agentrade/types";
import { nanoid } from "nanoid";
import {
  clampPageLimit,
  encodeKeysetCursor,
  nextCursorOffset,
  parseListCursor
} from "../pagination/cursor.js";

const REQUEST_LOG_RESOURCE = "server-request-logs";
const AUDIT_LOG_RESOURCE = "server-audit-logs";
const normalizeSensitiveDetailKey = (key: string): string =>
  key.replaceAll(/[^a-zA-Z0-9]/g, "").toLowerCase();

const SENSITIVE_DETAIL_KEYS = new Set(
  [
    "adminServiceKey",
    "admin_key",
    "authorization",
    "message",
    "challengeMessage",
    "siweMessage",
    "privateKey",
    "private_key",
    "walletPrivateKey",
    "secret",
    "signature",
    "authSignature",
    "token",
    "authToken",
    "bearerToken",
    "jwtToken",
    "x-admin-service-key"
  ].map(normalizeSensitiveDetailKey)
);

export const IN_MEMORY_REQUEST_LOG_CAPACITY = 10_000;
export const IN_MEMORY_AUDIT_LOG_CAPACITY = 5_000;

export interface RequestLogQuery {
  cursor?: string;
  limit: number;
  from?: string;
  to?: string;
  requestId?: string;
  actor?: Address;
  ip?: string;
  method?: string;
  routeId?: string;
  status?: number;
}

export interface AuditLogQuery {
  cursor?: string;
  limit: number;
  from?: string;
  to?: string;
  requestId?: string;
  actor?: Address;
  ip?: string;
  category?: ServerAuditCategory;
  action?: string;
  outcome?: ServerAuditOutcome;
}

export interface RequestLogCreateInput {
  requestId: string;
  method: string;
  path: string;
  routeId: string;
  statusCode: number;
  durationMs: number;
  clientIp: string;
  forwardedFor?: string | null;
  userAgent?: string | null;
  actorAddress?: Address | null;
  errorCode?: string | null;
  createdAt?: Date;
}

export interface AuditLogCreateInput {
  category: ServerAuditCategory;
  action: string;
  severity?: ServerAuditSeverity;
  outcome: ServerAuditOutcome;
  requestId?: string | null;
  clientIp?: string | null;
  actorAddress?: Address | null;
  method?: string | null;
  routeId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  cycleId?: string | null;
  message: string;
  details?: Record<string, unknown> | null;
  createdAt?: Date;
}

export interface WriteAuditContext {
  category: ServerAuditCategory;
  action: string;
  requestId?: string | null;
  clientIp?: string | null;
  actorAddress?: Address | null;
  method?: string | null;
  routeId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  cycleId?: string | null;
  details?: Record<string, unknown> | null;
}

export interface CleanupLogsResult {
  deletedRequestLogs: number;
  deletedAuditLogs: number;
}

const toIso = (value: Date): string => value.toISOString();
const toTimestamp = (value: string): number | null => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const compareCreatedDesc = (
  left: { createdAt: string; id: string },
  right: { createdAt: string; id: string }
): number => {
  const delta = right.createdAt.localeCompare(left.createdAt);
  if (delta !== 0) {
    return delta;
  }
  return right.id.localeCompare(left.id);
};

const redactDetailValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => redactDetailValue(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const next: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (SENSITIVE_DETAIL_KEYS.has(normalizeSensitiveDetailKey(key))) {
      next[key] = "[REDACTED]";
      continue;
    }
    next[key] = redactDetailValue(nestedValue);
  }
  return next;
};

export const sanitizeAuditDetails = (
  details: Record<string, unknown> | null | undefined
): Record<string, unknown> | null => {
  if (!details) {
    return null;
  }
  return redactDetailValue(details) as Record<string, unknown>;
};

export const buildRequestLogRecord = (
  input: RequestLogCreateInput
): ServerRequestLogRecord => ({
  id: nanoid(),
  requestId: input.requestId,
  method: input.method,
  path: input.path,
  routeId: input.routeId,
  statusCode: input.statusCode,
  durationMs: Number(input.durationMs.toFixed(3)),
  clientIp: input.clientIp,
  forwardedFor: input.forwardedFor ?? null,
  userAgent: input.userAgent ?? null,
  actorAddress: input.actorAddress ?? null,
  errorCode: input.errorCode ?? null,
  createdAt: toIso(input.createdAt ?? new Date())
});

export const buildAuditLogRecord = (
  input: AuditLogCreateInput
): ServerAuditLogRecord => ({
  id: nanoid(),
  category: input.category,
  action: input.action,
  severity: input.severity ?? ServerAuditSeverity.INFO,
  outcome: input.outcome,
  requestId: input.requestId ?? null,
  clientIp: input.clientIp ?? null,
  actorAddress: input.actorAddress ?? null,
  method: input.method ?? null,
  routeId: input.routeId ?? null,
  targetType: input.targetType ?? null,
  targetId: input.targetId ?? null,
  cycleId: input.cycleId ?? null,
  message: input.message,
  details: sanitizeAuditDetails(input.details),
  createdAt: toIso(input.createdAt ?? new Date())
});

const paginateByCreatedAt = <T extends { id: string; createdAt: string }>(
  items: T[],
  input: {
    cursor?: string;
    limit: number;
    resource: string;
  }
): PaginatedResponse<T> => {
  const cursor = parseListCursor(input.cursor, {
    resource: input.resource,
    sort: "createdAt",
    order: "desc"
  });
  const boundedLimit = clampPageLimit(input.limit);
  const sorted = [...items].sort(compareCreatedDesc);
  const startIndex =
    cursor.mode === "legacy-offset"
      ? Math.min(cursor.offset, sorted.length)
      : cursor.mode === "keyset"
        ? sorted.findIndex((item) => {
            const cursorId = cursor.values.id;
            const cursorPrimary = cursor.values.primary;
            if (typeof cursorId !== "string" || typeof cursorPrimary !== "string") {
              return false;
            }
            if (item.createdAt < cursorPrimary) {
              return true;
            }
            return item.createdAt === cursorPrimary && item.id < cursorId;
          })
        : 0;
  const normalizedStart = startIndex < 0 ? sorted.length : startIndex;
  const pageWithSentinel = sorted.slice(normalizedStart, normalizedStart + boundedLimit + 1);
  const hasMore = pageWithSentinel.length > boundedLimit;
  const pageItems = hasMore ? pageWithSentinel.slice(0, boundedLimit) : pageWithSentinel;
  const nextCursor =
    hasMore && pageItems.length > 0
      ? encodeKeysetCursor({
          resource: input.resource,
          sort: "createdAt",
          order: "desc",
          offset: nextCursorOffset(cursor, pageItems.length),
          values: {
            primary: pageItems[pageItems.length - 1]!.createdAt,
            id: pageItems[pageItems.length - 1]!.id
          }
        })
      : null;
  return {
    items: pageItems,
    nextCursor
  };
};

const filterByTimeRange = <T extends { createdAt: string }>(
  items: T[],
  input: { from?: string; to?: string }
): T[] => {
  const fromTs = input.from ? toTimestamp(input.from) : null;
  const toTs = input.to ? toTimestamp(input.to) : null;
  return items.filter((item) => {
    const itemTs = toTimestamp(item.createdAt);
    if (itemTs === null) {
      return false;
    }
    if (fromTs !== null && itemTs < fromTs) {
      return false;
    }
    if (toTs !== null && itemTs > toTs) {
      return false;
    }
    return true;
  });
};

export class InMemoryServerLogStore {
  private readonly requestLogs: ServerRequestLogRecord[] = [];
  private readonly auditLogs: ServerAuditLogRecord[] = [];

  appendRequestLog(input: RequestLogCreateInput): ServerRequestLogRecord {
    const record = buildRequestLogRecord(input);
    this.requestLogs.push(record);
    if (this.requestLogs.length > IN_MEMORY_REQUEST_LOG_CAPACITY) {
      this.requestLogs.splice(0, this.requestLogs.length - IN_MEMORY_REQUEST_LOG_CAPACITY);
    }
    return record;
  }

  appendAuditLog(input: AuditLogCreateInput): ServerAuditLogRecord {
    const record = buildAuditLogRecord(input);
    this.auditLogs.push(record);
    if (this.auditLogs.length > IN_MEMORY_AUDIT_LOG_CAPACITY) {
      this.auditLogs.splice(0, this.auditLogs.length - IN_MEMORY_AUDIT_LOG_CAPACITY);
    }
    return record;
  }

  queryRequestLogs(input: RequestLogQuery): PaginatedResponse<ServerRequestLogRecord> {
    const normalizedMethod = input.method?.toUpperCase();
    const filtered = paginateByCreatedAt(
      filterByTimeRange(this.requestLogs, input).filter((item) => {
        if (input.requestId && item.requestId !== input.requestId) {
          return false;
        }
        if (input.actor && item.actorAddress?.toLowerCase() !== input.actor.toLowerCase()) {
          return false;
        }
        if (input.ip && item.clientIp !== input.ip) {
          return false;
        }
        if (normalizedMethod && item.method.toUpperCase() !== normalizedMethod) {
          return false;
        }
        if (input.routeId && item.routeId !== input.routeId) {
          return false;
        }
        if (input.status !== undefined && item.statusCode !== input.status) {
          return false;
        }
        return true;
      }),
      {
        cursor: input.cursor,
        limit: input.limit,
        resource: REQUEST_LOG_RESOURCE
      }
    );
    return filtered;
  }

  queryAuditLogs(input: AuditLogQuery): PaginatedResponse<ServerAuditLogRecord> {
    return paginateByCreatedAt(
      filterByTimeRange(this.auditLogs, input).filter((item) => {
        if (input.requestId && item.requestId !== input.requestId) {
          return false;
        }
        if (input.actor && item.actorAddress?.toLowerCase() !== input.actor.toLowerCase()) {
          return false;
        }
        if (input.ip && item.clientIp !== input.ip) {
          return false;
        }
        if (input.category && item.category !== input.category) {
          return false;
        }
        if (input.action && item.action !== input.action) {
          return false;
        }
        if (input.outcome && item.outcome !== input.outcome) {
          return false;
        }
        return true;
      }),
      {
        cursor: input.cursor,
        limit: input.limit,
        resource: AUDIT_LOG_RESOURCE
      }
    );
  }

  cleanup(now: Date, config: Pick<AppConfig, "requestLogRetentionDays" | "auditLogRetentionDays">): CleanupLogsResult {
    const requestCutoff = now.getTime() - config.requestLogRetentionDays * 24 * 60 * 60 * 1000;
    const auditCutoff = now.getTime() - config.auditLogRetentionDays * 24 * 60 * 60 * 1000;
    const requestBefore = this.requestLogs.length;
    const auditBefore = this.auditLogs.length;
    for (let index = this.requestLogs.length - 1; index >= 0; index -= 1) {
      if (Date.parse(this.requestLogs[index]!.createdAt) < requestCutoff) {
        this.requestLogs.splice(index, 1);
      }
    }
    for (let index = this.auditLogs.length - 1; index >= 0; index -= 1) {
      if (Date.parse(this.auditLogs[index]!.createdAt) < auditCutoff) {
        this.auditLogs.splice(index, 1);
      }
    }
    return {
      deletedRequestLogs: requestBefore - this.requestLogs.length,
      deletedAuditLogs: auditBefore - this.auditLogs.length
    };
  }
}

export const extractRequestNetworkContext = (request: FastifyRequest): {
  clientIp: string;
  forwardedFor: string | null;
  userAgent: string | null;
} => {
  const forwardedHeader = request.headers["x-forwarded-for"];
  const forwardedFor = Array.isArray(forwardedHeader)
    ? forwardedHeader.join(",")
    : typeof forwardedHeader === "string"
      ? forwardedHeader
      : null;
  const userAgentHeader = request.headers["user-agent"];
  const userAgent = Array.isArray(userAgentHeader)
    ? userAgentHeader.join(" ")
    : typeof userAgentHeader === "string"
      ? userAgentHeader
      : null;
  return {
    clientIp: request.ip,
    forwardedFor,
    userAgent
  };
};

export const buildFastifyLoggerOptions = (
  config: Pick<AppConfig, "logLevel">
): FastifyServerOptions["logger"] => ({
  level: config.logLevel,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.x-admin-service-key",
      "headers.authorization",
      "headers.x-admin-service-key",
      "body.authorization",
      "body.token",
      "body.signature",
      "body.message",
      "body.privateKey",
      "body.wallet.privateKey",
      "data.token",
      "data.auth.token",
      "data.wallet.privateKey"
    ],
    censor: "[REDACTED]"
  },
  serializers: {
    err: (error: {
      name?: string;
      message?: string;
      stack?: string;
      code?: string;
      statusCode?: number;
    }) => ({
      type: error.name ?? "Error",
      message: error.message ?? "",
      code: error.code,
      statusCode: error.statusCode,
      stack: error.stack ?? ""
    }),
    req: (request: {
      id?: string;
      method?: string;
      url?: string;
      ip?: string;
      headers?: { ["user-agent"]?: string };
    }) => ({
      id: request.id,
      method: request.method,
      url: request.url,
      ip: request.ip,
      userAgent: request.headers?.["user-agent"]
    }),
    res: (reply: { statusCode?: number }) => ({
      statusCode: reply.statusCode
    })
  }
});

export const buildWriteSuccessAuditLog = (
  context: WriteAuditContext,
  input: {
    targetId?: string | null;
    cycleId?: string | null;
    details?: Record<string, unknown> | null;
    message?: string;
  } = {}
): AuditLogCreateInput => ({
  category: context.category,
  action: context.action,
  severity: ServerAuditSeverity.INFO,
  outcome: ServerAuditOutcome.SUCCESS,
  requestId: context.requestId ?? null,
  clientIp: context.clientIp ?? null,
  actorAddress: context.actorAddress ?? null,
  method: context.method ?? null,
  routeId: context.routeId ?? null,
  targetType: context.targetType ?? null,
  targetId: input.targetId ?? context.targetId ?? null,
  cycleId: input.cycleId ?? context.cycleId ?? null,
  message: input.message ?? `${context.action} succeeded`,
  details: input.details ?? context.details ?? null
});

export const buildWriteFailureAuditLog = (
  context: WriteAuditContext,
  input: {
    errorCode?: string | null;
    message?: string;
    details?: Record<string, unknown> | null;
  } = {}
): AuditLogCreateInput => ({
  category: context.category,
  action: context.action,
  severity: ServerAuditSeverity.WARN,
  outcome: ServerAuditOutcome.FAILURE,
  requestId: context.requestId ?? null,
  clientIp: context.clientIp ?? null,
  actorAddress: context.actorAddress ?? null,
  method: context.method ?? null,
  routeId: context.routeId ?? null,
  targetType: context.targetType ?? null,
  targetId: context.targetId ?? null,
  cycleId: context.cycleId ?? null,
  message: input.message ?? `${context.action} failed`,
  details: {
    ...(context.details ?? {}),
    ...(input.details ?? {}),
    ...(input.errorCode ? { errorCode: input.errorCode } : {})
  }
});
