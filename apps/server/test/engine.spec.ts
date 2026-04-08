import { describe, expect, it } from "vitest";
import { defaultConfig } from "@agentrade/config";
import { VoteChoice, type Address } from "@agentrade/types";
import { AgentradeEngine } from "../src/domain/engine.js";
import { MutableClock } from "../src/utils/time.js";

const addr = (seed: string): Address => `0x${seed.padEnd(40, "0")}` as Address;

const makeEngine = () => {
  const clock = new MutableClock(new Date("2026-03-30T00:00:00.000Z"));
  const engine = new AgentradeEngine(defaultConfig, clock);
  return { engine, clock };
};

describe("AgentradeEngine disputes and cycle settlement", () => {
  it("rejects duplicate supervision participation deterministically with 409 domain status", () => {
    const { engine, clock } = makeEngine();
    const publisher = addr("aa");
    const worker = addr("bb");
    const supervisor = addr("cc");
    const task = engine.publishTask({
      publisher,
      title: "Task 1",
      descriptionMd: "desc",
      acceptanceCriteria: "accept",
      deadlineUtc: "2026-04-02T00:00:00.000Z",
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 10,
      allowRepeatCompletionsBySameAgent: false
    });
    engine.addTaskIntention(task.id, worker);
    clock.advanceMinutes(31);
    const submission = engine.submitTask(task.id, worker, "work");
    engine.rejectSubmission(submission.id, publisher);
    const dispute = engine.openDispute({
      taskId: task.id,
      submissionId: submission.id,
      opener: publisher,
      reasonMd: "need review"
    });

    engine.voteDispute({ disputeId: dispute.id, agent: supervisor, vote: VoteChoice.COMPLETED });
    expect(() =>
      engine.voteDispute({ disputeId: dispute.id, agent: supervisor, vote: VoteChoice.NOT_COMPLETED })
    ).toThrowError(/only once per dispute/i);
  });

  it("settles supervision rewards on cycle close even when dispute remains delayed", () => {
    const { engine, clock } = makeEngine();
    const publisher = addr("11");
    const worker = addr("22");
    const supervisors = [addr("31"), addr("32"), addr("33"), addr("34")];
    const task = engine.publishTask({
      publisher,
      title: "Task 2",
      descriptionMd: "desc",
      acceptanceCriteria: "accept",
      deadlineUtc: "2026-04-03T00:00:00.000Z",
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 20,
      allowRepeatCompletionsBySameAgent: false
    });
    engine.addTaskIntention(task.id, worker);
    clock.advanceMinutes(31);
    const submission = engine.submitTask(task.id, worker, "work");
    engine.rejectSubmission(submission.id, publisher);
    const dispute = engine.openDispute({
      taskId: task.id,
      submissionId: submission.id,
      opener: publisher,
      reasonMd: "needs supervision"
    });
    for (const supervisor of supervisors) {
      engine.voteDispute({ disputeId: dispute.id, agent: supervisor, vote: VoteChoice.NOT_COMPLETED });
    }

    const before = engine.getLedger(supervisors[0]).available;
    const close = engine.closeCurrentCycle();
    const after = engine.getLedger(supervisors[0]).available;
    expect(close.finalizedDisputes).toHaveLength(0);
    expect(after).toBeGreaterThan(before);
  });

  it("does not carry cycle-N supervision workload into cycle N+1", () => {
    const { engine, clock } = makeEngine();
    const publisher = addr("41");
    const worker = addr("42");
    const supervisor = addr("43");
    const task = engine.publishTask({
      publisher,
      title: "Task 3",
      descriptionMd: "desc",
      acceptanceCriteria: "accept",
      deadlineUtc: "2026-04-03T00:00:00.000Z",
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 20,
      allowRepeatCompletionsBySameAgent: false
    });
    engine.addTaskIntention(task.id, worker);
    clock.advanceMinutes(31);
    const submission = engine.submitTask(task.id, worker, "work");
    engine.rejectSubmission(submission.id, publisher);
    const dispute = engine.openDispute({
      taskId: task.id,
      submissionId: submission.id,
      opener: publisher,
      reasonMd: "review"
    });
    engine.voteDispute({ disputeId: dispute.id, agent: supervisor, vote: VoteChoice.NOT_COMPLETED });
    const cycle1 = engine.getActiveCycle().id;
    const beforeClose1 = engine.getLedger(supervisor).available;
    engine.closeCurrentCycle();
    const afterClose1 = engine.getLedger(supervisor).available;
    expect(afterClose1).toBeGreaterThan(beforeClose1);

    const cycle2 = engine.getActiveCycle().id;
    expect(cycle2).not.toBe(cycle1);
    const beforeClose2 = engine.getLedger(supervisor).available;
    engine.closeCurrentCycle();
    const afterClose2 = engine.getLedger(supervisor).available;
    expect(afterClose2 - beforeClose2).toBe(0);
  });

  it("keeps prior votes for delayed disputes and blocks re-participation next cycle", () => {
    const { engine, clock } = makeEngine();
    const publisher = addr("51");
    const worker = addr("52");
    const supervisor = addr("53");
    const task = engine.publishTask({
      publisher,
      title: "Task 4",
      descriptionMd: "desc",
      acceptanceCriteria: "accept",
      deadlineUtc: "2026-04-03T00:00:00.000Z",
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 20,
      allowRepeatCompletionsBySameAgent: false
    });
    engine.addTaskIntention(task.id, worker);
    clock.advanceMinutes(31);
    const submission = engine.submitTask(task.id, worker, "work");
    engine.rejectSubmission(submission.id, publisher);
    const dispute = engine.openDispute({
      taskId: task.id,
      submissionId: submission.id,
      opener: publisher,
      reasonMd: "review"
    });
    engine.voteDispute({ disputeId: dispute.id, agent: supervisor, vote: VoteChoice.COMPLETED });
    engine.closeCurrentCycle();

    expect(engine.getDispute(dispute.id).status).toBe("OPEN");
    expect(() =>
      engine.voteDispute({ disputeId: dispute.id, agent: supervisor, vote: VoteChoice.COMPLETED })
    ).toThrowError(/only once per dispute/i);
  });

  it("runs end-to-end publish->intend->submit->reject->dispute->settlement lifecycle", () => {
    const { engine, clock } = makeEngine();
    const publisher = addr("61");
    const worker = addr("62");
    const supervisors = [addr("71"), addr("72"), addr("73"), addr("74"), addr("75")];
    const beforeWorker = engine.getLedger(worker).available;
    const task = engine.publishTask({
      publisher,
      title: "Task 5",
      descriptionMd: "desc",
      acceptanceCriteria: "accept",
      deadlineUtc: "2026-04-03T00:00:00.000Z",
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 20,
      allowRepeatCompletionsBySameAgent: false
    });
    engine.addTaskIntention(task.id, worker);
    clock.advanceMinutes(31);
    const submission = engine.submitTask(task.id, worker, "work");
    engine.rejectSubmission(submission.id, publisher);
    const dispute = engine.openDispute({
      taskId: task.id,
      submissionId: submission.id,
      opener: worker,
      reasonMd: "publisher rejected valid completion"
    });
    for (const supervisor of supervisors) {
      engine.voteDispute({ disputeId: dispute.id, agent: supervisor, vote: VoteChoice.COMPLETED });
    }
    const close = engine.closeCurrentCycle();
    expect(close.finalizedDisputes.includes(dispute.id)).toBe(true);
    expect(engine.getDispute(dispute.id).status).toBe("RESOLVED_COMPLETED");
    expect(engine.getTask(task.id).status).toBe("CLOSED");
    expect(engine.getLedger(worker).available).toBeGreaterThan(beforeWorker);
  });

  it("restores state from snapshot and preserves single-participation dispute rule", () => {
    const { engine, clock } = makeEngine();
    const publisher = addr("81");
    const worker = addr("82");
    const supervisor = addr("83");
    const task = engine.publishTask({
      publisher,
      title: "Task 6",
      descriptionMd: "desc",
      acceptanceCriteria: "accept",
      deadlineUtc: "2026-04-03T00:00:00.000Z",
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 20,
      allowRepeatCompletionsBySameAgent: false
    });
    engine.addTaskIntention(task.id, worker);
    clock.advanceMinutes(31);
    const submission = engine.submitTask(task.id, worker, "work");
    engine.rejectSubmission(submission.id, publisher);
    const dispute = engine.openDispute({
      taskId: task.id,
      submissionId: submission.id,
      opener: publisher,
      reasonMd: "review"
    });
    engine.voteDispute({ disputeId: dispute.id, agent: supervisor, vote: VoteChoice.COMPLETED });

    const restored = AgentradeEngine.fromSnapshot(defaultConfig, engine.toSnapshot(), clock);
    expect(restored.getDispute(dispute.id).status).toBe("OPEN");
    expect(() =>
      restored.voteDispute({ disputeId: dispute.id, agent: supervisor, vote: VoteChoice.NOT_COMPLETED })
    ).toThrowError(/only once per dispute/i);
  });

  it("reopens dispute to OPEN when admin overrides as NOT_COMPLETED", () => {
    const { engine, clock } = makeEngine();
    const publisher = addr("ao1");
    const worker = addr("ao2");
    const supervisor = addr("ao3");
    const task = engine.publishTask({
      publisher,
      title: "Task admin-open",
      descriptionMd: "desc",
      acceptanceCriteria: "accept",
      deadlineUtc: "2026-04-03T00:00:00.000Z",
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 20,
      allowRepeatCompletionsBySameAgent: false
    });
    engine.addTaskIntention(task.id, worker);
    clock.advanceMinutes(31);
    const submission = engine.submitTask(task.id, worker, "work");
    engine.rejectSubmission(submission.id, publisher);
    const dispute = engine.openDispute({
      taskId: task.id,
      submissionId: submission.id,
      opener: publisher,
      reasonMd: "review"
    });
    engine.voteDispute({ disputeId: dispute.id, agent: supervisor, vote: VoteChoice.COMPLETED });
    engine.closeCurrentCycle();
    expect(engine.getDispute(dispute.id).status).toBe("OPEN");

    const overridden = engine.overrideDispute(dispute.id, "NOT_COMPLETED");
    expect(overridden.status).toBe("OPEN");

    const anotherSupervisor = addr("ao4");
    const vote = engine.voteDispute({
      disputeId: dispute.id,
      agent: anotherSupervisor,
      vote: VoteChoice.COMPLETED
    });
    expect(vote.vote.disputeId).toBe(dispute.id);
  });

  it("allows intention registration beyond slot count and updates competition metrics", () => {
    const { engine } = makeEngine();
    const publisher = addr("91");
    const workerA = addr("92");
    const workerB = addr("93");
    const task = engine.publishTask({
      publisher,
      title: "Task 7",
      descriptionMd: "desc",
      acceptanceCriteria: "accept",
      deadlineUtc: "2026-04-05T00:00:00.000Z",
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 10,
      allowRepeatCompletionsBySameAgent: false
    });
    engine.addTaskIntention(task.id, workerA);
    engine.addTaskIntention(task.id, workerB);
    const afterIntentions = engine.getTask(task.id);
    expect(afterIntentions.intentCount).toBe(2);
    expect(afterIntentions.competitionRatio).toBe(2);
  });

  it("closes repeatable multi-slot task by confirmed slot count and avoids zombie state", () => {
    const { engine, clock } = makeEngine();
    const publisher = addr("rp1");
    const worker = addr("rp2");
    const task = engine.publishTask({
      publisher,
      title: "Task repeat slots",
      descriptionMd: "desc",
      acceptanceCriteria: "accept",
      deadlineUtc: "2026-04-05T00:00:00.000Z",
      displayTimezone: "UTC",
      slotsTotal: 2,
      rewardPerSlot: 10,
      allowRepeatCompletionsBySameAgent: true
    });

    engine.addTaskIntention(task.id, worker);
    const firstSubmission = engine.submitTask(task.id, worker, "first");
    engine.confirmSubmission(firstSubmission.id, publisher);
    const afterFirstConfirm = engine.getTask(task.id);
    expect(afterFirstConfirm.status).toBe("IN_PROGRESS");
    expect(afterFirstConfirm.rewardEscrowRemaining).toBe(10);
    expect(afterFirstConfirm.competitionRatio).toBe(1);

    clock.advanceMinutes(31);
    const secondSubmission = engine.submitTask(task.id, worker, "second");
    engine.confirmSubmission(secondSubmission.id, publisher);
    const afterSecondConfirm = engine.getTask(task.id);
    expect(afterSecondConfirm.status).toBe("CLOSED");
    expect(afterSecondConfirm.rewardEscrowRemaining).toBe(0);
    expect(afterSecondConfirm.competitionRatio).toBe(0);
    expect(afterSecondConfirm.completedAgents).toEqual([worker]);
    expect(() => engine.addTaskIntention(task.id, worker)).toThrowError(/not open for intentions/i);
  });

  it("requires submission to be rejected before dispute can be opened", () => {
    const { engine, clock } = makeEngine();
    const publisher = addr("dsp1");
    const worker = addr("dsp2");
    const task = engine.publishTask({
      publisher,
      title: "Task dispute precondition",
      descriptionMd: "desc",
      acceptanceCriteria: "accept",
      deadlineUtc: "2026-04-05T00:00:00.000Z",
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 10,
      allowRepeatCompletionsBySameAgent: false
    });
    engine.addTaskIntention(task.id, worker);
    clock.advanceMinutes(31);
    const submission = engine.submitTask(task.id, worker, "result");
    expect(() =>
      engine.openDispute({
        taskId: task.id,
        submissionId: submission.id,
        opener: publisher,
        reasonMd: "should fail before rejection"
      })
    ).toThrowError(/must be rejected/i);
  });

  it("allows only publisher or submission agent to open dispute", () => {
    const { engine, clock } = makeEngine();
    const publisher = addr("dsp3");
    const worker = addr("dsp4");
    const outsider = addr("dsp5");
    const task = engine.publishTask({
      publisher,
      title: "Task dispute opener",
      descriptionMd: "desc",
      acceptanceCriteria: "accept",
      deadlineUtc: "2026-04-05T00:00:00.000Z",
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 10,
      allowRepeatCompletionsBySameAgent: false
    });
    engine.addTaskIntention(task.id, worker);
    clock.advanceMinutes(31);
    const submission = engine.submitTask(task.id, worker, "result");
    engine.rejectSubmission(submission.id, publisher);
    expect(() =>
      engine.openDispute({
        taskId: task.id,
        submissionId: submission.id,
        opener: outsider,
        reasonMd: "outsider cannot open dispute"
      })
    ).toThrowError(/only task publisher or submission agent/i);
  });

  it("enforces single open dispute per submission", () => {
    const { engine, clock } = makeEngine();
    const publisher = addr("dsp6");
    const worker = addr("dsp7");
    const task = engine.publishTask({
      publisher,
      title: "Task dispute dedupe",
      descriptionMd: "desc",
      acceptanceCriteria: "accept",
      deadlineUtc: "2026-04-05T00:00:00.000Z",
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 10,
      allowRepeatCompletionsBySameAgent: false
    });
    engine.addTaskIntention(task.id, worker);
    clock.advanceMinutes(31);
    const submission = engine.submitTask(task.id, worker, "result");
    engine.rejectSubmission(submission.id, publisher);
    const dispute = engine.openDispute({
      taskId: task.id,
      submissionId: submission.id,
      opener: worker,
      reasonMd: "first dispute"
    });
    expect(dispute.status).toBe("OPEN");

    expect(() =>
      engine.openDispute({
        taskId: task.id,
        submissionId: submission.id,
        opener: publisher,
        reasonMd: "duplicate open dispute"
      })
    ).toThrowError(/already exists/i);
  });

  it("rejects task publication with past deadline", () => {
    const { engine } = makeEngine();
    const publisher = addr("vr1");
    expect(() =>
      engine.publishTask({
        publisher,
        title: "Task invalid deadline",
        descriptionMd: "desc",
        acceptanceCriteria: "accept",
        deadlineUtc: "2026-03-29T23:59:59.000Z",
        displayTimezone: "UTC",
        slotsTotal: 1,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: false
      })
    ).toThrowError(/must be in the future/i);
  });

  it("rejects task publication with invalid timezone", () => {
    const { engine } = makeEngine();
    const publisher = addr("vr2");
    expect(() =>
      engine.publishTask({
        publisher,
        title: "Task invalid tz",
        descriptionMd: "desc",
        acceptanceCriteria: "accept",
        deadlineUtc: "2026-04-05T00:00:00.000Z",
        displayTimezone: "Mars/OlympusMons",
        slotsTotal: 1,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: false
      })
    ).toThrowError(/valid IANA timezone/i);
  });

  it("rejects task publication when AgentCoin budget exceeds available balance", () => {
    const { engine } = makeEngine();
    const publisher = addr("vr3");
    expect(() =>
      engine.publishTask({
        publisher,
        title: "Task expensive",
        descriptionMd: "desc",
        acceptanceCriteria: "accept",
        deadlineUtc: "2026-04-05T00:00:00.000Z",
        displayTimezone: "UTC",
        slotsTotal: 100,
        rewardPerSlot: 2_000,
        allowRepeatCompletionsBySameAgent: false
      })
    ).toThrowError(/insufficient balance/i);
  });

  it("does not allow second confirmation for same agent on non-repeatable task", () => {
    const { engine, clock } = makeEngine();
    const publisher = addr("vr4");
    const worker = addr("vr5");
    const task = engine.publishTask({
      publisher,
      title: "Task non-repeat duplicate confirm",
      descriptionMd: "desc",
      acceptanceCriteria: "accept",
      deadlineUtc: "2026-04-05T00:00:00.000Z",
      displayTimezone: "UTC",
      slotsTotal: 2,
      rewardPerSlot: 10,
      allowRepeatCompletionsBySameAgent: false
    });
    engine.addTaskIntention(task.id, worker);
    const firstSubmission = engine.submitTask(task.id, worker, "first");
    clock.advanceMinutes(31);
    const secondSubmission = engine.submitTask(task.id, worker, "second");

    engine.confirmSubmission(firstSubmission.id, publisher);
    expect(() => engine.confirmSubmission(secondSubmission.id, publisher)).toThrowError(
      /already completed this non-repeatable task/i
    );
  });

  it("enforces resubmission cooldown", () => {
    const { engine, clock } = makeEngine();
    const publisher = addr("a2");
    const worker = addr("b2");
    const task = engine.publishTask({
      publisher,
      title: "Task 8",
      descriptionMd: "desc",
      acceptanceCriteria: "accept",
      deadlineUtc: "2026-04-05T00:00:00.000Z",
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 10,
      allowRepeatCompletionsBySameAgent: false
    });
    engine.addTaskIntention(task.id, worker);
    const first = engine.submitTask(task.id, worker, "first");
    expect(first.status).toBe("SUBMITTED");
    expect(() => engine.submitTask(task.id, worker, "retry-too-fast")).toThrowError(/cooldown/i);

    clock.advanceMinutes(31);
    const second = engine.submitTask(task.id, worker, "retry-ok");
    expect(second.status).toBe("SUBMITTED");
  });

  it("rejects submission after task deadline even when agent already intended", () => {
    const { engine, clock } = makeEngine();
    const publisher = addr("dl1");
    const worker = addr("dl2");
    const task = engine.publishTask({
      publisher,
      title: "Task deadline",
      descriptionMd: "desc",
      acceptanceCriteria: "accept",
      deadlineUtc: "2026-03-30T00:10:00.000Z",
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 10,
      allowRepeatCompletionsBySameAgent: false
    });
    engine.addTaskIntention(task.id, worker);
    clock.advanceMinutes(11);
    expect(() => engine.submitTask(task.id, worker, "late")).toThrowError(/deadline has passed/i);
  });

  it("rejects submission after task termination", () => {
    const { engine } = makeEngine();
    const publisher = addr("tm1");
    const worker = addr("tm2");
    const task = engine.publishTask({
      publisher,
      title: "Task terminated",
      descriptionMd: "desc",
      acceptanceCriteria: "accept",
      deadlineUtc: "2026-04-08T00:00:00.000Z",
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 20,
      allowRepeatCompletionsBySameAgent: false
    });
    engine.addTaskIntention(task.id, worker);
    engine.terminateTask(task.id, publisher);
    expect(() => engine.submitTask(task.id, worker, "should fail")).toThrowError(
      /not open for submissions/i
    );
  });

  it("rejects submission attachment with blank name", () => {
    const { engine } = makeEngine();
    const publisher = addr("attach1");
    const worker = addr("attach2");
    const task = engine.publishTask({
      publisher,
      title: "Attachment validation",
      descriptionMd: "desc",
      acceptanceCriteria: "accept",
      deadlineUtc: "2026-04-08T00:00:00.000Z",
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 20,
      allowRepeatCompletionsBySameAgent: false
    });
    engine.addTaskIntention(task.id, worker);

    expect(() =>
      engine.submitTask(task.id, worker, "payload", [
        { name: "   ", url: "https://example.com/artifact.log" }
      ])
    ).toThrowError(/attachment name must be non-empty/i);
  });

  it("auto-confirms stale submissions at cycle close", () => {
    const { engine, clock } = makeEngine();
    const publisher = addr("c2");
    const worker = addr("d2");
    const task = engine.publishTask({
      publisher,
      title: "Task 9",
      descriptionMd: "desc",
      acceptanceCriteria: "accept",
      deadlineUtc: "2026-04-08T00:00:00.000Z",
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 30,
      allowRepeatCompletionsBySameAgent: false
    });
    engine.addTaskIntention(task.id, worker);
    clock.advanceMinutes(31);
    const submission = engine.submitTask(task.id, worker, "done");
    const before = engine.getLedger(worker).available;

    clock.advanceHours(73);
    engine.closeCurrentCycle();
    const updatedTask = engine.getTask(task.id);
    const after = engine.getLedger(worker).available;

    expect(updatedTask.status).toBe("CLOSED");
    expect(after).toBeGreaterThan(before);
  });

  it("applies termination penalty and refunds publisher remainder", () => {
    const { engine } = makeEngine();
    const publisher = addr("e2");
    const before = engine.getLedger(publisher).available;
    const task = engine.publishTask({
      publisher,
      title: "Task 10",
      descriptionMd: "desc",
      acceptanceCriteria: "accept",
      deadlineUtc: "2026-04-08T00:00:00.000Z",
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 100,
      allowRepeatCompletionsBySameAgent: false
    });
    const afterPublish = engine.getLedger(publisher).available;
    expect(before - afterPublish).toBe(105); // reward 100 + tax 5

    engine.terminateTask(task.id, publisher);
    const afterTerminate = engine.getLedger(publisher).available;
    expect(afterTerminate - afterPublish).toBe(90); // penalty 10, refund 90
  });
});
