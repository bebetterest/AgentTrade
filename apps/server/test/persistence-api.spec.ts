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
const futureDeadline = (hours = 24): string =>
  new Date(Date.now() + hours * 3_600_000).toISOString();

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
      url: `/v1/submissions/${submissionId}/reject`,
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
      url: "/v1/tasks",
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
    const tasks = await app.inject({ method: "GET", url: "/v1/tasks" });
    expect(tasks.statusCode).toBe(200);
    expect(tasks.json().items.length).toBe(1);
    expect(tasks.json().items[0].title).toBe("persistent-task");
  });

  it("persists agent profile updates across app restarts", async () => {
    const agent = addr("profile-persist");
    const patchRes = await app!.inject({
      method: "PATCH",
      url: `/v1/agents/${agent}/profile`,
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
      url: `/v1/agents/${agent}`
    });
    expect(profileRes.statusCode).toBe(200);
    const profile = profileRes.json() as { name: string; bio: string };
    expect(profile.name).toBe("Agent Persist");
    expect(profile.bio).toBe("profile survives restart");
  });

  it("keeps one-time supervision participation rule across restarts", async () => {
    const publisher = addr("p2");
    const worker = addr("p3");
    const supervisor = addr("p4");

    const taskRes = await app!.inject({
      method: "POST",
      url: "/v1/tasks",
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
      url: `/v1/tasks/${task.id}/accept`,
      headers: { authorization: `Bearer ${bearer(worker)}` }
    });
    const submissionRes = await app!.inject({
      method: "POST",
      url: `/v1/tasks/${task.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: { payloadMd: "result" }
    });
    const submission = submissionRes.json() as { id: string };
    await rejectSubmission(submission.id, publisher);

    const disputeRes = await app!.inject({
      method: "POST",
      url: "/v1/disputes",
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
      url: `/v1/disputes/${dispute.id}/votes`,
      headers: { authorization: `Bearer ${bearer(supervisor)}` },
      payload: { vote: VoteChoice.COMPLETED }
    });
    expect(firstVote.statusCode).toBe(200);

    await app!.close();
    app = await buildApp();
    await app.ready();

    const secondVote = await app!.inject({
      method: "POST",
      url: `/v1/disputes/${dispute.id}/votes`,
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
      url: "/v1/tasks",
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
      url: `/v1/tasks/${task.id}/accept`,
      headers: { authorization: `Bearer ${bearer(worker)}` }
    });
    expect(acceptRes.statusCode).toBe(200);

    const submissionRes = await app!.inject({
      method: "POST",
      url: `/v1/tasks/${task.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: { payloadMd: "result" }
    });
    expect(submissionRes.statusCode).toBe(200);
    const submission = submissionRes.json() as { id: string };
    await rejectSubmission(submission.id, publisher);

    const disputeRes = await app!.inject({
      method: "POST",
      url: "/v1/disputes",
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
        url: `/v1/disputes/${dispute.id}/votes`,
        headers: { authorization: `Bearer ${bearer(supervisor)}` },
        payload: { vote: VoteChoice.NOT_COMPLETED }
      });
      expect(voteRes.statusCode).toBe(200);
    }

    const beforeClose1Res = await app!.inject({
      method: "GET",
      url: `/v1/ledger/${supervisors[0]}`
    });
    expect(beforeClose1Res.statusCode).toBe(200);
    const beforeClose1 = (beforeClose1Res.json() as { available: number }).available;

    const close1Res = await app!.inject({
      method: "POST",
      url: "/v1/admin/cycles/close",
      headers: { "x-admin-service-key": adminKey }
    });
    expect(close1Res.statusCode).toBe(200);
    const close1 = close1Res.json() as { closedCycleId: string; finalizedDisputes: string[] };
    expect(close1.finalizedDisputes).toHaveLength(0);

    const disputeAfterClose1 = await app!.inject({
      method: "GET",
      url: `/v1/disputes/${dispute.id}`
    });
    expect(disputeAfterClose1.statusCode).toBe(200);
    expect((disputeAfterClose1.json() as { status: string }).status).toBe("OPEN");

    const rewards1Res = await app!.inject({
      method: "GET",
      url: `/v1/cycles/${close1.closedCycleId}/rewards`
    });
    expect(rewards1Res.statusCode).toBe(200);
    const rewards1 = rewards1Res.json() as {
      workloads: Array<{ disputeId: string; settledAt: string | null }>;
    };
    const disputeCycle1Workloads = rewards1.workloads.filter((item) => item.disputeId === dispute.id);
    expect(disputeCycle1Workloads.length).toBe(supervisors.length);
    expect(disputeCycle1Workloads.every((item) => item.settledAt !== null)).toBe(true);

    const afterClose1Res = await app!.inject({
      method: "GET",
      url: `/v1/ledger/${supervisors[0]}`
    });
    expect(afterClose1Res.statusCode).toBe(200);
    const afterClose1 = (afterClose1Res.json() as { available: number }).available;
    expect(afterClose1).toBeGreaterThan(beforeClose1);

    const close2Res = await app!.inject({
      method: "POST",
      url: "/v1/admin/cycles/close",
      headers: { "x-admin-service-key": adminKey }
    });
    expect(close2Res.statusCode).toBe(200);

    const afterClose2Res = await app!.inject({
      method: "GET",
      url: `/v1/ledger/${supervisors[0]}`
    });
    expect(afterClose2Res.statusCode).toBe(200);
    const afterClose2 = (afterClose2Res.json() as { available: number }).available;
    expect(afterClose2).toBe(afterClose1);
  });

  it("keeps one-open-dispute-per-submission rule across restarts", async () => {
    const publisher = addr("pb1");
    const worker = addr("pb2");

    const taskRes = await app!.inject({
      method: "POST",
      url: "/v1/tasks",
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
      url: `/v1/tasks/${task.id}/accept`,
      headers: { authorization: `Bearer ${bearer(worker)}` }
    });
    expect(acceptRes.statusCode).toBe(200);

    const submissionRes = await app!.inject({
      method: "POST",
      url: `/v1/tasks/${task.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: { payloadMd: "result" }
    });
    expect(submissionRes.statusCode).toBe(200);
    const submission = submissionRes.json() as { id: string };
    await rejectSubmission(submission.id, publisher);

    const firstDisputeRes = await app!.inject({
      method: "POST",
      url: "/v1/disputes",
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
      url: "/v1/disputes",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        taskId: task.id,
        submissionId: submission.id,
        reasonMd: "duplicate open dispute after restart"
      }
    });
    expect(secondDisputeRes.statusCode).toBe(409);
    expect(secondDisputeRes.json().error).toBe("OPEN_DISPUTE_ALREADY_EXISTS");
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
      url: "/v1/tasks",
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
      url: `/v1/tasks/${task.id}/accept`,
      headers: { authorization: `Bearer ${bearer(worker)}` }
    });
    expect(accept1.statusCode).toBe(200);
    const submit1 = await app!.inject({
      method: "POST",
      url: `/v1/tasks/${task.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: { payloadMd: "first" }
    });
    expect(submit1.statusCode).toBe(200);
    const submission1 = submit1.json() as { id: string };
    const confirm1 = await app!.inject({
      method: "POST",
      url: `/v1/submissions/${submission1.id}/confirm`,
      headers: { authorization: `Bearer ${bearer(publisher)}` }
    });
    expect(confirm1.statusCode).toBe(200);

    await app!.close();
    app = await buildApp();
    await app.ready();

    const accept2 = await app!.inject({
      method: "POST",
      url: `/v1/tasks/${task.id}/accept`,
      headers: { authorization: `Bearer ${bearer(worker)}` }
    });
    expect(accept2.statusCode).toBe(200);
    const submit2 = await app!.inject({
      method: "POST",
      url: `/v1/tasks/${task.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: { payloadMd: "second" }
    });
    expect(submit2.statusCode).toBe(200);
    const submission2 = submit2.json() as { id: string };
    const confirm2 = await app!.inject({
      method: "POST",
      url: `/v1/submissions/${submission2.id}/confirm`,
      headers: { authorization: `Bearer ${bearer(publisher)}` }
    });
    expect(confirm2.statusCode).toBe(200);

    const taskAfter = await app!.inject({
      method: "GET",
      url: `/v1/tasks/${task.id}`
    });
    expect(taskAfter.statusCode).toBe(200);
    const body = taskAfter.json() as { status: string; rewardEscrowRemaining: number };
    expect(body.status).toBe("CLOSED");
    expect(body.rewardEscrowRemaining).toBe(0);
    } finally {
      delete process.env.RESUBMIT_COOLDOWN_MINUTES;
    }
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
      url: `/v1/ledger/${worker}`
    });
    expect(workerBeforeRes.statusCode).toBe(200);
    const workerBefore = (workerBeforeRes.json() as { available: number }).available;

    const taskRes = await app!.inject({
      method: "POST",
      url: "/v1/tasks",
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
      url: `/v1/tasks/${task.id}/accept`,
      headers: { authorization: `Bearer ${bearer(worker)}` }
    });
    expect(acceptRes.statusCode).toBe(200);

    const submitRes = await app!.inject({
      method: "POST",
      url: `/v1/tasks/${task.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: { payloadMd: "scenario result" }
    });
    expect(submitRes.statusCode).toBe(200);
    const submission = submitRes.json() as { id: string };

    await rejectSubmission(submission.id, publisher);

    const disputeRes = await app!.inject({
      method: "POST",
      url: "/v1/disputes",
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
      url: `/v1/disputes/${dispute.id}/votes`,
      headers: { authorization: `Bearer ${bearer(supervisors[0])}` },
      payload: { vote: VoteChoice.NOT_COMPLETED }
    });
    expect(firstVoteRes.statusCode).toBe(200);

    const closeCycle1Res = await app!.inject({
      method: "POST",
      url: "/v1/admin/cycles/close",
      headers: { "x-admin-service-key": adminKey }
    });
    expect(closeCycle1Res.statusCode).toBe(200);

    const disputeAfterCycle1Res = await app!.inject({
      method: "GET",
      url: `/v1/disputes/${dispute.id}`
    });
    expect(disputeAfterCycle1Res.statusCode).toBe(200);
    expect((disputeAfterCycle1Res.json() as { status: string }).status).toBe("OPEN");

    await app!.close();
    app = await buildApp();
    await app.ready();

    const overrideOpenRes = await app!.inject({
      method: "POST",
      url: `/v1/admin/disputes/${dispute.id}/override`,
      headers: { "x-admin-service-key": adminKey },
      payload: { result: "NOT_COMPLETED" }
    });
    expect(overrideOpenRes.statusCode).toBe(200);
    expect((overrideOpenRes.json() as { status: string }).status).toBe("OPEN");

    for (const supervisor of supervisors.slice(1)) {
      const voteRes = await app!.inject({
        method: "POST",
        url: `/v1/disputes/${dispute.id}/votes`,
        headers: { authorization: `Bearer ${bearer(supervisor)}` },
        payload: { vote: VoteChoice.COMPLETED }
      });
      expect(voteRes.statusCode).toBe(200);
    }

    const overrideCompletedRes = await app!.inject({
      method: "POST",
      url: `/v1/admin/disputes/${dispute.id}/override`,
      headers: { "x-admin-service-key": adminKey },
      payload: { result: "COMPLETED" }
    });
    expect(overrideCompletedRes.statusCode).toBe(200);
    expect((overrideCompletedRes.json() as { status: string }).status).toBe("RESOLVED_COMPLETED");

    const taskAfterRes = await app!.inject({
      method: "GET",
      url: `/v1/tasks/${task.id}`
    });
    expect(taskAfterRes.statusCode).toBe(200);
    const taskAfter = taskAfterRes.json() as { status: string; rewardEscrowRemaining: number };
    expect(taskAfter.status).toBe("CLOSED");
    expect(taskAfter.rewardEscrowRemaining).toBe(0);

    const workerAfterRes = await app!.inject({
      method: "GET",
      url: `/v1/ledger/${worker}`
    });
    expect(workerAfterRes.statusCode).toBe(200);
    const workerAfter = (workerAfterRes.json() as { available: number }).available;
    expect(workerAfter - workerBefore).toBe(10);

    const voteAfterResolvedRes = await app!.inject({
      method: "POST",
      url: `/v1/disputes/${dispute.id}/votes`,
      headers: { authorization: `Bearer ${bearer(addr("scenario-sup-late"))}` },
      payload: { vote: VoteChoice.COMPLETED }
    });
    expect(voteAfterResolvedRes.statusCode).toBe(409);

    await app!.close();
    app = await buildApp();
    await app.ready();
    const disputeAfterRestartRes = await app!.inject({
      method: "GET",
      url: `/v1/disputes/${dispute.id}`
    });
    expect(disputeAfterRestartRes.statusCode).toBe(200);
    expect((disputeAfterRestartRes.json() as { status: string }).status).toBe("RESOLVED_COMPLETED");
  });

  it("keeps single-open-dispute guard through reopen, restart, and finalization", async () => {
    const publisher = addr("dedupe-flow-pub");
    const worker = addr("dedupe-flow-worker");
    const supervisor = addr("dedupe-flow-sup");

    const workerBeforeRes = await app!.inject({
      method: "GET",
      url: `/v1/ledger/${worker}`
    });
    expect(workerBeforeRes.statusCode).toBe(200);
    const workerBefore = (workerBeforeRes.json() as { available: number }).available;

    const taskRes = await app!.inject({
      method: "POST",
      url: "/v1/tasks",
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
      url: `/v1/tasks/${task.id}/accept`,
      headers: { authorization: `Bearer ${bearer(worker)}` }
    });
    expect(acceptRes.statusCode).toBe(200);

    const submitRes = await app!.inject({
      method: "POST",
      url: `/v1/tasks/${task.id}/submissions`,
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: { payloadMd: "result" }
    });
    expect(submitRes.statusCode).toBe(200);
    const submission = submitRes.json() as { id: string };
    await rejectSubmission(submission.id, publisher);

    const firstDisputeRes = await app!.inject({
      method: "POST",
      url: "/v1/disputes",
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
      url: `/v1/disputes/${dispute.id}/votes`,
      headers: { authorization: `Bearer ${bearer(supervisor)}` },
      payload: { vote: VoteChoice.NOT_COMPLETED }
    });
    expect(voteRes.statusCode).toBe(200);

    const closeCycleRes = await app!.inject({
      method: "POST",
      url: "/v1/admin/cycles/close",
      headers: { "x-admin-service-key": adminKey }
    });
    expect(closeCycleRes.statusCode).toBe(200);

    const reopenRes = await app!.inject({
      method: "POST",
      url: `/v1/admin/disputes/${dispute.id}/override`,
      headers: { "x-admin-service-key": adminKey },
      payload: { result: "NOT_COMPLETED" }
    });
    expect(reopenRes.statusCode).toBe(200);
    expect((reopenRes.json() as { status: string }).status).toBe("OPEN");

    const duplicateWhileOpenRes = await app!.inject({
      method: "POST",
      url: "/v1/disputes",
      headers: { authorization: `Bearer ${bearer(publisher)}` },
      payload: {
        taskId: task.id,
        submissionId: submission.id,
        reasonMd: "must still be blocked while open"
      }
    });
    expect(duplicateWhileOpenRes.statusCode).toBe(409);
    expect(duplicateWhileOpenRes.json().error).toBe("OPEN_DISPUTE_ALREADY_EXISTS");

    await app!.close();
    app = await buildApp();
    await app.ready();

    const duplicateAfterRestartRes = await app!.inject({
      method: "POST",
      url: "/v1/disputes",
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: {
        taskId: task.id,
        submissionId: submission.id,
        reasonMd: "must remain blocked after restart"
      }
    });
    expect(duplicateAfterRestartRes.statusCode).toBe(409);
    expect(duplicateAfterRestartRes.json().error).toBe("OPEN_DISPUTE_ALREADY_EXISTS");

    const finalizeRes = await app!.inject({
      method: "POST",
      url: `/v1/admin/disputes/${dispute.id}/override`,
      headers: { "x-admin-service-key": adminKey },
      payload: { result: "COMPLETED" }
    });
    expect(finalizeRes.statusCode).toBe(200);
    expect((finalizeRes.json() as { status: string }).status).toBe("RESOLVED_COMPLETED");

    const openAfterFinalizeRes = await app!.inject({
      method: "POST",
      url: "/v1/disputes",
      headers: { authorization: `Bearer ${bearer(worker)}` },
      payload: {
        taskId: task.id,
        submissionId: submission.id,
        reasonMd: "submission is confirmed now"
      }
    });
    expect(openAfterFinalizeRes.statusCode).toBe(409);
    expect(openAfterFinalizeRes.json().error).toBe("SUBMISSION_NOT_DISPUTABLE");

    const workerAfterRes = await app!.inject({
      method: "GET",
      url: `/v1/ledger/${worker}`
    });
    expect(workerAfterRes.statusCode).toBe(200);
    const workerAfter = (workerAfterRes.json() as { available: number }).available;
    expect(workerAfter - workerBefore).toBe(10);

    const taskAfterRes = await app!.inject({
      method: "GET",
      url: `/v1/tasks/${task.id}`
    });
    expect(taskAfterRes.statusCode).toBe(200);
    const taskAfter = taskAfterRes.json() as { status: string; rewardEscrowRemaining: number };
    expect(taskAfter.status).toBe("CLOSED");
    expect(taskAfter.rewardEscrowRemaining).toBe(0);
  });
});
