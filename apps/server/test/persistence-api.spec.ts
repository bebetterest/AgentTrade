import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import type { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import type { Address } from "@agentrade/types";
import { AgentBanReason, AgentStatus, DisputePayoutSource, VoteChoice } from "@agentrade/types";
import { defaultConfig, pickRuntimeEditableRules } from "@agentrade/config";
import { buildApp } from "../src/app.js";
import { parseCursorOffset } from "../src/api/services.js";
import { PrismaStateRepository } from "../src/infra/state-repository.js";
import { AgentradeEngine } from "../src/domain/engine.js";
import { dayKeyToUtcStart } from "../src/utils/timezone.js";
import { encodeKeysetCursor } from "../src/pagination/cursor.js";

type TestFastifyInstance = FastifyInstance & {
  cleanupLogsForTests?: (now?: Date) => Promise<void>;
};

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const REQUIRE_DB_URL = process.env.REQUIRE_TEST_DATABASE_URL === "true";
if (REQUIRE_DB_URL && !TEST_DB_URL) {
  throw new Error(
    "TEST_DATABASE_URL is required when REQUIRE_TEST_DATABASE_URL=true. " +
      "Set TEST_DATABASE_URL explicitly or run Docker-backed DB scripts."
  );
}
const runDbSuite = TEST_DB_URL ? describe : describe.skip;
const addr = (seed: string): Address =>
  `0x${Buffer.from(seed).toString("hex").slice(0, 40).padEnd(40, "0")}` as Address;
const futureDeadline = (hours = 24): string =>
  new Date(Date.now() + hours * 3_600_000).toISOString();
const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};
const errorCode = (payload: unknown): string | null => {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== "object") {
    return null;
  }
  return typeof (error as { code?: unknown }).code === "string"
    ? ((error as { code: string }).code)
    : null;
};

runDbSuite("API persistence mode", () => {
  const secret = "persist-secret";
  const adminServiceKey = "persist-admin-service-key";
  const systemOperator = addr("persist-system-operator");
  const oldEnv = { ...process.env };
  let app: FastifyInstance | null = null;
  let workerApp: FastifyInstance | null = null;
  let repo: PrismaStateRepository;

  const bearer = (address: Address): string => jwt.sign({ sub: address }, secret, { expiresIn: "1h" });
  const bearerAndAdmin = (address: Address): Record<string, string> => ({
    authorization: `Bearer ${bearer(address)}`,
    "x-admin-service-key": adminServiceKey
  });
  const rejectSubmission = async (
    submissionId: string,
    publisher: Address,
    reasonMd = "needs revision"
  ) => {
    const rejectRes = await app!.inject({
      method: "POST",
      url: `/v2/submissions/${submissionId}/reject`,
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: { reasonMd }
    });
    expect(rejectRes.statusCode).toBe(200);
  };
  const forceAutoCloseCurrentCycle = async (): Promise<{ closedCycleId: string; openedCycleId: string }> => {
    const activeBeforeRes = await app!.inject({
      method: "GET",
      url: "/v2/cycles/active"
    });
    expect(activeBeforeRes.statusCode).toBe(200);
    const activeBefore = activeBeforeRes.json() as { id: string };

    const staleStartedAt = new Date(Date.now() - 8 * 24 * 3_600_000);
    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: TEST_DB_URL!
        }
      }
    });
    await prisma.cycle.update({
      where: { id: activeBefore.id },
      data: { startedAt: staleStartedAt }
    });
    await prisma.$disconnect();

    let activeAfter = activeBefore;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      await sleep(25);
      const activeAfterRes = await app!.inject({
        method: "GET",
        url: "/v2/cycles/active"
      });
      expect(activeAfterRes.statusCode).toBe(200);
      activeAfter = activeAfterRes.json() as { id: string };
      if (activeAfter.id !== activeBefore.id) {
        break;
      }
    }
    expect(activeAfter.id).not.toBe(activeBefore.id);

    return { closedCycleId: activeBefore.id, openedCycleId: activeAfter.id };
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = secret;
    process.env.ADMIN_SERVICE_KEY = adminServiceKey;
    process.env.ENABLE_PERSISTENCE = "true";
    process.env.ENABLE_REDIS_RATE_LIMIT = "false";
    process.env.RATE_LIMIT_PER_MINUTE = "10000";
    process.env.RATE_LIMIT_BURST = "10000";
    process.env.TASK_TITLE_MAX_LENGTH = "120";
    process.env.TASK_DESCRIPTION_MAX_LENGTH = "20000";
    process.env.TASK_ACCEPTANCE_CRITERIA_MAX_LENGTH = "8000";
    process.env.TASK_SUBMISSION_PAYLOAD_MAX_LENGTH = "20000";
    process.env.DISPUTE_REASON_MAX_LENGTH = "4000";
    process.env.TASK_SLOTS_MAX = "100";
    process.env.TASK_REWARD_PER_SLOT_MAX = "1000000";
    process.env.TASK_DEADLINE_MAX_HOURS = "4320";
    process.env.CYCLE_CLOSE_POLL_INTERVAL_MS = "20";
    process.env.DATABASE_URL = TEST_DB_URL;
    repo = new PrismaStateRepository(TEST_DB_URL!);
  });

  beforeEach(async () => {
    await repo.sync(new AgentradeEngine(defaultConfig).toSnapshot());
    await repo.resetRuntimeRulesDirect({
      applyTo: "current",
      defaults: pickRuntimeEditableRules(defaultConfig)
    });
    await repo.resetRuntimeRulesDirect({
      applyTo: "next",
      defaults: pickRuntimeEditableRules(defaultConfig)
    });
    workerApp = await buildApp({ runtimeRole: "worker" });
    await workerApp.ready();
    app = await buildApp({ runtimeRole: "api" });
    await app.ready();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
    if (workerApp) {
      await workerApp.close();
      workerApp = null;
    }
  });

  afterAll(async () => {
    await repo.close();
    process.env = oldEnv;
  });

  it("persists tasks across app restarts", async () => {
    const publisher = addr("p1");
    const create = await app!.inject({
      method: "POST",
      url: "/v2/tasks",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        title: "persistent-task",
        descriptionMd: "desc",
        acceptanceCriteria: "ok",
        deadlineUtc: futureDeadline(),
        displayTimezone: "UTC",
        slotsTotal: 1,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: false
      }
    });
    expect(create.statusCode).toBe(200);
    await app!.close();

    app = await buildApp();
    await app.ready();
    const tasks = await app.inject({ method: "GET", url: "/v2/tasks" });
    expect(tasks.statusCode).toBe(200);
    expect(tasks.json().items.length).toBe(1);
    expect(tasks.json().items[0].title).toBe("persistent-task");
  });

  it("persists feedback reports across app restarts", async () => {
    const reporter = addr("persist-feedback-reporter");
    const create = await app!.inject({
      method: "POST",
      url: "/v2/feedback",
      headers: { authorization: `Bearer ${bearer(reporter)}` },
      payload: {
        type: "SUGGESTION",
        title: "persistent feedback",
        bodyMd: "please add a feedback review command"
      }
    });
    expect(create.statusCode).toBe(200);
    const created = create.json() as { id: string };

    await app!.close();
    app = await buildApp();
    await app.ready();

    const get = await app.inject({
      method: "GET",
      url: `/v2/feedback/${created.id}`,
      headers: bearerAndAdmin(systemOperator)
    });
    expect(get.statusCode).toBe(200);
    expect(get.json()).toMatchObject({
      id: created.id,
      type: "SUGGESTION",
      reporterAddress: reporter,
      title: "persistent feedback"
    });
  });

  it("filters persisted request and audit logs by actor case-insensitively", async () => {
    const publisher = addr("log-filter-publisher");
    const create = await app!.inject({
      method: "POST",
      url: "/v2/tasks",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        title: "log-filter-task",
        descriptionMd: "desc",
        acceptanceCriteria: "ok",
        deadlineUtc: futureDeadline(),
        displayTimezone: "UTC",
        slotsTotal: 1,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: false
      }
    });
    expect(create.statusCode).toBe(200);

    const actorQuery = `0x${publisher.slice(2).toUpperCase()}`;
    const requestLogs = await app!.inject({
      method: "GET",
      url: `/v2/system/logs/requests?actor=${actorQuery}&routeId=%2Fv2%2Ftasks&method=post&status=200`,
      headers: bearerAndAdmin(systemOperator)
    });
    expect(requestLogs.statusCode).toBe(200);
    const requestPayload = requestLogs.json() as {
      items: Array<{ actorAddress: string | null; method: string; routeId: string }>;
    };
    expect(requestPayload.items.some((item) => item.actorAddress === publisher)).toBe(true);

    const auditLogs = await app!.inject({
      method: "GET",
      url: `/v2/system/logs/audits?category=DOMAIN_WRITE&action=tasks.create&outcome=SUCCESS&actor=${actorQuery}`,
      headers: bearerAndAdmin(systemOperator)
    });
    expect(auditLogs.statusCode).toBe(200);
    const auditPayload = auditLogs.json() as {
      items: Array<{ action: string; actorAddress: string | null; outcome: string }>;
    };
    expect(auditPayload.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "tasks.create",
          actorAddress: publisher,
          outcome: "SUCCESS"
        })
      ])
    );
  });

  it("cleans API-local in-memory logs when persistence log sinks are disabled", async () => {
    const previous = {
      ENABLE_REQUEST_LOG_PERSISTENCE: process.env.ENABLE_REQUEST_LOG_PERSISTENCE,
      ENABLE_AUDIT_LOG_PERSISTENCE: process.env.ENABLE_AUDIT_LOG_PERSISTENCE,
      REQUEST_LOG_RETENTION_DAYS: process.env.REQUEST_LOG_RETENTION_DAYS,
      AUDIT_LOG_RETENTION_DAYS: process.env.AUDIT_LOG_RETENTION_DAYS
    };

    try {
      if (workerApp) {
        await workerApp.close();
        workerApp = null;
      }
      if (app) {
        await app.close();
        app = null;
      }
      process.env.ENABLE_REQUEST_LOG_PERSISTENCE = "false";
      process.env.ENABLE_AUDIT_LOG_PERSISTENCE = "false";
      process.env.REQUEST_LOG_RETENTION_DAYS = "1";
      process.env.AUDIT_LOG_RETENTION_DAYS = "1";
      app = await buildApp({ runtimeRole: "api" });
      await app.ready();

      const health = await app.inject({ method: "GET", url: "/v2/system/health" });
      expect(health.statusCode).toBe(200);
      const healthRequestId = health.headers["x-request-id"];

      const beforeCleanup = await app.inject({
        method: "GET",
        url: `/v2/system/logs/requests?requestId=${healthRequestId}`,
        headers: bearerAndAdmin(systemOperator)
      });
      expect(beforeCleanup.statusCode).toBe(200);
      expect(
        (beforeCleanup.json() as { items: Array<{ requestId: string }> }).items.some(
          (item) => item.requestId === healthRequestId
        )
      ).toBe(true);

      const cleanupForTests = (app as TestFastifyInstance).cleanupLogsForTests;
      expect(cleanupForTests).toBeTypeOf("function");
      await cleanupForTests!(new Date(Date.now() + 2 * 24 * 3_600_000));

      const afterCleanup = await app.inject({
        method: "GET",
        url: `/v2/system/logs/requests?requestId=${healthRequestId}`,
        headers: bearerAndAdmin(systemOperator)
      });
      expect(afterCleanup.statusCode).toBe(200);
      expect(
        (afterCleanup.json() as { items: Array<{ requestId: string }> }).items.some(
          (item) => item.requestId === healthRequestId
        )
      ).toBe(false);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it("falls back to in-memory audit logs when audit log persistence is disabled", async () => {
    const publisher = addr("audit-fallback-publisher");
    const previous = process.env.ENABLE_AUDIT_LOG_PERSISTENCE;
    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: TEST_DB_URL!
        }
      }
    });

    try {
      await app!.close();
      app = null;
      process.env.ENABLE_AUDIT_LOG_PERSISTENCE = "false";
      app = await buildApp();
      await app.ready();

      const create = await app.inject({
        method: "POST",
        url: "/v2/tasks",
        headers: { authorization: `Bearer ${bearer(publisher)}` },
        payload: {
          title: "audit-fallback-task",
          descriptionMd: "desc",
          acceptanceCriteria: "ok",
          deadlineUtc: futureDeadline(),
          displayTimezone: "UTC",
          slotsTotal: 1,
          rewardPerSlot: 10,
          allowRepeatCompletionsBySameAgent: false
        }
      });
      expect(create.statusCode).toBe(200);

      const logs = await app.inject({
        method: "GET",
        url: `/v2/system/logs/audits?action=tasks.create&actor=${publisher}`,
        headers: bearerAndAdmin(systemOperator)
      });
      expect(logs.statusCode).toBe(200);
      const payload = logs.json() as {
        items: Array<{ action: string; actorAddress: string | null; outcome: string }>;
      };
      expect(payload.items).toHaveLength(1);
      expect(payload.items[0]).toMatchObject({
        action: "tasks.create",
        actorAddress: publisher,
        outcome: "SUCCESS"
      });

      const persistedCount = await prisma.serverAuditLog.count({
        where: {
          action: "tasks.create",
          actorAddress: publisher
        }
      });
      expect(persistedCount).toBe(0);
    } finally {
      await prisma.$disconnect();
      if (app) {
        await app.close();
        app = null;
      }
      if (previous === undefined) {
        delete process.env.ENABLE_AUDIT_LOG_PERSISTENCE;
      } else {
        process.env.ENABLE_AUDIT_LOG_PERSISTENCE = previous;
      }
      app = await buildApp();
      await app.ready();
    }
  });

  it("drops oldest buffered request logs without failing requests when buffer capacity is exceeded", async () => {
    const previous = {
      REQUEST_LOG_BATCH_SIZE: process.env.REQUEST_LOG_BATCH_SIZE,
      REQUEST_LOG_FLUSH_INTERVAL_MS: process.env.REQUEST_LOG_FLUSH_INTERVAL_MS,
      REQUEST_LOG_BUFFER_CAPACITY: process.env.REQUEST_LOG_BUFFER_CAPACITY
    };

    try {
      await app!.close();
      app = null;
      process.env.REQUEST_LOG_BATCH_SIZE = "1000";
      process.env.REQUEST_LOG_FLUSH_INTERVAL_MS = "60000";
      process.env.REQUEST_LOG_BUFFER_CAPACITY = "1";
      app = await buildApp({ runtimeRole: "api" });
      await app.ready();

      const first = await app.inject({ method: "GET", url: "/v2/system/health" });
      expect(first.statusCode).toBe(200);
      const second = await app.inject({ method: "GET", url: "/v2/system/health" });
      expect(second.statusCode).toBe(200);

      const logs = await app.inject({
        method: "GET",
        url: "/v2/system/logs/requests?routeId=%2Fv2%2Fsystem%2Fhealth&method=GET",
        headers: bearerAndAdmin(systemOperator)
      });
      expect(logs.statusCode).toBe(200);
      const logsPayload = logs.json() as {
        items: Array<{ requestId: string; routeId: string }>;
      };
      expect(logsPayload.items.some((item) => item.requestId === first.headers["x-request-id"])).toBe(
        false
      );
      expect(logsPayload.items.some((item) => item.requestId === second.headers["x-request-id"])).toBe(
        true
      );

      const metrics = await app.inject({
        method: "GET",
        url: "/v2/system/metrics",
        headers: { authorization: `Bearer ${bearer(systemOperator)}` }
      });
      expect(metrics.statusCode).toBe(200);
      const metricsPayload = metrics.json() as {
        counters: { requestLogDroppedTotal: number };
        gauges: { requestLogBufferSize: number };
      };
      expect(metricsPayload.counters.requestLogDroppedTotal).toBeGreaterThanOrEqual(1);
      expect(metricsPayload.gauges.requestLogBufferSize).toBe(1);
    } finally {
      if (app) {
        await app.close();
        app = null;
      }
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      app = await buildApp({ runtimeRole: "api" });
      await app.ready();
    }
  });

  it("keeps buffered request log timestamps at enqueue time instead of flush time", async () => {
    const previous = {
      REQUEST_LOG_BATCH_SIZE: process.env.REQUEST_LOG_BATCH_SIZE,
      REQUEST_LOG_FLUSH_INTERVAL_MS: process.env.REQUEST_LOG_FLUSH_INTERVAL_MS,
      REQUEST_LOG_BUFFER_CAPACITY: process.env.REQUEST_LOG_BUFFER_CAPACITY
    };

    try {
      await app!.close();
      app = null;
      process.env.REQUEST_LOG_BATCH_SIZE = "1000";
      process.env.REQUEST_LOG_FLUSH_INTERVAL_MS = "60000";
      process.env.REQUEST_LOG_BUFFER_CAPACITY = "10";
      app = await buildApp({ runtimeRole: "api" });
      await app.ready();

      const health = await app.inject({ method: "GET", url: "/v2/system/health" });
      expect(health.statusCode).toBe(200);
      const completedAt = new Date();
      await sleep(50);

      const logs = await app.inject({
        method: "GET",
        url: "/v2/system/logs/requests?routeId=%2Fv2%2Fsystem%2Fhealth&method=GET",
        headers: bearerAndAdmin(systemOperator)
      });
      expect(logs.statusCode).toBe(200);
      const logsPayload = logs.json() as {
        items: Array<{ requestId: string; createdAt: string }>;
      };
      const healthLog = logsPayload.items.find(
        (item) => item.requestId === health.headers["x-request-id"]
      );
      expect(healthLog).toBeDefined();
      expect(new Date(healthLog!.createdAt).getTime()).toBeLessThanOrEqual(completedAt.getTime());
    } finally {
      if (app) {
        await app.close();
        app = null;
      }
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      app = await buildApp({ runtimeRole: "api" });
      await app.ready();
    }
  });

  it("exposes persisted worker job counters through API metrics", async () => {
    if (workerApp) {
      await workerApp.close();
      workerApp = null;
    }
    const readMetrics = async () => {
      const response = await app!.inject({
        method: "GET",
        url: "/v2/system/metrics",
        headers: { authorization: `Bearer ${bearer(systemOperator)}` }
      });
      expect(response.statusCode).toBe(200);
      return response.json() as {
        counters: {
          workerJobSuccessTotal: number;
          workerJobErrorTotal: number;
          workerJobLockMissTotal: number;
          workerJobSuccessTotalExact: string;
          workerJobErrorTotalExact: string;
          workerJobLockMissTotalExact: string;
        };
      };
    };

    const before = await readMetrics();
    await repo.incrementWorkerJobMetricDirect("success");
    await repo.incrementWorkerJobMetricDirect("error");
    await repo.incrementWorkerJobMetricDirect("lock_miss");

    const after = await readMetrics();
    expect(after.counters.workerJobSuccessTotal - before.counters.workerJobSuccessTotal).toBe(1);
    expect(after.counters.workerJobErrorTotal - before.counters.workerJobErrorTotal).toBe(1);
    expect(after.counters.workerJobLockMissTotal - before.counters.workerJobLockMissTotal).toBe(1);
    expect(
      BigInt(after.counters.workerJobSuccessTotalExact) -
        BigInt(before.counters.workerJobSuccessTotalExact)
    ).toBe(1n);
    expect(
      BigInt(after.counters.workerJobErrorTotalExact) -
        BigInt(before.counters.workerJobErrorTotalExact)
    ).toBe(1n);
    expect(
      BigInt(after.counters.workerJobLockMissTotalExact) -
        BigInt(before.counters.workerJobLockMissTotalExact)
    ).toBe(1n);
  });

  it("fails worker startup instead of initializing persistence when bootstrap has not completed", async () => {
    if (workerApp) {
      await workerApp.close();
      workerApp = null;
    }
    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: TEST_DB_URL!
        }
      }
    });
    await prisma.runtimeRuleState.deleteMany();
    await prisma.runtimeState.deleteMany();
    const auditCountBefore = await prisma.serverAuditLog.count();

    try {
      await expect(buildApp({ runtimeRole: "worker" })).rejects.toThrow(
        /worker runtime requires initialized persistence state/
      );
      await expect(prisma.runtimeRuleState.count()).resolves.toBe(0);
      await expect(prisma.runtimeState.count()).resolves.toBe(0);
      await expect(prisma.serverAuditLog.count()).resolves.toBe(auditCountBefore);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("does not auto-close due cycles on ordinary persistence read requests", async () => {
    if (workerApp) {
      await workerApp.close();
      workerApp = null;
    }
    const activeBeforeRes = await app!.inject({
      method: "GET",
      url: "/v2/cycles/active"
    });
    expect(activeBeforeRes.statusCode).toBe(200);
    const activeBefore = activeBeforeRes.json() as { id: string };

    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: TEST_DB_URL!
        }
      }
    });
    try {
      await prisma.cycle.update({
        where: { id: activeBefore.id },
        data: { startedAt: new Date(Date.now() - 8 * 24 * 3_600_000) }
      });
    } finally {
      await prisma.$disconnect();
    }

    const activeAfterRes = await app!.inject({
      method: "GET",
      url: "/v2/cycles/active"
    });
    expect(activeAfterRes.statusCode).toBe(200);
    expect((activeAfterRes.json() as { id: string }).id).toBe(activeBefore.id);

    const cycleRes = await app!.inject({
      method: "GET",
      url: `/v2/cycles/${activeBefore.id}`
    });
    expect(cycleRes.statusCode).toBe(200);
    const cycle = cycleRes.json() as { status: string; closedAt: string | null };
    expect(cycle.status).toBe("OPEN");
    expect(cycle.closedAt).toBeNull();
  });

  it("persists agent profile updates across app restarts", async () => {
    const agent = addr("profile-persist");
    const patchRes = await app!.inject({
      method: "PATCH",
      url: `/v2/agents/${agent}/profile`,
      headers: { authorization: `Bearer ${bearer(agent)}` },
      payload: {
        name: "Agent Persist",
        bio: "profile survives restart"
      }
    });
    expect(patchRes.statusCode).toBe(200);
    const patched = patchRes.json() as { name: string; bio: string };
    expect(patched.name).toBe("Agent Persist");
    expect(patched.bio).toBe("profile survives restart");

    await app!.close();
    app = await buildApp();
    await app.ready();

    const profileRes = await app!.inject({
      method: "GET",
      url: `/v2/agents/${agent}`
    });
    expect(profileRes.statusCode).toBe(200);
    const profile = profileRes.json() as { name: string; bio: string };
    expect(profile.name).toBe("Agent Persist");
    expect(profile.bio).toBe("profile survives restart");
  });

  it("persists runtime settings across restart and keeps DB precedence over env defaults", async () => {
    const oldTaxRateBps = process.env.TAX_RATE_BPS;
    const oldMintPerCycle = process.env.MINT_PER_CYCLE;
    try {
      const beforeRes = await app!.inject({
        method: "GET",
        url: "/v2/system/settings",
        headers: { authorization: `Bearer ${bearer(systemOperator)}` }
      });
      expect(beforeRes.statusCode).toBe(200);
      const before = beforeRes.json() as {
        currentRules: { taxRateBps: number; mintPerCycle: number };
        pendingNextPatch: { mintPerCycle?: number } | null;
        nextRules: { mintPerCycle: number };
      };
      expect(before.pendingNextPatch).toBeNull();

      const currentUpdateRes = await app!.inject({
        method: "PATCH",
        url: "/v2/system/settings",
        headers: bearerAndAdmin(systemOperator),
        payload: {
          applyTo: "current",
          patch: { taxRateBps: before.currentRules.taxRateBps + 100 },
          reason: "persistence restart db precedence test"
        }
      });
      expect(currentUpdateRes.statusCode).toBe(200);

      const nextUpdateRes = await app!.inject({
        method: "PATCH",
        url: "/v2/system/settings",
        headers: bearerAndAdmin(systemOperator),
        payload: {
          applyTo: "next",
          patch: { mintPerCycle: before.currentRules.mintPerCycle + 50 },
          reason: "persistence restart db precedence test"
        }
      });
      expect(nextUpdateRes.statusCode).toBe(200);
      const expected = nextUpdateRes.json() as {
        currentRules: { taxRateBps: number; mintPerCycle: number };
        pendingNextPatch: { mintPerCycle?: number } | null;
        nextRules: { mintPerCycle: number };
      };
      expect(expected.currentRules.taxRateBps).toBe(before.currentRules.taxRateBps + 100);
      expect(expected.pendingNextPatch?.mintPerCycle).toBe(before.currentRules.mintPerCycle + 50);
      expect(expected.nextRules.mintPerCycle).toBe(before.currentRules.mintPerCycle + 50);

      process.env.TAX_RATE_BPS = "1";
      process.env.MINT_PER_CYCLE = "1";

      await app!.close();
      app = await buildApp();
      await app.ready();

      const afterRestartRes = await app!.inject({
        method: "GET",
        url: "/v2/system/settings",
        headers: { authorization: `Bearer ${bearer(systemOperator)}` }
      });
      expect(afterRestartRes.statusCode).toBe(200);
      const afterRestart = afterRestartRes.json() as {
        currentRules: { taxRateBps: number; mintPerCycle: number };
        pendingNextPatch: { mintPerCycle?: number } | null;
        nextRules: { mintPerCycle: number };
      };
      expect(afterRestart.currentRules.taxRateBps).toBe(expected.currentRules.taxRateBps);
      expect(afterRestart.currentRules.mintPerCycle).toBe(expected.currentRules.mintPerCycle);
      expect(afterRestart.pendingNextPatch?.mintPerCycle).toBe(expected.pendingNextPatch?.mintPerCycle);
      expect(afterRestart.nextRules.mintPerCycle).toBe(expected.nextRules.mintPerCycle);
    } finally {
      if (oldTaxRateBps === undefined) {
        delete process.env.TAX_RATE_BPS;
      } else {
        process.env.TAX_RATE_BPS = oldTaxRateBps;
      }
      if (oldMintPerCycle === undefined) {
        delete process.env.MINT_PER_CYCLE;
      } else {
        process.env.MINT_PER_CYCLE = oldMintPerCycle;
      }
    }
  });

  it("uses refreshed runtime score weights for persisted agent directory reads", async () => {
    const reputationAgent = addr("score-refresh-reputation");
    const performanceAgent = addr("score-refresh-performance");
    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: TEST_DB_URL!
        }
      }
    });
    try {
      await prisma.agentProfile.createMany({
        data: [
          {
            address: reputationAgent,
            name: "score-refresh reputation",
            bio: "high reputation, low completion",
            status: "ACTIVE",
            bannedAt: null,
            banReasonCode: null,
            publisherRep: 100,
            workerRep: 100,
            supervisorRep: 100,
            tasksPublishedCount: 0,
            tasksIntentedCount: 10,
            tasksCompletedCount: 0,
            tasksTerminatedCount: 0,
            submissionsRejectedCount: 10,
            supervisionVotesCount: 0
          },
          {
            address: performanceAgent,
            name: "score-refresh performance",
            bio: "low reputation, high completion",
            status: "ACTIVE",
            bannedAt: null,
            banReasonCode: null,
            publisherRep: 0,
            workerRep: 0,
            supervisorRep: 0,
            tasksPublishedCount: 0,
            tasksIntentedCount: 10,
            tasksCompletedCount: 10,
            tasksTerminatedCount: 0,
            submissionsRejectedCount: 0,
            supervisionVotesCount: 0
          }
        ]
      });
    } finally {
      await prisma.$disconnect();
    }

    const beforeRes = await app!.inject({
      method: "GET",
      url: "/v2/agents?q=score-refresh&activeOnly=false&sort=score&order=desc&limit=10"
    });
    expect(beforeRes.statusCode).toBe(200);
    const before = beforeRes.json() as {
      items: Array<{ address: string; score: number }>;
    };
    expect(before.items.map((item) => item.address).slice(0, 2)).toEqual([
      performanceAgent,
      reputationAgent
    ]);

    const updateRes = await app!.inject({
      method: "PATCH",
      url: "/v2/system/settings",
      headers: bearerAndAdmin(systemOperator),
      payload: {
        applyTo: "current",
        patch: {
          scoreWeightReputationBps: 10000,
          scoreWeightCompletionBps: 0,
          scoreWeightQualityBps: 0
        },
        reason: "agent directory score refresh test"
      }
    });
    expect(updateRes.statusCode).toBe(200);

    const afterRes = await app!.inject({
      method: "GET",
      url: "/v2/agents?q=score-refresh&activeOnly=false&sort=score&order=desc&limit=10"
    });
    expect(afterRes.statusCode).toBe(200);
    const after = afterRes.json() as {
      items: Array<{ address: string; score: number }>;
    };
    expect(after.items.map((item) => item.address).slice(0, 2)).toEqual([
      reputationAgent,
      performanceAgent
    ]);
    expect(after.items[0]!.score).toBe(100);
  });

  it("worker auto-close applies fresh pending runtime rules from the database", async () => {
    const beforeRes = await app!.inject({
      method: "GET",
      url: "/v2/system/settings",
      headers: { authorization: `Bearer ${bearer(systemOperator)}` }
    });
    expect(beforeRes.statusCode).toBe(200);
    const before = beforeRes.json() as {
      currentRules: { mintPerCycle: number; taxRateBps: number };
    };
    const nextMintPerCycle = before.currentRules.mintPerCycle + 123;
    const nextTaxRateBps = before.currentRules.taxRateBps + 100;

    const nextUpdateRes = await app!.inject({
      method: "PATCH",
      url: "/v2/system/settings",
      headers: bearerAndAdmin(systemOperator),
      payload: {
        applyTo: "next",
        patch: { mintPerCycle: nextMintPerCycle, taxRateBps: nextTaxRateBps },
        reason: "worker fresh runtime rules test"
      }
    });
    expect(nextUpdateRes.statusCode).toBe(200);

    const close = await forceAutoCloseCurrentCycle();
    const openedCycleRes = await app!.inject({
      method: "GET",
      url: `/v2/cycles/${close.openedCycleId}`
    });
    expect(openedCycleRes.statusCode).toBe(200);
    expect((openedCycleRes.json() as { mintedAmount: number }).mintedAmount).toBe(nextMintPerCycle);

    const afterRes = await app!.inject({
      method: "GET",
      url: "/v2/system/settings",
      headers: { authorization: `Bearer ${bearer(systemOperator)}` }
    });
    expect(afterRes.statusCode).toBe(200);
    const after = afterRes.json() as {
      currentRules: { mintPerCycle: number; taxRateBps: number };
      pendingNextPatch: { mintPerCycle?: number; taxRateBps?: number } | null;
      nextRules: { mintPerCycle: number; taxRateBps: number };
    };
    expect(after.currentRules.mintPerCycle).toBe(nextMintPerCycle);
    expect(after.currentRules.taxRateBps).toBe(nextTaxRateBps);
    expect(after.pendingNextPatch).toBeNull();
    expect(after.nextRules.mintPerCycle).toBe(nextMintPerCycle);
    expect(after.nextRules.taxRateBps).toBe(nextTaxRateBps);

    const economyRes = await app!.inject({
      method: "GET",
      url: "/v2/economy/params"
    });
    expect(economyRes.statusCode).toBe(200);
    const economy = economyRes.json() as { taxRateBps: number; taxMin: number };
    expect(economy.taxRateBps).toBe(nextTaxRateBps);

    const taskReward = 100;
    const taskCreateRes = await app!.inject({
      method: "POST",
      url: "/v2/tasks",
      headers: { authorization: `Bearer ${bearer(addr("worker-fresh-rules-publisher"))}` },
      payload: {
        title: "worker-fresh-rules-task",
        descriptionMd: "desc",
        acceptanceCriteria: "ok",
        deadlineUtc: futureDeadline(),
        displayTimezone: "UTC",
        slotsTotal: 1,
        rewardPerSlot: taskReward,
        allowRepeatCompletionsBySameAgent: false
      }
    });
    expect(taskCreateRes.statusCode).toBe(200);
    expect((taskCreateRes.json() as { taxAmount: number }).taxAmount).toBe(
      Math.max(economy.taxMin, Math.floor((taskReward * nextTaxRateBps) / 10_000))
    );
  });

  it("uses configured initial balance when creating new agent ledger in persistence mode", async () => {
    await app!.close();
    app = null;
    const previousInitialAgentBalance = process.env.INITIAL_AGENT_BALANCE;
    process.env.INITIAL_AGENT_BALANCE = "4321";
    try {
      app = await buildApp();
      await app.ready();

      const agent = addr("persist-initial-balance");
      const patchRes = await app.inject({
        method: "PATCH",
        url: `/v2/agents/${agent}/profile`,
        headers: { authorization: `Bearer ${bearer(agent)}` },
        payload: {
          name: "bootstrap-ledger",
          bio: "ensure ledger amount follows config"
        }
      });
      expect(patchRes.statusCode).toBe(200);

      const ledgerRes = await app.inject({
        method: "GET",
        url: `/v2/ledger/${agent}`
      });
      expect(ledgerRes.statusCode).toBe(200);
      expect((ledgerRes.json() as { available: number }).available).toBe(4321);
    } finally {
      if (previousInitialAgentBalance === undefined) {
        delete process.env.INITIAL_AGENT_BALANCE;
      } else {
        process.env.INITIAL_AGENT_BALANCE = previousInitialAgentBalance;
      }
    }
  });

  it("auto-closes due cycle, settles rewards, and advances to next cycle in persistence mode", async () => {
    const publisher = addr("persist-auto-cycle-pub");
    const worker = addr("persist-auto-cycle-worker");

    const taskRes = await app!.inject({
      method: "POST",
      url: "/v2/tasks",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        title: "persist-auto-cycle-task",
        descriptionMd: "desc",
        acceptanceCriteria: "criteria",
        deadlineUtc: futureDeadline(),
        displayTimezone: "UTC",
        slotsTotal: 1,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: false
      }
    });
    expect(taskRes.statusCode).toBe(200);
    const task = taskRes.json() as { id: string };

    const intentRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/intentions`,
      headers: { authorization: `Bearer ${bearer(worker)}` }
    });
    expect(intentRes.statusCode).toBe(200);

    const submitRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: { payloadMd: "result" }
    });
    expect(submitRes.statusCode).toBe(200);
    const submission = submitRes.json() as { id: string };

    const confirmRes = await app!.inject({
      method: "POST",
      url: `/v2/submissions/${submission.id}/confirm`,
      headers: { authorization: `Bearer ${bearer(publisher)}` }
    });
    expect(confirmRes.statusCode).toBe(200);

    const workerBeforeAutoCloseRes = await app!.inject({
      method: "GET",
      url: `/v2/ledger/${worker}`
    });
    expect(workerBeforeAutoCloseRes.statusCode).toBe(200);
    const workerBeforeAutoClose = (workerBeforeAutoCloseRes.json() as { available: number }).available;

    const close = await forceAutoCloseCurrentCycle();
    expect(close.openedCycleId).toBe("cycle-2");

    const cycle1Res = await app!.inject({
      method: "GET",
      url: "/v2/cycles/cycle-1"
    });
    expect(cycle1Res.statusCode).toBe(200);
    const cycle1 = cycle1Res.json() as { status: string; closedAt: string | null };
    expect(cycle1.status).toBe("CLOSED");
    expect(cycle1.closedAt).not.toBeNull();

    const rewardsRes = await app!.inject({
      method: "GET",
      url: "/v2/cycles/cycle-1/rewards"
    });
    expect(rewardsRes.statusCode).toBe(200);
    const rewards = rewardsRes.json() as {
      rewardPool: number;
      distributions: Array<{ agent: string; amount: number }>;
      workloads: Array<{ taskId?: string | null; settledAt: string | null }>;
    };
    expect(rewards.rewardPool).toBeGreaterThan(0);
    expect(rewards.distributions.length).toBeGreaterThan(0);
    expect(
      rewards.workloads.some((item) => item.taskId === task.id && item.settledAt !== null)
    ).toBe(true);

    const workerAfterAutoCloseRes = await app!.inject({
      method: "GET",
      url: `/v2/ledger/${worker}`
    });
    expect(workerAfterAutoCloseRes.statusCode).toBe(200);
    const workerAfterAutoClose = (workerAfterAutoCloseRes.json() as { available: number }).available;
    expect(workerAfterAutoClose).toBeGreaterThan(workerBeforeAutoClose);
  });

  it("auto-confirms stale submissions during due cycle auto-close in persistence mode", async () => {
    const publisher = addr("persist-stale-pub");
    const worker = addr("persist-stale-worker");

    const taskRes = await app!.inject({
      method: "POST",
      url: "/v2/tasks",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        title: "persist-stale-auto-confirm-task",
        descriptionMd: "desc",
        acceptanceCriteria: "criteria",
        deadlineUtc: futureDeadline(),
        displayTimezone: "UTC",
        slotsTotal: 1,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: false
      }
    });
    expect(taskRes.statusCode).toBe(200);
    const task = taskRes.json() as { id: string };

    const intentRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/intentions`,
      headers: { authorization: `Bearer ${bearer(worker)}` }
    });
    expect(intentRes.statusCode).toBe(200);

    const submitRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: { payloadMd: "stale-result" }
    });
    expect(submitRes.statusCode).toBe(200);
    const submission = submitRes.json() as { id: string };

    const submissionBeforeAutoCloseRes = await app!.inject({
      method: "GET",
      url: `/v2/submissions/${submission.id}`
    });
    expect(submissionBeforeAutoCloseRes.statusCode).toBe(200);
    expect((submissionBeforeAutoCloseRes.json() as { status: string }).status).toBe("SUBMITTED");

    const workerBeforeAutoCloseRes = await app!.inject({
      method: "GET",
      url: `/v2/ledger/${worker}`
    });
    expect(workerBeforeAutoCloseRes.statusCode).toBe(200);
    const workerBeforeAutoClose = (workerBeforeAutoCloseRes.json() as { available: number }).available;

    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: TEST_DB_URL!
        }
      }
    });
    const staleCreatedAt = new Date(
      Date.now() - (defaultConfig.submissionTimeoutHours + 1) * 3_600_000
    );
    await prisma.$transaction([
      prisma.submission.update({
        where: { id: submission.id },
        data: {
          createdAt: staleCreatedAt
        }
      }),
      prisma.cycle.update({
        where: { id: "cycle-1" },
        data: {
          startedAt: new Date(Date.now() - 8 * 24 * 3_600_000)
        }
      })
    ]);
    await prisma.$disconnect();

    const close = await forceAutoCloseCurrentCycle();
    expect(close.openedCycleId).toBe("cycle-2");

    const submissionAfterAutoCloseRes = await app!.inject({
      method: "GET",
      url: `/v2/submissions/${submission.id}`
    });
    expect(submissionAfterAutoCloseRes.statusCode).toBe(200);
    expect((submissionAfterAutoCloseRes.json() as { status: string }).status).toBe("CONFIRMED");

    const taskAfterAutoCloseRes = await app!.inject({
      method: "GET",
      url: `/v2/tasks/${task.id}`
    });
    expect(taskAfterAutoCloseRes.statusCode).toBe(200);
    expect((taskAfterAutoCloseRes.json() as { status: string }).status).toBe("CLOSED");

    const rewardsRes = await app!.inject({
      method: "GET",
      url: "/v2/cycles/cycle-1/rewards"
    });
    expect(rewardsRes.statusCode).toBe(200);
    const rewards = rewardsRes.json() as {
      workloads: Array<{ taskId?: string | null; disputeId: string | null; settledAt: string | null }>;
    };
    const completionWorkloads = rewards.workloads.filter(
      (item) => item.taskId === task.id && item.disputeId === null
    );
    expect(completionWorkloads).toHaveLength(2);
    expect(completionWorkloads.every((item) => item.settledAt !== null)).toBe(true);

    const workerAfterAutoCloseRes = await app!.inject({
      method: "GET",
      url: `/v2/ledger/${worker}`
    });
    expect(workerAfterAutoCloseRes.statusCode).toBe(200);
    const workerAfterAutoClose = (workerAfterAutoCloseRes.json() as { available: number }).available;
    expect(workerAfterAutoClose).toBeGreaterThan(workerBeforeAutoClose);
  });

  it("keeps one-time supervision participation rule across restarts", async () => {
    const publisher = addr("p2");
    const worker = addr("p3");
    const supervisor = addr("p4");

    const taskRes = await app!.inject({
      method: "POST",
      url: "/v2/tasks",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        title: "task",
        descriptionMd: "desc",
        acceptanceCriteria: "criteria",
        deadlineUtc: futureDeadline(),
        displayTimezone: "UTC",
        slotsTotal: 1,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: false
      }
    });
    const task = taskRes.json() as { id: string };

    await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/intentions`,
      headers: { authorization: `Bearer ${bearer(worker)}` }
    });
    const submissionRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: { payloadMd: "result" }
    });
    const submission = submissionRes.json() as { id: string };
    await rejectSubmission(submission.id, publisher);

    const disputeRes = await app!.inject({
      method: "POST",
      url: "/v2/disputes",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        taskId: task.id,
        submissionId: submission.id,
        reasonMd: "review"
      }
    });
    const dispute = disputeRes.json() as { id: string };

    const firstVote = await app!.inject({
      method: "POST",
      url: `/v2/disputes/${dispute.id}/votes`,
      headers: { authorization: `Bearer ${bearer(supervisor)}` },
      payload: { vote: VoteChoice.COMPLETED }
    });
    expect(firstVote.statusCode).toBe(200);

    await app!.close();
    app = await buildApp();
    await app.ready();

    const secondVote = await app!.inject({
      method: "POST",
      url: `/v2/disputes/${dispute.id}/votes`,
      headers: { authorization: `Bearer ${bearer(supervisor)}` },
      payload: { vote: VoteChoice.NOT_COMPLETED }
    });
    expect(secondVote.statusCode).toBe(409);
  });

  it("rejects dispute-party votes and allows third-party supervisor votes", async () => {
    const publisher = addr("p2v");
    const worker = addr("p3v");
    const supervisor = addr("p4v");

    const taskRes = await app!.inject({
      method: "POST",
      url: "/v2/tasks",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        title: "task-party-vote",
        descriptionMd: "desc",
        acceptanceCriteria: "criteria",
        deadlineUtc: futureDeadline(),
        displayTimezone: "UTC",
        slotsTotal: 1,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: false
      }
    });
    expect(taskRes.statusCode).toBe(200);
    const task = taskRes.json() as { id: string };

    await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/intentions`,
      headers: { authorization: `Bearer ${bearer(worker)}` }
    });
    const submissionRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: { payloadMd: "result" }
    });
    expect(submissionRes.statusCode).toBe(200);
    const submission = submissionRes.json() as { id: string };
    await rejectSubmission(submission.id, publisher);

    const disputeRes = await app!.inject({
      method: "POST",
      url: "/v2/disputes",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        taskId: task.id,
        submissionId: submission.id,
        reasonMd: "review"
      }
    });
    expect(disputeRes.statusCode).toBe(200);
    const dispute = disputeRes.json() as { id: string };

    const publisherVoteRes = await app!.inject({
      method: "POST",
      url: `/v2/disputes/${dispute.id}/votes`,
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: { vote: VoteChoice.COMPLETED }
    });
    expect(publisherVoteRes.statusCode).toBe(403);
    expect(errorCode(publisherVoteRes.json())).toBe("DISPUTE_PARTY_CANNOT_VOTE");

    const workerVoteRes = await app!.inject({
      method: "POST",
      url: `/v2/disputes/${dispute.id}/votes`,
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: { vote: VoteChoice.COMPLETED }
    });
    expect(workerVoteRes.statusCode).toBe(403);
    expect(errorCode(workerVoteRes.json())).toBe("DISPUTE_PARTY_CANNOT_VOTE");

    const supervisorVoteRes = await app!.inject({
      method: "POST",
      url: `/v2/disputes/${dispute.id}/votes`,
      headers: { authorization: `Bearer ${bearer(supervisor)}` },
      payload: { vote: VoteChoice.COMPLETED }
    });
    expect(supervisorVoteRes.statusCode).toBe(200);
  });

  it("allows one counterparty reason from the non-opener party only", async () => {
    const publisher = addr("p2r");
    const worker = addr("p3r");
    const outsider = addr("p4r");

    const taskRes = await app!.inject({
      method: "POST",
      url: "/v2/tasks",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        title: "task-counterparty-reason",
        descriptionMd: "desc",
        acceptanceCriteria: "criteria",
        deadlineUtc: futureDeadline(),
        displayTimezone: "UTC",
        slotsTotal: 1,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: false
      }
    });
    expect(taskRes.statusCode).toBe(200);
    const task = taskRes.json() as { id: string };

    await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/intentions`,
      headers: { authorization: `Bearer ${bearer(worker)}` }
    });
    const submissionRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: { payloadMd: "result" }
    });
    expect(submissionRes.statusCode).toBe(200);
    const submission = submissionRes.json() as { id: string };
    await rejectSubmission(submission.id, publisher);

    const disputeRes = await app!.inject({
      method: "POST",
      url: "/v2/disputes",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        taskId: task.id,
        submissionId: submission.id,
        reasonMd: "review"
      }
    });
    expect(disputeRes.statusCode).toBe(200);
    const dispute = disputeRes.json() as { id: string };

    const workerRespondRes = await app!.inject({
      method: "POST",
      url: `/v2/disputes/${dispute.id}/counterparty-reason`,
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: { reasonMd: "worker counterparty reason" }
    });
    expect(workerRespondRes.statusCode).toBe(200);
    const workerRespond = workerRespondRes.json() as {
      counterpartyResponder?: string | null;
      counterpartyReasonMd?: string | null;
    };
    expect(workerRespond.counterpartyResponder).toBe(worker);
    expect(workerRespond.counterpartyReasonMd).toBe("worker counterparty reason");

    const duplicateRespondRes = await app!.inject({
      method: "POST",
      url: `/v2/disputes/${dispute.id}/counterparty-reason`,
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: { reasonMd: "duplicate" }
    });
    expect(duplicateRespondRes.statusCode).toBe(409);
    expect(errorCode(duplicateRespondRes.json())).toBe("DISPUTE_COUNTERPARTY_REASON_ALREADY_EXISTS");

    const openerRespondRes = await app!.inject({
      method: "POST",
      url: `/v2/disputes/${dispute.id}/counterparty-reason`,
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: { reasonMd: "opener should fail" }
    });
    expect(openerRespondRes.statusCode).toBe(403);
    expect(errorCode(openerRespondRes.json())).toBe("DISPUTE_COUNTERPARTY_ONLY");

    const outsiderRespondRes = await app!.inject({
      method: "POST",
      url: `/v2/disputes/${dispute.id}/counterparty-reason`,
      headers: { authorization: `Bearer ${bearer(outsider)}` },
      payload: { reasonMd: "outsider should fail" }
    });
    expect(outsiderRespondRes.statusCode).toBe(403);
    expect(errorCode(outsiderRespondRes.json())).toBe("DISPUTE_COUNTERPARTY_ONLY");
  });

  it("rejects dispute creation after the parent task has been terminated", async () => {
    const publisher = addr("ptd1");
    const worker = addr("ptd2");

    const taskRes = await app!.inject({
      method: "POST",
      url: "/v2/tasks",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        title: "terminated-dispute-task",
        descriptionMd: "desc",
        acceptanceCriteria: "criteria",
        deadlineUtc: futureDeadline(),
        displayTimezone: "UTC",
        slotsTotal: 1,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: false
      }
    });
    expect(taskRes.statusCode).toBe(200);
    const task = taskRes.json() as { id: string };

    await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/intentions`,
      headers: { authorization: `Bearer ${bearer(worker)}` }
    });
    const submissionRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: { payloadMd: "result" }
    });
    expect(submissionRes.statusCode).toBe(200);
    const submission = submissionRes.json() as { id: string };
    await rejectSubmission(submission.id, publisher);

    const terminateRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/terminate`,
      headers: { authorization: `Bearer ${bearer(publisher)}` }
    });
    expect(terminateRes.statusCode).toBe(200);

    const disputeRes = await app!.inject({
      method: "POST",
      url: "/v2/disputes",
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: {
        taskId: task.id,
        submissionId: submission.id,
        reasonMd: "terminated tasks cannot be disputed"
      }
    });
    expect(disputeRes.statusCode).toBe(409);
    expect(errorCode(disputeRes.json())).toBe("SUBMISSION_NOT_DISPUTABLE");
  });

  it("bans insolvent publishers and freezes new intake on persistence-mode active tasks", async () => {
    const publisher = addr("pbp");
    const workerA = addr("pba");
    const workerB = addr("pbb");
    const workerC = addr("pbc");
    const workerD = addr("pbd");
    const supervisors = [addr("pbs1"), addr("pbs2"), addr("pbs3"), addr("pbs4"), addr("pbs5")];

    const createTask = async (title: string) => {
      const response = await app!.inject({
        method: "POST",
        url: "/v2/tasks",
        headers: { authorization: `Bearer ${bearer(publisher)}` },
        payload: {
          title,
          descriptionMd: "desc",
          acceptanceCriteria: "criteria",
          deadlineUtc: futureDeadline(),
          displayTimezone: "UTC",
          slotsTotal: 1,
          rewardPerSlot: 10,
          allowRepeatCompletionsBySameAgent: false
        }
      });
      expect(response.statusCode).toBe(200);
      return response.json() as { id: string };
    };

    const slotTask = await createTask("slot-task");
    const cleanTask = await createTask("clean-task");
    const frozenTask = await createTask("frozen-task");

    for (const [taskId, worker] of [
      [slotTask.id, workerA],
      [slotTask.id, workerB],
      [frozenTask.id, workerC]
    ] as const) {
      const intentionRes = await app!.inject({
        method: "POST",
        url: `/v2/tasks/${taskId}/intentions`,
        headers: { authorization: `Bearer ${bearer(worker)}` }
      });
      expect(intentionRes.statusCode).toBe(200);
    }

    const confirmedRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${slotTask.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(workerA)}` },
      payload: { payloadMd: "confirmed" }
    });
    expect(confirmedRes.statusCode).toBe(200);
    const confirmedSubmission = confirmedRes.json() as { id: string };

    const disputedRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${slotTask.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(workerB)}` },
      payload: { payloadMd: "disputed" }
    });
    expect(disputedRes.statusCode).toBe(200);
    const disputedSubmission = disputedRes.json() as { id: string };

    const pendingRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${frozenTask.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(workerC)}` },
      payload: { payloadMd: "pending" }
    });
    expect(pendingRes.statusCode).toBe(200);
    expect(pendingRes.json()).toHaveProperty("id");

    const confirmRes = await app!.inject({
      method: "POST",
      url: `/v2/submissions/${confirmedSubmission.id}/confirm`,
      headers: { authorization: `Bearer ${bearer(publisher)}` }
    });
    expect(confirmRes.statusCode).toBe(200);
    await rejectSubmission(disputedSubmission.id, publisher);

    const disputeRes = await app!.inject({
      method: "POST",
      url: "/v2/disputes",
      headers: { authorization: `Bearer ${bearer(workerB)}` },
      payload: {
        taskId: slotTask.id,
        submissionId: disputedSubmission.id,
        reasonMd: "valid completion"
      }
    });
    expect(disputeRes.statusCode).toBe(200);
    const dispute = disputeRes.json() as { id: string };

    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: TEST_DB_URL!
        }
      }
    });
    await prisma.ledgerBalance.update({
      where: { address: publisher },
      data: { available: 4 }
    });
    await prisma.$disconnect();

    for (const supervisor of supervisors) {
      const voteRes = await app!.inject({
        method: "POST",
        url: `/v2/disputes/${dispute.id}/votes`,
        headers: { authorization: `Bearer ${bearer(supervisor)}` },
        payload: { vote: VoteChoice.COMPLETED }
      });
      expect(voteRes.statusCode).toBe(200);
    }

    await forceAutoCloseCurrentCycle();

    const publisherRes = await app!.inject({
      method: "GET",
      url: `/v2/agents/${publisher}`
    });
    expect(publisherRes.statusCode).toBe(200);
    expect(
      publisherRes.json() as { status: string; banReasonCode: string | null }
    ).toMatchObject({
      status: "BANNED",
      banReasonCode: "DISPUTE_INSOLVENCY"
    });

    const disputeAfterRes = await app!.inject({
      method: "GET",
      url: `/v2/disputes/${dispute.id}`
    });
    expect(disputeAfterRes.statusCode).toBe(200);
    expect(
      disputeAfterRes.json() as {
        resolution: {
          payoutSource: string;
          payoutAmount: number;
          payoutShortfallAmount: number;
          publisherBanned: boolean;
        };
      }
    ).toMatchObject({
      resolution: {
        payoutSource: "PUBLISHER_WALLET_PARTIAL",
        payoutAmount: 4,
        payoutShortfallAmount: 6,
        publisherBanned: true
      }
    });

    const bannedWriteRes = await app!.inject({
      method: "POST",
      url: "/v2/tasks",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        title: "should fail",
        descriptionMd: "desc",
        acceptanceCriteria: "criteria",
        deadlineUtc: futureDeadline(),
        displayTimezone: "UTC",
        slotsTotal: 1,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: false
      }
    });
    expect(bannedWriteRes.statusCode).toBe(403);
    expect(errorCode(bannedWriteRes.json())).toBe("ACCOUNT_BANNED");

    const frozenIntentRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${frozenTask.id}/intentions`,
      headers: { authorization: `Bearer ${bearer(workerD)}` }
    });
    expect(frozenIntentRes.statusCode).toBe(409);
    expect(errorCode(frozenIntentRes.json())).toBe("TASK_FROZEN");

    const cleanTaskRes = await app!.inject({
      method: "GET",
      url: `/v2/tasks/${cleanTask.id}`
    });
    expect(cleanTaskRes.statusCode).toBe(200);
    expect((cleanTaskRes.json() as { status: string }).status).toBe("TERMINATED");
  });

  it("settles delayed-dispute supervision workload in current cycle only", async () => {
    const publisher = addr("p5");
    const worker = addr("p6");
    const supervisors = [addr("p7"), addr("p8"), addr("p9"), addr("pa")];

    const taskRes = await app!.inject({
      method: "POST",
      url: "/v2/tasks",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        title: "delayed-cycle-task",
        descriptionMd: "desc",
        acceptanceCriteria: "criteria",
        deadlineUtc: futureDeadline(),
        displayTimezone: "UTC",
        slotsTotal: 1,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: false
      }
    });
    expect(taskRes.statusCode).toBe(200);
    const task = taskRes.json() as { id: string };

    const acceptRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/intentions`,
      headers: { authorization: `Bearer ${bearer(worker)}` }
    });
    expect(acceptRes.statusCode).toBe(200);

    const submissionRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: { payloadMd: "result" }
    });
    expect(submissionRes.statusCode).toBe(200);
    const submission = submissionRes.json() as { id: string };
    await rejectSubmission(submission.id, publisher);

    const disputeRes = await app!.inject({
      method: "POST",
      url: "/v2/disputes",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        taskId: task.id,
        submissionId: submission.id,
        reasonMd: "delayed workload settlement"
      }
    });
    expect(disputeRes.statusCode).toBe(200);
    const dispute = disputeRes.json() as { id: string };

    for (const supervisor of supervisors) {
      const voteRes = await app!.inject({
        method: "POST",
        url: `/v2/disputes/${dispute.id}/votes`,
        headers: { authorization: `Bearer ${bearer(supervisor)}` },
        payload: { vote: VoteChoice.NOT_COMPLETED }
      });
      expect(voteRes.statusCode).toBe(200);
    }

    const beforeClose1Res = await app!.inject({
      method: "GET",
      url: `/v2/ledger/${supervisors[0]}`
    });
    expect(beforeClose1Res.statusCode).toBe(200);
    const beforeClose1 = (beforeClose1Res.json() as { available: number }).available;

    const close1 = await forceAutoCloseCurrentCycle();

    const disputeAfterClose1 = await app!.inject({
      method: "GET",
      url: `/v2/disputes/${dispute.id}`
    });
    expect(disputeAfterClose1.statusCode).toBe(200);
    expect((disputeAfterClose1.json() as { status: string }).status).toBe("OPEN");

    const rewards1Res = await app!.inject({
      method: "GET",
      url: `/v2/cycles/${close1.closedCycleId}/rewards`
    });
    expect(rewards1Res.statusCode).toBe(200);
    const rewards1 = rewards1Res.json() as {
      rewardPool: number;
      distributions: Array<{ agent: string; amount: number }>;
      workloads: Array<{ disputeId: string | null; taskId?: string | null; settledAt: string | null }>;
    };
    expect(rewards1.rewardPool).toBeGreaterThan(0);
    expect(rewards1.distributions.length).toBeGreaterThan(0);
    expect(rewards1.distributions.every((item) => item.amount > 0)).toBe(true);
    const disputeCycle1Workloads = rewards1.workloads.filter(
      (item) => item.disputeId === dispute.id && item.taskId === null
    );
    expect(disputeCycle1Workloads).toHaveLength(supervisors.length);
    expect(disputeCycle1Workloads.every((item) => item.settledAt !== null)).toBe(true);

    const afterClose1Res = await app!.inject({
      method: "GET",
      url: `/v2/ledger/${supervisors[0]}`
    });
    expect(afterClose1Res.statusCode).toBe(200);
    const afterClose1 = (afterClose1Res.json() as { available: number }).available;
    expect(afterClose1).toBeGreaterThan(beforeClose1);

    await forceAutoCloseCurrentCycle();

    const afterClose2Res = await app!.inject({
      method: "GET",
      url: `/v2/ledger/${supervisors[0]}`
    });
    expect(afterClose2Res.statusCode).toBe(200);
    const afterClose2 = (afterClose2Res.json() as { available: number }).available;
    expect(afterClose2).toBe(afterClose1);
  });

  it("records completion workloads for publisher and worker on confirmed submissions", async () => {
    const publisher = addr("pw1");
    const worker = addr("pw2");

    const taskRes = await app!.inject({
      method: "POST",
      url: "/v2/tasks",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        title: "completion-workload-task",
        descriptionMd: "desc",
        acceptanceCriteria: "criteria",
        deadlineUtc: futureDeadline(),
        displayTimezone: "UTC",
        slotsTotal: 1,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: false
      }
    });
    expect(taskRes.statusCode).toBe(200);
    const task = taskRes.json() as { id: string };

    const intentRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/intentions`,
      headers: { authorization: `Bearer ${bearer(worker)}` }
    });
    expect(intentRes.statusCode).toBe(200);

    const submissionRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: { payloadMd: "result" }
    });
    expect(submissionRes.statusCode).toBe(200);
    const submission = submissionRes.json() as { id: string };

    const confirmRes = await app!.inject({
      method: "POST",
      url: `/v2/submissions/${submission.id}/confirm`,
      headers: { authorization: `Bearer ${bearer(publisher)}` }
    });
    expect(confirmRes.statusCode).toBe(200);

    const close = await forceAutoCloseCurrentCycle();

    const rewardsRes = await app!.inject({
      method: "GET",
      url: `/v2/cycles/${close.closedCycleId}/rewards`
    });
    expect(rewardsRes.statusCode).toBe(200);
    const rewards = rewardsRes.json() as {
      workloads: Array<{ taskId?: string | null; disputeId: string | null; agent: string; workload: number }>;
    };
    const completionWorkloads = rewards.workloads.filter(
      (item) => item.taskId === task.id && item.disputeId === null
    );
    expect(completionWorkloads).toHaveLength(2);
    expect(completionWorkloads.every((item) => item.workload === 0.25)).toBe(true);
    expect(completionWorkloads.some((item) => item.agent === publisher)).toBe(true);
    expect(completionWorkloads.some((item) => item.agent === worker)).toBe(true);
  });

  it("keeps one-open-dispute-per-submission rule across restarts", async () => {
    const publisher = addr("pb1");
    const worker = addr("pb2");

    const taskRes = await app!.inject({
      method: "POST",
      url: "/v2/tasks",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        title: "dedupe-dispute-restart-task",
        descriptionMd: "desc",
        acceptanceCriteria: "criteria",
        deadlineUtc: futureDeadline(),
        displayTimezone: "UTC",
        slotsTotal: 1,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: false
      }
    });
    expect(taskRes.statusCode).toBe(200);
    const task = taskRes.json() as { id: string };

    const acceptRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/intentions`,
      headers: { authorization: `Bearer ${bearer(worker)}` }
    });
    expect(acceptRes.statusCode).toBe(200);

    const submissionRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: { payloadMd: "result" }
    });
    expect(submissionRes.statusCode).toBe(200);
    const submission = submissionRes.json() as { id: string };
    await rejectSubmission(submission.id, publisher);

    const firstDisputeRes = await app!.inject({
      method: "POST",
      url: "/v2/disputes",
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: {
        taskId: task.id,
        submissionId: submission.id,
        reasonMd: "first open dispute"
      }
    });
    expect(firstDisputeRes.statusCode).toBe(200);

    await app!.close();
    app = await buildApp();
    await app.ready();

    const secondDisputeRes = await app!.inject({
      method: "POST",
      url: "/v2/disputes",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        taskId: task.id,
        submissionId: submission.id,
        reasonMd: "duplicate open dispute after restart"
      }
    });
    expect(secondDisputeRes.statusCode).toBe(409);
    expect(errorCode(secondDisputeRes.json())).toBe("OPEN_DISPUTE_ALREADY_EXISTS");
  });

  it("preserves slot-based closure for repeatable tasks across restart", async () => {
    await app!.close();
    app = null;
    app = await buildApp();
    await app.ready();

    const publisher = addr("pb3");
    const worker = addr("pb4");
    const taskRes = await app!.inject({
      method: "POST",
      url: "/v2/tasks",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        title: "repeat-restart-task",
        descriptionMd: "desc",
        acceptanceCriteria: "criteria",
        deadlineUtc: futureDeadline(),
        displayTimezone: "UTC",
        slotsTotal: 2,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: true
      }
    });
    expect(taskRes.statusCode).toBe(200);
    const task = taskRes.json() as { id: string };

    const accept1 = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/intentions`,
      headers: { authorization: `Bearer ${bearer(worker)}` }
    });
    expect(accept1.statusCode).toBe(200);
    const submit1 = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: { payloadMd: "first" }
    });
    expect(submit1.statusCode).toBe(200);
    const submission1 = submit1.json() as { id: string };
    const confirm1 = await app!.inject({
      method: "POST",
      url: `/v2/submissions/${submission1.id}/confirm`,
      headers: { authorization: `Bearer ${bearer(publisher)}` }
    });
    expect(confirm1.statusCode).toBe(200);

    await app!.close();
    app = await buildApp();
    await app.ready();

    const updateRulesRes = await app!.inject({
      method: "PATCH",
      url: "/v2/system/settings",
      headers: bearerAndAdmin(systemOperator),
      payload: {
        applyTo: "current",
        patch: { resubmitCooldownMinutes: 0 },
        reason: "persistence repeatable submission test"
      }
    });
    expect(updateRulesRes.statusCode).toBe(200);

    const submit2 = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: { payloadMd: "second" }
    });
    expect(submit2.statusCode).toBe(200);
    const submission2 = submit2.json() as { id: string };
    const confirm2 = await app!.inject({
      method: "POST",
      url: `/v2/submissions/${submission2.id}/confirm`,
      headers: { authorization: `Bearer ${bearer(publisher)}` }
    });
    expect(confirm2.statusCode).toBe(200);

    const taskAfter = await app!.inject({
      method: "GET",
      url: `/v2/tasks/${task.id}`
    });
    expect(taskAfter.statusCode).toBe(200);
    const body = taskAfter.json() as { status: string; rewardEscrowRemaining: number };
    expect(body.status).toBe("CLOSED");
    expect(body.rewardEscrowRemaining).toBe(0);
  });

  it("computes competition using remaining slots in persistence mode", async () => {
    const publisher = addr("cmp-persist-1");
    const workerA = addr("cmp-persist-2");
    const workerB = addr("cmp-persist-3");

    const taskRes = await app!.inject({
      method: "POST",
      url: "/v2/tasks",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        title: "persistence-remaining-slots-competition",
        descriptionMd: "desc",
        acceptanceCriteria: "criteria",
        deadlineUtc: futureDeadline(),
        displayTimezone: "UTC",
        slotsTotal: 2,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: false
      }
    });
    expect(taskRes.statusCode).toBe(200);
    const task = taskRes.json() as { id: string };

    const acceptA = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/intentions`,
      headers: { authorization: `Bearer ${bearer(workerA)}` }
    });
    expect(acceptA.statusCode).toBe(200);
    const acceptB = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/intentions`,
      headers: { authorization: `Bearer ${bearer(workerB)}` }
    });
    expect(acceptB.statusCode).toBe(200);

    const submissionRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(workerA)}` },
      payload: { payloadMd: "first completion" }
    });
    expect(submissionRes.statusCode).toBe(200);
    const submission = submissionRes.json() as { id: string };

    const confirmRes = await app!.inject({
      method: "POST",
      url: `/v2/submissions/${submission.id}/confirm`,
      headers: { authorization: `Bearer ${bearer(publisher)}` }
    });
    expect(confirmRes.statusCode).toBe(200);

    const taskAfter = await app!.inject({
      method: "GET",
      url: `/v2/tasks/${task.id}`
    });
    expect(taskAfter.statusCode).toBe(200);
    const body = taskAfter.json() as { intentCount: number; competitionRatio: number };
    expect(body.intentCount).toBe(2);
    expect(body.competitionRatio).toBe(2);
  });

  it("closes task before returning 409 when submit finds no payable slots in persistence mode", async () => {
    const publisher = addr("persist-slot-submit-pub");
    const workerA = addr("slot-submit-a-worker");
    const workerB = addr("slot-submit-b-worker");

    const taskRes = await app!.inject({
      method: "POST",
      url: "/v2/tasks",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        title: "persist-submit-no-slots",
        descriptionMd: "desc",
        acceptanceCriteria: "criteria",
        deadlineUtc: futureDeadline(),
        displayTimezone: "UTC",
        slotsTotal: 1,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: false
      }
    });
    expect(taskRes.statusCode).toBe(200);
    const task = taskRes.json() as { id: string };

    const [intentARes, intentBRes] = await Promise.all([
      app!.inject({
        method: "POST",
        url: `/v2/tasks/${task.id}/intentions`,
        headers: { authorization: `Bearer ${bearer(workerA)}` }
      }),
      app!.inject({
        method: "POST",
        url: `/v2/tasks/${task.id}/intentions`,
        headers: { authorization: `Bearer ${bearer(workerB)}` }
      })
    ]);
    expect(intentARes.statusCode).toBe(200);
    expect(intentBRes.statusCode).toBe(200);

    const submitARes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(workerA)}` },
      payload: { payloadMd: "first" }
    });
    expect(submitARes.statusCode).toBe(200);
    const submissionA = submitARes.json() as { id: string };

    const confirmARes = await app!.inject({
      method: "POST",
      url: `/v2/submissions/${submissionA.id}/confirm`,
      headers: { authorization: `Bearer ${bearer(publisher)}` }
    });
    expect(confirmARes.statusCode).toBe(200);

    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: TEST_DB_URL!
        }
      }
    });
    await prisma.task.update({
      where: { id: task.id },
      data: {
        status: "IN_PROGRESS"
      }
    });
    await prisma.$disconnect();

    const submitBRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(workerB)}` },
      payload: { payloadMd: "second" }
    });
    expect(submitBRes.statusCode).toBe(409);
    expect(errorCode(submitBRes.json())).toBe("TASK_NOT_SUBMITTABLE");

    const taskAfterRes = await app!.inject({
      method: "GET",
      url: `/v2/tasks/${task.id}`
    });
    expect(taskAfterRes.statusCode).toBe(200);
    expect((taskAfterRes.json() as { status: string }).status).toBe("CLOSED");
  });

  it("closes task before returning 409 when confirm finds no payable slots in persistence mode", async () => {
    const publisher = addr("persist-slot-confirm-pub");
    const workerA = addr("slot-confirm-a-worker");
    const workerB = addr("slot-confirm-b-worker");

    const taskRes = await app!.inject({
      method: "POST",
      url: "/v2/tasks",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        title: "persist-confirm-no-slots",
        descriptionMd: "desc",
        acceptanceCriteria: "criteria",
        deadlineUtc: futureDeadline(),
        displayTimezone: "UTC",
        slotsTotal: 1,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: false
      }
    });
    expect(taskRes.statusCode).toBe(200);
    const task = taskRes.json() as { id: string };

    const [intentARes, intentBRes] = await Promise.all([
      app!.inject({
        method: "POST",
        url: `/v2/tasks/${task.id}/intentions`,
        headers: { authorization: `Bearer ${bearer(workerA)}` }
      }),
      app!.inject({
        method: "POST",
        url: `/v2/tasks/${task.id}/intentions`,
        headers: { authorization: `Bearer ${bearer(workerB)}` }
      })
    ]);
    expect(intentARes.statusCode).toBe(200);
    expect(intentBRes.statusCode).toBe(200);

    const submitARes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(workerA)}` },
      payload: { payloadMd: "first" }
    });
    expect(submitARes.statusCode).toBe(200);
    const submissionA = submitARes.json() as { id: string };

    const submitBRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(workerB)}` },
      payload: { payloadMd: "second" }
    });
    expect(submitBRes.statusCode).toBe(200);
    const submissionB = submitBRes.json() as { id: string };

    const confirmARes = await app!.inject({
      method: "POST",
      url: `/v2/submissions/${submissionA.id}/confirm`,
      headers: { authorization: `Bearer ${bearer(publisher)}` }
    });
    expect(confirmARes.statusCode).toBe(200);

    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: TEST_DB_URL!
        }
      }
    });
    await prisma.task.update({
      where: { id: task.id },
      data: {
        status: "IN_PROGRESS"
      }
    });
    await prisma.$disconnect();

    const confirmBRes = await app!.inject({
      method: "POST",
      url: `/v2/submissions/${submissionB.id}/confirm`,
      headers: { authorization: `Bearer ${bearer(publisher)}` }
    });
    expect(confirmBRes.statusCode).toBe(409);
    expect(errorCode(confirmBRes.json())).toBe("SUBMISSION_NOT_CONFIRMABLE");

    const taskAfterRes = await app!.inject({
      method: "GET",
      url: `/v2/tasks/${task.id}`
    });
    expect(taskAfterRes.statusCode).toBe(200);
    expect((taskAfterRes.json() as { status: string }).status).toBe("CLOSED");
  });

  it("simulates restart-aware interactive dispute escalation with quorum votes", async () => {
    const publisher = addr("scenario-pub");
    const worker = addr("scenario-worker");
    const supervisors = [
      addr("scenario-sup-1"),
      addr("scenario-sup-2"),
      addr("scenario-sup-3"),
      addr("scenario-sup-4"),
      addr("scenario-sup-5")
    ];

    const workerBeforeRes = await app!.inject({
      method: "GET",
      url: `/v2/ledger/${worker}`
    });
    expect(workerBeforeRes.statusCode).toBe(200);
    const workerBefore = (workerBeforeRes.json() as { available: number }).available;

    const taskRes = await app!.inject({
      method: "POST",
      url: "/v2/tasks",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        title: "restart-interactive-scenario",
        descriptionMd: "long running interaction",
        acceptanceCriteria: "criteria",
        deadlineUtc: futureDeadline(),
        displayTimezone: "UTC",
        slotsTotal: 1,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: false
      }
    });
    expect(taskRes.statusCode).toBe(200);
    const task = taskRes.json() as { id: string };

    const acceptRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/intentions`,
      headers: { authorization: `Bearer ${bearer(worker)}` }
    });
    expect(acceptRes.statusCode).toBe(200);

    const submitRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: { payloadMd: "scenario result" }
    });
    expect(submitRes.statusCode).toBe(200);
    const submission = submitRes.json() as { id: string };

    await rejectSubmission(submission.id, publisher);

    const disputeRes = await app!.inject({
      method: "POST",
      url: "/v2/disputes",
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: {
        taskId: task.id,
        submissionId: submission.id,
        reasonMd: "needs supervision due rejection"
      }
    });
    expect(disputeRes.statusCode).toBe(200);
    const dispute = disputeRes.json() as { id: string };

    const firstVoteRes = await app!.inject({
      method: "POST",
      url: `/v2/disputes/${dispute.id}/votes`,
      headers: { authorization: `Bearer ${bearer(supervisors[0])}` },
      payload: { vote: VoteChoice.NOT_COMPLETED }
    });
    expect(firstVoteRes.statusCode).toBe(200);

    await forceAutoCloseCurrentCycle();

    const disputeAfterCycle1Res = await app!.inject({
      method: "GET",
      url: `/v2/disputes/${dispute.id}`
    });
    expect(disputeAfterCycle1Res.statusCode).toBe(200);
    const disputeAfterCycle1 = disputeAfterCycle1Res.json() as { status: string; resolution?: unknown };
    expect(disputeAfterCycle1.status).toBe("OPEN");
    expect(disputeAfterCycle1).not.toHaveProperty("resolution");

    await app!.close();
    app = await buildApp();
    await app.ready();

    for (const supervisor of supervisors.slice(1)) {
      const voteRes = await app!.inject({
        method: "POST",
        url: `/v2/disputes/${dispute.id}/votes`,
        headers: { authorization: `Bearer ${bearer(supervisor)}` },
        payload: { vote: VoteChoice.COMPLETED }
      });
      expect(voteRes.statusCode).toBe(200);
    }

    await forceAutoCloseCurrentCycle();

    const taskAfterRes = await app!.inject({
      method: "GET",
      url: `/v2/tasks/${task.id}`
    });
    expect(taskAfterRes.statusCode).toBe(200);
    const taskAfter = taskAfterRes.json() as { status: string; rewardEscrowRemaining: number };
    expect(taskAfter.status).toBe("CLOSED");
    expect(taskAfter.rewardEscrowRemaining).toBe(0);

    const workerAfterRes = await app!.inject({
      method: "GET",
      url: `/v2/ledger/${worker}`
    });
    expect(workerAfterRes.statusCode).toBe(200);
    const workerAfter = (workerAfterRes.json() as { available: number }).available;
    expect(workerAfter - workerBefore).toBeGreaterThanOrEqual(10);

    const voteAfterResolvedRes = await app!.inject({
      method: "POST",
      url: `/v2/disputes/${dispute.id}/votes`,
      headers: { authorization: `Bearer ${bearer(addr("scenario-sup-late"))}` },
      payload: { vote: VoteChoice.COMPLETED }
    });
    expect(voteAfterResolvedRes.statusCode).toBe(409);

    await app!.close();
    app = await buildApp();
    await app.ready();
    const disputeAfterRestartRes = await app!.inject({
      method: "GET",
      url: `/v2/disputes/${dispute.id}`
    });
    expect(disputeAfterRestartRes.statusCode).toBe(200);
    const disputeAfterRestart = disputeAfterRestartRes.json() as {
      status: string;
      resolution?: {
        totalVotes: number;
        completedVotes: number;
        notCompletedVotes: number;
        outcome: VoteChoice;
        winnerRole: string;
        winnerAddress: Address;
        payoutSource: DisputePayoutSource;
        payoutAmount: number;
        payoutShortfallAmount: number;
        publisherBanned: boolean;
      };
    };
    expect(disputeAfterRestart.status).toBe("RESOLVED_COMPLETED");
    expect(disputeAfterRestart.resolution).toEqual({
      totalVotes: supervisors.length,
      completedVotes: supervisors.length - 1,
      notCompletedVotes: 1,
      outcome: VoteChoice.COMPLETED,
      winnerRole: "SUBMISSION_AGENT",
      winnerAddress: worker,
      payoutSource: DisputePayoutSource.ESCROW,
      payoutAmount: 10,
      payoutShortfallAmount: 0,
      publisherBanned: false
    });
  });

  it("blocks manual confirm while a submission has an open dispute in persistence mode", async () => {
    const publisher = addr("persist-confirm-open-dispute-pub");
    const worker = addr("persist-confirm-open-dispute-worker");

    const taskRes = await app!.inject({
      method: "POST",
      url: "/v2/tasks",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        title: "confirm-blocked-by-open-dispute",
        descriptionMd: "desc",
        acceptanceCriteria: "criteria",
        deadlineUtc: futureDeadline(),
        displayTimezone: "UTC",
        slotsTotal: 1,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: false
      }
    });
    expect(taskRes.statusCode).toBe(200);
    const task = taskRes.json() as { id: string };

    const intentionRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/intentions`,
      headers: { authorization: `Bearer ${bearer(worker)}` }
    });
    expect(intentionRes.statusCode).toBe(200);

    const submitRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: { payloadMd: "payload" }
    });
    expect(submitRes.statusCode).toBe(200);
    const submission = submitRes.json() as { id: string };
    await rejectSubmission(submission.id, publisher);

    const disputeRes = await app!.inject({
      method: "POST",
      url: "/v2/disputes",
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: {
        taskId: task.id,
        submissionId: submission.id,
        reasonMd: "open dispute"
      }
    });
    expect(disputeRes.statusCode).toBe(200);

    const confirmRes = await app!.inject({
      method: "POST",
      url: `/v2/submissions/${submission.id}/confirm`,
      headers: { authorization: `Bearer ${bearer(publisher)}` }
    });
    expect(confirmRes.statusCode).toBe(409);
    expect(errorCode(confirmRes.json())).toBe("SUBMISSION_NOT_CONFIRMABLE");
  });

  it("blocks manual confirm after a completed dispute is reopened in persistence mode", async () => {
    const publisher = addr("persist-reopen-confirm-pub");
    const worker = addr("persist-reopen-confirm-worker");

    const taskRes = await app!.inject({
      method: "POST",
      url: "/v2/tasks",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        title: "confirm-blocked-after-reopen",
        descriptionMd: "desc",
        acceptanceCriteria: "criteria",
        deadlineUtc: futureDeadline(),
        displayTimezone: "UTC",
        slotsTotal: 1,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: false
      }
    });
    expect(taskRes.statusCode).toBe(200);
    const task = taskRes.json() as { id: string };

    await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/intentions`,
      headers: { authorization: `Bearer ${bearer(worker)}` }
    });
    const submitRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: { payloadMd: "payload" }
    });
    expect(submitRes.statusCode).toBe(200);
    const submission = submitRes.json() as { id: string };
    await rejectSubmission(submission.id, publisher);

    const disputeRes = await app!.inject({
      method: "POST",
      url: "/v2/disputes",
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: {
        taskId: task.id,
        submissionId: submission.id,
        reasonMd: "reopen dispute"
      }
    });
    expect(disputeRes.statusCode).toBe(200);
    const dispute = disputeRes.json() as { id: string };

    await repo.overrideDisputeDirect(dispute.id, "COMPLETED");
    await repo.overrideDisputeDirect(dispute.id, "NOT_COMPLETED");

    const confirmRes = await app!.inject({
      method: "POST",
      url: `/v2/submissions/${submission.id}/confirm`,
      headers: { authorization: `Bearer ${bearer(publisher)}` }
    });
    expect(confirmRes.statusCode).toBe(409);
    expect(errorCode(confirmRes.json())).toBe("SUBMISSION_NOT_CONFIRMABLE");
  });

  it("bans agents that remain negative after a reopened dispute settles again in persistence mode", async () => {
    const publisher = addr("persist-reopen-ban-pub");
    const worker = addr("persist-reopen-ban-worker");

    const taskRes = await app!.inject({
      method: "POST",
      url: "/v2/tasks",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        title: "reopen-negative-ban",
        descriptionMd: "desc",
        acceptanceCriteria: "criteria",
        deadlineUtc: futureDeadline(),
        displayTimezone: "UTC",
        slotsTotal: 1,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: false
      }
    });
    expect(taskRes.statusCode).toBe(200);
    const task = taskRes.json() as { id: string };

    const intentionRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/intentions`,
      headers: { authorization: `Bearer ${bearer(worker)}` }
    });
    expect(intentionRes.statusCode).toBe(200);

    const submitRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: { payloadMd: "payload" }
    });
    expect(submitRes.statusCode).toBe(200);
    const submission = submitRes.json() as { id: string };
    await rejectSubmission(submission.id, publisher);

    const disputeRes = await app!.inject({
      method: "POST",
      url: "/v2/disputes",
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: {
        taskId: task.id,
        submissionId: submission.id,
        reasonMd: "reopen negative balance"
      }
    });
    expect(disputeRes.statusCode).toBe(200);
    const dispute = disputeRes.json() as { id: string };

    await repo.overrideDisputeDirect(dispute.id, "COMPLETED");

    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: TEST_DB_URL!
        }
      }
    });
    await prisma.ledgerBalance.update({
      where: { address: worker },
      data: { available: 0 }
    });
    await prisma.$disconnect();

    await repo.overrideDisputeDirect(dispute.id, "NOT_COMPLETED");

    const profileRes = await app!.inject({
      method: "GET",
      url: `/v2/agents/${worker}`
    });
    expect(profileRes.statusCode).toBe(200);
    expect(profileRes.json()).toMatchObject({
      status: AgentStatus.ACTIVE,
      banReasonCode: null
    });

    const ledgerRes = await app!.inject({
      method: "GET",
      url: `/v2/ledger/${worker}`
    });
    expect(ledgerRes.statusCode).toBe(200);
    expect(ledgerRes.json()).toMatchObject({
      available: -10
    });

    const publishWhileNegativeRes = await app!.inject({
      method: "POST",
      url: "/v2/tasks",
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: {
        title: "negative-ledger-publish-blocked",
        descriptionMd: "desc",
        acceptanceCriteria: "criteria",
        deadlineUtc: futureDeadline(),
        displayTimezone: "UTC",
        slotsTotal: 1,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: false
      }
    });
    expect(publishWhileNegativeRes.statusCode).toBe(409);
    expect(errorCode(publishWhileNegativeRes.json())).toBe("INSUFFICIENT_BALANCE");

    const prismaAfterReopen = new PrismaClient({
      datasources: {
        db: {
          url: TEST_DB_URL!
        }
      }
    });
    await prismaAfterReopen.ledgerBalance.update({
      where: { address: worker },
      data: { available: -20 }
    });
    await prismaAfterReopen.$disconnect();

    await repo.overrideDisputeDirect(dispute.id, "COMPLETED");

    const profileAfterResolutionRes = await app!.inject({
      method: "GET",
      url: `/v2/agents/${worker}`
    });
    expect(profileAfterResolutionRes.statusCode).toBe(200);
    expect(profileAfterResolutionRes.json()).toMatchObject({
      status: AgentStatus.BANNED,
      banReasonCode: AgentBanReason.REOPEN_NEGATIVE_BALANCE
    });

    const ledgerAfterResolutionRes = await app!.inject({
      method: "GET",
      url: `/v2/ledger/${worker}`
    });
    expect(ledgerAfterResolutionRes.statusCode).toBe(200);
    expect((ledgerAfterResolutionRes.json() as { available: number }).available).toBeLessThan(0);

    const bannedWriteRes = await app!.inject({
      method: "POST",
      url: "/v2/tasks",
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: {
        title: "should-fail-while-banned",
        descriptionMd: "desc",
        acceptanceCriteria: "criteria",
        deadlineUtc: futureDeadline(),
        displayTimezone: "UTC",
        slotsTotal: 1,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: false
      }
    });
    expect(bannedWriteRes.statusCode).toBe(403);
    expect(errorCode(bannedWriteRes.json())).toBe("ACCOUNT_BANNED");
  });

  it("does not ban unrelated negative accounts when a different reopened dispute settles again in persistence mode", async () => {
    const publisherA = addr("persist-reopen-scope-pub-a");
    const workerA = addr("persist-reopen-scope-worker-a");
    const publisherB = addr("persist-reopen-scope-pub-b");
    const workerB = addr("persist-reopen-scope-worker-b");

    const createRejectedDispute = async (publisher: Address, worker: Address, title: string, reasonMd: string) => {
      const taskRes = await app!.inject({
        method: "POST",
        url: "/v2/tasks",
        headers: { authorization: `Bearer ${bearer(publisher)}` },
        payload: {
          title,
          descriptionMd: "desc",
          acceptanceCriteria: "criteria",
          deadlineUtc: futureDeadline(),
          displayTimezone: "UTC",
          slotsTotal: 1,
          rewardPerSlot: 10,
          allowRepeatCompletionsBySameAgent: false
        }
      });
      expect(taskRes.statusCode).toBe(200);
      const task = taskRes.json() as { id: string };

      const intentionRes = await app!.inject({
        method: "POST",
        url: `/v2/tasks/${task.id}/intentions`,
        headers: { authorization: `Bearer ${bearer(worker)}` }
      });
      expect(intentionRes.statusCode).toBe(200);

      const submitRes = await app!.inject({
        method: "POST",
        url: `/v2/tasks/${task.id}/submissions`,
        headers: { authorization: `Bearer ${bearer(worker)}` },
        payload: { payloadMd: "payload" }
      });
      expect(submitRes.statusCode).toBe(200);
      const submission = submitRes.json() as { id: string };
      await rejectSubmission(submission.id, publisher);

      const disputeRes = await app!.inject({
        method: "POST",
        url: "/v2/disputes",
        headers: { authorization: `Bearer ${bearer(worker)}` },
        payload: {
          taskId: task.id,
          submissionId: submission.id,
          reasonMd
        }
      });
      expect(disputeRes.statusCode).toBe(200);
      return disputeRes.json() as { id: string };
    };

    const disputeA = await createRejectedDispute(
      publisherA,
      workerA,
      "persist-reopen-scope-task-a",
      "reopen-scope-a"
    );
    const disputeB = await createRejectedDispute(
      publisherB,
      workerB,
      "persist-reopen-scope-task-b",
      "reopen-scope-b"
    );

    await repo.overrideDisputeDirect(disputeA.id, "COMPLETED");

    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: TEST_DB_URL!
        }
      }
    });
    await prisma.ledgerBalance.update({
      where: { address: workerA },
      data: { available: 0 }
    });

    await repo.overrideDisputeDirect(disputeA.id, "NOT_COMPLETED");

    const workerAAfterReopenRes = await app!.inject({
      method: "GET",
      url: `/v2/agents/${workerA}`
    });
    expect(workerAAfterReopenRes.statusCode).toBe(200);
    expect(workerAAfterReopenRes.json()).toMatchObject({
      status: AgentStatus.ACTIVE,
      banReasonCode: null
    });

    await repo.overrideDisputeDirect(disputeB.id, "COMPLETED");
    await repo.overrideDisputeDirect(disputeB.id, "NOT_COMPLETED");
    await repo.overrideDisputeDirect(disputeB.id, "COMPLETED");

    const workerAAfterBResettleRes = await app!.inject({
      method: "GET",
      url: `/v2/agents/${workerA}`
    });
    expect(workerAAfterBResettleRes.statusCode).toBe(200);
    expect(workerAAfterBResettleRes.json()).toMatchObject({
      status: AgentStatus.ACTIVE,
      banReasonCode: null
    });

    await prisma.ledgerBalance.update({
      where: { address: workerA },
      data: { available: -20 }
    });
    await repo.overrideDisputeDirect(disputeA.id, "COMPLETED");

    const workerAAfterAResettleRes = await app!.inject({
      method: "GET",
      url: `/v2/agents/${workerA}`
    });
    expect(workerAAfterAResettleRes.statusCode).toBe(200);
    expect(workerAAfterAResettleRes.json()).toMatchObject({
      status: AgentStatus.BANNED,
      banReasonCode: AgentBanReason.REOPEN_NEGATIVE_BALANCE
    });

    await prisma.$disconnect();
  });

  it("blocks manual termination while a task has an open dispute in persistence mode", async () => {
    const publisher = addr("persist-terminate-open-dispute-pub");
    const worker = addr("persist-terminate-open-dispute-worker");

    const taskRes = await app!.inject({
      method: "POST",
      url: "/v2/tasks",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        title: "terminate-blocked-by-open-dispute",
        descriptionMd: "desc",
        acceptanceCriteria: "criteria",
        deadlineUtc: futureDeadline(),
        displayTimezone: "UTC",
        slotsTotal: 1,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: false
      }
    });
    expect(taskRes.statusCode).toBe(200);
    const task = taskRes.json() as { id: string };

    const intentionRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/intentions`,
      headers: { authorization: `Bearer ${bearer(worker)}` }
    });
    expect(intentionRes.statusCode).toBe(200);

    const submitRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: { payloadMd: "payload" }
    });
    expect(submitRes.statusCode).toBe(200);
    const submission = submitRes.json() as { id: string };
    await rejectSubmission(submission.id, publisher);

    const disputeRes = await app!.inject({
      method: "POST",
      url: "/v2/disputes",
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: {
        taskId: task.id,
        submissionId: submission.id,
        reasonMd: "open dispute"
      }
    });
    expect(disputeRes.statusCode).toBe(200);

    const terminateRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/terminate`,
      headers: { authorization: `Bearer ${bearer(publisher)}` }
    });
    expect(terminateRes.statusCode).toBe(409);
    expect(errorCode(terminateRes.json())).toBe("TASK_NOT_TERMINABLE");
  });

  it("keeps single-open-dispute guard through restart and finalization", async () => {
    const publisher = addr("dedupe-flow-pub");
    const worker = addr("dedupe-flow-worker");
    const supervisors = [
      addr("dedupe-flow-sup-1"),
      addr("dedupe-flow-sup-2"),
      addr("dedupe-flow-sup-3"),
      addr("dedupe-flow-sup-4"),
      addr("dedupe-flow-sup-5")
    ];

    const workerBeforeRes = await app!.inject({
      method: "GET",
      url: `/v2/ledger/${worker}`
    });
    expect(workerBeforeRes.statusCode).toBe(200);
    const workerBefore = (workerBeforeRes.json() as { available: number }).available;

    const taskRes = await app!.inject({
      method: "POST",
      url: "/v2/tasks",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        title: "single-open-dispute-across-phases",
        descriptionMd: "desc",
        acceptanceCriteria: "criteria",
        deadlineUtc: futureDeadline(),
        displayTimezone: "UTC",
        slotsTotal: 1,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: false
      }
    });
    expect(taskRes.statusCode).toBe(200);
    const task = taskRes.json() as { id: string };

    const acceptRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/intentions`,
      headers: { authorization: `Bearer ${bearer(worker)}` }
    });
    expect(acceptRes.statusCode).toBe(200);

    const submitRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: { payloadMd: "result" }
    });
    expect(submitRes.statusCode).toBe(200);
    const submission = submitRes.json() as { id: string };
    await rejectSubmission(submission.id, publisher);

    const firstDisputeRes = await app!.inject({
      method: "POST",
      url: "/v2/disputes",
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: {
        taskId: task.id,
        submissionId: submission.id,
        reasonMd: "initial open dispute"
      }
    });
    expect(firstDisputeRes.statusCode).toBe(200);
    const dispute = firstDisputeRes.json() as { id: string };

    const voteRes = await app!.inject({
      method: "POST",
      url: `/v2/disputes/${dispute.id}/votes`,
      headers: { authorization: `Bearer ${bearer(supervisors[0])}` },
      payload: { vote: VoteChoice.NOT_COMPLETED }
    });
    expect(voteRes.statusCode).toBe(200);

    await forceAutoCloseCurrentCycle();

    const duplicateWhileOpenRes = await app!.inject({
      method: "POST",
      url: "/v2/disputes",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        taskId: task.id,
        submissionId: submission.id,
        reasonMd: "must still be blocked while open"
      }
    });
    expect(duplicateWhileOpenRes.statusCode).toBe(409);
    expect(errorCode(duplicateWhileOpenRes.json())).toBe("OPEN_DISPUTE_ALREADY_EXISTS");

    await app!.close();
    app = await buildApp();
    await app.ready();

    const duplicateAfterRestartRes = await app!.inject({
      method: "POST",
      url: "/v2/disputes",
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: {
        taskId: task.id,
        submissionId: submission.id,
        reasonMd: "must remain blocked after restart"
      }
    });
    expect(duplicateAfterRestartRes.statusCode).toBe(409);
    expect(errorCode(duplicateAfterRestartRes.json())).toBe("OPEN_DISPUTE_ALREADY_EXISTS");

    const finalizeVote2Res = await app!.inject({
      method: "POST",
      url: `/v2/disputes/${dispute.id}/votes`,
      headers: { authorization: `Bearer ${bearer(supervisors[1])}` },
      payload: { vote: VoteChoice.COMPLETED }
    });
    expect(finalizeVote2Res.statusCode).toBe(200);
    const finalizeVote3Res = await app!.inject({
      method: "POST",
      url: `/v2/disputes/${dispute.id}/votes`,
      headers: { authorization: `Bearer ${bearer(supervisors[2])}` },
      payload: { vote: VoteChoice.COMPLETED }
    });
    expect(finalizeVote3Res.statusCode).toBe(200);
    const finalizeVote4Res = await app!.inject({
      method: "POST",
      url: `/v2/disputes/${dispute.id}/votes`,
      headers: { authorization: `Bearer ${bearer(supervisors[3])}` },
      payload: { vote: VoteChoice.COMPLETED }
    });
    expect(finalizeVote4Res.statusCode).toBe(200);
    const finalizeVote5Res = await app!.inject({
      method: "POST",
      url: `/v2/disputes/${dispute.id}/votes`,
      headers: { authorization: `Bearer ${bearer(supervisors[4])}` },
      payload: { vote: VoteChoice.COMPLETED }
    });
    expect(finalizeVote5Res.statusCode).toBe(200);

    await forceAutoCloseCurrentCycle();

    const openAfterFinalizeRes = await app!.inject({
      method: "POST",
      url: "/v2/disputes",
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: {
        taskId: task.id,
        submissionId: submission.id,
        reasonMd: "submission is confirmed now"
      }
    });
    expect(openAfterFinalizeRes.statusCode).toBe(409);
    expect(errorCode(openAfterFinalizeRes.json())).toBe("SUBMISSION_NOT_DISPUTABLE");

    const workerAfterRes = await app!.inject({
      method: "GET",
      url: `/v2/ledger/${worker}`
    });
    expect(workerAfterRes.statusCode).toBe(200);
    const workerAfter = (workerAfterRes.json() as { available: number }).available;
    expect(workerAfter - workerBefore).toBeGreaterThanOrEqual(10);

    const taskAfterRes = await app!.inject({
      method: "GET",
      url: `/v2/tasks/${task.id}`
    });
    expect(taskAfterRes.statusCode).toBe(200);
    const taskAfter = taskAfterRes.json() as { status: string; rewardEscrowRemaining: number };
    expect(taskAfter.status).toBe("CLOSED");
    expect(taskAfter.rewardEscrowRemaining).toBe(0);
  });

  it(
    "keeps one-open-dispute invariant under concurrent open race when legacy data replays submission to REJECTED",
    async () => {
      const publisher = addr("persist-race-reopen-open-pub");
      const worker = addr("persist-race-reopen-open-worker");
      const supervisors = [
        addr("race-sup-a"),
        addr("race-sup-b"),
        addr("race-sup-c"),
        addr("race-sup-d"),
        addr("race-sup-e")
      ];
      const taskRes = await app!.inject({
        method: "POST",
        url: "/v2/tasks",
        headers: { authorization: `Bearer ${bearer(publisher)}` },
        payload: {
          title: "persist-race-reopen-open-task",
          descriptionMd: "desc",
          acceptanceCriteria: "ok",
          deadlineUtc: futureDeadline(),
          displayTimezone: "UTC",
          slotsTotal: 1,
          rewardPerSlot: 10,
          allowRepeatCompletionsBySameAgent: false
        }
      });
      expect(taskRes.statusCode).toBe(200);
      const task = taskRes.json() as { id: string };

      const acceptRes = await app!.inject({
        method: "POST",
        url: `/v2/tasks/${task.id}/intentions`,
        headers: { authorization: `Bearer ${bearer(worker)}` }
      });
      expect(acceptRes.statusCode).toBe(200);

      const submitRes = await app!.inject({
        method: "POST",
        url: `/v2/tasks/${task.id}/submissions`,
        headers: { authorization: `Bearer ${bearer(worker)}` },
        payload: { payloadMd: "result" }
      });
      expect(submitRes.statusCode).toBe(200);
      const submission = submitRes.json() as { id: string };
      await rejectSubmission(submission.id, publisher);

      const firstDisputeRes = await app!.inject({
        method: "POST",
        url: "/v2/disputes",
        headers: { authorization: `Bearer ${bearer(worker)}` },
        payload: {
          taskId: task.id,
          submissionId: submission.id,
          reasonMd: "seed dispute for reopen/open race"
        }
      });
      expect(firstDisputeRes.statusCode).toBe(200);
      const seededDispute = firstDisputeRes.json() as { id: string };

      for (const supervisor of supervisors) {
        const voteRes = await app!.inject({
          method: "POST",
          url: `/v2/disputes/${seededDispute.id}/votes`,
          headers: { authorization: `Bearer ${bearer(supervisor)}` },
          payload: { vote: VoteChoice.COMPLETED }
        });
        expect(voteRes.statusCode).toBe(200);
      }

      await forceAutoCloseCurrentCycle();

      // Simulate legacy/manual replay where the submission was reverted back to REJECTED.
      const prisma = new PrismaClient({
        datasources: {
          db: {
            url: TEST_DB_URL!
          }
        }
      });
      await prisma.submission.update({
        where: { id: submission.id },
        data: { status: "REJECTED" }
      });
      await prisma.$disconnect();

      const openAttempts = Array.from({ length: 40 }).map(() =>
        app!.inject({
          method: "POST",
          url: "/v2/disputes",
          headers: { authorization: `Bearer ${bearer(publisher)}` },
          payload: {
            taskId: task.id,
            submissionId: submission.id,
            reasonMd: "race between duplicate opens"
          }
        })
      );

      const attempts = await Promise.all(openAttempts);
      const success = attempts.filter((item) => item.statusCode === 200).length;
      const conflicts = attempts.filter((item) => item.statusCode === 409);
      const unexpected = attempts.filter((item) => ![200, 409].includes(item.statusCode));
      expect(unexpected).toHaveLength(0);
      expect(success).toBe(1);
      expect(conflicts).toHaveLength(attempts.length - 1);
      for (const response of conflicts) {
        expect(errorCode(response.json())).toBe("OPEN_DISPUTE_ALREADY_EXISTS");
      }

      const prismaVerify = new PrismaClient({
        datasources: {
          db: {
            url: TEST_DB_URL!
          }
        }
      });
      const openDisputeCount = await prismaVerify.dispute.count({
        where: {
          submissionId: submission.id,
          status: "OPEN"
        }
      });
      await prismaVerify.$disconnect();
      expect(openDisputeCount).toBe(1);
    },
    30_000
  );

  it("serves filtered persistence-mode list reads and dashboard aggregates directly from DB queries", async () => {
    const publisherA = addr("persist-read-a");
    const publisherB = addr("persist-read-b");
    const worker = addr("persist-read-worker");
    const supervisor = addr("persist-read-supervisor");
    const inactive = addr("persist-read-idle");

    const createTask = async (publisher: Address, title: string, rewardPerSlot: number) => {
      const response = await app!.inject({
        method: "POST",
        url: "/v2/tasks",
        headers: { authorization: `Bearer ${bearer(publisher)}` },
        payload: {
          title,
          descriptionMd: "desc",
          acceptanceCriteria: "criteria",
          deadlineUtc: futureDeadline(),
          displayTimezone: "UTC",
          slotsTotal: 1,
          rewardPerSlot,
          allowRepeatCompletionsBySameAgent: false
        }
      });
      expect(response.statusCode).toBe(200);
      return response.json() as { id: string };
    };

    const alpha = await createTask(publisherA, "alpha-open", 5);
    const beta = await createTask(publisherA, "beta-dispute", 20);
    const delta = await createTask(publisherA, "delta-terminated", 30);
    const gamma = await createTask(publisherB, "gamma-closed", 40);

    const acceptBetaRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${beta.id}/intentions`,
      headers: { authorization: `Bearer ${bearer(worker)}` }
    });
    expect(acceptBetaRes.statusCode).toBe(200);

    const betaSubmissionRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${beta.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: { payloadMd: "beta result" }
    });
    expect(betaSubmissionRes.statusCode).toBe(200);
    const betaSubmission = betaSubmissionRes.json() as { id: string };
    await rejectSubmission(betaSubmission.id, publisherA);

    const disputeRes = await app!.inject({
      method: "POST",
      url: "/v2/disputes",
      headers: { authorization: `Bearer ${bearer(publisherA)}` },
      payload: {
        taskId: beta.id,
        submissionId: betaSubmission.id,
        reasonMd: "beta review"
      }
    });
    expect(disputeRes.statusCode).toBe(200);
    const dispute = disputeRes.json() as { id: string };

    const voteRes = await app!.inject({
      method: "POST",
      url: `/v2/disputes/${dispute.id}/votes`,
      headers: { authorization: `Bearer ${bearer(supervisor)}` },
      payload: { vote: VoteChoice.COMPLETED }
    });
    expect(voteRes.statusCode).toBe(200);

    const acceptGammaRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${gamma.id}/intentions`,
      headers: { authorization: `Bearer ${bearer(worker)}` }
    });
    expect(acceptGammaRes.statusCode).toBe(200);

    const gammaSubmissionRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${gamma.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: { payloadMd: "gamma result" }
    });
    expect(gammaSubmissionRes.statusCode).toBe(200);
    const gammaSubmission = gammaSubmissionRes.json() as { id: string };

    const confirmGammaRes = await app!.inject({
      method: "POST",
      url: `/v2/submissions/${gammaSubmission.id}/confirm`,
      headers: { authorization: `Bearer ${bearer(publisherB)}` }
    });
    expect(confirmGammaRes.statusCode).toBe(200);

    const terminateDeltaRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${delta.id}/terminate`,
      headers: { authorization: `Bearer ${bearer(publisherA)}` }
    });
    expect(terminateDeltaRes.statusCode).toBe(200);

    const inactiveProfileRes = await app!.inject({
      method: "PATCH",
      url: `/v2/agents/${inactive}/profile`,
      headers: { authorization: `Bearer ${bearer(inactive)}` },
      payload: {
        name: "DormantReader"
      }
    });
    expect(inactiveProfileRes.statusCode).toBe(200);

    const tasksPageOneRes = await app!.inject({
      method: "GET",
      url: `/v2/tasks?publisher=${publisherA}&sort=reward&order=desc&limit=2`
    });
    expect(tasksPageOneRes.statusCode).toBe(200);
    const tasksPageOne = tasksPageOneRes.json() as {
      items: Array<{ id: string }>;
      nextCursor: string | null;
    };
    expect(tasksPageOne.items.map((item) => item.id)).toEqual([delta.id, beta.id]);
    expect(parseCursorOffset(tasksPageOne.nextCursor ?? undefined)).toBe(2);

    const tasksPageTwoRes = await app!.inject({
      method: "GET",
      url: `/v2/tasks?publisher=${publisherA}&sort=reward&order=desc&limit=2&cursor=${tasksPageOne.nextCursor}`
    });
    expect(tasksPageTwoRes.statusCode).toBe(200);
    const tasksPageTwo = tasksPageTwoRes.json() as {
      items: Array<{ id: string }>;
      nextCursor: string | null;
    };
    expect(tasksPageTwo.items.map((item) => item.id)).toEqual([alpha.id]);
    expect(tasksPageTwo.nextCursor).toBeNull();

    const alphaFilterRes = await app!.inject({
      method: "GET",
      url: "/v2/tasks?q=alpha&status=OPEN&limit=10"
    });
    expect(alphaFilterRes.statusCode).toBe(200);
    const alphaFilter = alphaFilterRes.json() as {
      items: Array<{ id: string }>;
    };
    expect(alphaFilter.items.map((item) => item.id)).toEqual([alpha.id]);

    const disputesListRes = await app!.inject({
      method: "GET",
      url: `/v2/disputes?taskId=${beta.id}&status=OPEN&opener=${publisherA}&limit=10`
    });
    expect(disputesListRes.statusCode).toBe(200);
    const disputesList = disputesListRes.json() as {
      items: Array<{ id: string }>;
      nextCursor: string | null;
    };
    expect(disputesList.items.map((item) => item.id)).toEqual([dispute.id]);
    expect(disputesList.nextCursor).toBeNull();

    const activitiesPageOneRes = await app!.inject({
      method: "GET",
      url: `/v2/activities?taskId=${beta.id}&order=asc&limit=2`
    });
    expect(activitiesPageOneRes.statusCode).toBe(200);
    const activitiesPageOne = activitiesPageOneRes.json() as {
      items: Array<{ type: string }>;
      nextCursor: string | null;
    };
    expect(activitiesPageOne.items.map((item) => item.type)).toEqual([
      "TASK_PUBLISHED",
      "TASK_INTENDED"
    ]);
    expect(parseCursorOffset(activitiesPageOne.nextCursor ?? undefined)).toBe(2);

    const activitiesPageTwoRes = await app!.inject({
      method: "GET",
      url: `/v2/activities?taskId=${beta.id}&order=asc&limit=2&cursor=${activitiesPageOne.nextCursor}`
    });
    expect(activitiesPageTwoRes.statusCode).toBe(200);
    const activitiesPageTwo = activitiesPageTwoRes.json() as {
      items: Array<{ type: string }>;
      nextCursor: string | null;
    };
    expect(activitiesPageTwo.items.map((item) => item.type)).toEqual([
      "TASK_SUBMITTED",
      "SUBMISSION_REJECTED"
    ]);
    expect(parseCursorOffset(activitiesPageTwo.nextCursor ?? undefined)).toBe(4);

    const activitiesPageThreeRes = await app!.inject({
      method: "GET",
      url: `/v2/activities?taskId=${beta.id}&order=asc&limit=2&cursor=${activitiesPageTwo.nextCursor}`
    });
    expect(activitiesPageThreeRes.statusCode).toBe(200);
    const activitiesPageThree = activitiesPageThreeRes.json() as {
      items: Array<{ type: string }>;
      nextCursor: string | null;
    };
    expect(activitiesPageThree.items.map((item) => item.type)).toEqual(["DISPUTE_OPENED"]);
    expect(activitiesPageThree.nextCursor).toBeNull();

    const dormantAgentsRes = await app!.inject({
      method: "GET",
      url: "/v2/agents?q=DormantReader&activeOnly=false&limit=10"
    });
    expect(dormantAgentsRes.statusCode).toBe(200);
    const dormantAgents = dormantAgentsRes.json() as {
      items: Array<{ address: string; isActive: boolean; name: string }>;
    };
    expect(dormantAgents.items).toHaveLength(1);
    expect(dormantAgents.items[0]).toMatchObject({
      address: inactive,
      name: "DormantReader",
      isActive: false
    });

    const summaryRes = await app!.inject({
      method: "GET",
      url: "/v2/dashboard/summary?tz=UTC"
    });
    expect(summaryRes.statusCode).toBe(200);
    const summary = summaryRes.json() as {
      currentCycle: {
        tasksPublished: number;
        tasksIntented: number;
        tasksCompleted: number;
        disputesOpened: number;
      };
      totals: { tasks: number; disputes: number; agents: number };
    };
    expect(summary.currentCycle).toEqual({
      tasksPublished: 4,
      tasksIntented: 2,
      tasksCompleted: 1,
      disputesOpened: 1
    });
    expect(summary.totals).toEqual({
      tasks: 4,
      disputes: 1,
      agents: 5
    });

    const trendsRes = await app!.inject({
      method: "GET",
      url: "/v2/dashboard/trends?tz=UTC&window=7d"
    });
    expect(trendsRes.statusCode).toBe(200);
    const trends = trendsRes.json() as {
      points: Array<{
        tasksPublished: number;
        tasksIntented: number;
        tasksCompleted: number;
        disputesOpened: number;
      }>;
    };
    expect(trends.points).toHaveLength(7);
    expect(trends.points.reduce((sum, item) => sum + item.tasksPublished, 0)).toBe(4);
    expect(trends.points.reduce((sum, item) => sum + item.tasksIntented, 0)).toBe(2);
    expect(trends.points.reduce((sum, item) => sum + item.tasksCompleted, 0)).toBe(1);
    expect(trends.points.reduce((sum, item) => sum + item.disputesOpened, 0)).toBe(1);

    const losAngelesTrendsRes = await app!.inject({
      method: "GET",
      url: "/v2/dashboard/trends?tz=America/Los_Angeles&window=7d"
    });
    expect(losAngelesTrendsRes.statusCode).toBe(200);
    const losAngelesTrends = losAngelesTrendsRes.json() as {
      points: Array<{ bucketStart: string; label: string }>;
    };
    for (const point of losAngelesTrends.points) {
      expect(point.bucketStart).toBe(
        dayKeyToUtcStart(point.label, "America/Los_Angeles").toISOString()
      );
    }

    const shanghaiTrendsRes = await app!.inject({
      method: "GET",
      url: "/v2/dashboard/trends?tz=Asia/Shanghai&window=7d"
    });
    expect(shanghaiTrendsRes.statusCode).toBe(200);
    const shanghaiTrends = shanghaiTrendsRes.json() as {
      points: Array<{
        bucketStart: string;
        label: string;
        tasksPublished: number;
        tasksIntented: number;
        tasksCompleted: number;
        disputesOpened: number;
      }>;
    };
    expect(shanghaiTrends.points).toHaveLength(7);
    for (const point of shanghaiTrends.points) {
      expect(point.bucketStart).toBe(
        dayKeyToUtcStart(point.label, "Asia/Shanghai").toISOString()
      );
    }
    expect(shanghaiTrends.points.reduce((sum, item) => sum + item.tasksPublished, 0)).toBe(4);
    expect(shanghaiTrends.points.reduce((sum, item) => sum + item.tasksIntented, 0)).toBe(2);
    expect(shanghaiTrends.points.reduce((sum, item) => sum + item.tasksCompleted, 0)).toBe(1);
    expect(shanghaiTrends.points.reduce((sum, item) => sum + item.disputesOpened, 0)).toBe(1);
  });

  it("groups account todos across action-required and waiting scopes in persistence mode", async () => {
    const target = addr("persist-todo-target");
    const otherPublisher = addr("persist-todo-other-publisher");
    const workerB = addr("ptw-b");
    const workerC = addr("ptw-c");

    const createTask = async (
      publisher: Address,
      input: { title: string; slotsTotal?: number }
    ) => {
      const response = await app!.inject({
        method: "POST",
        url: "/v2/tasks",
        headers: { authorization: `Bearer ${bearer(publisher)}` },
        payload: {
          title: input.title,
          descriptionMd: `${input.title}-desc`,
          acceptanceCriteria: `${input.title}-criteria`,
          deadlineUtc: futureDeadline(),
          displayTimezone: "UTC",
          slotsTotal: input.slotsTotal ?? 1,
          rewardPerSlot: 10,
          allowRepeatCompletionsBySameAgent: false
        }
      });
      expect(response.statusCode).toBe(200);
      return response.json() as { id: string };
    };

    const addIntention = async (taskId: string, agent: Address) => {
      const response = await app!.inject({
        method: "POST",
        url: `/v2/tasks/${taskId}/intentions`,
        headers: { authorization: `Bearer ${bearer(agent)}` }
      });
      expect(response.statusCode).toBe(200);
    };

    const submitTask = async (taskId: string, agent: Address, payloadMd: string) => {
      const response = await app!.inject({
        method: "POST",
        url: `/v2/tasks/${taskId}/submissions`,
        headers: { authorization: `Bearer ${bearer(agent)}` },
        payload: { payloadMd }
      });
      expect(response.statusCode).toBe(200);
      return response.json() as { id: string };
    };

    const openDispute = async (taskId: string, submissionId: string, opener: Address) => {
      const response = await app!.inject({
        method: "POST",
        url: "/v2/disputes",
        headers: { authorization: `Bearer ${bearer(opener)}` },
        payload: { taskId, submissionId, reasonMd: "todo dispute" }
      });
      expect(response.statusCode).toBe(200);
      return response.json() as { id: string };
    };

    const rejectedTask = await createTask(otherPublisher, { title: "persist-todo-rejected" });
    await addIntention(rejectedTask.id, target);
    const rejectedSubmission = await submitTask(rejectedTask.id, target, "todo rejected");
    await rejectSubmission(rejectedSubmission.id, otherPublisher);

    const counterpartyTask = await createTask(target, { title: "persist-todo-counterparty" });
    await addIntention(counterpartyTask.id, workerB);
    const counterpartySubmission = await submitTask(counterpartyTask.id, workerB, "needs review");
    await rejectSubmission(counterpartySubmission.id, target);
    await openDispute(counterpartyTask.id, counterpartySubmission.id, workerB);

    const pendingReviewTask = await createTask(target, {
      title: "persist-todo-pending-review",
      slotsTotal: 2
    });
    await addIntention(pendingReviewTask.id, workerB);
    const pendingSubmissionA = await submitTask(pendingReviewTask.id, workerB, "pending a");
    await addIntention(pendingReviewTask.id, workerC);
    const pendingSubmissionB = await submitTask(pendingReviewTask.id, workerC, "pending b");

    const expiredTask = await createTask(target, { title: "persist-todo-expired" });
    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: TEST_DB_URL!
        }
      }
    });
    await prisma.task.update({
      where: { id: expiredTask.id },
      data: { deadlineUtc: new Date(Date.now() - 60_000) }
    });
    await prisma.$disconnect();

    const intendedTask = await createTask(otherPublisher, { title: "persist-todo-intended" });
    await addIntention(intendedTask.id, target);

    const waitingReviewTask = await createTask(otherPublisher, { title: "persist-todo-waiting-review" });
    await addIntention(waitingReviewTask.id, target);
    const waitingSubmission = await submitTask(waitingReviewTask.id, target, "awaiting publisher");

    const waitingNewSubmissionTask = await createTask(target, { title: "persist-todo-waiting-new" });

    const waitingResolutionTask = await createTask(otherPublisher, {
      title: "persist-todo-waiting-resolution"
    });
    await addIntention(waitingResolutionTask.id, target);
    const waitingResolutionSubmission = await submitTask(waitingResolutionTask.id, target, "open dispute");
    await rejectSubmission(waitingResolutionSubmission.id, otherPublisher);
    const waitingResolutionDispute = await openDispute(
      waitingResolutionTask.id,
      waitingResolutionSubmission.id,
      target
    );

    const response = await app!.inject({
      method: "GET",
      url: `/v2/todos/${target}?scope=all&limit=1`
    });
    expect(response.statusCode).toBe(200);
    const payload = response.json() as {
      address: string;
      groups: Array<{
        type: string;
        title: string;
        description: string;
        totalCount: number;
        nextCursor: string | null;
        items: Array<{ taskId: string; submissionId: string | null; disputeId: string | null }>;
      }>;
    };
    expect(payload.address).toBe(target);
    expect(payload.groups).toHaveLength(8);

    const groups = new Map(payload.groups.map((group) => [group.type, group]));
    expect(groups.get("latest_rejected_submission_no_followup")?.items[0]?.submissionId).toBe(rejectedSubmission.id);
    expect(groups.get("open_dispute_counterparty_response_required")?.totalCount).toBe(1);
    expect(groups.get("published_task_submission_pending_review")?.totalCount).toBe(2);
    expect(groups.get("published_task_submission_pending_review")?.nextCursor).not.toBeNull();
    expect(groups.get("expired_published_task_cleanup_required")?.items[0]?.taskId).toBe(expiredTask.id);
    expect(groups.get("intended_task_never_submitted")?.items[0]?.taskId).toBe(intendedTask.id);
    expect(groups.get("submitted_submission_waiting_review")?.items[0]?.submissionId).toBe(waitingSubmission.id);
    expect(groups.get("published_task_waiting_new_submission")?.items[0]?.taskId).toBe(waitingNewSubmissionTask.id);
    expect(groups.get("open_dispute_waiting_resolution")?.items[0]?.disputeId).toBe(waitingResolutionDispute.id);
    expect(groups.get("open_dispute_waiting_resolution")?.title.length).toBeGreaterThan(0);
    expect(groups.get("open_dispute_waiting_resolution")?.description.length).toBeGreaterThan(0);

    const pageOne = await app!.inject({
      method: "GET",
      url: `/v2/todos/${target}?scope=action_required&type=published_task_submission_pending_review&limit=1`
    });
    expect(pageOne.statusCode).toBe(200);
    const pageOnePayload = pageOne.json() as {
      groups: Array<{
        totalCount: number;
        nextCursor: string | null;
        items: Array<{ submissionId: string | null }>;
      }>;
    };
    expect(pageOnePayload.groups[0]?.totalCount).toBe(2);
    expect(pageOnePayload.groups[0]?.nextCursor).not.toBeNull();
    expect([pendingSubmissionA.id, pendingSubmissionB.id]).toContain(
      pageOnePayload.groups[0]?.items[0]?.submissionId
    );

    const pageTwo = await app!.inject({
      method: "GET",
      url: `/v2/todos/${target}?scope=action_required&type=published_task_submission_pending_review&cursor=${encodeURIComponent(pageOnePayload.groups[0]!.nextCursor!)}&limit=1`
    });
    expect(pageTwo.statusCode).toBe(200);
    const pageTwoPayload = pageTwo.json() as {
      groups: Array<{
        totalCount: number;
        nextCursor: string | null;
        items: Array<{ submissionId: string | null; updatedAt: string }>;
      }>;
    };
    expect(pageTwoPayload.groups[0]?.items).toHaveLength(1);
    expect(pageTwoPayload.groups[0]?.items[0]?.submissionId).not.toBe(
      pageOnePayload.groups[0]?.items[0]?.submissionId
    );
    expect(pageTwoPayload.groups[0]?.totalCount).toBe(2);

    const exhaustedCursor = encodeKeysetCursor({
      resource: "todos:published_task_submission_pending_review",
      sort: "updatedAt",
      order: "desc",
      offset: 2,
      values: {
        primary: pageTwoPayload.groups[0]!.items[0]!.updatedAt,
        id: pageTwoPayload.groups[0]!.items[0]!.submissionId!
      }
    });
    const exhaustedPage = await app!.inject({
      method: "GET",
      url: `/v2/todos/${target}?scope=action_required&type=published_task_submission_pending_review&cursor=${encodeURIComponent(exhaustedCursor)}&limit=1`
    });
    expect(exhaustedPage.statusCode).toBe(200);
    const exhaustedPayload = exhaustedPage.json() as {
      groups: Array<{ totalCount: number; nextCursor: string | null; items: unknown[] }>;
    };
    expect(exhaustedPayload.groups[0]?.totalCount).toBe(2);
    expect(exhaustedPayload.groups[0]?.items).toHaveLength(0);
    expect(exhaustedPayload.groups[0]?.nextCursor).toBeNull();

    const invalidCursor = await app!.inject({
      method: "GET",
      url: `/v2/todos/${target}?scope=all&cursor=forbidden-without-type`
    });
    expect(invalidCursor.statusCode).toBe(400);
    expect(errorCode(invalidCursor.json())).toBe("VALIDATION_ERROR");

    const invalidScopeType = await app!.inject({
      method: "GET",
      url: `/v2/todos/${target}?scope=waiting&type=published_task_submission_pending_review`
    });
    expect(invalidScopeType.statusCode).toBe(400);
    expect(errorCode(invalidScopeType.json())).toBe("VALIDATION_ERROR");
  });

  it("rejects removed dispute status enum values in persistence-mode query parameters", async () => {
    const response = await app!.inject({
      method: "GET",
      url: "/v2/disputes?status=RESOLVED_NOT_COMPLETED"
    });
    expect(response.statusCode).toBe(400);
    expect(errorCode(response.json())).toBe("VALIDATION_ERROR");
  });

  it("keeps keyset cursor pagination stable after inserts while accepting legacy offset cursors", async () => {
    const publisher = addr("p-keyset-stable");
    const createTask = async (title: string, rewardPerSlot: number): Promise<string> => {
      const res = await app!.inject({
        method: "POST",
        url: "/v2/tasks",
        headers: { authorization: `Bearer ${bearer(publisher)}` },
        payload: {
          title,
          descriptionMd: "desc",
          acceptanceCriteria: "ok",
          deadlineUtc: futureDeadline(),
          displayTimezone: "UTC",
          slotsTotal: 1,
          rewardPerSlot,
          allowRepeatCompletionsBySameAgent: false
        }
      });
      expect(res.statusCode).toBe(200);
      return (res.json() as { id: string }).id;
    };

    const lowReward = await createTask("stable-low", 10);
    const midReward = await createTask("stable-mid", 20);
    const highReward = await createTask("stable-high", 30);

    const pageOneRes = await app!.inject({
      method: "GET",
      url: `/v2/tasks?publisher=${publisher}&sort=reward&order=desc&limit=2`
    });
    expect(pageOneRes.statusCode).toBe(200);
    const pageOne = pageOneRes.json() as {
      items: Array<{ id: string }>;
      nextCursor: string | null;
    };
    expect(pageOne.items.map((item) => item.id)).toEqual([highReward, midReward]);
    expect(pageOne.nextCursor).not.toBeNull();
    expect(parseCursorOffset(pageOne.nextCursor ?? undefined)).toBe(2);

    await createTask("stable-new-top", 100);

    const keysetPageTwoRes = await app!.inject({
      method: "GET",
      url: `/v2/tasks?publisher=${publisher}&sort=reward&order=desc&limit=2&cursor=${pageOne.nextCursor}`
    });
    expect(keysetPageTwoRes.statusCode).toBe(200);
    const keysetPageTwo = keysetPageTwoRes.json() as {
      items: Array<{ id: string }>;
      nextCursor: string | null;
    };
    expect(keysetPageTwo.items.map((item) => item.id)).toEqual([lowReward]);
    expect(keysetPageTwo.nextCursor).toBeNull();

    const legacyPageTwoRes = await app!.inject({
      method: "GET",
      url: `/v2/tasks?publisher=${publisher}&sort=reward&order=desc&limit=2&cursor=2`
    });
    expect(legacyPageTwoRes.statusCode).toBe(200);
    const legacyPageTwo = legacyPageTwoRes.json() as {
      items: Array<{ id: string }>;
    };
    expect(legacyPageTwo.items.some((item) => item.id === lowReward)).toBe(true);
  });
});
