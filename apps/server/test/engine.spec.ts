import { describe, expect, it } from "vitest";
import { defaultConfig } from "@agentrade/config";
import {
  ActivityEventType,
  AgentBanReason,
  AgentStatus,
  DisputePayoutSource,
  DisputeStatus,
  SubmissionStatus,
  TaskStatus,
  TaskTargetMentionStatus,
  VoteChoice,
  type Address
} from "@agentrade/types";
import { AgentradeEngine } from "../src/domain/engine.js";
import { MutableClock } from "../src/utils/time.js";

const addr = (seed: string): Address =>
  `0x${Buffer.from(seed).toString("hex").slice(0, 40).padEnd(40, "0")}` as Address;

const makeEngine = () => {
  const clock = new MutableClock(new Date("2026-03-30T00:00:00.000Z"));
  const engine = new AgentradeEngine(defaultConfig, clock);
  return { engine, clock };
};

describe("AgentradeEngine disputes and cycle settlement", () => {
  it("publishes targeted task mentions and lets only the target dismiss them", () => {
    const { engine } = makeEngine();
    const publisher = addr("target-publisher");
    const target = addr("target-worker");
    const mixedCaseTarget = `0x${target.slice(2).toUpperCase()}` as Address;
    const other = addr("target-other");
    engine.updateAgentProfile(target, { name: "Target Worker", bio: "Reviews targeted tasks." });
    engine.updateAgentProfile(other, { name: "Other Worker", bio: "Not targeted." });

    const missingTarget = addr("target-missing");
    expect(() =>
      engine.publishTask({
        publisher,
        title: "Targeted task invalid",
        descriptionMd: "desc",
        acceptanceCriteria: "accept",
        deadlineUtc: "2026-04-02T00:00:00.000Z",
        displayTimezone: "UTC",
        slotsTotal: 1,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: false,
        targetAgentAddresses: [missingTarget]
      })
    ).toThrowError(/target agents must exist and be active/i);

    const task = engine.publishTask({
      publisher,
      title: "Targeted task",
      descriptionMd: "desc",
      acceptanceCriteria: "accept",
      deadlineUtc: "2026-04-02T00:00:00.000Z",
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 10,
      allowRepeatCompletionsBySameAgent: false,
      targetAgentAddresses: [mixedCaseTarget]
    });

    expect(task.targetMentions).toHaveLength(1);
    expect(task.targetMentions[0]).toMatchObject({
      taskId: task.id,
      publisher,
      targetAgent: target,
      status: TaskTargetMentionStatus.OPEN,
      dismissedAt: null
    });
    expect(engine.toSnapshot().targetMentions).toHaveLength(1);
    expect(() => engine.dismissTaskTargetMention(task.targetMentions[0]!.id, other)).toThrowError(
      /only the targeted agent/i
    );

    const dismissed = engine.dismissTaskTargetMention(task.targetMentions[0]!.id, target);
    expect(dismissed.status).toBe(TaskTargetMentionStatus.DISMISSED);
    expect(dismissed.dismissedAt).not.toBeNull();
    expect(engine.getTask(task.id).targetMentions[0]?.status).toBe(
      TaskTargetMentionStatus.DISMISSED
    );
    expect(engine.dismissTaskTargetMention(task.targetMentions[0]!.id, target)).toBe(dismissed);
  });

  it("uses configured initial balance when auto-creating a new agent ledger", () => {
    const clock = new MutableClock(new Date("2026-03-30T00:00:00.000Z"));
    const engine = new AgentradeEngine({ ...defaultConfig, initialAgentBalance: 4321 }, clock);
    const newcomer = addr("cfg-ledger");

    const ledger = engine.getLedger(newcomer);
    expect(ledger.available).toBe(4321);
  });

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
    engine.rejectSubmission(submission.id, publisher, "needs revision");
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
    engine.rejectSubmission(submission.id, publisher, "needs revision");
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
    engine.rejectSubmission(submission.id, publisher, "needs revision");
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
    engine.rejectSubmission(submission.id, publisher, "needs revision");
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
    engine.rejectSubmission(submission.id, publisher, "needs revision");
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
    engine.rejectSubmission(submission.id, publisher, "needs revision");
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

  it("reopens dispute to OPEN and clears prior votes when admin overrides as NOT_COMPLETED", () => {
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
    engine.rejectSubmission(submission.id, publisher, "needs revision");
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
    expect(engine.toSnapshot().disputeRollbackHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          disputeId: dispute.id,
          previousStatus: DisputeStatus.OPEN,
          archivedVotes: expect.arrayContaining([
            expect.objectContaining({
              disputeId: dispute.id,
              agent: supervisor,
              vote: VoteChoice.COMPLETED
            })
          ])
        })
      ])
    );

    const vote = engine.voteDispute({
      disputeId: dispute.id,
      agent: supervisor,
      vote: VoteChoice.NOT_COMPLETED
    });
    expect(vote.vote.disputeId).toBe(dispute.id);
  });

  it("rolls back settlement, ban side effects, and old votes when reopening a settled dispute", () => {
    const { clock } = makeEngine();
    const engine = new AgentradeEngine(
      {
        ...defaultConfig,
        disputeQuorum: 1,
        disputeApprovalBps: 5_000
      },
      clock
    );
    const publisher = addr("aom1");
    const workerA = addr("aom2");
    const workerB = addr("aom3");
    const supervisor = addr("aom4");
    const task = engine.publishTask({
      publisher,
      title: "Task admin-meta",
      descriptionMd: "desc",
      acceptanceCriteria: "accept",
      deadlineUtc: "2026-05-03T00:00:00.000Z",
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 20,
      allowRepeatCompletionsBySameAgent: false
    });
    engine.addTaskIntention(task.id, workerA);
    engine.addTaskIntention(task.id, workerB);
    const cleanTask = engine.publishTask({
      publisher,
      title: "Task admin-cleanup",
      descriptionMd: "desc",
      acceptanceCriteria: "accept",
      deadlineUtc: "2026-05-04T00:00:00.000Z",
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
    engine.voteDispute({ disputeId: dispute.id, agent: supervisor, vote: VoteChoice.COMPLETED });
    engine.getLedger(publisher).available = 3;

    engine.closeCurrentCycle();
    expect(engine.getDisputeResolution(dispute.id)).toMatchObject({
      payoutSource: DisputePayoutSource.PUBLISHER_WALLET_PARTIAL,
      payoutAmount: 3,
      payoutShortfallAmount: 17,
      publisherBanned: true
    });
    expect(engine.findAgent(publisher)?.status).toBe(AgentStatus.BANNED);
    expect(engine.getTask(cleanTask.id).status).toBe(TaskStatus.TERMINATED);
    engine.getLedger(workerB).available = 0;

    expect(engine.overrideDispute(dispute.id, "NOT_COMPLETED").status).toBe("OPEN");
    expect(engine.getDisputeResolution(dispute.id)).toBeNull();
    expect(engine.toSnapshot().disputeRollbackHistory).toEqual(
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
    expect(engine.findAgent(publisher)?.status).toBe(AgentStatus.ACTIVE);
    expect(engine.findAgent(workerB)?.status).toBe(AgentStatus.ACTIVE);
    expect(engine.getLedger(workerB).available).toBeLessThan(0);
    expect(() =>
      engine.publishTask({
        publisher: workerB,
        title: "negative-ledger-publish-blocked",
        descriptionMd: "desc",
        acceptanceCriteria: "accept",
        deadlineUtc: "2026-05-05T00:00:00.000Z",
        displayTimezone: "UTC",
        slotsTotal: 1,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: false
      })
    ).toThrowError(/insufficient balance/i);
    expect(engine.getSubmission(disputed.id).status).toBe(SubmissionStatus.REJECTED);
    expect(engine.getTask(cleanTask.id).status).toBe(TaskStatus.OPEN);
    expect(engine.getTask(cleanTask.id).rewardEscrowRemaining).toBe(15);

    expect(engine.overrideDispute(dispute.id, "COMPLETED").status).toBe("RESOLVED_COMPLETED");
    expect(engine.findAgent(workerB)).toMatchObject({
      status: AgentStatus.BANNED,
      banReasonCode: AgentBanReason.REOPEN_NEGATIVE_BALANCE
    });
  });

  it("does not ban unrelated negative accounts when a different reopened dispute settles again", () => {
    const { engine, clock } = makeEngine();
    const publisherA = addr("reopen-scope-pub-a");
    const workerA = addr("reopen-scope-worker-a");
    const publisherB = addr("reopen-scope-pub-b");
    const workerB = addr("reopen-scope-worker-b");

    const taskA = engine.publishTask({
      publisher: publisherA,
      title: "reopen-scope-task-a",
      descriptionMd: "desc",
      acceptanceCriteria: "accept",
      deadlineUtc: "2026-05-05T00:00:00.000Z",
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 10,
      allowRepeatCompletionsBySameAgent: false
    });
    engine.addTaskIntention(taskA.id, workerA);
    const taskB = engine.publishTask({
      publisher: publisherB,
      title: "reopen-scope-task-b",
      descriptionMd: "desc",
      acceptanceCriteria: "accept",
      deadlineUtc: "2026-05-05T00:00:00.000Z",
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

    expect(engine.overrideDispute(disputeA.id, "COMPLETED").status).toBe("RESOLVED_COMPLETED");
    engine.getLedger(workerA).available = 0;
    expect(engine.overrideDispute(disputeA.id, "NOT_COMPLETED").status).toBe("OPEN");
    expect(engine.getLedger(workerA).available).toBeLessThan(0);
    expect(engine.findAgent(workerA)?.status).toBe(AgentStatus.ACTIVE);

    expect(engine.overrideDispute(disputeB.id, "COMPLETED").status).toBe("RESOLVED_COMPLETED");
    expect(engine.overrideDispute(disputeB.id, "NOT_COMPLETED").status).toBe("OPEN");
    expect(engine.overrideDispute(disputeB.id, "COMPLETED").status).toBe("RESOLVED_COMPLETED");

    expect(engine.findAgent(workerA)?.status).toBe(AgentStatus.ACTIVE);

    engine.getLedger(workerA).available = -20;
    expect(engine.overrideDispute(disputeA.id, "COMPLETED").status).toBe("RESOLVED_COMPLETED");
    expect(engine.findAgent(workerA)).toMatchObject({
      status: AgentStatus.BANNED,
      banReasonCode: AgentBanReason.REOPEN_NEGATIVE_BALANCE
    });
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

  it("adds publisher and worker cycle workloads on each confirmed task completion", () => {
    const { engine, clock } = makeEngine();
    const publisher = addr("wc1");
    const worker = addr("wc2");
    const task = engine.publishTask({
      publisher,
      title: "Task workload completion",
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
    clock.advanceMinutes(31);
    const secondSubmission = engine.submitTask(task.id, worker, "second");
    engine.confirmSubmission(secondSubmission.id, publisher);

    const close = engine.closeCurrentCycle();
    const rewards = engine.getCycleRewards(close.closedCycleId);
    const completionWorkloads = rewards.workloads.filter(
      (item) => item.taskId === task.id && item.disputeId === null
    );
    expect(completionWorkloads).toHaveLength(4);
    expect(completionWorkloads.every((item) => item.workload === 0.25)).toBe(true);
    expect(completionWorkloads.filter((item) => item.agent === publisher)).toHaveLength(2);
    expect(completionWorkloads.filter((item) => item.agent === worker)).toHaveLength(2);
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
    engine.rejectSubmission(submission.id, publisher, "needs revision");
    expect(() =>
      engine.openDispute({
        taskId: task.id,
        submissionId: submission.id,
        opener: outsider,
        reasonMd: "outsider cannot open dispute"
      })
    ).toThrowError(/only task publisher or submission agent/i);
  });

  it("allows only the non-opener party to submit one counterparty reason", () => {
    const { engine, clock } = makeEngine();
    const publisher = addr("dsp3r");
    const worker = addr("dsp4r");
    const outsider = addr("dsp5r");
    const task = engine.publishTask({
      publisher,
      title: "Task dispute counterparty reason",
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
    engine.rejectSubmission(submission.id, publisher, "needs revision");
    const dispute = engine.openDispute({
      taskId: task.id,
      submissionId: submission.id,
      opener: publisher,
      reasonMd: "publisher reason"
    });

    const updated = engine.respondDispute({
      disputeId: dispute.id,
      responder: worker,
      reasonMd: "worker counterparty reason"
    });
    expect(updated.counterpartyResponder).toBe(worker);
    expect(updated.counterpartyReasonMd).toBe("worker counterparty reason");

    expect(() =>
      engine.respondDispute({
        disputeId: dispute.id,
        responder: worker,
        reasonMd: "worker duplicate reason"
      })
    ).toThrowError(/already submitted/i);
    expect(() =>
      engine.respondDispute({
        disputeId: dispute.id,
        responder: publisher,
        reasonMd: "opener cannot respond"
      })
    ).toThrowError(/non-opener party/i);
    expect(() =>
      engine.respondDispute({
        disputeId: dispute.id,
        responder: outsider,
        reasonMd: "outsider cannot respond"
      })
    ).toThrowError(/non-opener party/i);
  });

  it("blocks dispute parties from voting and allows third-party supervisors only", () => {
    const { engine, clock } = makeEngine();
    const publisher = addr("dsp6v");
    const worker = addr("dsp7v");
    const supervisor = addr("dsp8v");
    const task = engine.publishTask({
      publisher,
      title: "Task dispute voting parties",
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
    engine.rejectSubmission(submission.id, publisher, "needs revision");
    const dispute = engine.openDispute({
      taskId: task.id,
      submissionId: submission.id,
      opener: publisher,
      reasonMd: "first reason"
    });

    expect(() =>
      engine.voteDispute({ disputeId: dispute.id, agent: publisher, vote: VoteChoice.COMPLETED })
    ).toThrowError(/only third-party supervisors/i);
    expect(() =>
      engine.voteDispute({ disputeId: dispute.id, agent: worker, vote: VoteChoice.COMPLETED })
    ).toThrowError(/only third-party supervisors/i);

    const acceptedVote = engine.voteDispute({
      disputeId: dispute.id,
      agent: supervisor,
      vote: VoteChoice.COMPLETED
    });
    expect(acceptedVote.vote.agent).toBe(supervisor);
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
    engine.rejectSubmission(submission.id, publisher, "needs revision");
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

  it("closes task before returning 409 when submit finds no payable slots", () => {
    const { engine, clock } = makeEngine();
    const publisher = addr("slot-submit-1");
    const workerA = addr("slot-submit-2");
    const workerB = addr("slot-submit-3");

    const task = engine.publishTask({
      publisher,
      title: "Submit no slots",
      descriptionMd: "desc",
      acceptanceCriteria: "accept",
      deadlineUtc: "2026-04-08T00:00:00.000Z",
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 20,
      allowRepeatCompletionsBySameAgent: false
    });
    engine.addTaskIntention(task.id, workerA);
    engine.addTaskIntention(task.id, workerB);
    clock.advanceMinutes(31);
    const firstSubmission = engine.submitTask(task.id, workerA, "first");
    engine.confirmSubmission(firstSubmission.id, publisher);

    const mutableTask = engine.getTask(task.id);
    mutableTask.status = TaskStatus.IN_PROGRESS;

    const error = (() => {
      try {
        engine.submitTask(task.id, workerB, "second");
        return null;
      } catch (caught) {
        return caught as { code?: string; statusCode?: number };
      }
    })();

    expect(error?.code).toBe("TASK_NOT_SUBMITTABLE");
    expect(error?.statusCode).toBe(409);
    expect(engine.getTask(task.id).status).toBe("CLOSED");
  });

  it("closes task before returning 409 when confirm finds no payable slots", () => {
    const { engine, clock } = makeEngine();
    const publisher = addr("slot-confirm-1");
    const workerA = addr("slot-confirm-2");
    const workerB = addr("slot-confirm-3");

    const task = engine.publishTask({
      publisher,
      title: "Confirm no slots",
      descriptionMd: "desc",
      acceptanceCriteria: "accept",
      deadlineUtc: "2026-04-08T00:00:00.000Z",
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 20,
      allowRepeatCompletionsBySameAgent: false
    });
    engine.addTaskIntention(task.id, workerA);
    engine.addTaskIntention(task.id, workerB);
    clock.advanceMinutes(31);
    const submissionA = engine.submitTask(task.id, workerA, "first");
    const submissionB = engine.submitTask(task.id, workerB, "second");
    engine.confirmSubmission(submissionA.id, publisher);

    const mutableTask = engine.getTask(task.id);
    mutableTask.status = TaskStatus.IN_PROGRESS;

    const error = (() => {
      try {
        engine.confirmSubmission(submissionB.id, publisher);
        return null;
      } catch (caught) {
        return caught as { code?: string; statusCode?: number };
      }
    })();

    expect(error?.code).toBe("SUBMISSION_NOT_CONFIRMABLE");
    expect(error?.statusCode).toBe(409);
    expect(engine.getTask(task.id).status).toBe("CLOSED");
  });

  it("blocks manual confirm while submission has an open dispute", () => {
    const { engine, clock } = makeEngine();
    const publisher = addr("confirm-dispute-pub");
    const worker = addr("confirm-dispute-worker");

    const task = engine.publishTask({
      publisher,
      title: "Confirm blocked by dispute",
      descriptionMd: "desc",
      acceptanceCriteria: "accept",
      deadlineUtc: "2026-04-08T00:00:00.000Z",
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 20,
      allowRepeatCompletionsBySameAgent: false
    });
    engine.addTaskIntention(task.id, worker);
    clock.advanceMinutes(31);
    const submission = engine.submitTask(task.id, worker, "payload");
    engine.rejectSubmission(submission.id, publisher, "needs review");
    const dispute = engine.openDispute({
      taskId: task.id,
      submissionId: submission.id,
      opener: worker,
      reasonMd: "open dispute"
    });

    const error = (() => {
      try {
        engine.confirmSubmission(submission.id, publisher);
        return null;
      } catch (caught) {
        return caught as { code?: string; statusCode?: number };
      }
    })();

    expect(error?.code).toBe("SUBMISSION_NOT_CONFIRMABLE");
    expect(error?.statusCode).toBe(409);
    expect(engine.getSubmission(submission.id).status).toBe(SubmissionStatus.REJECTED);
    expect(engine.getDispute(dispute.id).status).toBe("OPEN");
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
    engine.submitTask(task.id, worker, "done");
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

  it("blocks manual termination while task has an open dispute", () => {
    const { engine, clock } = makeEngine();
    const publisher = addr("terminate-dispute-pub");
    const worker = addr("terminate-dispute-worker");

    const task = engine.publishTask({
      publisher,
      title: "Terminate blocked by dispute",
      descriptionMd: "desc",
      acceptanceCriteria: "accept",
      deadlineUtc: "2026-04-08T00:00:00.000Z",
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 20,
      allowRepeatCompletionsBySameAgent: false
    });
    engine.addTaskIntention(task.id, worker);
    clock.advanceMinutes(31);
    const submission = engine.submitTask(task.id, worker, "payload");
    engine.rejectSubmission(submission.id, publisher, "needs review");
    const dispute = engine.openDispute({
      taskId: task.id,
      submissionId: submission.id,
      opener: worker,
      reasonMd: "open dispute"
    });

    const error = (() => {
      try {
        engine.terminateTask(task.id, publisher);
        return null;
      } catch (caught) {
        return caught as { code?: string; statusCode?: number };
      }
    })();

    expect(error?.code).toBe("TASK_NOT_TERMINABLE");
    expect(error?.statusCode).toBe(409);
    expect(engine.getTask(task.id).status).toBe(TaskStatus.IN_PROGRESS);
    expect(engine.getDispute(dispute.id).status).toBe("OPEN");
  });

  it("does not award publisher completion credits when dispute overturn confirms through escrow", () => {
    const clock = new MutableClock(new Date("2026-03-30T00:00:00.000Z"));
    const engine = new AgentradeEngine(
      {
        ...defaultConfig,
        disputeQuorum: 1,
        disputeApprovalBps: 5_000
      },
      clock
    );
    const publisher = addr("escrow-dispute-pub");
    const worker = addr("escrow-dispute-worker");
    const supervisor = addr("escrow-dispute-supervisor");

    const task = engine.publishTask({
      publisher,
      title: "Escrow dispute completion",
      descriptionMd: "desc",
      acceptanceCriteria: "accept",
      deadlineUtc: "2026-04-08T00:00:00.000Z",
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 20,
      allowRepeatCompletionsBySameAgent: false
    });
    const publisherRepAfterPublish = engine.findAgent(publisher)!.reputation.publisher;
    const cycleId = engine.getActiveCycle().id;

    engine.addTaskIntention(task.id, worker);
    clock.advanceMinutes(31);
    const submission = engine.submitTask(task.id, worker, "payload");
    engine.rejectSubmission(submission.id, publisher, "needs revision");
    const dispute = engine.openDispute({
      taskId: task.id,
      submissionId: submission.id,
      opener: worker,
      reasonMd: "valid work"
    });
    engine.voteDispute({
      disputeId: dispute.id,
      agent: supervisor,
      vote: VoteChoice.COMPLETED
    });

    engine.closeCurrentCycle();

    expect(engine.findAgent(publisher)!.reputation.publisher).toBe(publisherRepAfterPublish);
    const workloads = engine
      .getCycleRewards(cycleId)
      .workloads.filter((item) => item.taskId === task.id && item.disputeId === dispute.id);
    expect(workloads).toHaveLength(1);
    expect(workloads[0]).toMatchObject({
      agent: worker,
      workload: defaultConfig.taskCompletionWorkerWorkload
    });
    expect(engine.getDisputeResolution(dispute.id)).toEqual({
      totalVotes: 1,
      completedVotes: 1,
      notCompletedVotes: 0,
      outcome: VoteChoice.COMPLETED,
      winnerRole: "SUBMISSION_AGENT",
      winnerAddress: worker,
      payoutSource: DisputePayoutSource.ESCROW,
      payoutAmount: 20,
      payoutShortfallAmount: 0,
      publisherBanned: false
    });
  });

  it("settles slot-full disputes from publisher wallet, bans insolvent publishers, and keeps passive convergence working", () => {
    const clock = new MutableClock(new Date("2026-03-30T00:00:00.000Z"));
    const engine = new AgentradeEngine(
      {
        ...defaultConfig,
        disputeQuorum: 1,
        disputeApprovalBps: 5_000
      },
      clock
    );
    const publisher = addr("wdp");
    const workerA = addr("wda");
    const workerB = addr("wdb");
    const workerC = addr("wdc");
    const workerD = addr("wdd");
    const supervisor = addr("wds");

    const slotFilledTask = engine.publishTask({
      publisher,
      title: "slot-filled",
      descriptionMd: "desc",
      acceptanceCriteria: "accept",
      deadlineUtc: "2026-04-08T00:00:00.000Z",
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 10,
      allowRepeatCompletionsBySameAgent: false
    });
    const cleanTask = engine.publishTask({
      publisher,
      title: "clean-task",
      descriptionMd: "desc",
      acceptanceCriteria: "accept",
      deadlineUtc: "2026-04-08T00:00:00.000Z",
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 10,
      allowRepeatCompletionsBySameAgent: false
    });
    const frozenTask = engine.publishTask({
      publisher,
      title: "frozen-task",
      descriptionMd: "desc",
      acceptanceCriteria: "accept",
      deadlineUtc: "2026-04-08T00:00:00.000Z",
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 10,
      allowRepeatCompletionsBySameAgent: false
    });

    engine.addTaskIntention(slotFilledTask.id, workerA);
    engine.addTaskIntention(slotFilledTask.id, workerB);
    engine.addTaskIntention(frozenTask.id, workerC);
    clock.advanceMinutes(31);
    const confirmedSubmission = engine.submitTask(slotFilledTask.id, workerA, "confirmed");
    const disputedSubmission = engine.submitTask(slotFilledTask.id, workerB, "disputed");
    const pendingSubmission = engine.submitTask(frozenTask.id, workerC, "pending");
    engine.confirmSubmission(confirmedSubmission.id, publisher);
    engine.rejectSubmission(disputedSubmission.id, publisher, "incorrect");
    const dispute = engine.openDispute({
      taskId: slotFilledTask.id,
      submissionId: disputedSubmission.id,
      opener: workerB,
      reasonMd: "valid completion"
    });
    engine.voteDispute({
      disputeId: dispute.id,
      agent: supervisor,
      vote: VoteChoice.COMPLETED
    });

    const workerBBeforeClose = engine.getLedger(workerB).available;
    const publisherLedger = engine.getLedger(publisher);
    publisherLedger.available = 4;
    publisherLedger.updatedAt = new Date("2026-03-30T01:00:00.000Z").toISOString();

    engine.closeCurrentCycle();

    expect(engine.getSubmission(disputedSubmission.id).status).toBe(SubmissionStatus.DISPUTE_COMPLETED);
    expect(engine.getLedger(workerB).available - workerBBeforeClose).toBeGreaterThanOrEqual(4);
    expect(engine.findAgent(publisher)).toMatchObject({
      status: AgentStatus.BANNED,
      banReasonCode: AgentBanReason.DISPUTE_INSOLVENCY
    });
    expect(engine.getTask(cleanTask.id).status).toBe(TaskStatus.TERMINATED);
    expect(engine.getTask(frozenTask.id).status).toBe(TaskStatus.IN_PROGRESS);
    expect(() => engine.addTaskIntention(frozenTask.id, workerD)).toThrowError(/task is frozen/i);
    expect(() =>
      engine.publishTask({
        publisher,
        title: "banned-publish",
        descriptionMd: "desc",
        acceptanceCriteria: "accept",
        deadlineUtc: "2026-04-09T00:00:00.000Z",
        displayTimezone: "UTC",
        slotsTotal: 1,
        rewardPerSlot: 10,
        allowRepeatCompletionsBySameAgent: false
      })
    ).toThrowError(/banned/i);
    expect(engine.getDisputeResolution(dispute.id)).toEqual({
      totalVotes: 1,
      completedVotes: 1,
      notCompletedVotes: 0,
      outcome: VoteChoice.COMPLETED,
      winnerRole: "SUBMISSION_AGENT",
      winnerAddress: workerB,
      payoutSource: DisputePayoutSource.PUBLISHER_WALLET_PARTIAL,
      payoutAmount: 4,
      payoutShortfallAmount: 6,
      publisherBanned: true
    });

    clock.advanceHours(73);
    engine.closeCurrentCycle();
    expect(engine.getSubmission(pendingSubmission.id).status).toBe(SubmissionStatus.CONFIRMED);
    expect(engine.getTask(frozenTask.id).status).toBe(TaskStatus.CLOSED);
  });

  it("auto-terminates expired clean tasks while leaving expired tasks with open disputes active", () => {
    const { engine, clock } = makeEngine();
    const publisher = addr("expire-clean-pub");
    const worker = addr("expire-clean-worker");
    const supervisor = addr("expire-clean-supervisor");

    const cleanTask = engine.publishTask({
      publisher,
      title: "expired-clean",
      descriptionMd: "desc",
      acceptanceCriteria: "accept",
      deadlineUtc: "2026-03-30T01:00:00.000Z",
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 10,
      allowRepeatCompletionsBySameAgent: false
    });
    const disputedTask = engine.publishTask({
      publisher,
      title: "expired-disputed",
      descriptionMd: "desc",
      acceptanceCriteria: "accept",
      deadlineUtc: "2026-03-30T01:00:00.000Z",
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 10,
      allowRepeatCompletionsBySameAgent: false
    });
    engine.addTaskIntention(cleanTask.id, worker);
    engine.addTaskIntention(disputedTask.id, worker);
    clock.advanceMinutes(31);
    const cleanSubmission = engine.submitTask(cleanTask.id, worker, "clean");
    const disputedSubmission = engine.submitTask(disputedTask.id, worker, "disputed");
    engine.rejectSubmission(cleanSubmission.id, publisher, "reject");
    engine.rejectSubmission(disputedSubmission.id, publisher, "reject");
    const dispute = engine.openDispute({
      taskId: disputedTask.id,
      submissionId: disputedSubmission.id,
      opener: worker,
      reasonMd: "open dispute"
    });
    engine.voteDispute({
      disputeId: dispute.id,
      agent: supervisor,
      vote: VoteChoice.NOT_COMPLETED
    });

    clock.advanceHours(2);
    engine.closeCurrentCycle();

    expect(engine.getTask(cleanTask.id).status).toBe(TaskStatus.TERMINATED);
    expect(engine.getTask(disputedTask.id).status).toBe(TaskStatus.IN_PROGRESS);
    expect(engine.getDispute(dispute.id).status).toBe("OPEN");
  });

  it("rejects disputes on terminated tasks", () => {
    const { engine, clock } = makeEngine();
    const publisher = addr("terminated-dispute-pub");
    const worker = addr("terminated-dispute-worker");

    const task = engine.publishTask({
      publisher,
      title: "terminated-dispute",
      descriptionMd: "desc",
      acceptanceCriteria: "accept",
      deadlineUtc: "2026-04-08T00:00:00.000Z",
      displayTimezone: "UTC",
      slotsTotal: 1,
      rewardPerSlot: 10,
      allowRepeatCompletionsBySameAgent: false
    });
    engine.addTaskIntention(task.id, worker);
    clock.advanceMinutes(31);
    const submission = engine.submitTask(task.id, worker, "payload");
    engine.rejectSubmission(submission.id, publisher, "reject");
    engine.terminateTask(task.id, publisher);

    expect(() =>
      engine.openDispute({
        taskId: task.id,
        submissionId: submission.id,
        opener: worker,
        reasonMd: "too late"
      })
    ).toThrowError(/parent task is terminated/i);
  });
});
