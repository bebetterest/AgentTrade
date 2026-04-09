import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { defaultConfig } from "@agentrade/config";
import type { Address } from "@agentrade/types";
import { ActivityEventType, DisputeStatus, SubmissionStatus, TaskStatus, VoteChoice } from "@agentrade/types";
import { AgentradeEngine } from "../src/domain/engine.js";
import { parseCursorOffset, toAgentScore } from "../src/api/services.js";
import { MutableClock } from "../src/utils/time.js";
import { PrismaStateRepository } from "../src/infra/state-repository.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const REQUIRE_DB_URL = process.env.REQUIRE_TEST_DATABASE_URL === "true";
if (REQUIRE_DB_URL && !TEST_DB_URL) {
  throw new Error(
    "TEST_DATABASE_URL is required when REQUIRE_TEST_DATABASE_URL=true. " +
      "Set TEST_DATABASE_URL explicitly or run Docker-backed DB scripts."
  );
}
const runDbSuite = TEST_DB_URL ? describe : describe.skip;
const addr = (seed: string): Address => `0x${seed.padEnd(40, "0")}` as Address;

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
      deadlineUtc: "2026-05-01T00:00:00.000Z",
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 20,
      allowRepeatCompletionsBySameAgent: false
    });
    engine.addTaskIntention(task.id, worker);
    clock.advanceMinutes(31);
    const submission = engine.submitTask(task.id, worker, "payload");
    engine.rejectSubmission(submission.id, publisher);
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
          deadlineUtc: "2026-05-01T00:00:00.000Z",
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
      deadlineUtc: "2026-05-01T00:00:00.000Z",
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

  it("deletes entities that were removed from snapshot during sync", async () => {
    const engine = new AgentradeEngine(defaultConfig);
    const publisher = addr("inc-b");
    engine.publishTask({
      publisher,
      title: "to-be-deleted",
      descriptionMd: "desc",
      acceptanceCriteria: "ok",
      deadlineUtc: "2026-05-01T00:00:00.000Z",
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
    engine.rejectSubmission(betaSubmission.id, publisherA);
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
      publisher: publisherA,
      sort: "reward",
      order: "desc",
      offset: 0,
      limit: 2,
      paged: true
    });
    expect(publisherPageOne.items.map((item) => item.id)).toEqual([alpha.id, beta.id]);
    expect(parseCursorOffset(publisherPageOne.nextCursor ?? undefined)).toBe(2);

    const publisherPageTwo = await repo.queryTasksDirect({
      publisher: publisherA,
      sort: "reward",
      order: "desc",
      offset: 2,
      limit: 2,
      paged: true
    });
    expect(publisherPageTwo.items.map((item) => item.id)).toEqual([delta.id]);
    expect(publisherPageTwo.nextCursor).toBeNull();

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
      opener: publisherA,
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
      agent: worker,
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

    const alpha = engine.publishTask({
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
    engine.rejectSubmission(betaSubmission.id, publisherA);
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
  });
});
