import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "jsonwebtoken";
import { isAddress as isEvmAddress, verifyMessage } from "viem";
import { z } from "zod";
import { nanoid } from "nanoid";
import { loadConfig } from "@agentrade/config";
import { VoteChoice, type Address, type AgentProfile, type LedgerBalance } from "@agentrade/types";
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

  app.get("/v1/tasks", async () => {
    if (stateRepository) {
      return { items: await stateRepository.listTasksDirect() };
    }
    return { items: await read((engine) => engine.listTasks()) };
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
  app.get("/v1/disputes", async () => {
    if (stateRepository) {
      return { items: await stateRepository.listDisputesDirect() };
    }
    return { items: await read((engine) => engine.listDisputes()) };
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
  app.get("/v1/economy/params", async () => read((engine) => engine.getConfig()));

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
