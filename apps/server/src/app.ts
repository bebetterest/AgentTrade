import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "jsonwebtoken";
import { isAddress as isEvmAddress, verifyMessage } from "viem";
import { z } from "zod";
import { nanoid } from "nanoid";
import { loadConfig, toPublicEconomyParams } from "@agentrade/config";
import {
  ActivityEventType,
  DisputeStatus,
  TaskStatus,
  VoteChoice,
  type ActivityEvent,
  type Address,
  type AgentDirectoryItem,
  type AgentProfile,
  type DashboardMetricSnapshot,
  type DashboardTrendPoint,
  type Dispute,
  type LedgerBalance,
  type Task
} from "@agentrade/types";
import { AgentradeEngine, INITIAL_AGENT_BALANCE } from "./domain/engine.js";
import { DomainError } from "./domain/errors.js";
import { HttpError } from "./utils/http-error.js";
import { applyRateLimit } from "./core/rate-limit.js";
import { createRateLimiter } from "./infra/rate-limiter.js";
import {
  PersistenceConflictError,
  PrismaStateRepository,
  type PersistenceMutationScope
} from "./infra/state-repository.js";
import "./types.js";

interface AuthChallenge {
  address: Address;
  nonce: string;
  message: string;
  createdAt: number;
}

const isAddress = (value: string): value is Address => isEvmAddress(value);
const isValidTimezone = (value: string): boolean => {
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

const toDayKey = (value: string | Date, timeZone: string): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(typeof value === "string" ? new Date(value) : value);

const countMetrics = (events: ActivityEvent[]): DashboardMetricSnapshot => {
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

const parseCursorOffset = (cursor: string | undefined): number => {
  if (!cursor) {
    return 0;
  }
  const value = Number(cursor);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new HttpError(400, "invalid cursor");
  }
  return value;
};

const paginateItems = <T>(items: T[], cursor: string | undefined, limit: number) => {
  const offset = parseCursorOffset(cursor);
  const boundedLimit = Math.max(1, Math.min(100, limit));
  const page = items.slice(offset, offset + boundedLimit);
  const nextOffset = offset + page.length;
  const nextCursor = nextOffset < items.length ? String(nextOffset) : null;
  return { items: page, nextCursor };
};

const toAgentScore = (profile: AgentProfile): number => {
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

export const buildApp = async () => {
  const config = loadConfig();
  const app = Fastify({ logger: !process.env.VITEST });
  const limiter = await createRateLimiter(config, app.log);
  const stateRepository = config.enablePersistence ? new PrismaStateRepository(config.databaseUrl) : null;

  let inMemoryEngine = new AgentradeEngine(config);
  let runtimeRevision: string | null = null;
  let inMemoryEngineDirty = false;
  if (stateRepository) {
    await stateRepository.ensureInitialized(inMemoryEngine.toSnapshot());
    const snapshot = await stateRepository.load();
    if (snapshot) {
      inMemoryEngine = AgentradeEngine.fromSnapshot(config, snapshot);
      app.log.info("loaded engine state from normalized persistence tables");
    }
    runtimeRevision = await stateRepository.getRuntimeRevision();
  }

  const read = async <T>(operation: (engine: AgentradeEngine) => T | Promise<T>): Promise<T> => {
    return operation(inMemoryEngine);
  };
  const cloneSnapshot = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

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
    scope?: PersistenceMutationScope[]
  ): Promise<T> => {
    if (!stateRepository) {
      return operation(inMemoryEngine);
    }
    return enqueueMutation(async () => {
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
  };

  const mutateDirect = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (!stateRepository) {
      throw new HttpError(500, "persistence repository is unavailable");
    }
    return enqueueMutation(async () => {
      const result = await operation();
      inMemoryEngineDirty = true;
      runtimeRevision = null;
      return result;
    });
  };

  const defaultAgentProfile = (address: Address): AgentProfile => {
    const now = new Date().toISOString();
    return {
      address,
      name: "",
      bio: "",
      reputation: { publisher: 50, worker: 50, supervisor: 50 },
      stats: {
        tasksPublished: 0,
        tasksAccepted: 0,
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
    available: INITIAL_AGENT_BALANCE,
    updatedAt: new Date().toISOString()
  });

  const readTasks = async (): Promise<Task[]> => {
    if (stateRepository) {
      return stateRepository.listTasksDirect();
    }
    return read((engine) => engine.listTasks());
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

  const readActiveCycle = async () => {
    if (stateRepository) {
      const cycle = await stateRepository.getActiveCycleDirect();
      if (!cycle) {
        throw new DomainError("CYCLE_NOT_FOUND", "active cycle not found", 404);
      }
      return cycle;
    }
    return read((engine) => engine.getActiveCycle());
  };

  const challenges = new Map<string, AuthChallenge>();

  app.decorate("engine", inMemoryEngine);
  app.decorate("authenticate", async (request) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      throw new HttpError(401, "missing bearer token");
    }
    const token = authHeader.replace("Bearer ", "");
    try {
      const payload = jwt.verify(token, config.jwtSecret) as { sub: string };
      request.agentAddress = payload.sub;
    } catch {
      throw new HttpError(401, "invalid token");
    }
    if (!request.agentAddress || !isAddress(request.agentAddress)) {
      throw new HttpError(401, "invalid token subject");
    }
  });
  app.decorate("requireAdmin", async (request) => {
    const adminKey = request.headers["x-admin-service-key"];
    if (adminKey !== config.adminServiceKey) {
      throw new HttpError(401, "invalid admin service key");
    }
  });

  app.addHook("onRequest", applyRateLimit(limiter));
  app.register(cors, { origin: true });

  app.addHook("onClose", async () => {
    if (limiter.close) {
      await limiter.close();
    }
    if (stateRepository) {
      await stateRepository.close();
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainError) {
      reply.code(error.statusCode).send({ error: error.code, message: error.message });
      return;
    }
    if (error instanceof HttpError) {
      reply.code(error.statusCode).send({ error: "HTTP_ERROR", message: error.message });
      return;
    }
    if (error instanceof z.ZodError) {
      reply.code(400).send({ error: "VALIDATION_ERROR", issues: error.issues });
      return;
    }
    reply.code(500).send({ error: "INTERNAL_ERROR", message: "unexpected server error" });
  });

  app.get("/health", async () => ({ ok: true, service: "agentrade-server" }));

  app.post("/v1/auth/challenge", async (request) => {
    const body = z.object({ address: z.string() }).parse(request.body);
    if (!isAddress(body.address)) {
      throw new HttpError(400, "invalid address");
    }
    const nonce = nanoid(12);
    const message = `Agentrade SIWE\nAddress: ${body.address}\nNonce: ${nonce}\nIssuedAt: ${new Date().toISOString()}`;
    challenges.set(body.address.toLowerCase(), {
      address: body.address as Address,
      nonce,
      message,
      createdAt: Date.now()
    });
    return { nonce, message };
  });

  app.post("/v1/auth/verify", async (request) => {
    const body = z
      .object({
        address: z.string(),
        nonce: z.string(),
        message: z.string(),
        signature: z.string()
      })
      .parse(request.body);
    if (!isAddress(body.address)) {
      throw new HttpError(400, "invalid address");
    }
    const challenge = challenges.get(body.address.toLowerCase());
    if (!challenge) {
      throw new HttpError(401, "challenge not found");
    }
    const challengeTtlMs = Math.max(0, config.authChallengeTtlMinutes * 60_000);
    if (Date.now() - challenge.createdAt >= challengeTtlMs) {
      challenges.delete(body.address.toLowerCase());
      throw new HttpError(401, "challenge expired");
    }
    if (challenge.nonce !== body.nonce || challenge.message !== body.message) {
      throw new HttpError(401, "challenge mismatch");
    }
    const isValid = await verifyMessage({
      address: body.address as Address,
      message: body.message,
      signature: body.signature as `0x${string}`
    }).catch(() => false);
    if (!isValid) {
      throw new HttpError(401, "invalid signature");
    }
    const token = jwt.sign({ sub: body.address }, config.jwtSecret, { expiresIn: "15m" });
    challenges.delete(body.address.toLowerCase());
    return { token, expiresIn: "15m" };
  });

  app.get("/v1/tasks", async (request) => {
    const query = z
      .object({
        q: z.string().trim().min(1).optional(),
        status: z.nativeEnum(TaskStatus).optional(),
        publisher: z.string().optional(),
        sort: z.enum(["latest", "created", "deadline", "reward"]).optional(),
        order: z.enum(["asc", "desc"]).optional(),
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional()
      })
      .parse(request.query ?? {});

    if (query.publisher && !isAddress(query.publisher)) {
      throw new HttpError(400, "invalid publisher address");
    }

    if (stateRepository) {
      return stateRepository.queryTasksDirect({
        q: query.q,
        status: query.status,
        publisher: query.publisher as Address | undefined,
        sort: query.sort ?? "latest",
        order: query.order ?? "desc",
        offset: parseCursorOffset(query.cursor),
        limit: query.limit ?? 20,
        paged: Boolean(query.limit || query.cursor)
      });
    }

    let items = await readTasks();
    if (query.status) {
      items = items.filter((item) => item.status === query.status);
    }
    if (query.publisher) {
      const publisherLower = query.publisher.toLowerCase();
      items = items.filter((item) => item.publisher.toLowerCase() === publisherLower);
    }
    if (query.q) {
      const q = query.q.toLowerCase();
      items = items.filter(
        (item) =>
          item.id.toLowerCase().includes(q) ||
          item.title.toLowerCase().includes(q) ||
          item.publisher.toLowerCase().includes(q)
      );
    }

    const sortKey = query.sort ?? "latest";
    const order = query.order ?? "desc";
    items.sort((a, b) => {
      let delta = 0;
      if (sortKey === "created") {
        delta = a.createdAt.localeCompare(b.createdAt);
      } else if (sortKey === "deadline") {
        delta = a.deadlineUtc.localeCompare(b.deadlineUtc);
      } else if (sortKey === "reward") {
        delta = a.rewardPerSlot - b.rewardPerSlot;
      } else {
        delta = a.updatedAt.localeCompare(b.updatedAt);
      }
      if (delta === 0) {
        delta = a.id.localeCompare(b.id);
      }
      return order === "asc" ? delta : -delta;
    });

    if (!query.limit && !query.cursor) {
      return { items, nextCursor: null };
    }
    const page = paginateItems(items, query.cursor, query.limit ?? 20);
    return page;
  });
  app.get("/v1/tasks/:id", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    if (stateRepository) {
      const task = await stateRepository.getTaskDirect(params.id);
      if (!task) {
        throw new DomainError("TASK_NOT_FOUND", `Task ${params.id} does not exist`, 404);
      }
      return task;
    }
    return read((engine) => engine.getTask(params.id));
  });
  app.post("/v1/tasks", { preHandler: [app.authenticate] }, async (request) => {
    const body = z
      .object({
        title: z.string().min(1).max(config.taskTitleMaxLength),
        descriptionMd: z.string().min(1).max(config.taskDescriptionMaxLength),
        acceptanceCriteria: z.string().min(1).max(config.taskAcceptanceCriteriaMaxLength),
        deadlineUtc: z.string().datetime(),
        displayTimezone: z.string().refine((value) => isValidTimezone(value), {
          message: "displayTimezone must be a valid IANA timezone"
        }),
        slotsTotal: z.number().int().positive().max(config.taskSlotsMax),
        rewardPerSlot: z.number().int().positive().max(config.taskRewardPerSlotMax),
        allowRepeatCompletionsBySameAgent: z.boolean()
      })
      .parse(request.body);
    const publisher = request.agentAddress as Address;
    if (stateRepository) {
      return mutateDirect(() =>
        stateRepository.publishTaskDirect({
          publisher,
          ...body,
          config
        })
      );
    }
    return mutate((engine) =>
      engine.publishTask({
        publisher,
        ...body
      }),
      ["profiles", "balances", "tasks", "cycles"]
    );
  });
  app.post("/v1/tasks/:id/accept", { preHandler: [app.authenticate] }, async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const agent = request.agentAddress as Address;
    if (stateRepository) {
      return mutateDirect(() => stateRepository.acceptTaskDirect(params.id, agent));
    }
    return mutate((engine) => engine.acceptTask(params.id, agent), ["profiles", "tasks"]);
  });
  app.post("/v1/tasks/:id/submissions", { preHandler: [app.authenticate] }, async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({
        payloadMd: z.string().min(1).max(config.taskSubmissionPayloadMaxLength)
      })
      .parse(request.body);
    const agent = request.agentAddress as Address;
    if (stateRepository) {
      return mutateDirect(() =>
        stateRepository.submitTaskDirect({
          taskId: params.id,
          agent,
          payloadMd: body.payloadMd,
          taskSubmissionPayloadMaxLength: config.taskSubmissionPayloadMaxLength,
          resubmitCooldownMinutes: config.resubmitCooldownMinutes
        })
      );
    }
    return mutate((engine) => engine.submitTask(params.id, agent, body.payloadMd), ["submissions"]);
  });
  app.post("/v1/tasks/:id/terminate", { preHandler: [app.authenticate] }, async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    if (stateRepository) {
      return mutateDirect(() =>
        stateRepository.terminateTaskDirect(params.id, request.agentAddress as Address, config)
      );
    }
    return mutate((engine) => engine.terminateTask(params.id, request.agentAddress as Address), [
      "profiles",
      "balances",
      "tasks",
      "cycles"
    ]);
  });

  app.post("/v1/submissions/:id/confirm", { preHandler: [app.authenticate] }, async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    if (stateRepository) {
      return mutateDirect(() =>
        stateRepository.confirmSubmissionDirect(params.id, request.agentAddress as Address)
      );
    }
    return mutate((engine) => engine.confirmSubmission(params.id, request.agentAddress as Address), [
      "profiles",
      "balances",
      "tasks",
      "submissions"
    ]);
  });
  app.post("/v1/submissions/:id/reject", { preHandler: [app.authenticate] }, async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    if (stateRepository) {
      return mutateDirect(() =>
        stateRepository.rejectSubmissionDirect(params.id, request.agentAddress as Address)
      );
    }
    return mutate((engine) => engine.rejectSubmission(params.id, request.agentAddress as Address), [
      "profiles",
      "submissions"
    ]);
  });

  app.post("/v1/disputes", { preHandler: [app.authenticate] }, async (request) => {
    const body = z
      .object({
        taskId: z.string(),
        submissionId: z.string(),
        reasonMd: z.string().min(1).max(config.disputeReasonMaxLength)
      })
      .parse(request.body);
    const opener = request.agentAddress as Address;
    if (stateRepository) {
      return mutateDirect(() =>
        stateRepository.openDisputeDirect({
          ...body,
          opener,
          disputeReasonMaxLength: config.disputeReasonMaxLength
        })
      );
    }
    return mutate((engine) => engine.openDispute({ ...body, opener }), ["disputes"]);
  });
  app.get("/v1/disputes", async (request) => {
    const query = z
      .object({
        taskId: z.string().optional(),
        opener: z.string().optional(),
        status: z.nativeEnum(DisputeStatus).optional(),
        q: z.string().trim().min(1).optional(),
        sort: z.enum(["latest", "created"]).optional(),
        order: z.enum(["asc", "desc"]).optional(),
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional()
      })
      .parse(request.query ?? {});

    if (query.opener && !isAddress(query.opener)) {
      throw new HttpError(400, "invalid opener address");
    }

    if (stateRepository) {
      return stateRepository.queryDisputesDirect({
        taskId: query.taskId,
        opener: query.opener as Address | undefined,
        status: query.status,
        q: query.q,
        sort: query.sort ?? "latest",
        order: query.order ?? "desc",
        offset: parseCursorOffset(query.cursor),
        limit: query.limit ?? 20,
        paged: Boolean(query.limit || query.cursor)
      });
    }

    let items = await readDisputes();
    if (query.taskId) {
      items = items.filter((item) => item.taskId === query.taskId);
    }
    if (query.opener) {
      const openerLower = query.opener.toLowerCase();
      items = items.filter((item) => item.opener.toLowerCase() === openerLower);
    }
    if (query.status) {
      items = items.filter((item) => item.status === query.status);
    }
    if (query.q) {
      const q = query.q.toLowerCase();
      items = items.filter(
        (item) =>
          item.id.toLowerCase().includes(q) ||
          item.taskId.toLowerCase().includes(q) ||
          item.submissionId.toLowerCase().includes(q) ||
          item.opener.toLowerCase().includes(q)
      );
    }

    const sortKey = query.sort ?? "latest";
    const order = query.order ?? "desc";
    items.sort((a, b) => {
      let delta = sortKey === "created" ? a.createdAt.localeCompare(b.createdAt) : a.updatedAt.localeCompare(b.updatedAt);
      if (delta === 0) {
        delta = a.id.localeCompare(b.id);
      }
      return order === "asc" ? delta : -delta;
    });

    if (!query.limit && !query.cursor) {
      return { items, nextCursor: null };
    }
    const page = paginateItems(items, query.cursor, query.limit ?? 20);
    return page;
  });
  app.get("/v1/disputes/:id", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    if (stateRepository) {
      const dispute = await stateRepository.getDisputeDirect(params.id);
      if (!dispute) {
        throw new DomainError("DISPUTE_NOT_FOUND", `Dispute ${params.id} does not exist`, 404);
      }
      return dispute;
    }
    return read((engine) => engine.getDispute(params.id));
  });
  app.post("/v1/disputes/:id/votes", { preHandler: [app.authenticate] }, async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ vote: z.nativeEnum(VoteChoice) }).parse(request.body);
    try {
      if (stateRepository) {
        return await mutateDirect(() =>
          stateRepository.voteDisputeDirect({
            disputeId: params.id,
            agent: request.agentAddress as Address,
            vote: body.vote,
            config
          })
        );
      }
      return await mutate((engine) =>
        engine.voteDispute({
          disputeId: params.id,
          agent: request.agentAddress as Address,
          vote: body.vote
        }),
        ["profiles", "votes", "cycleWorkloads"]
      );
    } catch (error) {
      if (error instanceof DomainError && error.code === "DUPLICATE_SUPERVISION_PARTICIPATION") {
        reply.code(409);
      }
      throw error;
    }
  });

  app.get("/v1/dashboard/summary", async (request) => {
    const query = z
      .object({
        tz: z.string().default("UTC")
      })
      .parse(request.query ?? {});
    if (!isValidTimezone(query.tz)) {
      throw new HttpError(400, "invalid timezone");
    }

    if (stateRepository) {
      return stateRepository.getDashboardSummaryDirect(query.tz);
    }

    const [activities, activeCycle, tasks, disputes, agents] = await Promise.all([
      readActivities(),
      readActiveCycle(),
      readTasks(),
      readDisputes(),
      readAgents()
    ]);
    const now = new Date();
    const todayKey = toDayKey(now, query.tz);
    const todayEvents = activities.filter((item) => toDayKey(item.createdAt, query.tz) === todayKey);
    const cycleEvents = activities.filter((item) => item.cycleId === activeCycle.id);

    return {
      timezone: query.tz,
      generatedAt: now.toISOString(),
      activeCycleId: activeCycle.id,
      today: countMetrics(todayEvents),
      currentCycle: countMetrics(cycleEvents),
      totals: {
        tasks: tasks.length,
        disputes: disputes.length,
        agents: agents.length
      }
    };
  });

  app.get("/v1/dashboard/trends", async (request) => {
    const query = z
      .object({
        tz: z.string().default("UTC"),
        window: z.enum(["7d", "30d"]).default("7d")
      })
      .parse(request.query ?? {});
    if (!isValidTimezone(query.tz)) {
      throw new HttpError(400, "invalid timezone");
    }

    if (stateRepository) {
      return stateRepository.getDashboardTrendsDirect(query.tz, query.window);
    }

    const events = await readActivities();
    const windowSize = query.window === "30d" ? 30 : 7;
    const now = new Date();
    const dayKeys: string[] = [];
    for (let step = 0; dayKeys.length < windowSize && step < windowSize * 3; step += 1) {
      const key = toDayKey(new Date(now.getTime() - step * 86_400_000), query.tz);
      if (!dayKeys.includes(key)) {
        dayKeys.unshift(key);
      }
    }

    const pointMap = new Map<string, DashboardTrendPoint>();
    for (const key of dayKeys) {
      pointMap.set(key, {
        bucketStart: `${key}T00:00:00.000Z`,
        label: key,
        tasksPublished: 0,
        tasksAccepted: 0,
        tasksCompleted: 0,
        disputesOpened: 0
      });
    }

    for (const event of events) {
      const key = toDayKey(event.createdAt, query.tz);
      const point = pointMap.get(key);
      if (!point) {
        continue;
      }
      if (event.type === ActivityEventType.TASK_PUBLISHED) {
        point.tasksPublished += 1;
      } else if (event.type === ActivityEventType.TASK_ACCEPTED) {
        point.tasksAccepted += 1;
      } else if (event.type === ActivityEventType.TASK_COMPLETED) {
        point.tasksCompleted += 1;
      } else if (event.type === ActivityEventType.DISPUTE_OPENED) {
        point.disputesOpened += 1;
      }
    }

    return {
      timezone: query.tz,
      generatedAt: now.toISOString(),
      window: query.window,
      points: dayKeys.map((key) => pointMap.get(key)!)
    };
  });

  app.get("/v1/agents", async (request) => {
    const query = z
      .object({
        q: z.string().trim().min(1).optional(),
        activeOnly: z
          .enum(["true", "false"])
          .transform((value) => value === "true")
          .optional(),
        sort: z.enum(["latest", "score", "reputation", "completed", "published", "accepted"]).optional(),
        order: z.enum(["asc", "desc"]).optional(),
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional()
      })
      .parse(request.query ?? {});

    if (stateRepository) {
      return stateRepository.queryAgentsDirect({
        q: query.q,
        activeOnly: query.activeOnly,
        sort: query.sort ?? "latest",
        order: query.order ?? "desc",
        offset: parseCursorOffset(query.cursor),
        limit: query.limit ?? 20,
        paged: Boolean(query.limit || query.cursor)
      });
    }

    const [profiles, activities] = await Promise.all([readAgents(), readActivities()]);
    const latestActivityByAddress = new Map<string, string>();
    for (const event of activities) {
      const prev = latestActivityByAddress.get(event.actor);
      if (!prev || prev < event.createdAt) {
        latestActivityByAddress.set(event.actor, event.createdAt);
      }
    }

    let items: AgentDirectoryItem[] = profiles.map((profile) => {
      const latestActivityAt = latestActivityByAddress.get(profile.address) ?? null;
      const isActive =
        latestActivityAt !== null ||
        profile.stats.tasksAccepted > 0 ||
        profile.stats.tasksPublished > 0 ||
        profile.stats.tasksCompleted > 0 ||
        profile.stats.submissionsRejected > 0 ||
        profile.stats.supervisionVotes > 0;
      return {
        ...profile,
        latestActivityAt,
        score: toAgentScore(profile),
        isActive
      };
    });

    if (query.activeOnly) {
      items = items.filter((item) => item.isActive);
    }
    if (query.q) {
      const q = query.q.toLowerCase();
      items = items.filter(
        (item) =>
          item.address.toLowerCase().includes(q) ||
          item.name.toLowerCase().includes(q) ||
          item.bio.toLowerCase().includes(q)
      );
    }

    const sortKey = query.sort ?? "latest";
    const order = query.order ?? "desc";
    items.sort((a, b) => {
      let delta = 0;
      if (sortKey === "score") {
        delta = a.score - b.score;
      } else if (sortKey === "reputation") {
        const repA = (a.reputation.publisher + a.reputation.worker + a.reputation.supervisor) / 3;
        const repB = (b.reputation.publisher + b.reputation.worker + b.reputation.supervisor) / 3;
        delta = repA - repB;
      } else if (sortKey === "completed") {
        delta = a.stats.tasksCompleted - b.stats.tasksCompleted;
      } else if (sortKey === "published") {
        delta = a.stats.tasksPublished - b.stats.tasksPublished;
      } else if (sortKey === "accepted") {
        delta = a.stats.tasksAccepted - b.stats.tasksAccepted;
      } else {
        const left = a.latestActivityAt ?? "";
        const right = b.latestActivityAt ?? "";
        delta = left.localeCompare(right);
      }
      if (delta === 0) {
        delta = a.address.localeCompare(b.address);
      }
      return order === "asc" ? delta : -delta;
    });

    if (!query.limit && !query.cursor) {
      return { items, nextCursor: null };
    }
    const page = paginateItems(items, query.cursor, query.limit ?? 20);
    return page;
  });

  app.get("/v1/activities", async (request) => {
    const query = z
      .object({
        taskId: z.string().optional(),
        disputeId: z.string().optional(),
        address: z.string().optional(),
        type: z.nativeEnum(ActivityEventType).optional(),
        order: z.enum(["asc", "desc"]).optional(),
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).optional()
      })
      .parse(request.query ?? {});
    if (query.address && !isAddress(query.address)) {
      throw new HttpError(400, "invalid address");
    }

    if (stateRepository) {
      return stateRepository.queryActivitiesDirect({
        taskId: query.taskId,
        disputeId: query.disputeId,
        address: query.address as Address | undefined,
        type: query.type,
        order: query.order ?? "desc",
        offset: parseCursorOffset(query.cursor),
        limit: query.limit ?? 20,
        paged: Boolean(query.limit || query.cursor)
      });
    }

    let items = await readActivities();
    if (query.taskId) {
      items = items.filter((item) => item.taskId === query.taskId);
    }
    if (query.disputeId) {
      items = items.filter((item) => item.disputeId === query.disputeId);
    }
    if (query.address) {
      const address = query.address.toLowerCase();
      items = items.filter((item) => item.actor.toLowerCase() === address);
    }
    if (query.type) {
      items = items.filter((item) => item.type === query.type);
    }

    const order = query.order ?? "desc";
    items.sort((a, b) => {
      let delta = a.createdAt.localeCompare(b.createdAt);
      if (delta === 0) {
        delta = a.id.localeCompare(b.id);
      }
      return order === "asc" ? delta : -delta;
    });

    if (!query.limit && !query.cursor) {
      return { items, nextCursor: null };
    }
    const page = paginateItems(items, query.cursor, query.limit ?? 20);
    return page;
  });

  app.get("/v1/agents/:address", async (request) => {
    const params = z.object({ address: z.string() }).parse(request.params);
    if (!isAddress(params.address)) {
      throw new HttpError(400, "invalid address");
    }
    if (stateRepository) {
      const address = params.address as Address;
      const profile = await stateRepository.getAgentDirect(address);
      return profile ?? defaultAgentProfile(address);
    }
    return read((engine) => engine.getAgent(params.address as Address));
  });
  app.patch("/v1/agents/:address/profile", { preHandler: [app.authenticate] }, async (request) => {
    const params = z.object({ address: z.string() }).parse(request.params);
    const body = z
      .object({
        name: z.string().max(120).optional(),
        bio: z.string().max(1000).optional()
      })
      .parse(request.body);
    if (params.address.toLowerCase() !== String(request.agentAddress).toLowerCase()) {
      throw new HttpError(403, "cannot update another profile");
    }
    if (stateRepository) {
      return mutateDirect(() => stateRepository.updateAgentProfileDirect(params.address as Address, body));
    }
    return mutate((engine) => engine.updateAgentProfile(params.address as Address, body), ["profiles"]);
  });
  app.get("/v1/agents/:address/stats", async (request) => {
    const params = z.object({ address: z.string() }).parse(request.params);
    if (!isAddress(params.address)) {
      throw new HttpError(400, "invalid address");
    }
    if (stateRepository) {
      const address = params.address as Address;
      const profile = await stateRepository.getAgentDirect(address);
      return (profile ?? defaultAgentProfile(address)).stats;
    }
    return read((engine) => engine.getAgent(params.address as Address).stats);
  });

  app.get("/v1/ledger/:address", async (request) => {
    const params = z.object({ address: z.string() }).parse(request.params);
    if (!isAddress(params.address)) {
      throw new HttpError(400, "invalid address");
    }
    if (stateRepository) {
      const address = params.address as Address;
      const ledger = await stateRepository.getLedgerDirect(address);
      return ledger ?? defaultLedger(address);
    }
    return read((engine) => engine.getLedger(params.address as Address));
  });
  app.get("/v1/cycles/:id/rewards", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    if (stateRepository) {
      const rewards = await stateRepository.getCycleRewardsDirect(params.id);
      if (!rewards) {
        throw new DomainError("CYCLE_NOT_FOUND", `Cycle ${params.id} not found`, 404);
      }
      return rewards;
    }
    return read((engine) => engine.getCycleRewards(params.id));
  });
  app.get("/v1/cycles", async () => {
    if (stateRepository) {
      return { items: await stateRepository.listCyclesDirect() };
    }
    return { items: await read((engine) => engine.listCycles()) };
  });
  app.get("/v1/cycles/active", async () => {
    if (stateRepository) {
      const cycle = await stateRepository.getActiveCycleDirect();
      if (!cycle) {
        throw new DomainError("CYCLE_NOT_FOUND", "active cycle not found", 404);
      }
      return cycle;
    }
    return read((engine) => engine.getActiveCycle());
  });
  app.get("/v1/cycles/:id", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    if (stateRepository) {
      const cycle = await stateRepository.getCycleDirect(params.id);
      if (!cycle) {
        throw new DomainError("CYCLE_NOT_FOUND", `Cycle ${params.id} not found`, 404);
      }
      return cycle;
    }
    return read((engine) => engine.getCycle(params.id));
  });
  app.get("/v1/economy/params", async () => toPublicEconomyParams(config));

  app.post("/v1/admin/cycles/close", { preHandler: [app.requireAdmin] }, async () => {
    if (stateRepository) {
      return mutateDirect(() => stateRepository.closeCurrentCycleDirect(config));
    }
    return mutate((engine) => engine.closeCurrentCycle(), [
      "profiles",
      "balances",
      "tasks",
      "submissions",
      "disputes",
      "cycleWorkloads",
      "cycles"
    ]);
  });
  app.post("/v1/admin/disputes/:id/override", { preHandler: [app.requireAdmin] }, async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ result: z.enum(["COMPLETED", "NOT_COMPLETED"]) }).parse(request.body);
    if (stateRepository) {
      return mutateDirect(() => stateRepository.overrideDisputeDirect(params.id, body.result));
    }
    return mutate((engine) => engine.overrideDispute(params.id, body.result), [
      "profiles",
      "balances",
      "tasks",
      "submissions",
      "disputes"
    ]);
  });
  app.post("/v1/admin/bridge/export", { preHandler: [app.requireAdmin] }, async (request) => {
    const body = z.object({ addresses: z.array(z.string()).optional() }).parse(request.body ?? {});
    const addresses = body.addresses?.filter((item): item is Address => isAddress(item));
    return {
      chain: config.bridgeChain,
      mode: config.bridgeMode,
      exports: stateRepository
        ? await stateRepository.exportBridgeBatchDirect({ addresses })
        : await read((engine) =>
            engine.exportBridgeBatch({
              addresses
            })
          )
    };
  });

  return app;
};
