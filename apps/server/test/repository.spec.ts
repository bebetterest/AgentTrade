import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { defaultConfig } from "@agentrade/config";
import type { Address } from "@agentrade/types";
import { VoteChoice } from "@agentrade/types";
import { AgentradeEngine } from "../src/domain/engine.js";
import { MutableClock } from "../src/utils/time.js";
import { PrismaStateRepository } from "../src/infra/state-repository.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const runDbSuite = TEST_DB_URL ? describe : describe.skip;
const addr = (seed: string): Address => `0x${seed.padEnd(40, "0")}` as Address;

runDbSuite("PrismaStateRepository", () => {
  let repo: PrismaStateRepository;

  beforeAll(async () => {
    repo = new PrismaStateRepository(TEST_DB_URL!);
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
    engine.acceptTask(task.id, worker);
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
});
