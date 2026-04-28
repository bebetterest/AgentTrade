import { timingSafeEqual } from "node:crypto";
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "jsonwebtoken";
import { z } from "zod";
import {
  applyRuntimeEditableRules,
  mergeRuntimeEditableRules,
  pickRuntimeEditableRules,
  validateRuntimeEditableRules,
  loadConfig,
  type RuntimeEditableRulesPatch
} from "@agentrade/config";
import { supportedApiVersions } from "@agentrade/contracts";
import {
  type ActivityEvent,
  type Address,
  type AgentProfile,
  AgentStatus,
  type CloseCycleResult,
  type Cycle,
  type Dispute,
  type LedgerBalance,
  type PaginatedResponse,
  type RuntimeRuleAuditRecord,
  ServerAuditCategory,
  ServerAuditOutcome,
  ServerAuditSeverity,
  type ServerAuditLogRecord,
  type ServerRequestLogRecord,
  type RuntimeSettingsState,
  type Submission,
  type Task
} from "@agentrade/types";
import { AgentradeEngine } from "./domain/engine.js";
import { DomainError } from "./domain/errors.js";
import { applyRateLimit } from "./core/rate-limit.js";
import { createRateLimiter } from "./infra/rate-limiter.js";
import {
  PersistenceConflictError,
  PrismaStateRepository,
  type PersistenceMutationScope
} from "./infra/state-repository.js";
import { registerAgentRoutes } from "./api/agents.js";
import { registerAuthRoutes } from "./api/auth.js";
import { registerDisputeRoutes } from "./api/disputes.js";
import { registerSubmissionRoutes } from "./api/submissions.js";
import { registerTodoRoutes } from "./api/todos.js";
import {
  isAddress,
  toV2ErrorEnvelope,
  type AppServices,
  type WriteOperationMeta
} from "./api/services.js";
import { registerSystemRoutes } from "./api/system.js";
import { registerTaskRoutes } from "./api/tasks.js";
import {
  assertSupportedApiDefaultVersion,
  findUnsupportedApiVersion,
  formatUnsupportedApiVersionMessage,
  getRequestPathname,
  resolveVersionlessApiRedirect
} from "./api/versioning.js";
import { ServiceMetricsCollector } from "./observability/metrics.js";
import {
  type AuditLogCreateInput,
  buildFastifyLoggerOptions,
  buildWriteFailureAuditLog,
  buildWriteSuccessAuditLog,
  extractRequestNetworkContext,
  InMemoryServerLogStore,
  type RequestLogCreateInput,
  type WriteAuditContext
} from "./observability/server-logs.js";
import { HttpError } from "./utils/http-error.js";
import "./types.js";

export const buildApp = async () => {
  const config = loadConfig();
  assertSupportedApiDefaultVersion(config);
  const app = Fastify({
    logger: process.env.VITEST ? false : buildFastifyLoggerOptions(config),
    disableRequestLogging: true,
    trustProxy: config.trustProxy
  });
  const corsOrigin =
    config.corsAllowedOrigins.length === 1 && config.corsAllowedOrigins[0] === "*"
      ? true
      : config.corsAllowedOrigins;

  const stateRepository = config.enablePersistence
    ? new PrismaStateRepository(config.databaseUrl, config)
    : null;
  const inMemoryServerLogs = new InMemoryServerLogStore();
  let logQueue: Promise<void> = Promise.resolve();
  const enqueueLogWrite = async <T>(operation: () => Promise<T>): Promise<T> => {
    const next = logQueue.then(operation, operation);
    logQueue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  };
  const appendRequestLog = async (
    input: RequestLogCreateInput
  ): Promise<ServerRequestLogRecord> =>
    enqueueLogWrite(async () => {
      if (stateRepository && config.enableRequestLogPersistence) {
        return stateRepository.appendRequestLogDirect(input);
      }
      return inMemoryServerLogs.appendRequestLog(input);
    });
  const appendAuditLog = async (
    input: AuditLogCreateInput
  ): Promise<ServerAuditLogRecord> =>
    enqueueLogWrite(async () => {
      const record =
        stateRepository && config.enableAuditLogPersistence
          ? await stateRepository.appendAuditLogDirect(input)
          : inMemoryServerLogs.appendAuditLog(input);
      const payload = {
        category: record.category,
        action: record.action,
        outcome: record.outcome,
        requestId: record.requestId,
        clientIp: record.clientIp,
        actorAddress: record.actorAddress,
        targetType: record.targetType,
        targetId: record.targetId,
        cycleId: record.cycleId,
        details: record.details
      };
      if (record.severity === ServerAuditSeverity.ERROR) {
        app.log.error(payload, record.message);
      } else if (record.severity === ServerAuditSeverity.WARN) {
        app.log.warn(payload, record.message);
      } else {
        app.log.info(payload, record.message);
      }
      return record;
    });
  const recordAudit = async (input: AuditLogCreateInput): Promise<void> => {
    try {
      await appendAuditLog(input);
    } catch (error) {
      app.log.error({ error }, "audit log append failed");
    }
  };
  const listRequestLogs = async (
    input: Parameters<InMemoryServerLogStore["queryRequestLogs"]>[0]
  ): Promise<PaginatedResponse<ServerRequestLogRecord>> => {
    if (stateRepository && config.enableRequestLogPersistence) {
      return stateRepository.queryRequestLogsDirect(input);
    }
    return inMemoryServerLogs.queryRequestLogs(input);
  };
  const listAuditLogs = async (
    input: Parameters<InMemoryServerLogStore["queryAuditLogs"]>[0]
  ): Promise<PaginatedResponse<ServerAuditLogRecord>> => {
    if (stateRepository && config.enableAuditLogPersistence) {
      return stateRepository.queryAuditLogsDirect(input);
    }
    return inMemoryServerLogs.queryAuditLogs(input);
  };
  const cleanupLogs = async (now = new Date()) =>
    enqueueLogWrite(async () => {
      const [persisted, inMemory] = await Promise.all([
        stateRepository && (config.enableRequestLogPersistence || config.enableAuditLogPersistence)
          ? stateRepository.cleanupExpiredLogs(now)
          : Promise.resolve({ deletedRequestLogs: 0, deletedAuditLogs: 0 }),
        Promise.resolve(inMemoryServerLogs.cleanup(now, config))
      ]);
      return {
        deletedRequestLogs: persisted.deletedRequestLogs + inMemory.deletedRequestLogs,
        deletedAuditLogs: persisted.deletedAuditLogs + inMemory.deletedAuditLogs
      };
    });

  await app.register(helmet);
  const limiter = await createRateLimiter(config, app.log, appendAuditLog);
  const metrics = new ServiceMetricsCollector();
  const safeSecretEqual = (expected: string, received: string): boolean => {
    const expectedBuffer = Buffer.from(expected);
    const receivedBuffer = Buffer.from(received);
    if (expectedBuffer.length !== receivedBuffer.length) {
      return false;
    }
    return timingSafeEqual(expectedBuffer, receivedBuffer);
  };
  const runtimeRulesSeed = pickRuntimeEditableRules(config);
  let runtimeSettingsState: RuntimeSettingsState = {
    currentRules: runtimeRulesSeed,
    pendingNextPatch: null,
    nextRules: runtimeRulesSeed,
    updatedAt: new Date().toISOString()
  };
  const nonPersistenceRuntimeAuditLog: RuntimeRuleAuditRecord[] = [];

  const syncConfigWithRuntimeRules = (state: RuntimeSettingsState): void => {
    validateRuntimeEditableRules(state.currentRules);
    validateRuntimeEditableRules(state.nextRules);
    Object.assign(config, applyRuntimeEditableRules(config, state.currentRules));
  };
  const setRuntimeSettingsState = (next: RuntimeSettingsState): RuntimeSettingsState => {
    runtimeSettingsState = next;
    syncConfigWithRuntimeRules(next);
    return runtimeSettingsState;
  };
  const diffRuntimePatch = (
    base: RuntimeSettingsState["currentRules"],
    target: RuntimeSettingsState["currentRules"]
  ): RuntimeEditableRulesPatch => {
    const patch: RuntimeEditableRulesPatch = {};
    for (const [key, value] of Object.entries(target)) {
      const typedKey = key as keyof typeof target;
      if (base[typedKey] !== value) {
        patch[typedKey] = value;
      }
    }
    return patch;
  };
  syncConfigWithRuntimeRules(runtimeSettingsState);

  let inMemoryEngine = new AgentradeEngine(config);
  let runtimeRevision: string | null = null;
  let inMemoryEngineDirty = false;
  if (stateRepository) {
    await stateRepository.ensureInitialized(inMemoryEngine.toSnapshot());
    const initializedRules = await stateRepository.ensureRuntimeRulesInitialized(runtimeRulesSeed);
    setRuntimeSettingsState(initializedRules);
    const snapshot = await stateRepository.load();
    if (snapshot) {
      inMemoryEngine = AgentradeEngine.fromSnapshot(config, snapshot);
      app.log.info("loaded engine state from normalized persistence tables");
      await recordAudit({
        category: ServerAuditCategory.RUNTIME,
        action: "runtime.persistence.load",
        severity: ServerAuditSeverity.INFO,
        outcome: ServerAuditOutcome.SUCCESS,
        cycleId: snapshot.activeCycleId,
        message: "loaded engine state from normalized persistence tables",
        details: {
          activeCycleId: snapshot.activeCycleId
        }
      });
    }
    runtimeRevision = await stateRepository.getRuntimeRevision();
  }

  const read = async <T>(operation: (engine: AgentradeEngine) => T | Promise<T>): Promise<T> => {
    return operation(inMemoryEngine);
  };

  const cloneSnapshot = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

  const errorCode = (error: unknown): string | null => {
    if (!error || typeof error !== "object" || !("code" in error)) {
      return null;
    }
    const raw = (error as { code?: unknown }).code;
    return typeof raw === "string" && raw.length > 0 ? raw : null;
  };

  const isDeadlockError = (error: unknown): boolean => {
    const code = errorCode(error);
    if (code === "40P01") {
      return true;
    }
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    return message.includes("deadlock");
  };

  const resolveCurrentCycleId = (): string | undefined => {
    try {
      return inMemoryEngine.getActiveCycle().id;
    } catch {
      return undefined;
    }
  };

  const buildWriteAuditContext = (meta: WriteOperationMeta): WriteAuditContext => ({
    category: meta.auditCategory,
    action: meta.operation,
    requestId: meta.requestId ?? null,
    clientIp: meta.clientIp ?? null,
    actorAddress: meta.actor ?? null,
    method: meta.method ?? null,
    routeId: meta.routeId ?? null,
    targetType: meta.targetType ?? null,
    targetId: meta.targetId ?? null,
    cycleId: meta.cycleId ?? null,
    details: meta.details ?? null
  });

  const normalizeWriteMeta = (
    meta: WriteOperationMeta | undefined,
    fallbackOperation: string
  ): WriteOperationMeta => ({
    operation: meta?.operation ?? fallbackOperation,
    actor: meta?.actor,
    cycleId: meta?.cycleId ?? resolveCurrentCycleId(),
    auditCategory: meta?.auditCategory ?? ServerAuditCategory.DOMAIN_WRITE,
    requestId: meta?.requestId ?? null,
    clientIp: meta?.clientIp ?? null,
    method: meta?.method ?? null,
    routeId: meta?.routeId ?? null,
    targetType: meta?.targetType ?? null,
    targetId: meta?.targetId ?? null,
    details: meta?.details ?? null
  });

  const recordWriteOutcome = async (
    meta: WriteOperationMeta,
    input: {
      startedAtNs: bigint;
      retryCount: number;
      conflict: boolean;
      outcome: "success" | "error";
      error?: unknown;
    }
  ): Promise<void> => {
    const durationMs = Number(process.hrtime.bigint() - input.startedAtNs) / 1_000_000;
    const deadlock = input.outcome === "error" && isDeadlockError(input.error);
    metrics.recordWrite({
      durationMs,
      outcome: input.outcome,
      conflict: input.conflict,
      deadlock
    });

    const payload = {
      operation: meta.operation,
      actor: meta.actor ?? null,
      cycleId: meta.cycleId ?? null,
      retryCount: input.retryCount,
      conflictOrDeadlock: input.conflict || deadlock,
      outcome: input.outcome,
      durationMs: Number(durationMs.toFixed(3))
    };
    if (input.outcome === "success") {
      app.log.info(payload, "write operation completed");
      if (!stateRepository || !config.enableAuditLogPersistence) {
        await recordAudit(
          buildWriteSuccessAuditLog(buildWriteAuditContext(meta), {
            cycleId: meta.cycleId ?? null,
            details: {
              ...(meta.details ?? {}),
              retryCount: input.retryCount,
              conflictOrDeadlock: input.conflict || deadlock
            }
          })
        );
      }
      return;
    }
    app.log.warn({ ...payload, code: errorCode(input.error) }, "write operation failed");
    await recordAudit(
      buildWriteFailureAuditLog(buildWriteAuditContext(meta), {
        errorCode: errorCode(input.error),
        details: {
          retryCount: input.retryCount,
          conflictOrDeadlock: input.conflict || deadlock
        }
      })
    );
  };

  let mutationQueue: Promise<void> = Promise.resolve();
  const enqueueMutation = async <T>(operation: () => Promise<T>): Promise<T> => {
    const next = mutationQueue.then(operation, operation);
    mutationQueue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  };

  const mutate = async <T>(
    operation: (engine: AgentradeEngine) => T | Promise<T>,
    scope?: PersistenceMutationScope[],
    meta?: WriteOperationMeta
  ): Promise<T> => {
    const writeMeta = normalizeWriteMeta(meta, "engine-mutate");
    const startedAtNs = process.hrtime.bigint();
    let retryCount = 0;
    let conflict = false;

    try {
      if (!stateRepository) {
        const result = await enqueueMutation(async () => operation(inMemoryEngine));
        await recordWriteOutcome(writeMeta, {
          startedAtNs,
          retryCount,
          conflict,
          outcome: "success"
        });
        return result;
      }

      const result = await enqueueMutation(async () => {
        if (inMemoryEngineDirty) {
          const latestSnapshot = await stateRepository.load();
          if (latestSnapshot) {
            inMemoryEngine = AgentradeEngine.fromSnapshot(config, latestSnapshot);
            app.engine = inMemoryEngine;
          }
          runtimeRevision = await stateRepository.getRuntimeRevision();
          inMemoryEngineDirty = false;
        }

        for (let attempt = 1; attempt <= 3; attempt += 1) {
          const baselineSnapshot = inMemoryEngine.toSnapshot();
          const runtime = AgentradeEngine.fromSnapshot(config, cloneSnapshot(baselineSnapshot));
          const result = await operation(runtime);
          const nextSnapshot = runtime.toSnapshot();

          try {
            runtimeRevision = await stateRepository.syncFromSnapshots(
              baselineSnapshot,
              nextSnapshot,
              runtimeRevision,
              scope
            );
          } catch (error) {
            if (error instanceof PersistenceConflictError && attempt < 3) {
              conflict = true;
              retryCount += 1;
              const latestSnapshot = await stateRepository.load();
              if (latestSnapshot) {
                inMemoryEngine = AgentradeEngine.fromSnapshot(config, latestSnapshot);
                app.engine = inMemoryEngine;
              }
              runtimeRevision = await stateRepository.getRuntimeRevision();
              continue;
            }
            throw error;
          }

          inMemoryEngine = runtime;
          app.engine = inMemoryEngine;
          inMemoryEngineDirty = false;
          return result;
        }

        throw new HttpError(409, "persistence conflict: retry limit reached");
      });

      await recordWriteOutcome(writeMeta, {
        startedAtNs,
        retryCount,
        conflict,
        outcome: "success"
      });
      return result;
    } catch (error) {
      await recordWriteOutcome(writeMeta, {
        startedAtNs,
        retryCount,
        conflict,
        outcome: "error",
        error
      });
      throw error;
    }
  };

  const mutateDirect = async <T>(
    operation: () => Promise<T>,
    meta?: WriteOperationMeta
  ): Promise<T> => {
    const writeMeta = normalizeWriteMeta(meta, "repository-direct-write");
    const startedAtNs = process.hrtime.bigint();
    if (!stateRepository) {
      throw new HttpError(500, "persistence repository is unavailable");
    }
    try {
      const result = await enqueueMutation(async () => {
        const next = await operation();
        inMemoryEngineDirty = true;
        runtimeRevision = null;
        return next;
      });
      await recordWriteOutcome(writeMeta, {
        startedAtNs,
        retryCount: 0,
        conflict: false,
        outcome: "success"
      });
      return result;
    } catch (error) {
      await recordWriteOutcome(writeMeta, {
        startedAtNs,
        retryCount: 0,
        conflict: false,
        outcome: "error",
        error
      });
      throw error;
    }
  };

  const AUTO_CYCLE_CLOSE_INTERVAL_MS = 30_000;
  const AUTO_CYCLE_CLOSE_SKIP_PATHS = new Set<string>();
  let autoCycleCloseInFlight: Promise<void> | null = null;
  const hasPendingRuntimePatch = (): boolean =>
    Boolean(
      runtimeSettingsState.pendingNextPatch &&
        Object.keys(runtimeSettingsState.pendingNextPatch).length > 0
    );

  const isCycleDueForAutoClose = (cycle: Cycle): boolean => {
    if (cycle.status !== "OPEN") {
      return false;
    }
    const startedAtMs = Date.parse(cycle.startedAt);
    if (!Number.isFinite(startedAtMs)) {
      return false;
    }
    const cycleDurationMs = runtimeSettingsState.currentRules.cycleDurationHours * 3_600_000;
    return Date.now() >= startedAtMs + cycleDurationMs;
  };

  const closeDueCycleOnce = async (): Promise<CloseCycleResult | null> => {
    if (!stateRepository) {
      return enqueueMutation(async () => {
        const activeCycle = inMemoryEngine.getActiveCycle();
        if (!isCycleDueForAutoClose(activeCycle)) {
          return null;
        }
        const beforeRules = runtimeSettingsState.currentRules;
        const pendingPatch = runtimeSettingsState.pendingNextPatch;
        config.mintPerCycle = runtimeSettingsState.nextRules.mintPerCycle;
        const close = inMemoryEngine.closeCurrentCycle();
        if (pendingPatch && Object.keys(pendingPatch).length > 0) {
          const nextCurrentRules = mergeRuntimeEditableRules(beforeRules, pendingPatch);
          const nextState: RuntimeSettingsState = {
            currentRules: nextCurrentRules,
            pendingNextPatch: null,
            nextRules: nextCurrentRules,
            updatedAt: new Date().toISOString()
          };
          setRuntimeSettingsState(nextState);
          nonPersistenceRuntimeAuditLog.unshift({
            id: `runtime-audit-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            eventType: "AUTO_APPLY_NEXT",
            applyTo: null,
            reason: null,
            actor: "system",
            cycleId: close.openedCycleId,
            beforeRules,
            afterRules: nextCurrentRules,
            patch: pendingPatch,
            pendingNextPatch: null,
            createdAt: nextState.updatedAt
          });
        }
        app.engine = inMemoryEngine;
        return close;
      });
    }

    const close = await enqueueMutation(async () => {
      const shouldApplyNext = hasPendingRuntimePatch();
      const closeConfig = {
        ...config,
        mintPerCycle: runtimeSettingsState.nextRules.mintPerCycle
      };
      const result = await stateRepository.closeCurrentCycleIfDueDirect(closeConfig);
      if (!result) {
        return null;
      }
      if (shouldApplyNext) {
        const applied = await stateRepository.applyPendingRuntimeRulesForOpenedCycleDirect({
          openedCycleId: result.openedCycleId,
          actor: "system"
        });
        setRuntimeSettingsState(applied);
      }
      inMemoryEngineDirty = true;
      runtimeRevision = null;
      return result;
    });
    return close;
  };

  const settleDueCycles = async (
    trigger: "startup" | "request" | "timer"
  ): Promise<void> => {
    if (autoCycleCloseInFlight) {
      return autoCycleCloseInFlight;
    }

    autoCycleCloseInFlight = (async () => {
      let closedCount = 0;
      let lastClosedCycleId: string | null = null;
      let lastOpenedCycleId: string | null = null;
      while (true) {
        const closed = await closeDueCycleOnce();
        if (!closed) {
          break;
        }
        closedCount += 1;
        lastClosedCycleId = closed.closedCycleId;
        lastOpenedCycleId = closed.openedCycleId;
      }
      if (closedCount > 0) {
        app.log.info(
          {
            trigger,
            closedCount,
            lastClosedCycleId,
            lastOpenedCycleId
          },
          "auto cycle close settled due cycle(s)"
        );
        await recordAudit({
          category: ServerAuditCategory.BACKGROUND_JOB,
          action: "cycles.auto-close",
          severity: ServerAuditSeverity.INFO,
          outcome: ServerAuditOutcome.SUCCESS,
          cycleId: lastOpenedCycleId,
          message: "auto cycle close settled due cycle(s)",
          details: {
            trigger,
            closedCount,
            lastClosedCycleId,
            lastOpenedCycleId
          }
        });
      }
    })()
      .catch(async (error) => {
        app.log.warn(
          {
            trigger,
            code: errorCode(error)
          },
          "auto cycle close failed"
        );
        await recordAudit({
          category: ServerAuditCategory.BACKGROUND_JOB,
          action: "cycles.auto-close",
          severity: ServerAuditSeverity.WARN,
          outcome: ServerAuditOutcome.FAILURE,
          cycleId: resolveCurrentCycleId() ?? null,
          message: "auto cycle close failed",
          details: {
            trigger,
            errorCode: errorCode(error)
          }
        });
      })
      .finally(() => {
        autoCycleCloseInFlight = null;
      });

    return autoCycleCloseInFlight;
  };

  const defaultAgentProfile = (address: Address): AgentProfile => {
    const now = new Date().toISOString();
    return {
      address,
      name: "",
      bio: "",
      status: AgentStatus.ACTIVE,
      bannedAt: null,
      banReasonCode: null,
      reputation: { publisher: 50, worker: 50, supervisor: 50 },
      stats: {
        tasksPublished: 0,
        tasksIntented: 0,
        tasksCompleted: 0,
        tasksTerminated: 0,
        submissionsRejected: 0,
        supervisionVotes: 0
      },
      createdAt: now,
      updatedAt: now
    };
  };

  const defaultLedger = (address: Address): LedgerBalance => ({
    address,
    available: config.initialAgentBalance,
    updatedAt: new Date().toISOString()
  });

  const readTasks = async (): Promise<Task[]> => {
    if (stateRepository) {
      return stateRepository.listTasksDirect();
    }
    return read((engine) => engine.listTasks());
  };

  const readSubmissions = async (): Promise<Submission[]> => {
    if (stateRepository) {
      return stateRepository.listSubmissionsDirect();
    }
    return read((engine) => engine.listSubmissions());
  };

  const readDisputes = async (): Promise<Dispute[]> => {
    if (stateRepository) {
      return stateRepository.listDisputesDirect();
    }
    return read((engine) => engine.listDisputes());
  };

  const readAgents = async (): Promise<AgentProfile[]> => {
    if (stateRepository) {
      return stateRepository.listAgentsDirect();
    }
    return read((engine) => engine.listAgents());
  };

  const readActivities = async (): Promise<ActivityEvent[]> => {
    if (stateRepository) {
      return stateRepository.listActivitiesDirect();
    }
    return read((engine) => engine.listActivities());
  };

  const readActiveCycle = async (): Promise<Cycle> => {
    if (stateRepository) {
      const cycle = await stateRepository.getActiveCycleDirect();
      if (!cycle) {
        throw new DomainError("CYCLE_NOT_FOUND", "active cycle not found", 404);
      }
      return cycle;
    }
    return read((engine) => engine.getActiveCycle());
  };

  const readRuntimeSettings = async (): Promise<RuntimeSettingsState> => {
    if (!stateRepository) {
      return runtimeSettingsState;
    }
    const next =
      (await stateRepository.getRuntimeSettingsDirect()) ??
      (await stateRepository.ensureRuntimeRulesInitialized(runtimeRulesSeed));
    return setRuntimeSettingsState(next);
  };

  const listRuntimeRuleHistory = async (input: {
    cursor?: string;
    limit: number;
  }): Promise<PaginatedResponse<RuntimeRuleAuditRecord>> => {
    if (stateRepository) {
      return stateRepository.listRuntimeRuleAuditsDirect(input);
    }
    const boundedLimit = Math.min(100, Math.max(1, input.limit));
    const offsetRaw = input.cursor ? Number(input.cursor) : 0;
    const offset = Number.isSafeInteger(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;
    const items = nonPersistenceRuntimeAuditLog.slice(offset, offset + boundedLimit);
    const nextCursor =
      offset + boundedLimit < nonPersistenceRuntimeAuditLog.length
        ? String(offset + boundedLimit)
        : null;
    return { items, nextCursor };
  };

  const updateRuntimeSettings = async (input: {
    applyTo: "current" | "next";
    patch: RuntimeEditableRulesPatch;
    reason?: string;
    actor?: string;
    auditContext?: WriteAuditContext;
  }): Promise<RuntimeSettingsState> => {
    if (Object.keys(input.patch).length === 0) {
      return readRuntimeSettings();
    }
    if (stateRepository) {
      const nextState = await mutateDirect(
        () =>
          stateRepository.updateRuntimeRulesDirect({
            applyTo: input.applyTo,
            patch: input.patch,
            reason: input.reason,
            actor: input.actor,
            auditContext: input.auditContext
          }),
        {
          operation: "system.settings.update",
          actor: input.actor && isAddress(input.actor) ? input.actor : undefined,
          auditCategory: ServerAuditCategory.ADMIN,
          requestId: input.auditContext?.requestId ?? null,
          clientIp: input.auditContext?.clientIp ?? null,
          method: input.auditContext?.method ?? null,
          routeId: input.auditContext?.routeId ?? null,
          targetType: input.auditContext?.targetType ?? null,
          targetId: input.auditContext?.targetId ?? null,
          details: {
            applyTo: input.applyTo,
            patchKeys: Object.keys(input.patch)
          }
        }
      );
      return setRuntimeSettingsState(nextState);
    }

    try {
      const beforeRules = runtimeSettingsState.currentRules;
      const beforePending = runtimeSettingsState.pendingNextPatch;
      let nextCurrentRules = beforeRules;
      let nextPendingPatch = beforePending ?? {};
      if (input.applyTo === "current") {
        nextCurrentRules = mergeRuntimeEditableRules(beforeRules, input.patch);
        validateRuntimeEditableRules(nextCurrentRules);
        if (input.patch.mintPerCycle !== undefined) {
          inMemoryEngine.getActiveCycle().mintedAmount = nextCurrentRules.mintPerCycle;
        }
      } else {
        const currentNextRules = mergeRuntimeEditableRules(beforeRules, nextPendingPatch);
        const mergedNextRules = mergeRuntimeEditableRules(currentNextRules, input.patch);
        validateRuntimeEditableRules(mergedNextRules);
        nextPendingPatch = diffRuntimePatch(beforeRules, mergedNextRules);
      }
      const normalizedPending =
        Object.keys(nextPendingPatch).length > 0 ? nextPendingPatch : null;
      const nextRules = normalizedPending
        ? mergeRuntimeEditableRules(nextCurrentRules, normalizedPending)
        : nextCurrentRules;
      const nextState: RuntimeSettingsState = {
        currentRules: nextCurrentRules,
        pendingNextPatch: normalizedPending,
        nextRules,
        updatedAt: new Date().toISOString()
      };
      setRuntimeSettingsState(nextState);
      nonPersistenceRuntimeAuditLog.unshift({
        id: `runtime-audit-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        eventType: "UPDATE",
        applyTo: input.applyTo,
        reason: input.reason?.trim().length ? input.reason.trim() : null,
        actor: input.actor?.trim().length ? input.actor.trim() : null,
        cycleId: resolveCurrentCycleId() ?? null,
        beforeRules,
        afterRules: nextCurrentRules,
        patch: input.patch,
        pendingNextPatch: normalizedPending,
        createdAt: nextState.updatedAt
      });
      if (input.auditContext) {
        await recordAudit(
          buildWriteSuccessAuditLog(input.auditContext, {
            targetId: "singleton",
            cycleId: resolveCurrentCycleId() ?? null,
            message: "system.settings.update succeeded",
            details: {
              applyTo: input.applyTo,
              patchKeys: Object.keys(input.patch)
            }
          })
        );
      }
      return nextState;
    } catch (error) {
      if (input.auditContext) {
        await recordAudit(
          buildWriteFailureAuditLog(input.auditContext, {
            errorCode: errorCode(error),
            details: {
              applyTo: input.applyTo,
              patchKeys: Object.keys(input.patch)
            }
          })
        );
      }
      throw error;
    }
  };

  const resetRuntimeSettings = async (input: {
    applyTo: "current" | "next";
    reason?: string;
    actor?: string;
    auditContext?: WriteAuditContext;
  }): Promise<RuntimeSettingsState> => {
    if (stateRepository) {
      const nextState = await mutateDirect(
        () =>
          stateRepository.resetRuntimeRulesDirect({
            applyTo: input.applyTo,
            defaults: runtimeRulesSeed,
            reason: input.reason,
            actor: input.actor,
            auditContext: input.auditContext
          }),
        {
          operation: "system.settings.reset",
          actor: input.actor && isAddress(input.actor) ? input.actor : undefined,
          auditCategory: ServerAuditCategory.ADMIN,
          requestId: input.auditContext?.requestId ?? null,
          clientIp: input.auditContext?.clientIp ?? null,
          method: input.auditContext?.method ?? null,
          routeId: input.auditContext?.routeId ?? null,
          targetType: input.auditContext?.targetType ?? null,
          targetId: input.auditContext?.targetId ?? null,
          details: {
            applyTo: input.applyTo
          }
        }
      );
      return setRuntimeSettingsState(nextState);
    }

    try {
      const beforeRules = runtimeSettingsState.currentRules;
      const nextCurrentRules =
        input.applyTo === "current" ? runtimeRulesSeed : beforeRules;
      if (
        input.applyTo === "current" &&
        nextCurrentRules.mintPerCycle !== beforeRules.mintPerCycle
      ) {
        inMemoryEngine.getActiveCycle().mintedAmount = nextCurrentRules.mintPerCycle;
      }
      const pendingTarget =
        input.applyTo === "next"
          ? runtimeRulesSeed
          : mergeRuntimeEditableRules(
              nextCurrentRules,
              runtimeSettingsState.pendingNextPatch ?? {}
            );
      const pendingPatch: RuntimeEditableRulesPatch = {};
      if (input.applyTo === "next") {
        Object.assign(pendingPatch, diffRuntimePatch(nextCurrentRules, pendingTarget));
      }
      const normalizedPending =
        input.applyTo === "next" && Object.keys(pendingPatch).length > 0 ? pendingPatch : null;
      const nextRules = normalizedPending
        ? mergeRuntimeEditableRules(nextCurrentRules, normalizedPending)
        : nextCurrentRules;
      const nextState: RuntimeSettingsState = {
        currentRules: nextCurrentRules,
        pendingNextPatch: normalizedPending,
        nextRules,
        updatedAt: new Date().toISOString()
      };
      setRuntimeSettingsState(nextState);
      const patch =
        input.applyTo === "current"
          ? diffRuntimePatch(beforeRules, nextCurrentRules)
          : normalizedPending ?? {};
      nonPersistenceRuntimeAuditLog.unshift({
        id: `runtime-audit-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        eventType: "RESET",
        applyTo: input.applyTo,
        reason: input.reason?.trim().length ? input.reason.trim() : null,
        actor: input.actor?.trim().length ? input.actor.trim() : null,
        cycleId: resolveCurrentCycleId() ?? null,
        beforeRules,
        afterRules: nextCurrentRules,
        patch,
        pendingNextPatch: normalizedPending,
        createdAt: nextState.updatedAt
      });
      if (input.auditContext) {
        await recordAudit(
          buildWriteSuccessAuditLog(input.auditContext, {
            targetId: "singleton",
            cycleId: resolveCurrentCycleId() ?? null,
            message: "system.settings.reset succeeded",
            details: {
              applyTo: input.applyTo
            }
          })
        );
      }
      return nextState;
    } catch (error) {
      if (input.auditContext) {
        await recordAudit(
          buildWriteFailureAuditLog(input.auditContext, {
            errorCode: errorCode(error),
            details: {
              applyTo: input.applyTo
            }
          })
        );
      }
      throw error;
    }
  };

  const challenges = new Map<string, { address: Address; nonce: string; message: string; createdAt: number }>();

  const services: AppServices = {
    config,
    stateRepository,
    metrics,
    challenges,
    writeMeta: (input) => {
      const request = input.request;
      const network = request ? extractRequestNetworkContext(request) : null;
      return normalizeWriteMeta(
        {
          operation: input.operation,
          actor: input.actor,
          cycleId: input.cycleId,
          auditCategory: input.auditCategory ?? ServerAuditCategory.DOMAIN_WRITE,
          requestId: request?.id ?? null,
          clientIp: network?.clientIp ?? null,
          method: request?.method ?? null,
          routeId: request?.routeOptions?.url ?? null,
          targetType: input.targetType ?? null,
          targetId: input.targetId ?? null,
          details: input.details ?? null
        },
        input.operation
      );
    },
    read,
    mutate,
    mutateDirect,
    readTasks,
    readSubmissions,
    readDisputes,
    readAgents,
    readActivities,
    readActiveCycle,
    readRuntimeSettings,
    listRuntimeRuleHistory,
    listRequestLogs,
    listAuditLogs,
    recordAudit,
    updateRuntimeSettings,
    resetRuntimeSettings,
    defaultAgentProfile,
    defaultLedger
  };

  app.decorate("engine", inMemoryEngine);
  app.decorate("authenticate", async (request) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      await recordAudit({
        category: ServerAuditCategory.SECURITY,
        action: "auth.bearer.rejected",
        severity: ServerAuditSeverity.WARN,
        outcome: ServerAuditOutcome.REJECTED,
        requestId: request.id,
        clientIp: extractRequestNetworkContext(request).clientIp,
        method: request.method,
        routeId: request.routeOptions?.url ?? "unmatched",
        message: "bearer authentication rejected",
        details: {
          reason: "missing_bearer_token"
        }
      });
      throw new HttpError(401, "missing bearer token");
    }
    const token = authHeader.replace("Bearer ", "");
    try {
      const payload = jwt.verify(token, config.jwtSecret) as { sub: string };
      request.agentAddress = payload.sub;
    } catch {
      await recordAudit({
        category: ServerAuditCategory.SECURITY,
        action: "auth.bearer.rejected",
        severity: ServerAuditSeverity.WARN,
        outcome: ServerAuditOutcome.REJECTED,
        requestId: request.id,
        clientIp: extractRequestNetworkContext(request).clientIp,
        method: request.method,
        routeId: request.routeOptions?.url ?? "unmatched",
        message: "bearer authentication rejected",
        details: {
          reason: "invalid_token"
        }
      });
      throw new HttpError(401, "invalid token");
    }
    if (!request.agentAddress || !isAddress(request.agentAddress)) {
      await recordAudit({
        category: ServerAuditCategory.SECURITY,
        action: "auth.bearer.rejected",
        severity: ServerAuditSeverity.WARN,
        outcome: ServerAuditOutcome.REJECTED,
        requestId: request.id,
        clientIp: extractRequestNetworkContext(request).clientIp,
        method: request.method,
        routeId: request.routeOptions?.url ?? "unmatched",
        message: "bearer authentication rejected",
        details: {
          reason: "invalid_token_subject"
        }
      });
      throw new HttpError(401, "invalid token subject");
    }
  });
  app.decorate("requireActiveAgent", async (request) => {
    if (!request.agentAddress || !isAddress(request.agentAddress)) {
      throw new HttpError(401, "invalid token subject");
    }
    if (stateRepository) {
      const profile =
        (await stateRepository.getAgentDirect(request.agentAddress)) ??
        defaultAgentProfile(request.agentAddress);
      if (profile.status === AgentStatus.BANNED) {
        throw new DomainError("ACCOUNT_BANNED", "account is banned from active operations", 403);
      }
      return;
    }
    const profile = inMemoryEngine.findAgent(request.agentAddress) ?? defaultAgentProfile(request.agentAddress);
    if (profile.status === AgentStatus.BANNED) {
      throw new DomainError("ACCOUNT_BANNED", "account is banned from active operations", 403);
    }
  });
  app.decorate("requireAdmin", async (request) => {
    const adminHeader = request.headers["x-admin-service-key"];
    if (Array.isArray(adminHeader)) {
      await recordAudit({
        category: ServerAuditCategory.SECURITY,
        action: "auth.admin.rejected",
        severity: ServerAuditSeverity.WARN,
        outcome: ServerAuditOutcome.REJECTED,
        requestId: request.id,
        clientIp: extractRequestNetworkContext(request).clientIp,
        actorAddress: request.agentAddress && isAddress(request.agentAddress) ? request.agentAddress : null,
        method: request.method,
        routeId: request.routeOptions?.url ?? "unmatched",
        message: "admin service key rejected",
        details: {
          reason: "invalid_admin_header"
        }
      });
      throw new HttpError(401, "invalid admin service key");
    }
    if (!adminHeader || !safeSecretEqual(config.adminServiceKey, adminHeader)) {
      await recordAudit({
        category: ServerAuditCategory.SECURITY,
        action: "auth.admin.rejected",
        severity: ServerAuditSeverity.WARN,
        outcome: ServerAuditOutcome.REJECTED,
        requestId: request.id,
        clientIp: extractRequestNetworkContext(request).clientIp,
        actorAddress: request.agentAddress && isAddress(request.agentAddress) ? request.agentAddress : null,
        method: request.method,
        routeId: request.routeOptions?.url ?? "unmatched",
        message: "admin service key rejected",
        details: {
          reason: "invalid_admin_service_key"
        }
      });
      throw new HttpError(401, "invalid admin service key");
    }
  });

  const requestStartTimes = new WeakMap<object, bigint>();
  app.addHook("onRequest", async (request) => {
    requestStartTimes.set(request, process.hrtime.bigint());
  });
  app.addHook("onRequest", applyRateLimit(limiter));
  app.addHook("onRequest", async (request) => {
    const path = getRequestPathname(request.raw.url ?? request.url);
    if (AUTO_CYCLE_CLOSE_SKIP_PATHS.has(path)) {
      return;
    }
    await settleDueCycles("request");
  });
  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-request-id", request.id);
    return payload;
  });
  app.addHook("onResponse", async (request, reply) => {
    const startedAt = requestStartTimes.get(request);
    const durationMs = startedAt
      ? Number(process.hrtime.bigint() - startedAt) / 1_000_000
      : 0;
    const path = getRequestPathname(request.raw.url ?? request.url);
    const routeId = request.routeOptions?.url ?? "unmatched";
    const network = extractRequestNetworkContext(request);
    const actorAddress =
      request.agentAddress && isAddress(request.agentAddress) ? request.agentAddress : null;
    metrics.recordRequest({
      statusCode: reply.statusCode,
      durationMs
    });
    try {
      await appendRequestLog({
        requestId: request.id,
        method: request.method,
        path,
        routeId,
        statusCode: reply.statusCode,
        durationMs,
        clientIp: network.clientIp,
        forwardedFor: network.forwardedFor,
        userAgent: network.userAgent,
        actorAddress,
        errorCode: request.serverErrorCode ?? null
      });
    } catch (error) {
      app.log.error({ error }, "request log append failed");
    }
    if (reply.statusCode === 429 && request.serverErrorCode === "RATE_LIMITED") {
      await recordAudit({
        category: ServerAuditCategory.SECURITY,
        action: "rate-limit.rejected",
        severity: ServerAuditSeverity.WARN,
        outcome: ServerAuditOutcome.REJECTED,
        requestId: request.id,
        clientIp: network.clientIp,
        actorAddress,
        method: request.method,
        routeId,
        targetType: "route",
        targetId: routeId,
        message: "request rate limited",
        details: {
          path
        }
      });
    }
    app.log.info(
      {
        requestId: request.id,
        method: request.method,
        path,
        status: reply.statusCode,
        durationMs: Number(durationMs.toFixed(3)),
        routeId
      },
      "request completed"
    );
  });
  await app.register(cors, { origin: corsOrigin });

  await settleDueCycles("startup");
  await recordAudit({
    category: ServerAuditCategory.RUNTIME,
    action: "runtime.startup",
    severity: ServerAuditSeverity.INFO,
    outcome: ServerAuditOutcome.SUCCESS,
    cycleId: resolveCurrentCycleId() ?? null,
    message: "server runtime initialized",
    details: {
      enablePersistence: config.enablePersistence,
      enableRequestLogPersistence: config.enableRequestLogPersistence,
      enableAuditLogPersistence: config.enableAuditLogPersistence
    }
  });
  const autoCycleCloseTimer = setInterval(() => {
    void settleDueCycles("timer");
  }, AUTO_CYCLE_CLOSE_INTERVAL_MS);
  if (typeof autoCycleCloseTimer.unref === "function") {
    autoCycleCloseTimer.unref();
  }
  const logCleanupIntervalMs = config.logCleanupIntervalMinutes * 60_000;
  const logCleanupTimer = setInterval(() => {
    void cleanupLogs()
      .then((result) =>
        recordAudit({
          category: ServerAuditCategory.BACKGROUND_JOB,
          action: "logs.cleanup",
          severity: ServerAuditSeverity.INFO,
          outcome: ServerAuditOutcome.SUCCESS,
          cycleId: resolveCurrentCycleId() ?? null,
          message: "log cleanup completed",
          details: { ...result }
        })
      )
      .catch((error) =>
        recordAudit({
          category: ServerAuditCategory.BACKGROUND_JOB,
          action: "logs.cleanup",
          severity: ServerAuditSeverity.WARN,
          outcome: ServerAuditOutcome.FAILURE,
          cycleId: resolveCurrentCycleId() ?? null,
          message: "log cleanup failed",
          details: {
            errorCode: errorCode(error)
          }
        })
      );
  }, logCleanupIntervalMs);
  if (typeof logCleanupTimer.unref === "function") {
    logCleanupTimer.unref();
  }

  app.addHook("onClose", async () => {
    clearInterval(autoCycleCloseTimer);
    clearInterval(logCleanupTimer);
    await recordAudit({
      category: ServerAuditCategory.RUNTIME,
      action: "runtime.shutdown",
      severity: ServerAuditSeverity.INFO,
      outcome: ServerAuditOutcome.SUCCESS,
      cycleId: resolveCurrentCycleId() ?? null,
      message: "server runtime shutting down"
    });
    await cleanupLogs();
    await logQueue;
    if (limiter.close) {
      await limiter.close();
    }
    if (stateRepository) {
      await stateRepository.close();
    }
  });

  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof DomainError) {
      request.serverErrorCode = error.code;
      reply.code(error.statusCode).send(
        toV2ErrorEnvelope(error.statusCode, error.code, error.message, request.id)
      );
      return;
    }
    if (error instanceof HttpError) {
      request.serverErrorCode = "HTTP_ERROR";
      reply.code(error.statusCode).send(
        toV2ErrorEnvelope(error.statusCode, "HTTP_ERROR", error.message, request.id)
      );
      return;
    }
    if (error instanceof z.ZodError) {
      request.serverErrorCode = "VALIDATION_ERROR";
      reply.code(400).send(
        toV2ErrorEnvelope(400, "VALIDATION_ERROR", "request validation failed", request.id, error.issues)
      );
      return;
    }
    request.serverErrorCode = "INTERNAL_ERROR";
    await recordAudit({
      category: ServerAuditCategory.SECURITY,
      action: "request.unhandled-error",
      severity: ServerAuditSeverity.ERROR,
      outcome: ServerAuditOutcome.FAILURE,
      requestId: request.id,
      clientIp: extractRequestNetworkContext(request).clientIp,
      actorAddress: request.agentAddress && isAddress(request.agentAddress) ? request.agentAddress : null,
      method: request.method,
      routeId: request.routeOptions?.url ?? "unmatched",
      message: "unexpected server error",
      details: {
        errorCode: errorCode(error),
        errorName: error instanceof Error ? error.name : null
      }
    });
    reply.code(500).send(
      toV2ErrorEnvelope(500, "INTERNAL_ERROR", "unexpected server error", request.id)
    );
  });

  app.setNotFoundHandler((request, reply) => {
    const rawUrl = request.raw.url ?? request.url;
    const redirectLocation = resolveVersionlessApiRedirect({
      method: request.method,
      rawUrl,
      defaultVersion: config.apiDefaultVersion,
      forwardedPrefix: request.headers["x-forwarded-prefix"]
    });
    if (redirectLocation) {
      reply.redirect(redirectLocation, 307);
      return;
    }

    const unsupportedVersion = findUnsupportedApiVersion(rawUrl);
    if (unsupportedVersion) {
      request.serverErrorCode = "API_VERSION_UNSUPPORTED";
      reply.code(400).send(
        toV2ErrorEnvelope(
          400,
          "API_VERSION_UNSUPPORTED",
          formatUnsupportedApiVersionMessage(unsupportedVersion, config.apiDefaultVersion),
          request.id,
          {
            requestedVersion: unsupportedVersion,
            supportedVersions: supportedApiVersions,
            defaultVersion: config.apiDefaultVersion
          }
        )
      );
      return;
    }

    request.serverErrorCode = "ROUTE_NOT_FOUND";
    reply.code(404).send(
      toV2ErrorEnvelope(
        404,
        "ROUTE_NOT_FOUND",
        `route not found: ${getRequestPathname(rawUrl)}`,
        request.id
      )
    );
  });

  registerSystemRoutes(app, services);
  registerAuthRoutes(app, services);
  registerTaskRoutes(app, services);
  registerSubmissionRoutes(app, services);
  registerDisputeRoutes(app, services);
  registerTodoRoutes(app, services);
  registerAgentRoutes(app, services);

  return app;
};
