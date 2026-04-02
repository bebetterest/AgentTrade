import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import type { FastifyInstance } from "fastify";
import type { Address } from "@agentrade/types";
import { VoteChoice } from "@agentrade/types";
import { defaultConfig } from "@agentrade/config";
import { buildApp } from "../src/app.js";
import { PrismaStateRepository } from "../src/infra/state-repository.js";
import { AgentradeEngine } from "../src/domain/engine.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const runDbSuite = TEST_DB_URL ? describe : describe.skip;
const addr = (seed: string): Address =>
  `0x${Buffer.from(seed).toString("hex").slice(0, 40).padEnd(40, "0")}` as Address;
const indexedAddr = (offset: number, index: number): Address =>
  `0x${(BigInt(offset) + BigInt(index) + 1n).toString(16).padStart(40, "0")}` as Address;
const futureDeadline = (hours = 24): string =>
  new Date(Date.now() + hours * 3_600_000).toISOString();

runDbSuite("Persistence Stress", () => {
  const secret = "persist-stress-secret";
  const adminKey = "persist-stress-admin-key";
  const oldEnv = { ...process.env };
  let app: FastifyInstance | null = null;
  let repo: PrismaStateRepository;

  const bearer = (address: Address): string => jwt.sign({ sub: address }, secret, { expiresIn: "1h" });
  const rejectSubmission = async (submissionId: string, publisher: Address) => {
    const rejectRes = await app!.inject({
      method: "POST",
      url: `/v1/submissions/${submissionId}/reject`,
      headers: { authorization: `Bearer ${bearer(publisher)}` }
    });
    expect(rejectRes.statusCode).toBe(200);
  };

  const createTask = async (publisher: Address, slotsTotal: number) => {
    const taskRes = await app!.inject({
      method: "POST",
      url: "/v1/tasks",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        title: "stress-task",
        descriptionMd: "stress",
        acceptanceCriteria: "criteria",
        deadlineUtc: futureDeadline(),
        displayTimezone: "UTC",
        slotsTotal,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: false
      }
    });
    expect(taskRes.statusCode).toBe(200);
    return taskRes.json() as { id: string };
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = secret;
    process.env.ADMIN_SERVICE_KEY = adminKey;
    process.env.ENABLE_PERSISTENCE = "true";
    process.env.ENABLE_REDIS_RATE_LIMIT = "false";
    process.env.RATE_LIMIT_PER_MINUTE = "100000";
    process.env.RATE_LIMIT_BURST = "100000";
    process.env.TASK_TITLE_MAX_LENGTH = "120";
    process.env.TASK_DESCRIPTION_MAX_LENGTH = "20000";
    process.env.TASK_ACCEPTANCE_CRITERIA_MAX_LENGTH = "8000";
    process.env.TASK_SUBMISSION_PAYLOAD_MAX_LENGTH = "20000";
    process.env.DISPUTE_REASON_MAX_LENGTH = "4000";
    process.env.TASK_SLOTS_MAX = "100";
    process.env.TASK_REWARD_PER_SLOT_MAX = "1000000";
    process.env.TASK_DEADLINE_MAX_HOURS = "4320";
    process.env.DATABASE_URL = TEST_DB_URL;
    repo = new PrismaStateRepository(TEST_DB_URL!);
  });

  beforeEach(async () => {
    await repo.sync(new AgentradeEngine(defaultConfig).toSnapshot());
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
    await repo.close();
    process.env = oldEnv;
  });

  it("handles high-concurrency accept attempts without oversell", async () => {
    const publisher = addr("stress-pub-accept");
    const task = await createTask(publisher, 10);

    const workers = Array.from({ length: 80 }, (_, index) => indexedAddr(10_000, index));
    const attempts = await Promise.all(
      workers.map((worker) =>
        app!.inject({
          method: "POST",
          url: `/v1/tasks/${task.id}/accept`,
          headers: { authorization: `Bearer ${bearer(worker)}` }
        })
      )
    );

    const success = attempts.filter((item) => item.statusCode === 200).length;
    const conflicts = attempts.filter((item) => item.statusCode === 409).length;
    const unexpected = attempts.filter((item) => ![200, 409].includes(item.statusCode));
    expect(unexpected).toHaveLength(0);
    expect(success).toBe(10);
    expect(conflicts).toBe(70);

    const taskAfter = await app!.inject({ method: "GET", url: `/v1/tasks/${task.id}` });
    expect(taskAfter.statusCode).toBe(200);
    const snapshot = taskAfter.json() as { acceptedAgents: string[]; slotsTotal: number };
    expect(snapshot.acceptedAgents.length).toBe(snapshot.slotsTotal);
    expect(new Set(snapshot.acceptedAgents).size).toBe(snapshot.acceptedAgents.length);
  }, 30_000);

  it("keeps vote consistency and settles workloads under concurrent supervision", async () => {
    const publisher = addr("stress-pub-vote");
    const worker = addr("stress-worker-vote");
    const task = await createTask(publisher, 1);

    const accept = await app!.inject({
      method: "POST",
      url: `/v1/tasks/${task.id}/accept`,
      headers: { authorization: `Bearer ${bearer(worker)}` }
    });
    expect(accept.statusCode).toBe(200);

    const submit = await app!.inject({
      method: "POST",
      url: `/v1/tasks/${task.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: { payloadMd: "stress result" }
    });
    expect(submit.statusCode).toBe(200);
    const submission = submit.json() as { id: string };
    await rejectSubmission(submission.id, publisher);

    const disputeRes = await app!.inject({
      method: "POST",
      url: "/v1/disputes",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        taskId: task.id,
        submissionId: submission.id,
        reasonMd: "stress review"
      }
    });
    expect(disputeRes.statusCode).toBe(200);
    const dispute = disputeRes.json() as { id: string };

    const supervisors = Array.from({ length: 50 }, (_, index) => indexedAddr(20_000, index));
    const voteResponses = await Promise.all(
      supervisors.map((supervisor) =>
        app!.inject({
          method: "POST",
          url: `/v1/disputes/${dispute.id}/votes`,
          headers: { authorization: `Bearer ${bearer(supervisor)}` },
          payload: { vote: VoteChoice.COMPLETED }
        })
      )
    );
    expect(voteResponses.every((response) => response.statusCode === 200)).toBe(true);

    const closeRes = await app!.inject({
      method: "POST",
      url: "/v1/admin/cycles/close",
      headers: { "x-admin-service-key": adminKey }
    });
    expect(closeRes.statusCode).toBe(200);
    const closePayload = closeRes.json() as { closedCycleId: string; finalizedDisputes: string[] };
    expect(closePayload.finalizedDisputes).toContain(dispute.id);

    const disputeAfter = await app!.inject({ method: "GET", url: `/v1/disputes/${dispute.id}` });
    expect(disputeAfter.statusCode).toBe(200);
    const disputeBody = disputeAfter.json() as { status: string };
    expect(disputeBody.status).toBe("RESOLVED_COMPLETED");

    const rewards = await app!.inject({
      method: "GET",
      url: `/v1/cycles/${closePayload.closedCycleId}/rewards`
    });
    expect(rewards.statusCode).toBe(200);
    const rewardsBody = rewards.json() as {
      workloads: Array<{ disputeId: string; settledAt: string | null }>;
    };
    const disputeWorkloads = rewardsBody.workloads.filter((item) => item.disputeId === dispute.id);
    expect(disputeWorkloads.length).toBe(supervisors.length);
    expect(disputeWorkloads.every((item) => item.settledAt !== null)).toBe(true);
  }, 30_000);

  it("allows only one successful vote under duplicate concurrent participation attempts", async () => {
    const publisher = addr("stress-pub-dupe");
    const worker = addr("stress-worker-dupe");
    const supervisor = addr("stress-supervisor-dupe");
    const task = await createTask(publisher, 1);

    const accept = await app!.inject({
      method: "POST",
      url: `/v1/tasks/${task.id}/accept`,
      headers: { authorization: `Bearer ${bearer(worker)}` }
    });
    expect(accept.statusCode).toBe(200);

    const submit = await app!.inject({
      method: "POST",
      url: `/v1/tasks/${task.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: { payloadMd: "stress duplicate vote result" }
    });
    expect(submit.statusCode).toBe(200);
    const submission = submit.json() as { id: string };
    await rejectSubmission(submission.id, publisher);

    const disputeRes = await app!.inject({
      method: "POST",
      url: "/v1/disputes",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        taskId: task.id,
        submissionId: submission.id,
        reasonMd: "duplicate vote race"
      }
    });
    expect(disputeRes.statusCode).toBe(200);
    const dispute = disputeRes.json() as { id: string };

    const attempts = await Promise.all(
      Array.from({ length: 40 }).map(() =>
        app!.inject({
          method: "POST",
          url: `/v1/disputes/${dispute.id}/votes`,
          headers: { authorization: `Bearer ${bearer(supervisor)}` },
          payload: { vote: VoteChoice.COMPLETED }
        })
      )
    );

    const success = attempts.filter((item) => item.statusCode === 200).length;
    const conflicts = attempts.filter((item) => item.statusCode === 409).length;
    const unexpected = attempts.filter((item) => ![200, 409].includes(item.statusCode));
    expect(unexpected).toHaveLength(0);
    expect(success).toBe(1);
    expect(conflicts).toBe(39);

    const closeRes = await app!.inject({
      method: "POST",
      url: "/v1/admin/cycles/close",
      headers: { "x-admin-service-key": adminKey }
    });
    expect(closeRes.statusCode).toBe(200);
    const close = closeRes.json() as { closedCycleId: string };

    const rewards = await app!.inject({
      method: "GET",
      url: `/v1/cycles/${close.closedCycleId}/rewards`
    });
    expect(rewards.statusCode).toBe(200);
    const rewardsBody = rewards.json() as {
      workloads: Array<{ disputeId: string; settledAt: string | null }>;
    };
    const disputeWorkloads = rewardsBody.workloads.filter((item) => item.disputeId === dispute.id);
    expect(disputeWorkloads).toHaveLength(1);
    expect(disputeWorkloads[0].settledAt).not.toBeNull();
  }, 30_000);

  it("allows only one successful dispute creation under duplicate concurrent requests", async () => {
    const publisher = addr("stress-pub-dispute");
    const worker = addr("stress-worker-dispute");
    const task = await createTask(publisher, 1);

    const accept = await app!.inject({
      method: "POST",
      url: `/v1/tasks/${task.id}/accept`,
      headers: { authorization: `Bearer ${bearer(worker)}` }
    });
    expect(accept.statusCode).toBe(200);

    const submit = await app!.inject({
      method: "POST",
      url: `/v1/tasks/${task.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: { payloadMd: "stress duplicate dispute result" }
    });
    expect(submit.statusCode).toBe(200);
    const submission = submit.json() as { id: string };
    await rejectSubmission(submission.id, publisher);

    const attempts = await Promise.all(
      Array.from({ length: 40 }).map(() =>
        app!.inject({
          method: "POST",
          url: "/v1/disputes",
          headers: { authorization: `Bearer ${bearer(publisher)}` },
          payload: {
            taskId: task.id,
            submissionId: submission.id,
            reasonMd: "duplicate dispute race"
          }
        })
      )
    );

    const success = attempts.filter((item) => item.statusCode === 200).length;
    const conflicts = attempts.filter((item) => item.statusCode === 409).length;
    const unexpected = attempts.filter((item) => ![200, 409].includes(item.statusCode));
    expect(unexpected).toHaveLength(0);
    expect(success).toBe(1);
    expect(conflicts).toBe(39);
    for (const response of attempts.filter((item) => item.statusCode === 409)) {
      expect(response.json().error).toBe("OPEN_DISPUTE_ALREADY_EXISTS");
    }
  }, 30_000);

  it("prevents AgentCoin overspend under concurrent high-cost task publishes", async () => {
    const publisher = addr("stress-pub-budget");
    const beforeLedger = await app!.inject({
      method: "GET",
      url: `/v1/ledger/${publisher}`
    });
    expect(beforeLedger.statusCode).toBe(200);
    const initialBalance = (beforeLedger.json() as { available: number }).available;

    const attempts = await Promise.all(
      Array.from({ length: 20 }).map(() =>
        app!.inject({
          method: "POST",
          url: "/v1/tasks",
          headers: { authorization: `Bearer ${bearer(publisher)}` },
          payload: {
            title: "stress-budget-task",
            descriptionMd: "stress budget check",
            acceptanceCriteria: "criteria",
            deadlineUtc: futureDeadline(),
            displayTimezone: "UTC",
            slotsTotal: 1,
            rewardPerSlot: 10_000,
            allowRepeatCompletionsBySameAgent: false
          }
        })
      )
    );

    const successResponses = attempts.filter((item) => item.statusCode === 200);
    const conflictResponses = attempts.filter((item) => item.statusCode === 409);
    const unexpected = attempts.filter((item) => ![200, 409].includes(item.statusCode));
    expect(unexpected).toHaveLength(0);

    const sample = successResponses[0]?.json() as { rewardEscrowRemaining: number; taxAmount: number } | undefined;
    expect(sample).toBeDefined();
    const perTaskCost = (sample?.rewardEscrowRemaining ?? 0) + (sample?.taxAmount ?? 0);
    expect(perTaskCost).toBeGreaterThan(0);

    const maxAffordablePublishes = Math.floor(initialBalance / perTaskCost);
    expect(successResponses.length).toBe(maxAffordablePublishes);
    expect(conflictResponses.length).toBe(20 - maxAffordablePublishes);
    for (const response of conflictResponses) {
      expect(response.json().error).toBe("INSUFFICIENT_BALANCE");
    }

    const afterLedger = await app!.inject({
      method: "GET",
      url: `/v1/ledger/${publisher}`
    });
    expect(afterLedger.statusCode).toBe(200);
    const afterBalance = (afterLedger.json() as { available: number }).available;
    expect(afterBalance).toBe(initialBalance - successResponses.length * perTaskCost);
    expect(afterBalance).toBeGreaterThanOrEqual(0);
  }, 30_000);

  it("returns stable paginated task reads immediately after concurrent publishes", async () => {
    const publisher = addr("stress-read-page");
    const responses = await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        app!.inject({
          method: "POST",
          url: "/v1/tasks",
          headers: { authorization: `Bearer ${bearer(publisher)}` },
          payload: {
            title: `stress-read-${index + 1}`,
            descriptionMd: "stress pagination read",
            acceptanceCriteria: "criteria",
            deadlineUtc: futureDeadline(),
            displayTimezone: "UTC",
            slotsTotal: 1,
            rewardPerSlot: 100,
            allowRepeatCompletionsBySameAgent: false
          }
        })
      )
    );

    expect(responses.every((response) => response.statusCode === 200)).toBe(true);
    const createdIds = new Set(
      responses.map((response) => (response.json() as { id: string }).id)
    );

    const pageOneRes = await app!.inject({
      method: "GET",
      url: `/v1/tasks?publisher=${publisher}&sort=latest&order=desc&limit=10`
    });
    expect(pageOneRes.statusCode).toBe(200);
    const pageOne = pageOneRes.json() as {
      items: Array<{ id: string }>;
      nextCursor: string | null;
    };
    expect(pageOne.items).toHaveLength(10);
    expect(pageOne.nextCursor).toBe("10");

    const pageTwoRes = await app!.inject({
      method: "GET",
      url: `/v1/tasks?publisher=${publisher}&sort=latest&order=desc&limit=10&cursor=${pageOne.nextCursor}`
    });
    expect(pageTwoRes.statusCode).toBe(200);
    const pageTwo = pageTwoRes.json() as {
      items: Array<{ id: string }>;
      nextCursor: string | null;
    };
    expect(pageTwo.items).toHaveLength(10);
    expect(pageTwo.nextCursor).toBe("20");

    const pageThreeRes = await app!.inject({
      method: "GET",
      url: `/v1/tasks?publisher=${publisher}&sort=latest&order=desc&limit=10&cursor=${pageTwo.nextCursor}`
    });
    expect(pageThreeRes.statusCode).toBe(200);
    const pageThree = pageThreeRes.json() as {
      items: Array<{ id: string }>;
      nextCursor: string | null;
    };
    expect(pageThree.items).toHaveLength(5);
    expect(pageThree.nextCursor).toBeNull();

    const pagedIds = new Set(
      [...pageOne.items, ...pageTwo.items, ...pageThree.items].map((item) => item.id)
    );
    expect(pagedIds).toEqual(createdIds);
  }, 30_000);
});
