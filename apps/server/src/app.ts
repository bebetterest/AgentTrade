import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { loadConfig } from "@agentrade/config";
import { type ActivityEvent, type Address, type AgentProfile, type Cycle, type Dispute, type LedgerBalance, type Task } from "@agentrade/types";
import { AgentradeEngine, INITIAL_AGENT_BALANCE } from "./domain/engine.js";
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
import {
  isAddress,
  isV2Request,
  toV2ErrorEnvelope,
  type AppServices
} from "./api/services.js";
import { registerSystemRoutes } from "./api/system.js";
import { registerTaskRoutes } from "./api/tasks.js";
import { HttpError } from "./utils/http-error.js";
import "./types.js";

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

  const challenges = new Map<string, { address: Address; nonce: string; message: string; createdAt: number }>();

  const services: AppServices = {
    config,
    stateRepository,
    challenges,
    read,
    mutate,
    mutateDirect,
    readTasks,
    readDisputes,
    readAgents,
    readActivities,
    readActiveCycle,
    defaultAgentProfile,
    defaultLedger
  };

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
  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-request-id", request.id);
    return payload;
  });
  app.register(cors, { origin: true });

  app.addHook("onClose", async () => {
    if (limiter.close) {
      await limiter.close();
    }
    if (stateRepository) {
      await stateRepository.close();
    }
  });

  app.setErrorHandler((error, request, reply) => {
    const isV2 = isV2Request(request);
    if (error instanceof DomainError) {
      if (isV2) {
        reply.code(error.statusCode).send(
          toV2ErrorEnvelope(error.statusCode, error.code, error.message, request.id)
        );
        return;
      }
      reply.code(error.statusCode).send({ error: error.code, message: error.message });
      return;
    }
    if (error instanceof HttpError) {
      if (isV2) {
        reply.code(error.statusCode).send(
          toV2ErrorEnvelope(error.statusCode, "HTTP_ERROR", error.message, request.id)
        );
        return;
      }
      reply.code(error.statusCode).send({ error: "HTTP_ERROR", message: error.message });
      return;
    }
    if (error instanceof z.ZodError) {
      if (isV2) {
        reply.code(400).send(
          toV2ErrorEnvelope(400, "VALIDATION_ERROR", "request validation failed", request.id, error.issues)
        );
        return;
      }
      reply.code(400).send({ error: "VALIDATION_ERROR", issues: error.issues });
      return;
    }
    if (isV2) {
      reply.code(500).send(
        toV2ErrorEnvelope(500, "INTERNAL_ERROR", "unexpected server error", request.id)
      );
      return;
    }
    reply.code(500).send({ error: "INTERNAL_ERROR", message: "unexpected server error" });
  });

  registerSystemRoutes(app, services);
  registerAuthRoutes(app, services);
  registerTaskRoutes(app, services);
  registerDisputeRoutes(app, services);
  registerAgentRoutes(app, services);

  return app;
};
