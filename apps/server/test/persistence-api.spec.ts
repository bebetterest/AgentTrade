import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import type { FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import type { Address } from "@agentrade/types";
import { VoteChoice } from "@agentrade/types";
import { defaultConfig } from "@agentrade/config";
import { buildApp } from "../src/app.js";
import { parseCursorOffset } from "../src/api/services.js";
import { PrismaStateRepository } from "../src/infra/state-repository.js";
import { AgentradeEngine } from "../src/domain/engine.js";

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
  const adminKey = "persist-admin-key";
  const oldEnv = { ...process.env };
  let app: FastifyInstance | null = null;
  let repo: PrismaStateRepository;

  const bearer = (address: Address): string => jwt.sign({ sub: address }, secret, { expiresIn: "1h" });
  const rejectSubmission = async (submissionId: string, publisher: Address) => {
    const rejectRes = await app!.inject({
      method: "POST",
      url: `/v2/submissions/${submissionId}/reject`,
      headers: { authorization: `Bearer ${bearer(publisher)}` }
    });
    expect(rejectRes.statusCode).toBe(200);
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = secret;
    process.env.ADMIN_SERVICE_KEY = adminKey;
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

    const close1Res = await app!.inject({
      method: "POST",
      url: "/v2/admin/cycles/close",
      headers: { "x-admin-service-key": adminKey }
    });
    expect(close1Res.statusCode).toBe(200);
    const close1 = close1Res.json() as { closedCycleId: string; finalizedDisputes: string[] };
    expect(close1.finalizedDisputes).toHaveLength(0);

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
      workloads: Array<{ disputeId: string; settledAt: string | null }>;
    };
    expect(rewards1.rewardPool).toBeGreaterThan(0);
    expect(rewards1.distributions.length).toBeGreaterThan(0);
    expect(rewards1.distributions.every((item) => item.amount > 0)).toBe(true);
    const disputeCycle1Workloads = rewards1.workloads.filter((item) => item.disputeId === dispute.id);
    expect(disputeCycle1Workloads.length).toBe(supervisors.length);
    expect(disputeCycle1Workloads.every((item) => item.settledAt !== null)).toBe(true);

    const afterClose1Res = await app!.inject({
      method: "GET",
      url: `/v2/ledger/${supervisors[0]}`
    });
    expect(afterClose1Res.statusCode).toBe(200);
    const afterClose1 = (afterClose1Res.json() as { available: number }).available;
    expect(afterClose1).toBeGreaterThan(beforeClose1);

    const close2Res = await app!.inject({
      method: "POST",
      url: "/v2/admin/cycles/close",
      headers: { "x-admin-service-key": adminKey }
    });
    expect(close2Res.statusCode).toBe(200);

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

    const closeRes = await app!.inject({
      method: "POST",
      url: "/v2/admin/cycles/close",
      headers: { "x-admin-service-key": adminKey }
    });
    expect(closeRes.statusCode).toBe(200);
    const close = closeRes.json() as { closedCycleId: string };

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
    process.env.RESUBMIT_COOLDOWN_MINUTES = "0";
    try {
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

  it("simulates restart-aware interactive dispute escalation with admin intervention", async () => {
    const publisher = addr("scenario-pub");
    const worker = addr("scenario-worker");
    const supervisors = [
      addr("scenario-sup-1"),
      addr("scenario-sup-2"),
      addr("scenario-sup-3"),
      addr("scenario-sup-4")
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

    const closeCycle1Res = await app!.inject({
      method: "POST",
      url: "/v2/admin/cycles/close",
      headers: { "x-admin-service-key": adminKey }
    });
    expect(closeCycle1Res.statusCode).toBe(200);

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

    const overrideOpenRes = await app!.inject({
      method: "POST",
      url: `/v2/admin/disputes/${dispute.id}/override`,
      headers: { "x-admin-service-key": adminKey },
      payload: { result: "NOT_COMPLETED" }
    });
    expect(overrideOpenRes.statusCode).toBe(200);
    expect((overrideOpenRes.json() as { status: string }).status).toBe("OPEN");

    for (const supervisor of supervisors.slice(1)) {
      const voteRes = await app!.inject({
        method: "POST",
        url: `/v2/disputes/${dispute.id}/votes`,
        headers: { authorization: `Bearer ${bearer(supervisor)}` },
        payload: { vote: VoteChoice.COMPLETED }
      });
      expect(voteRes.statusCode).toBe(200);
    }

    const overrideCompletedRes = await app!.inject({
      method: "POST",
      url: `/v2/admin/disputes/${dispute.id}/override`,
      headers: { "x-admin-service-key": adminKey },
      payload: { result: "COMPLETED" }
    });
    expect(overrideCompletedRes.statusCode).toBe(200);
    expect((overrideCompletedRes.json() as { status: string }).status).toBe("RESOLVED_COMPLETED");

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
      };
    };
    expect(disputeAfterRestart.status).toBe("RESOLVED_COMPLETED");
    expect(disputeAfterRestart.resolution).toEqual({
      totalVotes: supervisors.length,
      completedVotes: supervisors.length - 1,
      notCompletedVotes: 1,
      outcome: VoteChoice.COMPLETED,
      winnerRole: "SUBMISSION_AGENT",
      winnerAddress: worker
    });
  });

  it("keeps single-open-dispute guard through reopen, restart, and finalization", async () => {
    const publisher = addr("dedupe-flow-pub");
    const worker = addr("dedupe-flow-worker");
    const supervisor = addr("dedupe-flow-sup");

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
      headers: { authorization: `Bearer ${bearer(supervisor)}` },
      payload: { vote: VoteChoice.NOT_COMPLETED }
    });
    expect(voteRes.statusCode).toBe(200);

    const closeCycleRes = await app!.inject({
      method: "POST",
      url: "/v2/admin/cycles/close",
      headers: { "x-admin-service-key": adminKey }
    });
    expect(closeCycleRes.statusCode).toBe(200);

    const reopenRes = await app!.inject({
      method: "POST",
      url: `/v2/admin/disputes/${dispute.id}/override`,
      headers: { "x-admin-service-key": adminKey },
      payload: { result: "NOT_COMPLETED" }
    });
    expect(reopenRes.statusCode).toBe(200);
    expect((reopenRes.json() as { status: string }).status).toBe("OPEN");

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

    const finalizeRes = await app!.inject({
      method: "POST",
      url: `/v2/admin/disputes/${dispute.id}/override`,
      headers: { "x-admin-service-key": adminKey },
      payload: { result: "COMPLETED" }
    });
    expect(finalizeRes.statusCode).toBe(200);
    expect((finalizeRes.json() as { status: string }).status).toBe("RESOLVED_COMPLETED");

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
    expect(workerAfter - workerBefore).toBe(10);

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
    "keeps one-open-dispute invariant under reopen/open race when legacy data replays submission to REJECTED",
    async () => {
      const publisher = addr("persist-race-reopen-open-pub");
      const worker = addr("persist-race-reopen-open-worker");
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

      const finalizeRes = await app!.inject({
        method: "POST",
        url: `/v2/admin/disputes/${seededDispute.id}/override`,
        headers: { "x-admin-service-key": adminKey },
        payload: { result: "COMPLETED" }
      });
      expect(finalizeRes.statusCode).toBe(200);
      expect((finalizeRes.json() as { status: string }).status).toBe("RESOLVED_COMPLETED");

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

      const reopenAttempt = app!.inject({
        method: "POST",
        url: `/v2/admin/disputes/${seededDispute.id}/override`,
        headers: { "x-admin-service-key": adminKey },
        payload: { result: "NOT_COMPLETED" }
      });
      const openAttempts = Array.from({ length: 40 }).map(() =>
        app!.inject({
          method: "POST",
          url: "/v2/disputes",
          headers: { authorization: `Bearer ${bearer(publisher)}` },
          payload: {
            taskId: task.id,
            submissionId: submission.id,
            reasonMd: "race between reopen and duplicate open"
          }
        })
      );

      const attempts = await Promise.all([reopenAttempt, ...openAttempts]);
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
