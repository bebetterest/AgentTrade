import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { defaultConfig, pickRuntimeEditableRules } from "@agentrade/config";
import type { Address } from "@agentrade/types";
import {
  ActivityEventType,
  AgentBanReason,
  AgentStatus,
  DisputePayoutSource,
  DisputeStatus,
  ServerAuditCategory,
  ServerAuditOutcome,
  SubmissionStatus,
  TaskStatus,
  VoteChoice
} from "@agentrade/types";
import { AgentradeEngine } from "../src/domain/engine.js";
import { parseCursorOffset, toAgentScore } from "../src/api/services.js";
import { MutableClock } from "../src/utils/time.js";
import { PrismaStateRepository } from "../src/infra/state-repository.js";
import { encodeKeysetCursor } from "../src/pagination/cursor.js";

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
const CYCLE_CLOSE_WORKER_LOCK_KEY = 3_101;
const LOG_CLEANUP_WORKER_LOCK_KEY = 3_102;
const futureDeadline = (daysFromNow = 30, from = new Date()): string =>
  new Date(from.getTime() + daysFromNow * 24 * 60 * 60 * 1000).toISOString();
const singleConnectionUrl = (databaseUrl: string): string => {
  try {
    const url = new URL(databaseUrl);
    url.searchParams.set("connection_limit", "1");
    return url.toString();
  } catch {
    const separator = databaseUrl.includes("?") ? "&" : "?";
    return `${databaseUrl}${separator}connection_limit=1`;
  }
};
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

runDbSuite("PrismaStateRepository", () => {
  let repo: PrismaStateRepository;

  beforeAll(async () => {
    repo = new PrismaStateRepository(TEST_DB_URL!);
  });

  beforeEach(async () => {
    await repo.sync(new AgentradeEngine(defaultConfig).toSnapshot());
  });

  afterAll(async () => {
    await repo.close();
  });

  it("round-trips domain snapshot through normalized tables", async () => {
    const clock = new MutableClock(new Date("2026-03-30T00:00:00.000Z"));
    const engine = new AgentradeEngine(defaultConfig, clock);
    const publisher = addr("da");
    const worker = addr("db");
    const supervisor = addr("dc");

    const task = engine.publishTask({
      publisher,
      title: "repo-task",
      descriptionMd: "desc",
      acceptanceCriteria: "ok",
      deadlineUtc: futureDeadline(30, clock.now()),
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 20,
      allowRepeatCompletionsBySameAgent: false
    });
    engine.addTaskIntention(task.id, worker);
    clock.advanceMinutes(31);
    const submission = engine.submitTask(task.id, worker, "payload");
    engine.rejectSubmission(submission.id, publisher, "needs revision");
    const dispute = engine.openDispute({
      taskId: task.id,
      submissionId: submission.id,
      opener: publisher,
      reasonMd: "review"
    });
    engine.voteDispute({
      disputeId: dispute.id,
      agent: supervisor,
      vote: VoteChoice.COMPLETED
    });

    await repo.sync(engine.toSnapshot());
    const loaded = await repo.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.tasks.length).toBe(1);
    expect(loaded!.submissions.length).toBe(1);
    expect(loaded!.disputes.length).toBe(1);
    expect(loaded!.votes.length).toBe(1);
    expect(loaded!.activeCycleId).toBe("cycle-1");
  });

  it("does not mutate defaultConfig when refreshing persisted runtime rules", async () => {
    const defaultRules = pickRuntimeEditableRules(defaultConfig);
    const originalTaxRateBps = defaultConfig.taxRateBps;
    const engine = new AgentradeEngine(defaultConfig);
    const publisher = addr("config-clone-publisher");
    const worker = addr("config-clone-worker");
    const task = engine.publishTask({
      publisher,
      title: "config-clone-task",
      descriptionMd: "desc",
      acceptanceCriteria: "ok",
      deadlineUtc: futureDeadline(),
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 20,
      allowRepeatCompletionsBySameAgent: false
    });

    try {
      await repo.sync(engine.toSnapshot());
      await repo.ensureRuntimeRulesInitialized(defaultRules);
      await repo.resetRuntimeRulesDirect({ applyTo: "current", defaults: defaultRules });
      await repo.resetRuntimeRulesDirect({ applyTo: "next", defaults: defaultRules });
      await repo.updateRuntimeRulesDirect({
        applyTo: "current",
        patch: {
          taxRateBps: originalTaxRateBps + 123
        }
      });

      await repo.addTaskIntentionDirect(task.id, worker);

      expect(defaultConfig.taxRateBps).toBe(originalTaxRateBps);
      await expect(repo.getRuntimeSettingsDirect()).resolves.toMatchObject({
        currentRules: {
          taxRateBps: originalTaxRateBps + 123
        }
      });
    } finally {
      await repo.resetRuntimeRulesDirect({ applyTo: "current", defaults: defaultRules });
      await repo.resetRuntimeRulesDirect({ applyTo: "next", defaults: defaultRules });
    }
  });

  it("uses persisted current runtime rules for direct task publication", async () => {
    const defaultRules = pickRuntimeEditableRules(defaultConfig);
    const publisher = addr("locked-config-publisher");

    try {
      await repo.ensureRuntimeRulesInitialized(defaultRules);
      await repo.resetRuntimeRulesDirect({ applyTo: "current", defaults: defaultRules });
      await repo.resetRuntimeRulesDirect({ applyTo: "next", defaults: defaultRules });
      await repo.updateRuntimeRulesDirect({
        applyTo: "current",
        patch: {
          taxRateBps: 1_000
        }
      });

      const task = await repo.publishTaskDirect({
        publisher,
        title: "locked-config-task",
        descriptionMd: "desc",
        acceptanceCriteria: "ok",
        deadlineUtc: new Date(Date.now() + 48 * 3_600_000).toISOString(),
        displayTimezone: "UTC",
        slotsTotal: 1,
        rewardPerSlot: 100,
        allowRepeatCompletionsBySameAgent: false
      });

      expect(task.taxAmount).toBe(10);
    } finally {
      await repo.resetRuntimeRulesDirect({ applyTo: "current", defaults: defaultRules });
      await repo.resetRuntimeRulesDirect({ applyTo: "next", defaults: defaultRules });
    }
  });

  it("round-trips banned profiles and dispute payout metadata through snapshot sync", async () => {
    const clock = new MutableClock(new Date("2026-03-30T00:00:00.000Z"));
    const engine = new AgentradeEngine(
      {
        ...defaultConfig,
        disputeQuorum: 1,
        disputeApprovalBps: 5_000
      },
      clock
    );
    const publisher = addr("rpb");
    const workerA = addr("rwa");
    const workerB = addr("rwb");
    const supervisor = addr("rws");

    const task = engine.publishTask({
      publisher,
      title: "repo-dispute-wallet",
      descriptionMd: "desc",
      acceptanceCriteria: "ok",
      deadlineUtc: futureDeadline(30, clock.now()),
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 20,
      allowRepeatCompletionsBySameAgent: false
    });
    engine.addTaskIntention(task.id, workerA);
    engine.addTaskIntention(task.id, workerB);
    clock.advanceMinutes(31);
    const confirmed = engine.submitTask(task.id, workerA, "confirmed");
    const disputed = engine.submitTask(task.id, workerB, "disputed");
    engine.confirmSubmission(confirmed.id, publisher);
    engine.rejectSubmission(disputed.id, publisher, "reject");
    const dispute = engine.openDispute({
      taskId: task.id,
      submissionId: disputed.id,
      opener: workerB,
      reasonMd: "valid work"
    });
    engine.voteDispute({
      disputeId: dispute.id,
      agent: supervisor,
      vote: VoteChoice.COMPLETED
    });
    engine.getLedger(publisher).available = 3;
    engine.closeCurrentCycle();

    await repo.sync(engine.toSnapshot());
    const loaded = await repo.load();
    expect(loaded).not.toBeNull();
    const publisherProfile = loaded!.profiles.find((item) => item.address === publisher);
    expect(publisherProfile).toMatchObject({
      status: AgentStatus.BANNED,
      banReasonCode: AgentBanReason.DISPUTE_INSOLVENCY
    });
    expect(loaded!.submissions.find((item) => item.id === disputed.id)?.status).toBe(
      SubmissionStatus.DISPUTE_COMPLETED
    );
    expect(loaded!.disputeResolutionMeta).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          disputeId: dispute.id,
          payoutSource: DisputePayoutSource.PUBLISHER_WALLET_PARTIAL,
          payoutAmount: 3,
          payoutShortfallAmount: 17,
          publisherBanned: true
        })
      ])
    );
  });

  it("rolls back settlement, unbans publisher, and clears old votes when reopening through direct writes", async () => {
    const clock = new MutableClock(new Date("2026-03-30T00:00:00.000Z"));
    const engine = new AgentradeEngine(
      {
        ...defaultConfig,
        disputeQuorum: 1,
        disputeApprovalBps: 5_000
      },
      clock
    );
    const publisher = addr("repo-ov1");
    const workerA = addr("repo-ov2");
    const workerB = addr("repo-ov3");
    const supervisor = addr("repo-ov4");

    const task = engine.publishTask({
      publisher,
      title: "repo-override-meta",
      descriptionMd: "desc",
      acceptanceCriteria: "ok",
      deadlineUtc: futureDeadline(30, clock.now()),
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 20,
      allowRepeatCompletionsBySameAgent: false
    });
    engine.addTaskIntention(task.id, workerA);
    engine.addTaskIntention(task.id, workerB);
    const cleanTask = engine.publishTask({
      publisher,
      title: "repo-cleanup-task",
      descriptionMd: "desc",
      acceptanceCriteria: "ok",
      deadlineUtc: futureDeadline(31, clock.now()),
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 15,
      allowRepeatCompletionsBySameAgent: false
    });
    clock.advanceMinutes(31);
    const confirmed = engine.submitTask(task.id, workerA, "confirmed");
    const disputed = engine.submitTask(task.id, workerB, "disputed");
    engine.confirmSubmission(confirmed.id, publisher);
    engine.rejectSubmission(disputed.id, publisher, "needs revision");
    const dispute = engine.openDispute({
      taskId: task.id,
      submissionId: disputed.id,
      opener: workerB,
      reasonMd: "review"
    });
    engine.voteDispute({
      disputeId: dispute.id,
      agent: supervisor,
      vote: VoteChoice.COMPLETED
    });
    engine.getLedger(publisher).available = 3;
    engine.closeCurrentCycle();
    engine.getLedger(workerB).available = 0;

    await repo.sync(engine.toSnapshot());
    expect(await repo.getDisputeResolutionDirect(dispute.id)).toMatchObject({
      payoutSource: DisputePayoutSource.PUBLISHER_WALLET_PARTIAL,
      payoutAmount: 3,
      payoutShortfallAmount: 17,
      publisherBanned: true
    });
    expect((await repo.getAgentDirect(publisher))?.status).toBe(AgentStatus.BANNED);
    expect((await repo.getTaskDirect(cleanTask.id))?.status).toBe(TaskStatus.TERMINATED);

    await repo.overrideDisputeDirect(dispute.id, "NOT_COMPLETED");
    const loadedAfterOverride = await repo.load();
    expect(loadedAfterOverride?.disputeRollbackHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          disputeId: dispute.id,
          previousStatus: DisputeStatus.RESOLVED_COMPLETED,
          previousResolution: expect.objectContaining({
            payoutSource: DisputePayoutSource.PUBLISHER_WALLET_PARTIAL,
            payoutAmount: 3,
            payoutShortfallAmount: 17,
            publisherBanned: true
          }),
          archivedVotes: expect.arrayContaining([
            expect.objectContaining({
              disputeId: dispute.id,
              agent: supervisor,
              vote: VoteChoice.COMPLETED
            })
          ]),
          archivedActivities: expect.arrayContaining([
            expect.objectContaining({
              disputeId: dispute.id,
              type: ActivityEventType.TASK_COMPLETED
            }),
            expect.objectContaining({
              disputeId: dispute.id,
              type: ActivityEventType.TASK_TERMINATED,
              taskId: cleanTask.id
            })
          ])
        })
      ])
    );
    expect(await repo.getDisputeResolutionDirect(dispute.id)).toBeNull();
    expect((await repo.getAgentDirect(publisher))?.status).toBe(AgentStatus.ACTIVE);
    expect((await repo.getAgentDirect(workerB))?.status).toBe(AgentStatus.ACTIVE);
    const activitiesAfterReopen = await repo.listActivitiesDirect();
    const latestPublisherActivityAt =
      activitiesAfterReopen
        .filter((item) => item.actor === publisher)
        .map((item) => item.createdAt)
        .sort()
        .at(-1) ?? null;
    const publisherDirectoryAfterReopen = await repo.queryAgentsDirect({
      q: publisher,
      activeOnly: false,
      sort: "latest",
      order: "desc",
      limit: 5,
      paged: true
    });
    expect(publisherDirectoryAfterReopen.items.find((item) => item.address === publisher)?.latestActivityAt).toBe(
      latestPublisherActivityAt
    );
    expect((await repo.getLedgerDirect(workerB))?.available).toBeLessThan(0);
    await expect(
      repo.publishTaskDirect({
        publisher: workerB,
        title: "negative-ledger-publish-blocked",
        descriptionMd: "desc",
        acceptanceCriteria: "ok",
        deadlineUtc: futureDeadline(34),
        displayTimezone: "UTC",
        slotsTotal: 1,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: false
      })
    ).rejects.toMatchObject({
      code: "INSUFFICIENT_BALANCE",
      statusCode: 409
    });
    expect((await repo.getSubmissionDirect(disputed.id))?.status).toBe(SubmissionStatus.REJECTED);
    await expect(repo.confirmSubmissionDirect(disputed.id, publisher)).rejects.toMatchObject({
      code: "SUBMISSION_NOT_CONFIRMABLE",
      statusCode: 409
    });
    expect((await repo.getTaskDirect(cleanTask.id))?.status).toBe(TaskStatus.OPEN);
    expect((await repo.getTaskDirect(cleanTask.id))?.rewardEscrowRemaining).toBe(15);

    await repo.overrideDisputeDirect(dispute.id, "COMPLETED");
    expect(await repo.getAgentDirect(workerB)).toMatchObject({
      status: AgentStatus.BANNED,
      banReasonCode: AgentBanReason.REOPEN_NEGATIVE_BALANCE
    });
  });

  it("does not ban unrelated negative accounts when a different reopened dispute settles again through direct writes", async () => {
    const clock = new MutableClock(new Date("2026-03-30T00:00:00.000Z"));
    const engine = new AgentradeEngine(defaultConfig, clock);
    const publisherA = addr("repo-reopen-scope-pub-a");
    const workerA = addr("repo-reopen-scope-worker-a");
    const publisherB = addr("repo-reopen-scope-pub-b");
    const workerB = addr("repo-reopen-scope-worker-b");

    const taskA = engine.publishTask({
      publisher: publisherA,
      title: "repo-reopen-scope-task-a",
      descriptionMd: "desc",
      acceptanceCriteria: "ok",
      deadlineUtc: futureDeadline(34, clock.now()),
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 10,
      allowRepeatCompletionsBySameAgent: false
    });
    engine.addTaskIntention(taskA.id, workerA);
    const taskB = engine.publishTask({
      publisher: publisherB,
      title: "repo-reopen-scope-task-b",
      descriptionMd: "desc",
      acceptanceCriteria: "ok",
      deadlineUtc: futureDeadline(34, clock.now()),
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 10,
      allowRepeatCompletionsBySameAgent: false
    });
    engine.addTaskIntention(taskB.id, workerB);
    clock.advanceMinutes(31);

    const submissionA = engine.submitTask(taskA.id, workerA, "payload-a");
    engine.rejectSubmission(submissionA.id, publisherA, "needs revision");
    const disputeA = engine.openDispute({
      taskId: taskA.id,
      submissionId: submissionA.id,
      opener: workerA,
      reasonMd: "review-a"
    });

    const submissionB = engine.submitTask(taskB.id, workerB, "payload-b");
    engine.rejectSubmission(submissionB.id, publisherB, "needs revision");
    const disputeB = engine.openDispute({
      taskId: taskB.id,
      submissionId: submissionB.id,
      opener: workerB,
      reasonMd: "review-b"
    });

    await repo.sync(engine.toSnapshot());
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
    expect((await repo.getLedgerDirect(workerA))?.available).toBeLessThan(0);
    expect((await repo.getAgentDirect(workerA))?.status).toBe(AgentStatus.ACTIVE);

    await repo.overrideDisputeDirect(disputeB.id, "COMPLETED");
    await repo.overrideDisputeDirect(disputeB.id, "NOT_COMPLETED");
    await repo.overrideDisputeDirect(disputeB.id, "COMPLETED");

    expect((await repo.getAgentDirect(workerA))?.status).toBe(AgentStatus.ACTIVE);

    await prisma.ledgerBalance.update({
      where: { address: workerA },
      data: { available: -20 }
    });
    await repo.overrideDisputeDirect(disputeA.id, "COMPLETED");
    expect(await repo.getAgentDirect(workerA)).toMatchObject({
      status: AgentStatus.BANNED,
      banReasonCode: AgentBanReason.REOPEN_NEGATIVE_BALANCE
    });

    await prisma.$disconnect();
  });

  it("blocks manual confirm and terminate through direct writes while dispute is open", async () => {
    const clock = new MutableClock(new Date("2026-03-30T00:00:00.000Z"));
    const engine = new AgentradeEngine(defaultConfig, clock);
    const publisher = addr("repo-guard-pub");
    const worker = addr("repo-guard-worker");

    const task = engine.publishTask({
      publisher,
      title: "repo-open-dispute-guards",
      descriptionMd: "desc",
      acceptanceCriteria: "ok",
      deadlineUtc: futureDeadline(30, clock.now()),
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 20,
      allowRepeatCompletionsBySameAgent: false
    });
    engine.addTaskIntention(task.id, worker);
    clock.advanceMinutes(31);
    const submission = engine.submitTask(task.id, worker, "payload");
    engine.rejectSubmission(submission.id, publisher, "needs revision");
    engine.openDispute({
      taskId: task.id,
      submissionId: submission.id,
      opener: worker,
      reasonMd: "open dispute"
    });

    await repo.sync(engine.toSnapshot());

    await expect(repo.confirmSubmissionDirect(submission.id, publisher)).rejects.toMatchObject({
      code: "SUBMISSION_NOT_CONFIRMABLE",
      statusCode: 409
    });
    await expect(repo.terminateTaskDirect(task.id, publisher)).rejects.toMatchObject({
      code: "TASK_NOT_TERMINABLE",
      statusCode: 409
    });
  });

  it("serializes many concurrent writes via runLocked without lost updates", async () => {
    const base = new AgentradeEngine(defaultConfig).toSnapshot();
    await repo.sync(base);

    const publisher = addr("ea");
    const writer = async (title: string) =>
      repo.runLocked(base, async (snapshot) => {
        const engine = AgentradeEngine.fromSnapshot(defaultConfig, snapshot);
        engine.publishTask({
          publisher,
          title,
          descriptionMd: "desc",
          acceptanceCriteria: "ok",
          deadlineUtc: futureDeadline(),
          displayTimezone: "UTC",
          slotsTotal: 1,
          rewardPerSlot: 15,
          allowRepeatCompletionsBySameAgent: false
        });
        return {
          result: null,
          nextSnapshot: engine.toSnapshot()
        };
      });

    const titles = Array.from({ length: 8 }, (_, index) => `task-${index + 1}`);
    await Promise.all(titles.map((title) => writer(title)));
    const loaded = await repo.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.tasks.length).toBe(titles.length);
    expect(new Set(loaded!.tasks.map((item) => item.title)).size).toBe(titles.length);
  });

  it("does not rewrite unchanged rows during no-op sync", async () => {
    const engine = new AgentradeEngine(defaultConfig);
    const publisher = addr("inc-a");
    const task = engine.publishTask({
      publisher,
      title: "incremental-task",
      descriptionMd: "desc",
      acceptanceCriteria: "ok",
      deadlineUtc: futureDeadline(),
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 20,
      allowRepeatCompletionsBySameAgent: false
    });
    const snapshot = engine.toSnapshot();
    await repo.sync(snapshot);

    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: TEST_DB_URL!
        }
      }
    });
    const before = await prisma.task.findUnique({ where: { id: task.id } });
    expect(before).not.toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 20));
    await repo.sync(snapshot);

    const after = await prisma.task.findUnique({ where: { id: task.id } });
    await prisma.$disconnect();
    expect(after).not.toBeNull();
    expect(after!.updatedAt.toISOString()).toBe(before!.updatedAt.toISOString());
  });

  it("preserves dispute rollback history when syncing a legacy snapshot without that field", async () => {
    const clock = new MutableClock(new Date("2026-03-30T00:00:00.000Z"));
    const engine = new AgentradeEngine(
      {
        ...defaultConfig,
        disputeQuorum: 1,
        disputeApprovalBps: 5_000
      },
      clock
    );
    const publisher = addr("legacy-hist-pub");
    const workerA = addr("legacy-hist-wa");
    const workerB = addr("legacy-hist-wb");
    const supervisor = addr("legacy-hist-sup");

    const task = engine.publishTask({
      publisher,
      title: "legacy-history-task",
      descriptionMd: "desc",
      acceptanceCriteria: "ok",
      deadlineUtc: futureDeadline(30, clock.now()),
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 20,
      allowRepeatCompletionsBySameAgent: false
    });
    engine.addTaskIntention(task.id, workerA);
    engine.addTaskIntention(task.id, workerB);
    clock.advanceMinutes(31);
    const confirmed = engine.submitTask(task.id, workerA, "confirmed");
    const disputed = engine.submitTask(task.id, workerB, "disputed");
    engine.confirmSubmission(confirmed.id, publisher);
    engine.rejectSubmission(disputed.id, publisher, "reject");
    const dispute = engine.openDispute({
      taskId: task.id,
      submissionId: disputed.id,
      opener: workerB,
      reasonMd: "valid work"
    });
    engine.voteDispute({
      disputeId: dispute.id,
      agent: supervisor,
      vote: VoteChoice.COMPLETED
    });
    engine.closeCurrentCycle();
    engine.overrideDispute(dispute.id, "NOT_COMPLETED");

    const snapshot = engine.toSnapshot();
    expect(snapshot.disputeRollbackHistory?.length).toBeGreaterThan(0);
    await repo.sync(snapshot);

    const legacySnapshot = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot & {
      disputeRollbackHistory?: typeof snapshot.disputeRollbackHistory;
    };
    delete legacySnapshot.disputeRollbackHistory;
    await repo.sync(legacySnapshot);

    const loaded = await repo.load();
    expect(loaded?.disputeRollbackHistory).toEqual(snapshot.disputeRollbackHistory);
  });

  it("stores, queries, and cleans up server request and audit logs", async () => {
    const actor = addr("log-actor-1");
    await repo.appendRequestLogsDirect([
      {
        requestId: "req-log-1",
        method: "post",
        path: "/v2/tasks",
        routeId: "/v2/tasks",
        statusCode: 200,
        durationMs: 12.345,
        clientIp: "203.0.113.20",
        forwardedFor: "203.0.113.20",
        userAgent: "vitest",
        actorAddress: actor,
        errorCode: null,
        createdAt: new Date("2026-03-01T00:00:00.000Z")
      },
      {
        requestId: "req-log-route-method-1",
        method: "get",
        path: "/v2/tasks",
        routeId: "/v2/tasks",
        statusCode: 200,
        durationMs: 3,
        clientIp: "203.0.113.21",
        actorAddress: actor,
        createdAt: new Date("2026-03-01T00:00:02.000Z")
      },
      {
        requestId: "req-log-route-method-2",
        method: "GET",
        path: "/v2/tasks",
        routeId: "/v2/tasks",
        statusCode: 429,
        durationMs: 4,
        clientIp: "203.0.113.22",
        actorAddress: actor,
        createdAt: new Date("2026-03-01T00:00:01.000Z")
      }
    ]);
    await repo.appendAuditLogDirect({
      category: ServerAuditCategory.SECURITY,
      action: "auth.bearer.rejected",
      outcome: ServerAuditOutcome.REJECTED,
      requestId: "req-log-1",
      clientIp: "203.0.113.20",
      actorAddress: actor,
      method: "GET",
      routeId: "/v2/system/metrics",
      targetType: "route",
      targetId: "/v2/system/metrics",
      cycleId: null,
      message: "bearer authentication rejected",
      details: {
        reason: "missing_bearer_token"
      },
      createdAt: new Date("2026-03-01T00:00:00.000Z")
    });
    await repo.appendAuditLogDirect({
      category: ServerAuditCategory.SECURITY,
      action: "auth.bearer.rejected",
      outcome: ServerAuditOutcome.REJECTED,
      requestId: "req-log-audit-2",
      clientIp: "203.0.113.21",
      actorAddress: actor,
      method: "GET",
      routeId: "/v2/system/metrics",
      targetType: "route",
      targetId: "/v2/system/metrics",
      cycleId: null,
      message: "bearer authentication rejected again",
      details: {
        reason: "invalid_bearer_token"
      },
      createdAt: new Date("2026-03-01T00:00:02.000Z")
    });
    await repo.appendAuditLogDirect({
      category: ServerAuditCategory.SECURITY,
      action: "auth.bearer.rejected",
      outcome: ServerAuditOutcome.FAILURE,
      requestId: "req-log-audit-nonmatching-outcome",
      clientIp: "203.0.113.22",
      actorAddress: actor,
      method: "GET",
      routeId: "/v2/system/metrics",
      targetType: "route",
      targetId: "/v2/system/metrics",
      cycleId: null,
      message: "bearer authentication failed with a different outcome",
      details: {
        reason: "internal_audit_failure"
      },
      createdAt: new Date("2026-03-01T00:00:03.000Z")
    });

    const requestLogs = await repo.queryRequestLogsDirect({
      limit: 20,
      actor,
      routeId: "/v2/tasks",
      method: "pOsT",
      status: 200
    });
    expect(requestLogs.items).toHaveLength(1);
    expect(requestLogs.items[0]!.method).toBe("POST");
    expect(requestLogs.items[0]!.clientIp).toBe("203.0.113.20");
    expect(requestLogs.items[0]!.durationMs).toBe(12.345);

    const routeMethodLogsPageOne = await repo.queryRequestLogsDirect({
      limit: 1,
      actor,
      routeId: "/v2/tasks",
      method: "GET"
    });
    expect(routeMethodLogsPageOne.items.map((item) => item.requestId)).toEqual([
      "req-log-route-method-1"
    ]);
    expect(routeMethodLogsPageOne.nextCursor).toBeTruthy();
    const routeMethodLogsPageTwo = await repo.queryRequestLogsDirect({
      limit: 2,
      actor,
      routeId: "/v2/tasks",
      method: "get",
      cursor: routeMethodLogsPageOne.nextCursor!
    });
    expect(routeMethodLogsPageTwo.items.map((item) => item.requestId)).toEqual([
      "req-log-route-method-2"
    ]);

    const auditLogsPageOne = await repo.queryAuditLogsDirect({
      limit: 1,
      category: ServerAuditCategory.SECURITY,
      action: "auth.bearer.rejected",
      outcome: ServerAuditOutcome.REJECTED
    });
    expect(auditLogsPageOne.items.map((item) => item.requestId)).toEqual(["req-log-audit-2"]);
    expect(auditLogsPageOne.nextCursor).toBeTruthy();
    const auditLogsPageTwo = await repo.queryAuditLogsDirect({
      limit: 2,
      category: ServerAuditCategory.SECURITY,
      action: "auth.bearer.rejected",
      outcome: ServerAuditOutcome.REJECTED,
      cursor: auditLogsPageOne.nextCursor!
    });
    expect(auditLogsPageTwo.items.map((item) => item.requestId)).toEqual(["req-log-1"]);
    expect(auditLogsPageTwo.items[0]!.details).toEqual({
      reason: "missing_bearer_token"
    });

    const cleanup = await repo.cleanupExpiredLogs(new Date("2026-10-01T00:00:00.000Z"));
    expect(cleanup.deletedRequestLogs).toBeGreaterThanOrEqual(3);
    expect(cleanup.deletedAuditLogs).toBeGreaterThanOrEqual(3);
  });

  it("cleans expired server logs across configured bounded delete batches", async () => {
    const batchedRepo = new PrismaStateRepository(TEST_DB_URL!, {
      ...defaultConfig,
      logCleanupBatchSize: 2
    });

    try {
      await batchedRepo.appendRequestLogsDirect(
        Array.from({ length: 5 }, (_, index) => ({
          requestId: `batched-cleanup-request-${index}`,
          method: "GET",
          path: "/v2/batched-cleanup",
          routeId: "/v2/batched-cleanup",
          statusCode: 200,
          durationMs: 1,
          clientIp: "203.0.113.80",
          createdAt: new Date(`2026-01-01T00:00:0${index}.000Z`)
        }))
      );
      for (let index = 0; index < 3; index += 1) {
        await batchedRepo.appendAuditLogDirect({
          category: ServerAuditCategory.RUNTIME,
          action: `batched.cleanup.${index}`,
          outcome: ServerAuditOutcome.SUCCESS,
          message: "batched cleanup",
          createdAt: new Date(`2025-01-01T00:00:0${index}.000Z`)
        });
      }

      const cleanup = await batchedRepo.cleanupExpiredLogs(new Date("2026-10-01T00:00:00.000Z"));
      expect(cleanup.deletedRequestLogs).toBeGreaterThanOrEqual(5);
      expect(cleanup.deletedAuditLogs).toBeGreaterThanOrEqual(3);
      expect(
        (
          await batchedRepo.queryRequestLogsDirect({
            limit: 20,
            routeId: "/v2/batched-cleanup",
            method: "GET"
          })
        ).items
      ).toHaveLength(0);
    } finally {
      await batchedRepo.close();
    }
  });

  it("releases worker advisory locks so another repository instance can acquire them", async () => {
    const repoA = new PrismaStateRepository(TEST_DB_URL!);
    const repoB = new PrismaStateRepository(TEST_DB_URL!);

    try {
      const first = await repoA.cleanupExpiredLogsWithWorkerLock(
        new Date("2026-10-01T00:00:00.000Z")
      );
      expect(first.acquired).toBe(true);

      const second = await repoB.cleanupExpiredLogsWithWorkerLock(
        new Date("2026-10-01T00:00:00.000Z")
      );
      expect(second.acquired).toBe(true);
    } finally {
      await Promise.all([repoA.close(), repoB.close()]);
    }
  });

  it("reports worker advisory lock misses while another session holds the lock", async () => {
    const lockClient = new PrismaClient({
      datasources: {
        db: {
          url: singleConnectionUrl(TEST_DB_URL!)
        }
      }
    });

    try {
      const cycleLock = await lockClient.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_lock(${CYCLE_CLOSE_WORKER_LOCK_KEY}) AS locked
      `;
      expect(cycleLock[0]?.locked).toBe(true);
      const cycleBatchMiss = await repo.closeDueCyclesWithWorkerLock();
      expect(cycleBatchMiss.acquired).toBe(false);
      await lockClient.$queryRaw`SELECT pg_advisory_unlock(${CYCLE_CLOSE_WORKER_LOCK_KEY})`;

      const cleanupLock = await lockClient.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_lock(${LOG_CLEANUP_WORKER_LOCK_KEY}) AS locked
      `;
      expect(cleanupLock[0]?.locked).toBe(true);
      const cleanupMiss = await repo.cleanupExpiredLogsWithWorkerLock(
        new Date("2026-10-01T00:00:00.000Z")
      );
      expect(cleanupMiss.acquired).toBe(false);
      await lockClient.$queryRaw`SELECT pg_advisory_unlock(${LOG_CLEANUP_WORKER_LOCK_KEY})`;
    } finally {
      await lockClient.$queryRaw`SELECT pg_advisory_unlock(${CYCLE_CLOSE_WORKER_LOCK_KEY})`;
      await lockClient.$queryRaw`SELECT pg_advisory_unlock(${LOG_CLEANUP_WORKER_LOCK_KEY})`;
      await lockClient.$disconnect();
    }
  });

  it("prevents same-process worker advisory lock reentry on one repository instance", async () => {
    const rowLockClient = new PrismaClient({
      datasources: {
        db: {
          url: TEST_DB_URL!
        }
      }
    });
    const probeClient = new PrismaClient({
      datasources: {
        db: {
          url: singleConnectionUrl(TEST_DB_URL!)
        }
      }
    });
    let releaseRowLock = (): void => undefined;
    let rowLockTx: Promise<void> | null = null;
    let cleanupPromise: Promise<{
      acquired: boolean;
      result: { deletedRequestLogs: number; deletedAuditLogs: number } | null;
    }> | null = null;

    try {
      const [log] = await repo.appendRequestLogsDirect([
        {
          requestId: "same-process-lock",
          method: "GET",
          path: "/v2/system/health",
          routeId: "/v2/system/health",
          statusCode: 200,
          durationMs: 1,
          clientIp: "203.0.113.70",
          createdAt: new Date("2026-01-01T00:00:00.000Z")
        }
      ]);
      expect(log).toBeDefined();

      let rowLocked = (): void => undefined;
      const rowLockedPromise = new Promise<void>((resolve) => {
        rowLocked = resolve;
      });
      const rowLockReleased = new Promise<void>((resolve) => {
        releaseRowLock = resolve;
      });
      rowLockTx = rowLockClient.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "ServerRequestLog" WHERE id = ${log!.id} FOR UPDATE`;
          rowLocked();
          await rowLockReleased;
        },
        { timeout: 10_000 }
      );
      await rowLockedPromise;

      cleanupPromise = repo.cleanupExpiredLogsWithWorkerLock(
        new Date("2026-10-01T00:00:00.000Z")
      );

      let firstCallHoldsAdvisoryLock = false;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const lockAttempt = await probeClient.$queryRaw<Array<{ locked: boolean }>>`
          SELECT pg_try_advisory_lock(${LOG_CLEANUP_WORKER_LOCK_KEY}) AS locked
        `;
        if (!lockAttempt[0]?.locked) {
          firstCallHoldsAdvisoryLock = true;
          break;
        }
        await probeClient.$queryRaw`SELECT pg_advisory_unlock(${LOG_CLEANUP_WORKER_LOCK_KEY})`;
        await sleep(10);
      }
      expect(firstCallHoldsAdvisoryLock).toBe(true);

      const concurrent = await repo.cleanupExpiredLogsWithWorkerLock(
        new Date("2026-10-01T00:00:00.000Z")
      );
      expect(concurrent).toEqual({
        acquired: false,
        result: null
      });

      releaseRowLock();
      await rowLockTx;
      rowLockTx = null;
      const first = await cleanupPromise;
      cleanupPromise = null;
      expect(first.acquired).toBe(true);
      expect(first.result?.deletedRequestLogs).toBeGreaterThanOrEqual(1);
    } finally {
      releaseRowLock();
      if (rowLockTx) {
        await rowLockTx.catch(() => undefined);
      }
      if (cleanupPromise) {
        await cleanupPromise.catch(() => undefined);
      }
      await probeClient.$queryRaw`SELECT pg_advisory_unlock(${LOG_CLEANUP_WORKER_LOCK_KEY})`;
      await Promise.all([rowLockClient.$disconnect(), probeClient.$disconnect()]);
    }
  });

  it("persists worker job metric counters for API-side metrics reads", async () => {
    const before = await repo.getWorkerJobMetricCountersDirect();

    await repo.incrementWorkerJobMetricDirect("success");
    await repo.incrementWorkerJobMetricDirect("success");
    await repo.incrementWorkerJobMetricDirect("error");
    await repo.incrementWorkerJobMetricDirect("lock_miss");

    const after = await repo.getWorkerJobMetricCountersDirect();
    expect(after.workerJobSuccessTotal - before.workerJobSuccessTotal).toBe(2);
    expect(after.workerJobErrorTotal - before.workerJobErrorTotal).toBe(1);
    expect(after.workerJobLockMissTotal - before.workerJobLockMissTotal).toBe(1);
  });

  it("returns exact worker job metric counters beyond JavaScript safe integer range", async () => {
    const before = await repo.getWorkerJobMetricCountersDirect();
    const exactSuccess = BigInt(Number.MAX_SAFE_INTEGER) + 2n;
    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: TEST_DB_URL!
        }
      }
    });

    try {
      await prisma.serverMetricCounter.upsert({
        where: { name: "workerJobSuccessTotal" },
        update: { value: exactSuccess },
        create: { name: "workerJobSuccessTotal", value: exactSuccess }
      });

      const counters = await repo.getWorkerJobMetricCountersDirect();
      expect(counters.workerJobSuccessTotal).toBe(Number.MAX_SAFE_INTEGER);
      expect(counters.workerJobSuccessTotalExact).toBe(exactSuccess.toString());
    } finally {
      await prisma.serverMetricCounter.upsert({
        where: { name: "workerJobSuccessTotal" },
        update: { value: BigInt(before.workerJobSuccessTotalExact) },
        create: {
          name: "workerJobSuccessTotal",
          value: BigInt(before.workerJobSuccessTotalExact)
        }
      });
      await prisma.$disconnect();
    }
  });

  it("deletes entities that were removed from snapshot during sync", async () => {
    const engine = new AgentradeEngine(defaultConfig);
    const publisher = addr("inc-b");
    engine.publishTask({
      publisher,
      title: "to-be-deleted",
      descriptionMd: "desc",
      acceptanceCriteria: "ok",
      deadlineUtc: futureDeadline(),
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 20,
      allowRepeatCompletionsBySameAgent: false
    });
    await repo.sync(engine.toSnapshot());

    const emptySnapshot = new AgentradeEngine(defaultConfig).toSnapshot();
    await repo.sync(emptySnapshot);
    const loaded = await repo.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.tasks).toHaveLength(0);
  });

  it("queries tasks, disputes, and activities with DB-side filters, sorting, and pagination", async () => {
    const clock = new MutableClock(new Date("2026-03-30T08:00:00.000Z"));
    const engine = new AgentradeEngine(defaultConfig, clock);
    const publisherA = addr("query-a");
    const publisherB = addr("query-b");
    const worker = addr("query-worker");
    const deadline = () => new Date(clock.now().getTime() + 72 * 3_600_000).toISOString();

    const alpha = engine.publishTask({
      publisher: publisherA,
      title: "alpha-open",
      descriptionMd: "alpha-desc-token",
      acceptanceCriteria: "alpha-criteria-token",
      deadlineUtc: deadline(),
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 70,
      allowRepeatCompletionsBySameAgent: false
    });
    clock.advanceMinutes(1);

    const beta = engine.publishTask({
      publisher: publisherA,
      title: "beta-dispute",
      descriptionMd: "desc",
      acceptanceCriteria: "ok",
      deadlineUtc: deadline(),
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 20,
      allowRepeatCompletionsBySameAgent: false
    });
    clock.advanceMinutes(1);

    const gamma = engine.publishTask({
      publisher: publisherB,
      title: "gamma-closed",
      descriptionMd: "desc",
      acceptanceCriteria: "ok",
      deadlineUtc: deadline(),
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 40,
      allowRepeatCompletionsBySameAgent: false
    });
    clock.advanceMinutes(1);

    const delta = engine.publishTask({
      publisher: publisherA,
      title: "delta-terminated",
      descriptionMd: "desc",
      acceptanceCriteria: "ok",
      deadlineUtc: deadline(),
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 10,
      allowRepeatCompletionsBySameAgent: false
    });

    engine.addTaskIntention(beta.id, worker);
    clock.advanceMinutes(31);
    const betaSubmission = engine.submitTask(beta.id, worker, "beta-result", [
      { name: "beta-log", url: "https://example.com/beta.log" }
    ]);
    clock.advanceMinutes(1);
    engine.rejectSubmission(betaSubmission.id, publisherA, "needs revision");
    clock.advanceMinutes(1);
    const dispute = engine.openDispute({
      taskId: beta.id,
      submissionId: betaSubmission.id,
      opener: publisherA,
      reasonMd: "beta-review"
    });

    clock.advanceMinutes(1);
    engine.addTaskIntention(gamma.id, worker);
    clock.advanceMinutes(31);
    const gammaSubmission = engine.submitTask(gamma.id, worker, "gamma-result");
    engine.confirmSubmission(gammaSubmission.id, publisherB);

    clock.advanceMinutes(1);
    engine.terminateTask(delta.id, publisherA);

    await repo.sync(engine.toSnapshot());

    const publisherPageOne = await repo.queryTasksDirect({
      publisher: publisherA.toUpperCase() as Address,
      sort: "reward",
      order: "desc",
      offset: 0,
      limit: 2,
      paged: true
    });
    expect(publisherPageOne.items.map((item) => item.id)).toEqual([alpha.id, beta.id]);
    expect(parseCursorOffset(publisherPageOne.nextCursor ?? undefined)).toBe(2);

    const publisherPageTwo = await repo.queryTasksDirect({
      publisher: publisherA.toUpperCase() as Address,
      sort: "reward",
      order: "desc",
      offset: 2,
      limit: 2,
      paged: true
    });
    expect(publisherPageTwo.items.map((item) => item.id)).toEqual([delta.id]);
    expect(publisherPageTwo.nextCursor).toBeNull();

    const publisherRewardPageOne = await repo.queryTasksDirect({
      publisher: publisherA.toUpperCase() as Address,
      sort: "reward",
      order: "desc",
      limit: 1,
      paged: true
    });
    expect(publisherRewardPageOne.items.map((item) => item.id)).toEqual([alpha.id]);
    expect(publisherRewardPageOne.nextCursor).not.toBeNull();
    const publisherRewardPageTwo = await repo.queryTasksDirect({
      publisher: publisherA.toUpperCase() as Address,
      sort: "reward",
      order: "desc",
      cursor: publisherRewardPageOne.nextCursor ?? undefined,
      limit: 2,
      paged: true
    });
    expect(publisherRewardPageTwo.items.map((item) => item.id)).toEqual([beta.id, delta.id]);
    expect(publisherRewardPageTwo.nextCursor).toBeNull();

    const publisherLatest = await repo.queryTasksDirect({
      publisher: publisherA.toUpperCase() as Address,
      sort: "latest",
      order: "desc",
      limit: 10,
      paged: true
    });
    const publisherLatestPageOne = await repo.queryTasksDirect({
      publisher: publisherA.toUpperCase() as Address,
      sort: "latest",
      order: "desc",
      limit: 1,
      paged: true
    });
    expect(publisherLatestPageOne.nextCursor).not.toBeNull();
    const publisherLatestPageTwo = await repo.queryTasksDirect({
      publisher: publisherA.toUpperCase() as Address,
      sort: "latest",
      order: "desc",
      cursor: publisherLatestPageOne.nextCursor ?? undefined,
      limit: 2,
      paged: true
    });
    expect([...publisherLatestPageOne.items, ...publisherLatestPageTwo.items].map((item) => item.id)).toEqual(
      publisherLatest.items.slice(0, 3).map((item) => item.id)
    );

    const alphaOnly = await repo.queryTasksDirect({
      q: "alpha-desc-token",
      status: TaskStatus.OPEN,
      sort: "latest",
      order: "desc",
      offset: 0,
      limit: 20,
      paged: true
    });
    expect(alphaOnly.items.map((item) => item.id)).toEqual([alpha.id]);

    const alphaByCriteria = await repo.queryTasksDirect({
      q: "alpha-criteria-token",
      status: TaskStatus.OPEN,
      sort: "latest",
      order: "desc",
      offset: 0,
      limit: 20,
      paged: true
    });
    expect(alphaByCriteria.items.map((item) => item.id)).toEqual([alpha.id]);

    const disputes = await repo.queryDisputesDirect({
      taskId: beta.id,
      opener: publisherA.toUpperCase() as Address,
      status: DisputeStatus.OPEN,
      q: "beta-review",
      sort: "latest",
      order: "desc",
      offset: 0,
      limit: 10,
      paged: true
    });
    expect(disputes.items.map((item) => item.id)).toEqual([dispute.id]);
    expect(disputes.nextCursor).toBeNull();

    const submissions = await repo.querySubmissionsDirect({
      taskId: beta.id,
      agent: worker.toUpperCase() as Address,
      status: SubmissionStatus.REJECTED,
      q: "beta-result",
      sort: "latest",
      order: "desc",
      offset: 0,
      limit: 10,
      paged: true
    });
    expect(submissions.items.map((item) => item.id)).toEqual([betaSubmission.id]);
    expect(submissions.items[0]?.attachments).toEqual([{ name: "beta-log", url: "https://example.com/beta.log" }]);
    expect(submissions.nextCursor).toBeNull();

    const workerSubmissionPageOne = await repo.querySubmissionsDirect({
      agent: worker.toUpperCase() as Address,
      sort: "latest",
      order: "asc",
      limit: 1,
      paged: true
    });
    expect(workerSubmissionPageOne.items.map((item) => item.id)).toEqual([betaSubmission.id]);
    expect(workerSubmissionPageOne.nextCursor).not.toBeNull();
    const workerSubmissionPageTwo = await repo.querySubmissionsDirect({
      agent: worker.toUpperCase() as Address,
      sort: "latest",
      order: "asc",
      cursor: workerSubmissionPageOne.nextCursor ?? undefined,
      limit: 1,
      paged: true
    });
    expect(workerSubmissionPageTwo.items.map((item) => item.id)).toEqual([gammaSubmission.id]);
    expect(workerSubmissionPageTwo.nextCursor).toBeNull();

    const betaActivityPageOne = await repo.queryActivitiesDirect({
      taskId: beta.id,
      order: "asc",
      offset: 0,
      limit: 2,
      paged: true
    });
    expect(betaActivityPageOne.items.map((item) => item.type)).toEqual([
      ActivityEventType.TASK_PUBLISHED,
      ActivityEventType.TASK_INTENDED
    ]);
    expect(parseCursorOffset(betaActivityPageOne.nextCursor ?? undefined)).toBe(2);

    const betaActivityPageTwo = await repo.queryActivitiesDirect({
      taskId: beta.id,
      order: "asc",
      offset: 2,
      limit: 2,
      paged: true
    });
    expect(betaActivityPageTwo.items.map((item) => item.type)).toEqual([
      ActivityEventType.TASK_SUBMITTED,
      ActivityEventType.SUBMISSION_REJECTED
    ]);
    expect(parseCursorOffset(betaActivityPageTwo.nextCursor ?? undefined)).toBe(4);

    const betaActivityPageThree = await repo.queryActivitiesDirect({
      taskId: beta.id,
      order: "asc",
      offset: 4,
      limit: 2,
      paged: true
    });
    expect(betaActivityPageThree.items.map((item) => item.type)).toEqual([
      ActivityEventType.DISPUTE_OPENED
    ]);
    expect(betaActivityPageThree.nextCursor).toBeNull();

    const betaActivityKeysetPageOne = await repo.queryActivitiesDirect({
      taskId: beta.id,
      order: "asc",
      limit: 2,
      paged: true
    });
    expect(betaActivityKeysetPageOne.items.map((item) => item.type)).toEqual([
      ActivityEventType.TASK_PUBLISHED,
      ActivityEventType.TASK_INTENDED
    ]);
    expect(betaActivityKeysetPageOne.nextCursor).not.toBeNull();
    const betaActivityKeysetPageTwo = await repo.queryActivitiesDirect({
      taskId: beta.id,
      order: "asc",
      cursor: betaActivityKeysetPageOne.nextCursor ?? undefined,
      limit: 3,
      paged: true
    });
    expect(betaActivityKeysetPageTwo.items.map((item) => item.type)).toEqual([
      ActivityEventType.TASK_SUBMITTED,
      ActivityEventType.SUBMISSION_REJECTED,
      ActivityEventType.DISPUTE_OPENED
    ]);
    expect(betaActivityKeysetPageTwo.nextCursor).toBeNull();

    const disputeActivities = await repo.queryActivitiesDirect({
      disputeId: dispute.id,
      type: ActivityEventType.DISPUTE_OPENED,
      order: "desc",
      limit: 5,
      paged: true
    });
    expect(disputeActivities.items.map((item) => item.type)).toEqual([
      ActivityEventType.DISPUTE_OPENED
    ]);
    expect(disputeActivities.nextCursor).toBeNull();

    const betaWorkerActivities = await repo.queryActivitiesDirect({
      taskId: beta.id,
      address: worker.toUpperCase() as Address,
      order: "asc",
      offset: 0,
      limit: 10,
      paged: true
    });
    expect(betaWorkerActivities.items.map((item) => item.type)).toEqual([
      ActivityEventType.TASK_INTENDED,
      ActivityEventType.TASK_SUBMITTED
    ]);
    expect(betaWorkerActivities.nextCursor).toBeNull();

    const betaWorkerActivityPageOne = await repo.queryActivitiesDirect({
      taskId: beta.id,
      address: worker.toUpperCase() as Address,
      order: "asc",
      limit: 1,
      paged: true
    });
    expect(betaWorkerActivityPageOne.items.map((item) => item.type)).toEqual([
      ActivityEventType.TASK_INTENDED
    ]);
    expect(betaWorkerActivityPageOne.nextCursor).not.toBeNull();
    const betaWorkerActivityPageTwo = await repo.queryActivitiesDirect({
      taskId: beta.id,
      address: worker.toUpperCase() as Address,
      order: "asc",
      cursor: betaWorkerActivityPageOne.nextCursor ?? undefined,
      limit: 1,
      paged: true
    });
    expect(betaWorkerActivityPageTwo.items.map((item) => item.type)).toEqual([
      ActivityEventType.TASK_SUBMITTED
    ]);
    expect(betaWorkerActivityPageTwo.nextCursor).toBeNull();
  });

  it("queries agents and dashboard aggregates directly from normalized tables", async () => {
    const now = new Date();
    const currentUtcDay = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 8, 0, 0, 0)
    );
    const clock = new MutableClock(currentUtcDay);
    const engine = new AgentradeEngine(defaultConfig, clock);
    const publisherA = addr("agent-a");
    const publisherB = addr("agent-b");
    const worker = addr("agent-worker");
    const supervisor = addr("agent-supervisor");
    const inactive = addr("agent-idle");
    const deadline = () => new Date(clock.now().getTime() + 72 * 3_600_000).toISOString();

    engine.publishTask({
      publisher: publisherA,
      title: "agent-alpha",
      descriptionMd: "desc",
      acceptanceCriteria: "ok",
      deadlineUtc: deadline(),
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 20,
      allowRepeatCompletionsBySameAgent: false
    });
    clock.advanceMinutes(1);

    const beta = engine.publishTask({
      publisher: publisherA,
      title: "agent-beta",
      descriptionMd: "desc",
      acceptanceCriteria: "ok",
      deadlineUtc: deadline(),
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 30,
      allowRepeatCompletionsBySameAgent: false
    });
    clock.advanceMinutes(1);

    const gamma = engine.publishTask({
      publisher: publisherB,
      title: "agent-gamma",
      descriptionMd: "desc",
      acceptanceCriteria: "ok",
      deadlineUtc: deadline(),
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 40,
      allowRepeatCompletionsBySameAgent: false
    });

    engine.addTaskIntention(beta.id, worker);
    clock.advanceMinutes(31);
    const betaSubmission = engine.submitTask(beta.id, worker, "beta-result");
    engine.rejectSubmission(betaSubmission.id, publisherA, "needs revision");
    const dispute = engine.openDispute({
      taskId: beta.id,
      submissionId: betaSubmission.id,
      opener: publisherA,
      reasonMd: "agent-review"
    });
    engine.voteDispute({
      disputeId: dispute.id,
      agent: supervisor,
      vote: VoteChoice.COMPLETED
    });

    clock.advanceMinutes(1);
    engine.addTaskIntention(gamma.id, worker);
    clock.advanceMinutes(31);
    const gammaSubmission = engine.submitTask(gamma.id, worker, "gamma-result");
    engine.confirmSubmission(gammaSubmission.id, publisherB);

    await repo.sync(engine.toSnapshot());
    await repo.updateAgentProfileDirect(inactive, { name: "Dormant", bio: "idle profile" });

    const dormantAgents = await repo.queryAgentsDirect({
      q: "Dormant",
      activeOnly: false,
      sort: "latest",
      order: "desc",
      offset: 0,
      limit: 10,
      paged: true
    });
    expect(dormantAgents.items).toHaveLength(1);
    expect(dormantAgents.items[0].address).toBe(inactive);
    expect(dormantAgents.items[0].isActive).toBe(false);

    const activeAgents = await repo.queryAgentsDirect({
      activeOnly: true,
      sort: "completed",
      order: "desc",
      offset: 0,
      limit: 10,
      paged: true
    });
    expect(activeAgents.items[0].address).toBe(worker);
    expect(activeAgents.items.some((item) => item.address === inactive)).toBe(false);

    const latestAsc = await repo.queryAgentsDirect({
      activeOnly: false,
      sort: "latest",
      order: "asc",
      limit: 10,
      paged: true
    });
    const firstAscNonNullIndex = latestAsc.items.findIndex((item) => item.latestActivityAt !== null);
    expect(firstAscNonNullIndex).toBeGreaterThan(0);
    expect(latestAsc.items.slice(0, firstAscNonNullIndex).every((item) => item.latestActivityAt === null)).toBe(true);
    expect(latestAsc.items.slice(firstAscNonNullIndex).every((item) => item.latestActivityAt !== null)).toBe(true);
    const latestAscNullAddresses = latestAsc.items
      .filter((item) => item.latestActivityAt === null)
      .map((item) => item.address);
    expect(latestAscNullAddresses).toEqual([...latestAscNullAddresses].sort());

    const latestAscPageOne = await repo.queryAgentsDirect({
      activeOnly: false,
      sort: "latest",
      order: "asc",
      limit: 1,
      paged: true
    });
    expect(latestAscPageOne.nextCursor).not.toBeNull();

    const latestAscPageTwo = await repo.queryAgentsDirect({
      activeOnly: false,
      sort: "latest",
      order: "asc",
      cursor: latestAscPageOne.nextCursor ?? undefined,
      limit: 2,
      paged: true
    });
    expect([...latestAscPageOne.items, ...latestAscPageTwo.items].map((item) => item.address)).toEqual(
      latestAsc.items.slice(0, 3).map((item) => item.address)
    );

    const latestDesc = await repo.queryAgentsDirect({
      activeOnly: false,
      sort: "latest",
      order: "desc",
      limit: 10,
      paged: true
    });
    const firstDescNullIndex = latestDesc.items.findIndex((item) => item.latestActivityAt === null);
    expect(firstDescNullIndex).toBeGreaterThan(0);
    expect(latestDesc.items.slice(0, firstDescNullIndex).every((item) => item.latestActivityAt !== null)).toBe(true);
    expect(latestDesc.items.slice(firstDescNullIndex).every((item) => item.latestActivityAt === null)).toBe(true);
    const latestDescNullAddresses = latestDesc.items
      .filter((item) => item.latestActivityAt === null)
      .map((item) => item.address);
    expect(latestDescNullAddresses).toEqual([...latestDescNullAddresses].sort().reverse());

    const weightedConfig = {
      ...defaultConfig,
      scoreWeightReputationBps: 7000,
      scoreWeightCompletionBps: 2000,
      scoreWeightQualityBps: 1000
    };
    const weightedRepo = new PrismaStateRepository(TEST_DB_URL!, weightedConfig);
    try {
      const pageOne = await weightedRepo.queryAgentsDirect({
        activeOnly: false,
        sort: "score",
        order: "desc",
        offset: 0,
        limit: 2,
        paged: true
      });
      const pageTwo = pageOne.nextCursor
        ? await weightedRepo.queryAgentsDirect({
            activeOnly: false,
            sort: "score",
            order: "desc",
            cursor: pageOne.nextCursor,
            offset: 0,
            limit: 2,
            paged: true
          })
        : { items: [], nextCursor: null as string | null };

      const observed = [...pageOne.items, ...pageTwo.items];
      expect(new Set(observed.map((item) => item.address)).size).toBe(observed.length);
      expect(observed.length).toBeGreaterThan(1);
      for (let index = 0; index < observed.length - 1; index += 1) {
        const current = observed[index];
        const next = observed[index + 1];
        if (current.score === next.score) {
          expect(current.address >= next.address).toBe(true);
        } else {
          expect(current.score >= next.score).toBe(true);
        }
      }
      for (const item of observed) {
        expect(item.score).toBe(toAgentScore(item, weightedConfig));
      }
    } finally {
      await weightedRepo.close();
    }

    const summary = await repo.getDashboardSummaryDirect("UTC");
    expect(summary.timezone).toBe("UTC");
    expect(summary.activeCycleId).toBe("cycle-1");
    expect(summary.today).toEqual({
      tasksPublished: 3,
      tasksIntented: 2,
      tasksCompleted: 1,
      disputesOpened: 1
    });
    expect(summary.currentCycle).toEqual(summary.today);
    expect(summary.totals).toEqual({
      tasks: 3,
      disputes: 1,
      agents: 5
    });

    const trends = await repo.getDashboardTrendsDirect("UTC", "7d");
    expect(trends.window).toBe("7d");
    expect(trends.points).toHaveLength(7);
    expect(trends.points.reduce((sum, item) => sum + item.tasksPublished, 0)).toBe(3);
    expect(trends.points.reduce((sum, item) => sum + item.tasksIntented, 0)).toBe(2);
    expect(trends.points.reduce((sum, item) => sum + item.tasksCompleted, 0)).toBe(1);
    expect(trends.points.reduce((sum, item) => sum + item.disputesOpened, 0)).toBe(1);

    const reputationTieAgents = [
      addr("agent-reputation-a"),
      addr("agent-reputation-b"),
      addr("agent-reputation-c")
    ];
    for (const address of reputationTieAgents) {
      await repo.updateAgentProfileDirect(address, {
        name: "Reputation Cursor",
        bio: "same repeating reputation average"
      });
    }
    const reputationPrisma = new PrismaClient({
      datasources: {
        db: {
          url: TEST_DB_URL!
        }
      }
    });
    try {
      await Promise.all(
        reputationTieAgents.map((address) =>
          reputationPrisma.agentProfile.update({
            where: { address },
            data: {
              publisherRep: 100,
              workerRep: 50,
              supervisorRep: 50
            }
          })
        )
      );
    } finally {
      await reputationPrisma.$disconnect();
    }
    const reputationTieExpected = [...reputationTieAgents].sort().reverse();
    const reputationPageOne = await repo.queryAgentsDirect({
      activeOnly: false,
      sort: "reputation",
      order: "desc",
      limit: 1,
      paged: true
    });
    expect(reputationPageOne.items.map((item) => item.address)).toEqual([
      reputationTieExpected[0]
    ]);
    expect(reputationPageOne.nextCursor).not.toBeNull();
    const reputationPageTwo = await repo.queryAgentsDirect({
      activeOnly: false,
      sort: "reputation",
      order: "desc",
      cursor: reputationPageOne.nextCursor ?? undefined,
      limit: 2,
      paged: true
    });
    expect([...reputationPageOne.items, ...reputationPageTwo.items].map((item) => item.address)).toEqual(
      reputationTieExpected
    );
  });

  it("builds grouped account todos directly from persistence tables", async () => {
    const clock = new MutableClock(new Date("2026-04-01T00:00:00.000Z"));
    const engine = new AgentradeEngine(defaultConfig, clock);
    const target = addr("repo-todo-target");
    const otherPublisher = addr("repo-todo-other-publisher");
    const workerB = addr("repo-todo-worker-b");
    const workerC = addr("repo-todo-worker-c");

    const deadline = () => new Date(clock.now().getTime() + 72 * 3_600_000).toISOString();

    const rejectedTask = engine.publishTask({
      publisher: otherPublisher,
      title: "repo-todo-rejected",
      descriptionMd: "desc",
      acceptanceCriteria: "ok",
      deadlineUtc: deadline(),
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 10,
      allowRepeatCompletionsBySameAgent: false
    });
    engine.addTaskIntention(rejectedTask.id, target);
    clock.advanceMinutes(31);
    const rejectedSubmission = engine.submitTask(rejectedTask.id, target, "todo rejected");
    engine.rejectSubmission(rejectedSubmission.id, otherPublisher, "needs revision");

    clock.advanceMinutes(1);
    const counterpartyTask = engine.publishTask({
      publisher: target,
      title: "repo-todo-counterparty",
      descriptionMd: "desc",
      acceptanceCriteria: "ok",
      deadlineUtc: deadline(),
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 10,
      allowRepeatCompletionsBySameAgent: false
    });
    engine.addTaskIntention(counterpartyTask.id, workerB);
    clock.advanceMinutes(31);
    const counterpartySubmission = engine.submitTask(counterpartyTask.id, workerB, "needs review");
    engine.rejectSubmission(counterpartySubmission.id, target, "needs revision");
    engine.openDispute({
      taskId: counterpartyTask.id,
      submissionId: counterpartySubmission.id,
      opener: workerB,
      reasonMd: "todo dispute"
    });

    clock.advanceMinutes(1);
    const pendingReviewTask = engine.publishTask({
      publisher: target,
      title: "repo-todo-pending-review",
      descriptionMd: "desc",
      acceptanceCriteria: "ok",
      deadlineUtc: deadline(),
      displayTimezone: "UTC",
      slotsTotal: 2,
      rewardPerSlot: 10,
      allowRepeatCompletionsBySameAgent: false
    });
    engine.addTaskIntention(pendingReviewTask.id, workerB);
    clock.advanceMinutes(31);
    const pendingSubmissionA = engine.submitTask(pendingReviewTask.id, workerB, "pending a");
    engine.addTaskIntention(pendingReviewTask.id, workerC);
    clock.advanceMinutes(31);
    const pendingSubmissionB = engine.submitTask(pendingReviewTask.id, workerC, "pending b");

    const expiredTask = engine.publishTask({
      publisher: target,
      title: "repo-todo-expired",
      descriptionMd: "desc",
      acceptanceCriteria: "ok",
      deadlineUtc: deadline(),
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 10,
      allowRepeatCompletionsBySameAgent: false
    });
    engine.getTask(expiredTask.id).deadlineUtc = new Date(clock.now().getTime() - 60_000).toISOString();

    clock.advanceMinutes(1);
    const intendedTask = engine.publishTask({
      publisher: otherPublisher,
      title: "repo-todo-intended",
      descriptionMd: "desc",
      acceptanceCriteria: "ok",
      deadlineUtc: deadline(),
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 10,
      allowRepeatCompletionsBySameAgent: false
    });
    engine.addTaskIntention(intendedTask.id, target);

    clock.advanceMinutes(1);
    const waitingReviewTask = engine.publishTask({
      publisher: otherPublisher,
      title: "repo-todo-waiting-review",
      descriptionMd: "desc",
      acceptanceCriteria: "ok",
      deadlineUtc: deadline(),
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 10,
      allowRepeatCompletionsBySameAgent: false
    });
    engine.addTaskIntention(waitingReviewTask.id, target);
    clock.advanceMinutes(31);
    const waitingSubmission = engine.submitTask(waitingReviewTask.id, target, "awaiting publisher");

    const waitingNewSubmissionTask = engine.publishTask({
      publisher: target,
      title: "repo-todo-waiting-new",
      descriptionMd: "desc",
      acceptanceCriteria: "ok",
      deadlineUtc: deadline(),
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 10,
      allowRepeatCompletionsBySameAgent: false
    });

    clock.advanceMinutes(1);
    const waitingResolutionTask = engine.publishTask({
      publisher: otherPublisher,
      title: "repo-todo-waiting-resolution",
      descriptionMd: "desc",
      acceptanceCriteria: "ok",
      deadlineUtc: deadline(),
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 10,
      allowRepeatCompletionsBySameAgent: false
    });
    engine.addTaskIntention(waitingResolutionTask.id, target);
    clock.advanceMinutes(31);
    const waitingResolutionSubmission = engine.submitTask(
      waitingResolutionTask.id,
      target,
      "open dispute"
    );
    engine.rejectSubmission(waitingResolutionSubmission.id, otherPublisher, "needs revision");
    const waitingResolutionDispute = engine.openDispute({
      taskId: waitingResolutionTask.id,
      submissionId: waitingResolutionSubmission.id,
      opener: target,
      reasonMd: "todo dispute"
    });

    await repo.sync(engine.toSnapshot());

    const allGroups = await repo.getTodosDirect({
      address: target,
      scope: "all",
      limit: 1,
      generatedAt: clock.now().toISOString()
    });
    expect(allGroups.address).toBe(target);
    expect(allGroups.groups).toHaveLength(8);

    const groups = new Map(allGroups.groups.map((group) => [group.type, group]));
    expect(groups.get("latest_rejected_submission_no_followup")?.items[0]?.submissionId).toBe(rejectedSubmission.id);
    expect(groups.get("open_dispute_counterparty_response_required")?.totalCount).toBe(1);
    expect(groups.get("published_task_submission_pending_review")?.totalCount).toBe(2);
    expect(groups.get("published_task_submission_pending_review")?.nextCursor).not.toBeNull();
    expect(groups.get("expired_published_task_cleanup_required")?.items[0]?.taskId).toBe(expiredTask.id);
    expect(groups.get("intended_task_never_submitted")?.items[0]?.taskId).toBe(intendedTask.id);
    expect(groups.get("submitted_submission_waiting_review")?.items[0]?.submissionId).toBe(waitingSubmission.id);
    expect(groups.get("published_task_waiting_new_submission")?.items[0]?.taskId).toBe(waitingNewSubmissionTask.id);
    expect(groups.get("open_dispute_waiting_resolution")?.items[0]?.disputeId).toBe(waitingResolutionDispute.id);

    const intendedOnly = await repo.getTodosDirect({
      address: target.toUpperCase() as Address,
      scope: "action_required",
      type: "intended_task_never_submitted",
      limit: 5,
      generatedAt: clock.now().toISOString()
    });
    expect(intendedOnly.groups).toHaveLength(1);
    expect(intendedOnly.groups[0]?.totalCount).toBe(1);
    expect(intendedOnly.groups[0]?.items.map((item) => item.taskId)).toEqual([intendedTask.id]);

    const pageOne = await repo.getTodosDirect({
      address: target,
      scope: "action_required",
      type: "published_task_submission_pending_review",
      limit: 1,
      generatedAt: clock.now().toISOString()
    });
    expect(pageOne.groups).toHaveLength(1);
    expect(pageOne.groups[0]?.totalCount).toBe(2);
    expect(pageOne.groups[0]?.nextCursor).not.toBeNull();
    expect([pendingSubmissionA.id, pendingSubmissionB.id]).toContain(
      pageOne.groups[0]?.items[0]?.submissionId
    );

    const pageTwo = await repo.getTodosDirect({
      address: target,
      scope: "action_required",
      type: "published_task_submission_pending_review",
      cursor: pageOne.groups[0]!.nextCursor ?? undefined,
      limit: 1,
      generatedAt: clock.now().toISOString()
    });
    expect(pageTwo.groups[0]?.items).toHaveLength(1);
    expect(pageTwo.groups[0]?.totalCount).toBe(2);
    expect(pageTwo.groups[0]?.items[0]?.submissionId).not.toBe(pageOne.groups[0]?.items[0]?.submissionId);

    const exhaustedCursor = encodeKeysetCursor({
      resource: "todos:published_task_submission_pending_review",
      sort: "updatedAt",
      order: "desc",
      offset: 2,
      values: {
        primary: pageTwo.groups[0]!.items[0]!.updatedAt,
        id: pageTwo.groups[0]!.items[0]!.submissionId!
      }
    });
    const exhaustedPage = await repo.getTodosDirect({
      address: target,
      scope: "action_required",
      type: "published_task_submission_pending_review",
      cursor: exhaustedCursor,
      limit: 1,
      generatedAt: clock.now().toISOString()
    });
    expect(exhaustedPage.groups[0]?.items).toHaveLength(0);
    expect(exhaustedPage.groups[0]?.totalCount).toBe(2);
    expect(exhaustedPage.groups[0]?.nextCursor).toBeNull();
  });

  it("keeps latest rejected todo items aligned with per-task latest submission semantics", async () => {
    const clock = new MutableClock(new Date("2026-04-02T00:00:00.000Z"));
    const engine = new AgentradeEngine(defaultConfig, clock);
    const publisher = addr("repo-todo-latest-publisher");
    const target = addr("repo-todo-latest-worker");
    const deadline = () => new Date(clock.now().getTime() + 72 * 3_600_000).toISOString();
    const publish = (title: string) =>
      engine.publishTask({
        publisher,
        title,
        descriptionMd: "desc",
        acceptanceCriteria: "ok",
        deadlineUtc: deadline(),
        displayTimezone: "UTC",
        slotsTotal: 1,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: false
      });

    const needsFollowupTask = publish("repo-todo-latest-rejected");
    engine.addTaskIntention(needsFollowupTask.id, target);
    clock.advanceMinutes(31);
    const needsFollowupSubmission = engine.submitTask(
      needsFollowupTask.id,
      target,
      "needs follow-up"
    );
    engine.rejectSubmission(needsFollowupSubmission.id, publisher, "needs revision");

    clock.advanceMinutes(1);
    const newerSubmissionTask = publish("repo-todo-latest-newer-submission");
    engine.addTaskIntention(newerSubmissionTask.id, target);
    clock.advanceMinutes(31);
    const staleRejectedSubmission = engine.submitTask(
      newerSubmissionTask.id,
      target,
      "stale rejected"
    );
    engine.rejectSubmission(staleRejectedSubmission.id, publisher, "needs revision");
    clock.advanceMinutes(defaultConfig.resubmitCooldownMinutes + 1);
    const newerSubmission = engine.submitTask(newerSubmissionTask.id, target, "newer submission");

    await repo.sync(engine.toSnapshot());

    const todos = await repo.getTodosDirect({
      address: target,
      scope: "action_required",
      type: "latest_rejected_submission_no_followup",
      limit: 10,
      generatedAt: clock.now().toISOString()
    });

    expect(todos.groups).toHaveLength(1);
    expect(todos.groups[0]?.totalCount).toBe(1);
    expect(todos.groups[0]?.items.map((item) => item.submissionId)).toEqual([
      needsFollowupSubmission.id
    ]);
    expect(todos.groups[0]?.items.map((item) => item.submissionId)).not.toContain(
      staleRejectedSubmission.id
    );
    expect(todos.groups[0]?.items.map((item) => item.submissionId)).not.toContain(newerSubmission.id);
  });

  it("keeps dispute todo role branches aligned with opener and counterparty semantics", async () => {
    const clock = new MutableClock(new Date("2026-04-03T00:00:00.000Z"));
    const engine = new AgentradeEngine(defaultConfig, clock);
    const publisher = addr("rtdd-publisher");
    const workerA = addr("rtdd-worker-a");
    const workerB = addr("rtdd-worker-b");
    const deadline = () => new Date(clock.now().getTime() + 72 * 3_600_000).toISOString();
    const publishRejectedSubmission = (title: string, worker: Address) => {
      const task = engine.publishTask({
        publisher,
        title,
        descriptionMd: "desc",
        acceptanceCriteria: "ok",
        deadlineUtc: deadline(),
        displayTimezone: "UTC",
        slotsTotal: 1,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: false
      });
      engine.addTaskIntention(task.id, worker);
      clock.advanceMinutes(31);
      const submission = engine.submitTask(task.id, worker, `${title} payload`);
      engine.rejectSubmission(submission.id, publisher, "needs revision");
      clock.advanceMinutes(1);
      return { task, submission };
    };

    const workerResponseRequired = publishRejectedSubmission("repo-todo-dispute-worker-required", workerA);
    const workerResponseRequiredDispute = engine.openDispute({
      taskId: workerResponseRequired.task.id,
      submissionId: workerResponseRequired.submission.id,
      opener: publisher,
      reasonMd: "publisher asks for response"
    });

    const publisherResponseRequired = publishRejectedSubmission("repo-todo-dispute-publisher-required", workerB);
    const publisherResponseRequiredDispute = engine.openDispute({
      taskId: publisherResponseRequired.task.id,
      submissionId: publisherResponseRequired.submission.id,
      opener: workerB,
      reasonMd: "worker asks for response"
    });

    const workerWaitingResolution = publishRejectedSubmission("repo-todo-dispute-worker-waiting", workerA);
    const workerWaitingResolutionDispute = engine.openDispute({
      taskId: workerWaitingResolution.task.id,
      submissionId: workerWaitingResolution.submission.id,
      opener: publisher,
      reasonMd: "publisher asks for response"
    });
    engine.respondDispute({
      disputeId: workerWaitingResolutionDispute.id,
      responder: workerA,
      reasonMd: "worker response"
    });

    await repo.sync(engine.toSnapshot());

    const workerActionRequired = await repo.getTodosDirect({
      address: workerA,
      scope: "action_required",
      type: "open_dispute_counterparty_response_required",
      limit: 10,
      generatedAt: clock.now().toISOString()
    });
    expect(workerActionRequired.groups[0]?.items.map((item) => item.disputeId)).toEqual([
      workerResponseRequiredDispute.id
    ]);

    const publisherActionRequired = await repo.getTodosDirect({
      address: publisher,
      scope: "action_required",
      type: "open_dispute_counterparty_response_required",
      limit: 10,
      generatedAt: clock.now().toISOString()
    });
    expect(publisherActionRequired.groups[0]?.items.map((item) => item.disputeId)).toEqual([
      publisherResponseRequiredDispute.id
    ]);

    const workerWaiting = await repo.getTodosDirect({
      address: workerA,
      scope: "waiting",
      type: "open_dispute_waiting_resolution",
      limit: 10,
      generatedAt: clock.now().toISOString()
    });
    expect(workerWaiting.groups[0]?.items.map((item) => item.disputeId)).toEqual([
      workerWaitingResolutionDispute.id
    ]);
  });
});
