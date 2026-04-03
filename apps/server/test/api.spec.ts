import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import type { Address } from "@agentrade/types";
import { VoteChoice } from "@agentrade/types";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

const addr = (seed: string): Address =>
  `0x${Buffer.from(seed).toString("hex").slice(0, 40).padEnd(40, "0")}` as Address;
const futureDeadline = (hours = 24): string =>
  new Date(Date.now() + hours * 3_600_000).toISOString();
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

describe("API integration", () => {
  let app: FastifyInstance | null = null;
  const secret = "test-jwt-secret";
  const adminKey = "test-admin-key";
  const oldEnv = { ...process.env };

  beforeAll(() => {
    process.env.JWT_SECRET = secret;
    process.env.ADMIN_SERVICE_KEY = adminKey;
    process.env.ENABLE_PERSISTENCE = "false";
    process.env.ENABLE_REDIS_RATE_LIMIT = "false";
    process.env.TASK_TITLE_MAX_LENGTH = "120";
    process.env.TASK_DESCRIPTION_MAX_LENGTH = "20000";
    process.env.TASK_ACCEPTANCE_CRITERIA_MAX_LENGTH = "8000";
    process.env.TASK_SUBMISSION_PAYLOAD_MAX_LENGTH = "20000";
    process.env.DISPUTE_REASON_MAX_LENGTH = "4000";
    process.env.TASK_SLOTS_MAX = "100";
    process.env.TASK_REWARD_PER_SLOT_MAX = "1000000";
    process.env.TASK_DEADLINE_MAX_HOURS = "4320";
  });

  beforeEach(async () => {
    process.env.RATE_LIMIT_PER_MINUTE = "10000";
    process.env.RATE_LIMIT_BURST = "10000";
    app = await buildApp();
    await app.ready();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  afterAll(async () => {
    process.env = oldEnv;
  });

  const bearer = (address: Address): string => jwt.sign({ sub: address }, secret, { expiresIn: "1h" });

  const createSingleSlotTask = async (publisher: Address) => {
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
    expect(taskRes.statusCode).toBe(200);
    return taskRes.json() as { id: string };
  };

  const rejectSubmission = async (submissionId: string, publisher: Address) => {
    const rejectRes = await app!.inject({
      method: "POST",
      url: `/v2/submissions/${submissionId}/reject`,
      headers: { authorization: `Bearer ${bearer(publisher)}` }
    });
    expect(rejectRes.statusCode).toBe(200);
  };

  it("rejects unauthenticated write requests", async () => {
    const response = await app!.inject({
      method: "POST",
      url: "/v2/tasks",
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
    expect(response.statusCode).toBe(401);
  });

  it("redirects versionless API requests to the configured default version", async () => {
    const response = await app!.inject({
      method: "GET",
      url: "/tasks?limit=3"
    });
    expect(response.statusCode).toBe(307);
    expect(response.headers.location).toBe("/v2/tasks?limit=3");
  });

  it("preserves forwarded API path prefix when redirecting versionless requests", async () => {
    const response = await app!.inject({
      method: "GET",
      url: "/tasks?limit=2",
      headers: {
        "x-forwarded-prefix": "/api"
      }
    });
    expect(response.statusCode).toBe(307);
    expect(response.headers.location).toBe("/api/v2/tasks?limit=2");
  });

  it("returns a structured error for unsupported API versions", async () => {
    const response = await app!.inject({
      method: "GET",
      url: "/v9/tasks"
    });
    expect(response.statusCode).toBe(400);
    expect(errorCode(response.json())).toBe("API_VERSION_UNSUPPORTED");
    expect(
      (response.json() as { error: { message: string } }).error.message
    ).toContain("unsupported api version 'v9'");
  });

  it("rejects task creation with past deadline", async () => {
    const publisher = addr("val-deadline-1");
    const response = await app!.inject({
      method: "POST",
      url: "/v2/tasks",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        title: "task",
        descriptionMd: "desc",
        acceptanceCriteria: "criteria",
        deadlineUtc: "2020-01-01T00:00:00.000Z",
        displayTimezone: "UTC",
        slotsTotal: 1,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: false
      }
    });
    expect(response.statusCode).toBe(400);
    expect(errorCode(response.json())).toBe("INVALID_DEADLINE");
  });

  it("rejects task creation with deadline beyond configured horizon", async () => {
    const publisher = addr("val-deadline-2");
    const response = await app!.inject({
      method: "POST",
      url: "/v2/tasks",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        title: "task",
        descriptionMd: "desc",
        acceptanceCriteria: "criteria",
        deadlineUtc: new Date(Date.now() + 5_000 * 3_600_000).toISOString(),
        displayTimezone: "UTC",
        slotsTotal: 1,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: false
      }
    });
    expect(response.statusCode).toBe(400);
    expect(errorCode(response.json())).toBe("INVALID_DEADLINE");
  });

  it("rejects task creation with invalid timezone", async () => {
    const publisher = addr("val-timezone-1");
    const response = await app!.inject({
      method: "POST",
      url: "/v2/tasks",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        title: "task",
        descriptionMd: "desc",
        acceptanceCriteria: "criteria",
        deadlineUtc: futureDeadline(),
        displayTimezone: "Mars/OlympusMons",
        slotsTotal: 1,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: false
      }
    });
    expect(response.statusCode).toBe(400);
    expect(errorCode(response.json())).toBe("VALIDATION_ERROR");
  });

  it("rejects task creation when slots exceed configured max range", async () => {
    const publisher = addr("val-slots-1");
    const response = await app!.inject({
      method: "POST",
      url: "/v2/tasks",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        title: "task",
        descriptionMd: "desc",
        acceptanceCriteria: "criteria",
        deadlineUtc: futureDeadline(),
        displayTimezone: "UTC",
        slotsTotal: 101,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: false
      }
    });
    expect(response.statusCode).toBe(400);
    expect(errorCode(response.json())).toBe("VALIDATION_ERROR");
  });

  it("rejects task creation when AgentCoin budget exceeds available balance", async () => {
    const publisher = addr("val-budget-1");
    const response = await app!.inject({
      method: "POST",
      url: "/v2/tasks",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        title: "expensive-task",
        descriptionMd: "desc",
        acceptanceCriteria: "criteria",
        deadlineUtc: futureDeadline(),
        displayTimezone: "UTC",
        slotsTotal: 100,
        rewardPerSlot: 2_000,
        allowRepeatCompletionsBySameAgent: false
      }
    });
    expect(response.statusCode).toBe(409);
    expect(errorCode(response.json())).toBe("INSUFFICIENT_BALANCE");
  });

  it("rejects auth verify when challenge nonce or message mismatches", async () => {
    const address = addr("auth1");
    const challenge = await app!.inject({
      method: "POST",
      url: "/v2/auth/challenge",
      payload: { address }
    });
    expect(challenge.statusCode).toBe(200);
    const payload = challenge.json() as { nonce: string; message: string };

    const verify = await app!.inject({
      method: "POST",
      url: "/v2/auth/verify",
      payload: {
        address,
        nonce: `${payload.nonce}-tampered`,
        message: payload.message,
        signature: "0xdeadbeef"
      }
    });
    expect(verify.statusCode).toBe(401);
  });

  it("returns sanitized public economy params without runtime secrets", async () => {
    const response = await app!.inject({
      method: "GET",
      url: "/v2/economy/params"
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json() as Record<string, unknown>;
    expect(payload).toMatchObject({
      appName: "Agentrade",
      enablePersistence: false,
      enableRedisRateLimit: false,
      taskTitleMaxLength: 120,
      terminationPenaltyBps: 1000
    });
    expect(payload).not.toHaveProperty("host");
    expect(payload).not.toHaveProperty("port");
    expect(payload).not.toHaveProperty("databaseUrl");
    expect(payload).not.toHaveProperty("redisUrl");
    expect(payload).not.toHaveProperty("jwtSecret");
    expect(payload).not.toHaveProperty("adminServiceKey");
  });

  it("rejects invalid address format on auth challenge", async () => {
    const response = await app!.inject({
      method: "POST",
      url: "/v2/auth/challenge",
      payload: { address: "not-an-evm-address" }
    });
    expect(response.statusCode).toBe(400);
  });

  it("rejects expired challenge on auth verify", async () => {
    await app!.close();
    app = null;
    process.env.AUTH_CHALLENGE_TTL_MINUTES = "0";
    try {
      app = await buildApp();
      await app.ready();

      const address = addr("auth-expired");
      const challenge = await app.inject({
        method: "POST",
        url: "/v2/auth/challenge",
        payload: { address }
      });
      expect(challenge.statusCode).toBe(200);
      const payload = challenge.json() as { nonce: string; message: string };

      const verify = await app.inject({
        method: "POST",
        url: "/v2/auth/verify",
        payload: {
          address,
          nonce: payload.nonce,
          message: payload.message,
          signature: "0xdeadbeef"
        }
      });
      expect(verify.statusCode).toBe(401);
      expect((verify.json() as { error: { message: string } }).error.message).toMatch(/expired/i);
    } finally {
      delete process.env.AUTH_CHALLENGE_TTL_MINUTES;
    }
  });

  it("rejects bearer tokens with non-EVM subject addresses", async () => {
    const badToken = jwt.sign({ sub: "0xnothex" }, secret, { expiresIn: "1h" });
    const response = await app!.inject({
      method: "POST",
      url: "/v2/tasks",
      headers: { authorization: `Bearer ${badToken}` },
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
    expect(response.statusCode).toBe(401);
  });

  it("enforces IP rate limit and returns 429 after quota is exhausted", async () => {
    await app!.close();
    app = null;
    process.env.RATE_LIMIT_PER_MINUTE = "1";
    process.env.RATE_LIMIT_BURST = "0";
    app = await buildApp();
    await app.ready();

    const first = await app.inject({
      method: "GET",
      url: "/v2/tasks"
    });
    const second = await app.inject({
      method: "GET",
      url: "/v2/tasks"
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(429);
  });

  it("prevents oversell when two agents race for one slot", async () => {
    const publisher = addr("r1");
    const workerA = addr("r2");
    const workerB = addr("r3");
    const task = await createSingleSlotTask(publisher);

    const [acceptA, acceptB] = await Promise.all([
      app!.inject({
        method: "POST",
        url: `/v2/tasks/${task.id}/accept`,
        headers: { authorization: `Bearer ${bearer(workerA)}` }
      }),
      app!.inject({
        method: "POST",
        url: `/v2/tasks/${task.id}/accept`,
        headers: { authorization: `Bearer ${bearer(workerB)}` }
      })
    ]);
    const statuses = [acceptA.statusCode, acceptB.statusCode].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);
  });

  it("forbids non-publisher from confirming submission", async () => {
    const publisher = addr("f1");
    const worker = addr("f2");
    const outsider = addr("f3");
    const task = await createSingleSlotTask(publisher);

    const acceptRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/accept`,
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

    const confirmRes = await app!.inject({
      method: "POST",
      url: `/v2/submissions/${submission.id}/confirm`,
      headers: { authorization: `Bearer ${bearer(outsider)}` }
    });
    expect(confirmRes.statusCode).toBe(403);
  });

  it("rejects submission when task has been terminated", async () => {
    const publisher = addr("t1");
    const worker = addr("t2");
    const task = await createSingleSlotTask(publisher);

    const acceptRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/accept`,
      headers: { authorization: `Bearer ${bearer(worker)}` }
    });
    expect(acceptRes.statusCode).toBe(200);

    const terminateRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/terminate`,
      headers: { authorization: `Bearer ${bearer(publisher)}` }
    });
    expect(terminateRes.statusCode).toBe(200);

    const submitRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: { payloadMd: "late submit" }
    });
    expect(submitRes.statusCode).toBe(409);
  });

  it("rejects resubmission once task is closed", async () => {
    const publisher = addr("c1");
    const worker = addr("c2");
    const task = await createSingleSlotTask(publisher);

    const acceptRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/accept`,
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

    const confirmRes = await app!.inject({
      method: "POST",
      url: `/v2/submissions/${submission.id}/confirm`,
      headers: { authorization: `Bearer ${bearer(publisher)}` }
    });
    expect(confirmRes.statusCode).toBe(200);

    const resubmit = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: { payloadMd: "second submit" }
    });
    expect(resubmit.statusCode).toBe(409);
  });

  it("closes repeatable multi-slot task by confirmed slot count", async () => {
    await app!.close();
    app = null;
    process.env.RESUBMIT_COOLDOWN_MINUTES = "0";
    try {
      app = await buildApp();
      await app.ready();

    const publisher = addr("rp-api-1");
    const worker = addr("rp-api-2");
    const taskRes = await app!.inject({
      method: "POST",
      url: "/v2/tasks",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        title: "repeat-slots-task",
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
      url: `/v2/tasks/${task.id}/accept`,
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

    const accept2 = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/accept`,
      headers: { authorization: `Bearer ${bearer(worker)}` }
    });
    expect(accept2.statusCode).toBe(200);
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
    } finally {
      delete process.env.RESUBMIT_COOLDOWN_MINUTES;
    }
  });

  it("rejects dispute creation when submission is not rejected", async () => {
    const publisher = addr("dsp-api-1");
    const worker = addr("dsp-api-2");
    const task = await createSingleSlotTask(publisher);
    await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/accept`,
      headers: { authorization: `Bearer ${bearer(worker)}` }
    });
    const submitRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: { payloadMd: "result" }
    });
    expect(submitRes.statusCode).toBe(200);
    const submission = submitRes.json() as { id: string };

    const disputeRes = await app!.inject({
      method: "POST",
      url: "/v2/disputes",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        taskId: task.id,
        submissionId: submission.id,
        reasonMd: "must fail before rejection"
      }
    });
    expect(disputeRes.statusCode).toBe(409);
    expect(errorCode(disputeRes.json())).toBe("SUBMISSION_NOT_DISPUTABLE");
  });

  it("rejects dispute creation by non task-related agent", async () => {
    const publisher = addr("dsp-api-3");
    const worker = addr("dsp-api-4");
    const outsider = addr("dsp-api-5");
    const task = await createSingleSlotTask(publisher);
    await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/accept`,
      headers: { authorization: `Bearer ${bearer(worker)}` }
    });
    const submitRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: { payloadMd: "result" }
    });
    expect(submitRes.statusCode).toBe(200);
    const submission = submitRes.json() as { id: string };
    await rejectSubmission(submission.id, publisher);

    const disputeRes = await app!.inject({
      method: "POST",
      url: "/v2/disputes",
      headers: { authorization: `Bearer ${bearer(outsider)}` },
      payload: {
        taskId: task.id,
        submissionId: submission.id,
        reasonMd: "outsider should fail"
      }
    });
    expect(disputeRes.statusCode).toBe(403);
    expect(errorCode(disputeRes.json())).toBe("DISPUTE_FORBIDDEN_OPENER");
  });

  it("allows only one open dispute per submission under concurrent requests", async () => {
    const publisher = addr("dsp-api-6");
    const worker = addr("dsp-api-7");
    const task = await createSingleSlotTask(publisher);
    await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/accept`,
      headers: { authorization: `Bearer ${bearer(worker)}` }
    });
    const submitRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: { payloadMd: "result" }
    });
    expect(submitRes.statusCode).toBe(200);
    const submission = submitRes.json() as { id: string };
    await rejectSubmission(submission.id, publisher);

    const attempts = await Promise.all(
      Array.from({ length: 20 }).map(() =>
        app!.inject({
          method: "POST",
          url: "/v2/disputes",
          headers: { authorization: `Bearer ${bearer(publisher)}` },
          payload: {
            taskId: task.id,
            submissionId: submission.id,
            reasonMd: "duplicate open dispute race"
          }
        })
      )
    );
    const success = attempts.filter((item) => item.statusCode === 200).length;
    const conflicts = attempts.filter((item) => item.statusCode === 409).length;
    const unexpected = attempts.filter((item) => ![200, 409].includes(item.statusCode));
    expect(unexpected).toHaveLength(0);
    expect(success).toBe(1);
    expect(conflicts).toBe(19);
    for (const response of attempts.filter((item) => item.statusCode === 409)) {
      expect(errorCode(response.json())).toBe("OPEN_DISPUTE_ALREADY_EXISTS");
    }
  });

  it("returns 409 when the same agent votes twice for a dispute", async () => {
    const publisher = addr("a1");
    const worker = addr("b1");
    const supervisor = addr("c1");

    const task = await createSingleSlotTask(publisher);

    const acceptRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/accept`,
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

    const [vote1, vote2] = await Promise.all([
      app!.inject({
        method: "POST",
        url: `/v2/disputes/${dispute.id}/votes`,
        headers: { authorization: `Bearer ${bearer(supervisor)}` },
        payload: { vote: VoteChoice.COMPLETED }
      }),
      app!.inject({
        method: "POST",
        url: `/v2/disputes/${dispute.id}/votes`,
        headers: { authorization: `Bearer ${bearer(supervisor)}` },
        payload: { vote: VoteChoice.NOT_COMPLETED }
      })
    ]);

    const statuses = [vote1.statusCode, vote2.statusCode].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);
  });

  it("simulates a complex multi-party lifecycle with delayed dispute resolution across cycles", async () => {
    const publisher = addr("sim-pub-1");
    const workerA = addr("sim-worker-a");
    const workerB = addr("sim-worker-b");
    const supervisors = [
      addr("sim-sup-1"),
      addr("sim-sup-2"),
      addr("sim-sup-3"),
      addr("sim-sup-4"),
      addr("sim-sup-5")
    ];

    const taskRes = await app!.inject({
      method: "POST",
      url: "/v2/tasks",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        title: "complex-scenario-task",
        descriptionMd: "multi-step scenario",
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

    const workerBBeforeLedgerRes = await app!.inject({
      method: "GET",
      url: `/v2/ledger/${workerB}`
    });
    expect(workerBBeforeLedgerRes.statusCode).toBe(200);
    const workerBBefore = (workerBBeforeLedgerRes.json() as { available: number }).available;

    for (const worker of [workerA, workerB]) {
      const acceptRes = await app!.inject({
        method: "POST",
        url: `/v2/tasks/${task.id}/accept`,
        headers: { authorization: `Bearer ${bearer(worker)}` }
      });
      expect(acceptRes.statusCode).toBe(200);
    }

    const submissionARes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(workerA)}` },
      payload: { payloadMd: "worker-a-result" }
    });
    expect(submissionARes.statusCode).toBe(200);
    const submissionA = submissionARes.json() as { id: string };

    const submissionBRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(workerB)}` },
      payload: { payloadMd: "worker-b-result" }
    });
    expect(submissionBRes.statusCode).toBe(200);
    const submissionB = submissionBRes.json() as { id: string };

    const confirmARes = await app!.inject({
      method: "POST",
      url: `/v2/submissions/${submissionA.id}/confirm`,
      headers: { authorization: `Bearer ${bearer(publisher)}` }
    });
    expect(confirmARes.statusCode).toBe(200);

    const rejectBRes = await app!.inject({
      method: "POST",
      url: `/v2/submissions/${submissionB.id}/reject`,
      headers: { authorization: `Bearer ${bearer(publisher)}` }
    });
    expect(rejectBRes.statusCode).toBe(200);

    const disputeRes = await app!.inject({
      method: "POST",
      url: "/v2/disputes",
      headers: { authorization: `Bearer ${bearer(workerB)}` },
      payload: {
        taskId: task.id,
        submissionId: submissionB.id,
        reasonMd: "publisher rejected but work claims complete"
      }
    });
    expect(disputeRes.statusCode).toBe(200);
    const dispute = disputeRes.json() as { id: string };

    for (const supervisor of supervisors.slice(0, 2)) {
      const voteRes = await app!.inject({
        method: "POST",
        url: `/v2/disputes/${dispute.id}/votes`,
        headers: { authorization: `Bearer ${bearer(supervisor)}` },
        payload: { vote: VoteChoice.NOT_COMPLETED }
      });
      expect(voteRes.statusCode).toBe(200);
    }

    const closeCycle1Res = await app!.inject({
      method: "POST",
      url: "/v2/admin/cycles/close",
      headers: { "x-admin-service-key": adminKey }
    });
    expect(closeCycle1Res.statusCode).toBe(200);
    const closeCycle1 = closeCycle1Res.json() as { finalizedDisputes: string[] };
    expect(closeCycle1.finalizedDisputes).toHaveLength(0);

    for (const supervisor of supervisors.slice(2)) {
      const voteRes = await app!.inject({
        method: "POST",
        url: `/v2/disputes/${dispute.id}/votes`,
        headers: { authorization: `Bearer ${bearer(supervisor)}` },
        payload: { vote: VoteChoice.COMPLETED }
      });
      expect(voteRes.statusCode).toBe(200);
    }

    const closeCycle2Res = await app!.inject({
      method: "POST",
      url: "/v2/admin/cycles/close",
      headers: { "x-admin-service-key": adminKey }
    });
    expect(closeCycle2Res.statusCode).toBe(200);
    const closeCycle2 = closeCycle2Res.json() as { finalizedDisputes: string[] };
    expect(closeCycle2.finalizedDisputes).toContain(dispute.id);

    const taskAfterRes = await app!.inject({
      method: "GET",
      url: `/v2/tasks/${task.id}`
    });
    expect(taskAfterRes.statusCode).toBe(200);
    const taskAfter = taskAfterRes.json() as { status: string; rewardEscrowRemaining: number };
    expect(taskAfter.status).toBe("CLOSED");
    expect(taskAfter.rewardEscrowRemaining).toBe(0);

    const submissionBAfterRes = await app!.inject({
      method: "GET",
      url: `/v2/disputes/${dispute.id}`
    });
    expect(submissionBAfterRes.statusCode).toBe(200);
    const disputeAfter = submissionBAfterRes.json() as { status: string };
    expect(disputeAfter.status).toBe("RESOLVED_COMPLETED");

    const workerBAfterLedgerRes = await app!.inject({
      method: "GET",
      url: `/v2/ledger/${workerB}`
    });
    expect(workerBAfterLedgerRes.statusCode).toBe(200);
    const workerBAfter = (workerBAfterLedgerRes.json() as { available: number }).available;
    expect(workerBAfter - workerBBefore).toBe(10);

    const voteAfterResolvedRes = await app!.inject({
      method: "POST",
      url: `/v2/disputes/${dispute.id}/votes`,
      headers: { authorization: `Bearer ${bearer(addr("sim-sup-late"))}` },
      payload: { vote: VoteChoice.COMPLETED }
    });
    expect(voteAfterResolvedRes.statusCode).toBe(409);
  });

  it("keeps payout idempotent when publisher sends duplicate confirm requests", async () => {
    const publisher = addr("idem-pub");
    const worker = addr("idem-worker");
    const task = await createSingleSlotTask(publisher);

    const workerBeforeRes = await app!.inject({
      method: "GET",
      url: `/v2/ledger/${worker}`
    });
    expect(workerBeforeRes.statusCode).toBe(200);
    const workerBefore = (workerBeforeRes.json() as { available: number }).available;

    const acceptRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/accept`,
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

    const [confirm1, confirm2] = await Promise.all([
      app!.inject({
        method: "POST",
        url: `/v2/submissions/${submission.id}/confirm`,
        headers: { authorization: `Bearer ${bearer(publisher)}` }
      }),
      app!.inject({
        method: "POST",
        url: `/v2/submissions/${submission.id}/confirm`,
        headers: { authorization: `Bearer ${bearer(publisher)}` }
      })
    ]);
    expect([confirm1.statusCode, confirm2.statusCode].every((code) => code === 200)).toBe(true);

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
    expect(workerAfter - workerBefore).toBe(10);
  });

  it("keeps settlement coherent when a multi-slot task is partially completed then terminated", async () => {
    const publisher = addr("term-pub");
    const workerA = addr("term-worker-a");
    const workerB = addr("term-worker-b");

    const economyRes = await app!.inject({
      method: "GET",
      url: "/v2/economy/params"
    });
    expect(economyRes.statusCode).toBe(200);
    const economy = economyRes.json() as { terminationPenaltyBps: number };

    const publisherBeforeRes = await app!.inject({
      method: "GET",
      url: `/v2/ledger/${publisher}`
    });
    expect(publisherBeforeRes.statusCode).toBe(200);
    const publisherBefore = (publisherBeforeRes.json() as { available: number }).available;

    const workerABeforeRes = await app!.inject({
      method: "GET",
      url: `/v2/ledger/${workerA}`
    });
    expect(workerABeforeRes.statusCode).toBe(200);
    const workerABefore = (workerABeforeRes.json() as { available: number }).available;

    const workerBBeforeRes = await app!.inject({
      method: "GET",
      url: `/v2/ledger/${workerB}`
    });
    expect(workerBBeforeRes.statusCode).toBe(200);
    const workerBBefore = (workerBBeforeRes.json() as { available: number }).available;

    const taskCreateRes = await app!.inject({
      method: "POST",
      url: "/v2/tasks",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        title: "partial-then-terminate",
        descriptionMd: "desc",
        acceptanceCriteria: "criteria",
        deadlineUtc: futureDeadline(),
        displayTimezone: "UTC",
        slotsTotal: 2,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: false
      }
    });
    expect(taskCreateRes.statusCode).toBe(200);
    const createdTask = taskCreateRes.json() as {
      id: string;
      taxAmount: number;
      rewardEscrowRemaining: number;
    };

    for (const worker of [workerA, workerB]) {
      const acceptRes = await app!.inject({
        method: "POST",
        url: `/v2/tasks/${createdTask.id}/accept`,
        headers: { authorization: `Bearer ${bearer(worker)}` }
      });
      expect(acceptRes.statusCode).toBe(200);
    }

    const submissionARes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${createdTask.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(workerA)}` },
      payload: { payloadMd: "worker A result" }
    });
    expect(submissionARes.statusCode).toBe(200);
    const submissionA = submissionARes.json() as { id: string };

    const confirmARes = await app!.inject({
      method: "POST",
      url: `/v2/submissions/${submissionA.id}/confirm`,
      headers: { authorization: `Bearer ${bearer(publisher)}` }
    });
    expect(confirmARes.statusCode).toBe(200);

    const taskMidRes = await app!.inject({
      method: "GET",
      url: `/v2/tasks/${createdTask.id}`
    });
    expect(taskMidRes.statusCode).toBe(200);
    const taskMid = taskMidRes.json() as { rewardEscrowRemaining: number };
    expect(taskMid.rewardEscrowRemaining).toBe(10);

    const terminateRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${createdTask.id}/terminate`,
      headers: { authorization: `Bearer ${bearer(publisher)}` }
    });
    expect(terminateRes.statusCode).toBe(200);
    const terminated = terminateRes.json() as { status: string; rewardEscrowRemaining: number };
    expect(terminated.status).toBe("TERMINATED");
    expect(terminated.rewardEscrowRemaining).toBe(0);

    const submitAfterTerminateRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${createdTask.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(workerB)}` },
      payload: { payloadMd: "late worker B result" }
    });
    expect(submitAfterTerminateRes.statusCode).toBe(409);

    const penalty = Math.max(
      1,
      Math.floor((taskMid.rewardEscrowRemaining * economy.terminationPenaltyBps) / 10_000)
    );
    const expectedPublisherDelta =
      -1 * (createdTask.rewardEscrowRemaining + createdTask.taxAmount) +
      (taskMid.rewardEscrowRemaining - penalty);

    const publisherAfterRes = await app!.inject({
      method: "GET",
      url: `/v2/ledger/${publisher}`
    });
    expect(publisherAfterRes.statusCode).toBe(200);
    const publisherAfter = (publisherAfterRes.json() as { available: number }).available;
    expect(publisherAfter - publisherBefore).toBe(expectedPublisherDelta);

    const workerAAfterRes = await app!.inject({
      method: "GET",
      url: `/v2/ledger/${workerA}`
    });
    expect(workerAAfterRes.statusCode).toBe(200);
    const workerAAfter = (workerAAfterRes.json() as { available: number }).available;
    expect(workerAAfter - workerABefore).toBe(10);

    const workerBAfterRes = await app!.inject({
      method: "GET",
      url: `/v2/ledger/${workerB}`
    });
    expect(workerBAfterRes.statusCode).toBe(200);
    const workerBAfter = (workerBAfterRes.json() as { available: number }).available;
    expect(workerBAfter - workerBBefore).toBe(0);

    const cycleRes = await app!.inject({
      method: "GET",
      url: "/v2/cycles/active"
    });
    expect(cycleRes.statusCode).toBe(200);
    const cycle = cycleRes.json() as { taxPool: number; penaltyPool: number };
    expect(cycle.taxPool).toBe(createdTask.taxAmount);
    expect(cycle.penaltyPool).toBe(penalty);
  });

  it("rejects admin-only cycle close when key is invalid", async () => {
    const response = await app!.inject({
      method: "POST",
      url: "/v2/admin/cycles/close",
      headers: { "x-admin-service-key": "wrong-key" }
    });
    expect(response.statusCode).toBe(401);
  });

  it("exposes cycle list and active cycle updates after admin close", async () => {
    const activeBefore = await app!.inject({
      method: "GET",
      url: "/v2/cycles/active"
    });
    expect(activeBefore.statusCode).toBe(200);
    const cycleBefore = activeBefore.json();
    expect(cycleBefore.id).toBe("cycle-1");

    const closeRes = await app!.inject({
      method: "POST",
      url: "/v2/admin/cycles/close",
      headers: { "x-admin-service-key": adminKey }
    });
    expect(closeRes.statusCode).toBe(200);

    const activeAfter = await app!.inject({
      method: "GET",
      url: "/v2/cycles/active"
    });
    const cycleAfter = activeAfter.json();
    expect(cycleAfter.id).toBe("cycle-2");

    const listRes = await app!.inject({
      method: "GET",
      url: "/v2/cycles"
    });
    expect(listRes.statusCode).toBe(200);
    const list = listRes.json();
    expect(Array.isArray(list.items)).toBe(true);
    expect(list.items.length).toBeGreaterThanOrEqual(2);
  });

  it("allows admin NOT_COMPLETED override to reopen dispute for supervision", async () => {
    const publisher = addr("ov1");
    const worker = addr("ov2");
    const task = await createSingleSlotTask(publisher);

    const acceptRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/accept`,
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

    const disputeRes = await app!.inject({
      method: "POST",
      url: "/v2/disputes",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        taskId: task.id,
        submissionId: submission.id,
        reasonMd: "manual override path"
      }
    });
    expect(disputeRes.statusCode).toBe(200);
    const dispute = disputeRes.json() as { id: string };

    const overrideRes = await app!.inject({
      method: "POST",
      url: `/v2/admin/disputes/${dispute.id}/override`,
      headers: { "x-admin-service-key": adminKey },
      payload: { result: "NOT_COMPLETED" }
    });
    expect(overrideRes.statusCode).toBe(200);
    const overridden = overrideRes.json() as { status: string };
    expect(overridden.status).toBe("OPEN");

    const voteAfterOverride = await app!.inject({
      method: "POST",
      url: `/v2/disputes/${dispute.id}/votes`,
      headers: { authorization: `Bearer ${bearer(addr("ov3"))}` },
      payload: { vote: VoteChoice.COMPLETED }
    });
    expect(voteAfterOverride.statusCode).toBe(200);
  });

  it("allows admin COMPLETED override to finalize dispute and close voting", async () => {
    const publisher = addr("ov4");
    const worker = addr("ov5");
    const task = await createSingleSlotTask(publisher);

    const acceptRes = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/accept`,
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

    const disputeRes = await app!.inject({
      method: "POST",
      url: "/v2/disputes",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        taskId: task.id,
        submissionId: submission.id,
        reasonMd: "manual complete override"
      }
    });
    expect(disputeRes.statusCode).toBe(200);
    const dispute = disputeRes.json() as { id: string };

    const overrideRes = await app!.inject({
      method: "POST",
      url: `/v2/admin/disputes/${dispute.id}/override`,
      headers: { "x-admin-service-key": adminKey },
      payload: { result: "COMPLETED" }
    });
    expect(overrideRes.statusCode).toBe(200);
    const overridden = overrideRes.json() as { status: string };
    expect(overridden.status).toBe("RESOLVED_COMPLETED");

    const voteAfterOverride = await app!.inject({
      method: "POST",
      url: `/v2/disputes/${dispute.id}/votes`,
      headers: { authorization: `Bearer ${bearer(addr("ov6"))}` },
      payload: { vote: VoteChoice.COMPLETED }
    });
    expect(voteAfterOverride.statusCode).toBe(409);
  });

  it("exposes dashboard summary and trend metrics from activity events", async () => {
    const publisher = addr("dash-pub-1");
    const worker = addr("dash-worker-1");

    const taskA = await createSingleSlotTask(publisher);
    await app!.inject({
      method: "POST",
      url: `/v2/tasks/${taskA.id}/accept`,
      headers: { authorization: `Bearer ${bearer(worker)}` }
    });
    const submissionA = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${taskA.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: { payloadMd: "done-a" }
    });
    const submissionAId = (submissionA.json() as { id: string }).id;
    await app!.inject({
      method: "POST",
      url: `/v2/submissions/${submissionAId}/confirm`,
      headers: { authorization: `Bearer ${bearer(publisher)}` }
    });

    const taskB = await createSingleSlotTask(publisher);
    await app!.inject({
      method: "POST",
      url: `/v2/tasks/${taskB.id}/accept`,
      headers: { authorization: `Bearer ${bearer(worker)}` }
    });
    const submissionB = await app!.inject({
      method: "POST",
      url: `/v2/tasks/${taskB.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: { payloadMd: "done-b" }
    });
    const submissionBId = (submissionB.json() as { id: string }).id;
    await rejectSubmission(submissionBId, publisher);
    await app!.inject({
      method: "POST",
      url: "/v2/disputes",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: { taskId: taskB.id, submissionId: submissionBId, reasonMd: "dash dispute" }
    });

    const summaryRes = await app!.inject({
      method: "GET",
      url: "/v2/dashboard/summary?tz=UTC"
    });
    expect(summaryRes.statusCode).toBe(200);
    const summary = summaryRes.json() as {
      today: { tasksPublished: number; tasksAccepted: number; tasksCompleted: number; disputesOpened: number };
      currentCycle: { tasksPublished: number; tasksAccepted: number; tasksCompleted: number; disputesOpened: number };
    };
    expect(summary.today.tasksPublished).toBeGreaterThanOrEqual(2);
    expect(summary.today.tasksAccepted).toBeGreaterThanOrEqual(2);
    expect(summary.today.tasksCompleted).toBeGreaterThanOrEqual(1);
    expect(summary.today.disputesOpened).toBeGreaterThanOrEqual(1);
    expect(summary.currentCycle.tasksPublished).toBeGreaterThanOrEqual(2);

    const trendsRes = await app!.inject({
      method: "GET",
      url: "/v2/dashboard/trends?tz=UTC&window=7d"
    });
    expect(trendsRes.statusCode).toBe(200);
    const trends = trendsRes.json() as {
      points: Array<{ tasksPublished: number; tasksAccepted: number; tasksCompleted: number; disputesOpened: number }>;
    };
    expect(trends.points.length).toBe(7);
    const publishedTotal = trends.points.reduce((acc, item) => acc + item.tasksPublished, 0);
    expect(publishedTotal).toBeGreaterThanOrEqual(2);
  });

  it("supports agents and activities list read routes", async () => {
    const publisher = addr("list-pub-1");
    const worker = addr("list-worker-1");
    const task = await createSingleSlotTask(publisher);
    await app!.inject({
      method: "POST",
      url: `/v2/tasks/${task.id}/accept`,
      headers: { authorization: `Bearer ${bearer(worker)}` }
    });

    const agentsRes = await app!.inject({
      method: "GET",
      url: "/v2/agents?activeOnly=true&sort=score&order=desc&limit=10"
    });
    expect(agentsRes.statusCode).toBe(200);
    const agents = agentsRes.json() as { items: Array<{ address: string }>; nextCursor: string | null };
    expect(Array.isArray(agents.items)).toBe(true);
    expect(agents.items.length).toBeGreaterThan(0);

    const activitiesRes = await app!.inject({
      method: "GET",
      url: `/v2/activities?taskId=${task.id}&order=desc&limit=20`
    });
    expect(activitiesRes.statusCode).toBe(200);
    const activities = activitiesRes.json() as { items: Array<{ type: string }>; nextCursor: string | null };
    expect(activities.items.some((item) => item.type === "TASK_PUBLISHED")).toBe(true);
    expect(activities.items.some((item) => item.type === "TASK_ACCEPTED")).toBe(true);
  });
});
