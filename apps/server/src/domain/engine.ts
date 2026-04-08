import { defaultConfig, type AppConfig } from "@agentrade/config";
import {
  ActivityEventType,
  type CloseCycleResult,
  CycleStatus,
  DisputeStatus,
  SubmissionStatus,
  TaskStatus,
  VoteChoice,
  type ActivityEvent,
  type Address,
  type AgentProfile,
  type Cycle,
  type CycleRewardsResponse,
  type CycleWorkload,
  type Dispute,
  type DisputeResolutionSummary,
  type LedgerBalance,
  type SubmissionAttachment,
  type Submission,
  type SupervisionVote,
  type Task,
  type TaskIntention
} from "@agentrade/types";
import { nanoid } from "nanoid";
import { clampReputation, allocateIntegerPool, computeSupervisorVoteWeight, computeTaxAmount, computeTerminationPenalty } from "./helpers.js";
import { DomainError } from "./errors.js";
import type { Clock } from "../utils/time.js";
import { SystemClock } from "../utils/time.js";

interface UpdateProfilePayload {
  name?: string;
  bio?: string;
}

export interface EngineStateSnapshot {
  version: 1;
  activeCycleId: string;
  profiles: AgentProfile[];
  balances: LedgerBalance[];
  tasks: Task[];
  submissions: Submission[];
  disputes: Dispute[];
  votes: SupervisionVote[];
  votesByDisputeAndAgent: Array<[string, string]>;
  cycleWorkloads: CycleWorkload[];
  cycles: Cycle[];
  activities: ActivityEvent[];
  intentions?: TaskIntention[];
  latestSubmissionByTaskAndAgent: Array<[string, string]>;
}

export const INITIAL_AGENT_BALANCE = 100_000;

export class AgentradeEngine {
  private readonly config: AppConfig;
  private readonly clock: Clock;

  private profiles = new Map<Address, AgentProfile>();
  private balances = new Map<Address, LedgerBalance>();
  private tasks = new Map<string, Task>();
  private submissions = new Map<string, Submission>();
  private disputes = new Map<string, Dispute>();
  private votes = new Map<string, SupervisionVote>();
  private votesByDisputeAndAgent = new Map<string, string>();
  private cycleWorkloads = new Map<string, CycleWorkload>();
  private cycles = new Map<string, Cycle>();
  private activities = new Map<string, ActivityEvent>();
  private taskIntentions = new Map<string, TaskIntention>();
  private latestSubmissionByTaskAndAgent = new Map<string, string>();
  private activeCycleId!: string;

  constructor(
    config: AppConfig = defaultConfig,
    clock: Clock = new SystemClock(),
    snapshot?: EngineStateSnapshot
  ) {
    this.config = config;
    this.clock = clock;
    if (snapshot) {
      this.restoreFromSnapshot(snapshot);
      return;
    }
    const firstCycle = this.createCycle("cycle-1");
    this.cycles.set(firstCycle.id, firstCycle);
    this.activeCycleId = firstCycle.id;
  }

  static fromSnapshot(
    config: AppConfig,
    snapshot: EngineStateSnapshot,
    clock: Clock = new SystemClock()
  ): AgentradeEngine {
    return new AgentradeEngine(config, clock, snapshot);
  }

  getConfig(): AppConfig {
    return this.config;
  }

  getActiveCycle(): Cycle {
    return this.requireCycle(this.activeCycleId);
  }

  listCycles(): Cycle[] {
    return [...this.cycles.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  getCycle(cycleId: string): Cycle {
    return this.requireCycle(cycleId);
  }

  toSnapshot(): EngineStateSnapshot {
    return {
      version: 1,
      activeCycleId: this.activeCycleId,
      profiles: [...this.profiles.values()],
      balances: [...this.balances.values()],
      tasks: [...this.tasks.values()],
      submissions: [...this.submissions.values()],
      disputes: [...this.disputes.values()],
      votes: [...this.votes.values()],
      votesByDisputeAndAgent: [...this.votesByDisputeAndAgent.entries()],
      cycleWorkloads: [...this.cycleWorkloads.values()],
      cycles: [...this.cycles.values()],
      activities: [...this.activities.values()],
      intentions: [...this.taskIntentions.values()],
      latestSubmissionByTaskAndAgent: [...this.latestSubmissionByTaskAndAgent.entries()]
    };
  }

  listAgents(): AgentProfile[] {
    return [...this.profiles.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  listTasks(): Task[] {
    return [...this.tasks.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  listSubmissions(): Submission[] {
    return [...this.submissions.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  listTaskIntentions(taskId: string): TaskIntention[] {
    this.getTask(taskId);
    return [...this.taskIntentions.values()]
      .filter((item) => item.taskId === taskId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  getTask(taskId: string): Task {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new DomainError("TASK_NOT_FOUND", `Task ${taskId} does not exist`, 404);
    }
    return task;
  }

  getSubmission(submissionId: string): Submission {
    return this.requireSubmission(submissionId);
  }

  listDisputes(): Dispute[] {
    return [...this.disputes.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  listActivities(): ActivityEvent[] {
    return [...this.activities.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  getDispute(disputeId: string): Dispute {
    const dispute = this.disputes.get(disputeId);
    if (!dispute) {
      throw new DomainError("DISPUTE_NOT_FOUND", `Dispute ${disputeId} does not exist`, 404);
    }
    return dispute;
  }

  getDisputeResolution(disputeId: string): DisputeResolutionSummary | null {
    const dispute = this.getDispute(disputeId);
    if (dispute.status === DisputeStatus.OPEN) {
      return null;
    }

    const votes = [...this.votes.values()].filter((item) => item.disputeId === disputeId);
    const completedVotes = votes.filter((item) => item.vote === VoteChoice.COMPLETED).length;
    const notCompletedVotes = votes.length - completedVotes;
    const outcome =
      dispute.status === DisputeStatus.RESOLVED_COMPLETED
        ? VoteChoice.COMPLETED
        : VoteChoice.NOT_COMPLETED;
    const task = this.getTask(dispute.taskId);
    const submission = this.requireSubmission(dispute.submissionId);
    const winnerRole = outcome === VoteChoice.COMPLETED ? "SUBMISSION_AGENT" : "PUBLISHER";
    const winnerAddress = outcome === VoteChoice.COMPLETED ? submission.agent : task.publisher;

    return {
      totalVotes: votes.length,
      completedVotes,
      notCompletedVotes,
      outcome,
      winnerRole,
      winnerAddress
    };
  }

  getAgent(address: Address): AgentProfile {
    return this.requireAgent(address);
  }

  findAgent(address: Address): AgentProfile | null {
    return this.profiles.get(address) ?? null;
  }

  updateAgentProfile(address: Address, payload: UpdateProfilePayload): AgentProfile {
    const profile = this.requireAgent(address);
    profile.name = payload.name ?? profile.name;
    profile.bio = payload.bio ?? profile.bio;
    profile.updatedAt = this.nowIso();
    return profile;
  }

  getLedger(address: Address): LedgerBalance {
    return this.requireBalance(address);
  }

  findLedger(address: Address): LedgerBalance | null {
    return this.balances.get(address) ?? null;
  }

  publishTask(input: {
    publisher: Address;
    title: string;
    descriptionMd: string;
    acceptanceCriteria: string;
    deadlineUtc: string;
    displayTimezone: string;
    slotsTotal: number;
    rewardPerSlot: number;
    allowRepeatCompletionsBySameAgent: boolean;
  }): Task {
    this.requireAgent(input.publisher);
    const normalizedTitle = input.title.trim();
    if (normalizedTitle.length === 0 || input.title.length > this.config.taskTitleMaxLength) {
      throw new DomainError(
        "INVALID_TASK_TITLE",
        `title must be non-empty and <= ${this.config.taskTitleMaxLength} chars`,
        400
      );
    }
    if (
      input.descriptionMd.trim().length === 0 ||
      input.descriptionMd.length > this.config.taskDescriptionMaxLength
    ) {
      throw new DomainError(
        "INVALID_TASK_DESCRIPTION",
        `description must be non-empty and <= ${this.config.taskDescriptionMaxLength} chars`,
        400
      );
    }
    if (
      input.acceptanceCriteria.trim().length === 0 ||
      input.acceptanceCriteria.length > this.config.taskAcceptanceCriteriaMaxLength
    ) {
      throw new DomainError(
        "INVALID_ACCEPTANCE_CRITERIA",
        `acceptanceCriteria must be non-empty and <= ${this.config.taskAcceptanceCriteriaMaxLength} chars`,
        400
      );
    }
    if (!this.isValidTimeZone(input.displayTimezone)) {
      throw new DomainError("INVALID_TIMEZONE", "displayTimezone must be a valid IANA timezone", 400);
    }
    const deadlineMs = new Date(input.deadlineUtc).getTime();
    if (!Number.isFinite(deadlineMs)) {
      throw new DomainError("INVALID_DEADLINE", "deadlineUtc must be a valid ISO datetime", 400);
    }
    const nowMs = this.clock.now().getTime();
    if (deadlineMs <= nowMs) {
      throw new DomainError("INVALID_DEADLINE", "deadlineUtc must be in the future", 400);
    }
    const maxDeadlineMs = nowMs + this.config.taskDeadlineMaxHours * 3_600_000;
    if (deadlineMs > maxDeadlineMs) {
      throw new DomainError(
        "INVALID_DEADLINE",
        `deadlineUtc must be within ${this.config.taskDeadlineMaxHours} hours`,
        400
      );
    }
    if (
      !Number.isSafeInteger(input.slotsTotal) ||
      input.slotsTotal <= 0 ||
      input.slotsTotal > this.config.taskSlotsMax
    ) {
      throw new DomainError(
        "INVALID_SLOTS",
        `slotsTotal must be a safe integer in [1, ${this.config.taskSlotsMax}]`,
        400
      );
    }
    if (
      !Number.isSafeInteger(input.rewardPerSlot) ||
      input.rewardPerSlot < this.config.rewardMin ||
      input.rewardPerSlot > this.config.taskRewardPerSlotMax
    ) {
      throw new DomainError(
        "INVALID_REWARD",
        `rewardPerSlot must be a safe integer in [${this.config.rewardMin}, ${this.config.taskRewardPerSlotMax}]`,
        400
      );
    }
    const totalReward = input.slotsTotal * input.rewardPerSlot;
    if (!Number.isSafeInteger(totalReward) || totalReward <= 0) {
      throw new DomainError(
        "INVALID_TASK_BUDGET",
        "task reward budget is outside supported integer range",
        400
      );
    }
    const taxAmount = computeTaxAmount(totalReward, this.config);
    if (!Number.isSafeInteger(taxAmount) || taxAmount < 0) {
      throw new DomainError("INVALID_TASK_BUDGET", "task tax amount is invalid", 400);
    }
    const totalCost = totalReward + taxAmount;
    if (!Number.isSafeInteger(totalCost) || totalCost <= 0) {
      throw new DomainError(
        "INVALID_TASK_BUDGET",
        "task total cost is outside supported integer range",
        400
      );
    }
    const balance = this.requireBalance(input.publisher);
    if (balance.available < totalCost) {
      throw new DomainError("INSUFFICIENT_BALANCE", "insufficient balance for task escrow and tax", 409);
    }

    balance.available -= totalCost;
    balance.updatedAt = this.nowIso();
    const cycle = this.requireCycle(this.activeCycleId);
    cycle.taxPool += taxAmount;

    const timestamp = this.nowIso();
    const task: Task = {
      id: nanoid(),
      publisher: input.publisher,
      title: normalizedTitle,
      descriptionMd: input.descriptionMd,
      acceptanceCriteria: input.acceptanceCriteria,
      status: TaskStatus.OPEN,
      deadlineUtc: input.deadlineUtc,
      displayTimezone: input.displayTimezone,
      slotsTotal: input.slotsTotal,
      rewardPerSlot: input.rewardPerSlot,
      allowRepeatCompletionsBySameAgent: input.allowRepeatCompletionsBySameAgent,
      taxAmount,
      rewardEscrowRemaining: totalReward,
      intentCount: 0,
      competitionRatio: 0,
      completedAgents: [],
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.tasks.set(task.id, task);
    const publisherProfile = this.requireAgent(input.publisher);
    publisherProfile.stats.tasksPublished += 1;
    this.shiftReputation(input.publisher, "publisher", 1);
    this.recordActivity({
      type: ActivityEventType.TASK_PUBLISHED,
      taskId: task.id,
      disputeId: null,
      actor: input.publisher
    });
    return task;
  }

  addTaskIntention(taskId: string, agent: Address): TaskIntention {
    this.requireAgent(agent);
    const task = this.getTask(taskId);
    if (task.status === TaskStatus.TERMINATED || task.status === TaskStatus.CLOSED) {
      throw new DomainError("TASK_NOT_INTENTABLE", "task is not open for intentions", 409);
    }
    if (new Date(task.deadlineUtc).getTime() <= this.clock.now().getTime()) {
      throw new DomainError("TASK_NOT_INTENTABLE", "task deadline has passed", 409);
    }
    if (!task.allowRepeatCompletionsBySameAgent && task.completedAgents.includes(agent)) {
      throw new DomainError("REPEAT_NOT_ALLOWED", "agent already completed this task", 409);
    }
    const dedupeKey = `${task.id}:${agent}`;
    if (this.taskIntentions.has(dedupeKey)) {
      throw new DomainError("TASK_INTENT_ALREADY_EXISTS", "agent already added intention for this task", 409);
    }
    const now = this.nowIso();
    const intention: TaskIntention = {
      id: nanoid(),
      taskId: task.id,
      agent,
      createdAt: now
    };
    this.taskIntentions.set(dedupeKey, intention);
    const profile = this.requireAgent(agent);
    profile.stats.tasksIntented += 1;
    task.intentCount = this.countTaskIntentions(task.id);
    task.competitionRatio = this.computeCompetitionRatio(task.intentCount, this.getRemainingSlots(task));
    task.updatedAt = now;
    this.recordActivity({
      type: ActivityEventType.TASK_INTENDED,
      taskId: task.id,
      disputeId: null,
      actor: agent
    });
    return intention;
  }

  submitTask(
    taskId: string,
    agent: Address,
    payloadMd: string,
    attachments: SubmissionAttachment[] = []
  ): Submission {
    this.requireAgent(agent);
    const task = this.getTask(taskId);
    if (payloadMd.trim().length === 0 || payloadMd.length > this.config.taskSubmissionPayloadMaxLength) {
      throw new DomainError(
        "INVALID_SUBMISSION_PAYLOAD",
        `payloadMd must be non-empty and <= ${this.config.taskSubmissionPayloadMaxLength} chars`,
        400
      );
    }
    this.validateSubmissionAttachments(attachments);
    if (task.status === TaskStatus.TERMINATED || task.status === TaskStatus.CLOSED) {
      throw new DomainError("TASK_NOT_SUBMITTABLE", "task is not open for submissions", 409);
    }
    const confirmedSlots = this.getConfirmedSlots(task);
    if (confirmedSlots >= task.slotsTotal || task.rewardEscrowRemaining < task.rewardPerSlot) {
      task.status = TaskStatus.CLOSED;
      task.updatedAt = this.nowIso();
      throw new DomainError("TASK_NOT_SUBMITTABLE", "task is not open for submissions", 409);
    }
    if (new Date(task.deadlineUtc).getTime() <= this.clock.now().getTime()) {
      throw new DomainError("TASK_EXPIRED", "task deadline has passed", 409);
    }
    if (!this.taskIntentions.has(`${taskId}:${agent}`)) {
      throw new DomainError("TASK_INTENT_REQUIRED", "agent must add task intention before submission", 403);
    }
    const key = `${taskId}:${agent}`;
    const lastSubmissionId = this.latestSubmissionByTaskAndAgent.get(key);
    if (lastSubmissionId) {
      const lastSubmission = this.submissions.get(lastSubmissionId);
      if (lastSubmission) {
        const elapsedMs = this.clock.now().getTime() - new Date(lastSubmission.createdAt).getTime();
        const cooldownMs = this.config.resubmitCooldownMinutes * 60_000;
        if (elapsedMs < cooldownMs) {
          throw new DomainError(
            "RESUBMIT_COOLDOWN",
            `resubmission cooldown not reached (${this.config.resubmitCooldownMinutes} minutes)`,
            429
          );
        }
      }
    }

    const now = this.nowIso();
    const submission: Submission = {
      id: nanoid(),
      taskId: task.id,
      agent,
      payloadMd,
      attachments: attachments.map((item) => ({ ...item })),
      status: SubmissionStatus.SUBMITTED,
      createdAt: now,
      updatedAt: now
    };
    this.submissions.set(submission.id, submission);
    this.latestSubmissionByTaskAndAgent.set(key, submission.id);
    if (task.status === TaskStatus.OPEN) {
      task.status = TaskStatus.IN_PROGRESS;
      task.updatedAt = now;
    }
    this.recordActivity({
      type: ActivityEventType.TASK_SUBMITTED,
      taskId: task.id,
      disputeId: null,
      actor: agent
    });
    return submission;
  }

  confirmSubmission(submissionId: string, publisher: Address): Submission {
    const submission = this.requireSubmission(submissionId);
    const task = this.getTask(submission.taskId);
    if (task.publisher !== publisher) {
      throw new DomainError("FORBIDDEN", "only the publisher can confirm submission", 403);
    }
    this.confirmSubmissionInternal(submission, task, publisher);
    return submission;
  }

  rejectSubmission(submissionId: string, publisher: Address): Submission {
    const submission = this.requireSubmission(submissionId);
    const task = this.getTask(submission.taskId);
    if (task.publisher !== publisher) {
      throw new DomainError("FORBIDDEN", "only the publisher can reject submission", 403);
    }
    if (submission.status !== SubmissionStatus.SUBMITTED) {
      throw new DomainError("SUBMISSION_NOT_PENDING", "submission is not in submitted state", 409);
    }
    submission.status = SubmissionStatus.REJECTED;
    submission.updatedAt = this.nowIso();
    const profile = this.requireAgent(submission.agent);
    profile.stats.submissionsRejected += 1;
    this.shiftReputation(submission.agent, "worker", -1);
    this.recordActivity({
      type: ActivityEventType.SUBMISSION_REJECTED,
      taskId: task.id,
      disputeId: null,
      actor: publisher
    });
    return submission;
  }

  terminateTask(taskId: string, publisher: Address): Task {
    const task = this.getTask(taskId);
    if (task.publisher !== publisher) {
      throw new DomainError("FORBIDDEN", "only the publisher can terminate task", 403);
    }
    if (task.status === TaskStatus.TERMINATED || task.status === TaskStatus.CLOSED) {
      throw new DomainError("TASK_NOT_TERMINABLE", "task is already closed", 409);
    }

    const penalty = computeTerminationPenalty(task.rewardEscrowRemaining, this.config);
    const refund = Math.max(0, task.rewardEscrowRemaining - penalty);
    const publisherBalance = this.requireBalance(task.publisher);
    publisherBalance.available += refund;
    publisherBalance.updatedAt = this.nowIso();

    const cycle = this.requireCycle(this.activeCycleId);
    cycle.penaltyPool += penalty;

    task.rewardEscrowRemaining = 0;
    task.competitionRatio = this.computeCompetitionRatio(task.intentCount, this.getRemainingSlots(task));
    task.status = TaskStatus.TERMINATED;
    task.updatedAt = this.nowIso();
    const publisherProfile = this.requireAgent(task.publisher);
    publisherProfile.stats.tasksTerminated += 1;
    this.shiftReputation(task.publisher, "publisher", -1);
    this.recordActivity({
      type: ActivityEventType.TASK_TERMINATED,
      taskId: task.id,
      disputeId: null,
      actor: publisher
    });
    return task;
  }

  openDispute(input: {
    taskId: string;
    submissionId: string;
    opener: Address;
    reasonMd: string;
  }): Dispute {
    this.requireAgent(input.opener);
    const task = this.getTask(input.taskId);
    const submission = this.requireSubmission(input.submissionId);
    if (submission.taskId !== task.id) {
      throw new DomainError("MISMATCH", "submission does not belong to task", 400);
    }
    if (input.reasonMd.trim().length === 0 || input.reasonMd.length > this.config.disputeReasonMaxLength) {
      throw new DomainError(
        "INVALID_DISPUTE_REASON",
        `reasonMd must be non-empty and <= ${this.config.disputeReasonMaxLength} chars`,
        400
      );
    }
    if (input.opener !== task.publisher && input.opener !== submission.agent) {
      throw new DomainError(
        "DISPUTE_FORBIDDEN_OPENER",
        "only task publisher or submission agent can open dispute",
        403
      );
    }
    if (submission.status !== SubmissionStatus.REJECTED) {
      throw new DomainError(
        "SUBMISSION_NOT_DISPUTABLE",
        "submission must be rejected before dispute can be opened",
        409
      );
    }
    const hasOpenDispute = [...this.disputes.values()].some(
      (item) => item.submissionId === submission.id && item.status === DisputeStatus.OPEN
    );
    if (hasOpenDispute) {
      throw new DomainError(
        "OPEN_DISPUTE_ALREADY_EXISTS",
        "an open dispute already exists for this submission",
        409
      );
    }
    const now = this.nowIso();
    const dispute: Dispute = {
      id: nanoid(),
      taskId: task.id,
      submissionId: submission.id,
      opener: input.opener,
      reasonMd: input.reasonMd,
      status: DisputeStatus.OPEN,
      createdAt: now,
      updatedAt: now
    };
    this.disputes.set(dispute.id, dispute);
    this.recordActivity({
      type: ActivityEventType.DISPUTE_OPENED,
      taskId: task.id,
      disputeId: dispute.id,
      actor: input.opener
    });
    return dispute;
  }

  voteDispute(input: {
    disputeId: string;
    agent: Address;
    vote: VoteChoice;
  }): { vote: SupervisionVote; workload: CycleWorkload } {
    this.requireAgent(input.agent);
    const dispute = this.getDispute(input.disputeId);
    if (dispute.status !== DisputeStatus.OPEN) {
      throw new DomainError("DISPUTE_CLOSED", "dispute is already resolved", 409);
    }
    const dedupeKey = `${input.disputeId}:${input.agent}`;
    if (this.votesByDisputeAndAgent.has(dedupeKey)) {
      throw new DomainError(
        "DUPLICATE_SUPERVISION_PARTICIPATION",
        "agent can participate only once per dispute across all cycles",
        409
      );
    }
    const profile = this.requireAgent(input.agent);
    const weightSnapshot = computeSupervisorVoteWeight(profile.reputation, this.config);
    const now = this.nowIso();
    const vote: SupervisionVote = {
      id: nanoid(),
      disputeId: input.disputeId,
      agent: input.agent,
      vote: input.vote,
      weightSnapshot,
      createdCycleId: this.activeCycleId,
      createdAt: now
    };
    this.votes.set(vote.id, vote);
    this.votesByDisputeAndAgent.set(dedupeKey, vote.id);

    const workload: CycleWorkload = {
      id: nanoid(),
      cycleId: this.activeCycleId,
      disputeId: input.disputeId,
      agent: input.agent,
      workload: 1,
      createdAt: now,
      settledAt: null
    };
    this.cycleWorkloads.set(workload.id, workload);

    profile.stats.supervisionVotes += 1;
    this.shiftReputation(input.agent, "supervisor", 0.5);
    return { vote, workload };
  }

  closeCurrentCycle(): CloseCycleResult {
    this.autoConfirmStaleSubmissions();
    const finalizedDisputes: string[] = [];
    for (const dispute of this.disputes.values()) {
      const before = dispute.status;
      this.evaluateDispute(dispute.id);
      if (before !== dispute.status) {
        finalizedDisputes.push(dispute.id);
      }
    }

    const cycle = this.requireCycle(this.activeCycleId);
    const rewardPool = cycle.mintedAmount + cycle.taxPool + cycle.penaltyPool;
    const workloads = [...this.cycleWorkloads.values()].filter(
      (item) => item.cycleId === cycle.id && item.settledAt === null
    );

    const grouped = new Map<string, number>();
    for (const workload of workloads) {
      grouped.set(workload.agent, (grouped.get(workload.agent) ?? 0) + workload.workload);
    }
    const distribution = allocateIntegerPool(rewardPool, grouped);
    for (const [agent, amount] of distribution.entries()) {
      const balance = this.requireBalance(agent as Address);
      balance.available += amount;
      balance.updatedAt = this.nowIso();
    }
    for (const workload of workloads) {
      workload.settledAt = this.nowIso();
    }

    cycle.status = CycleStatus.CLOSED;
    cycle.closedAt = this.nowIso();
    const nextId = `cycle-${Number(cycle.id.replace("cycle-", "")) + 1}`;
    const nextCycle = this.createCycle(nextId);
    this.cycles.set(nextCycle.id, nextCycle);
    this.activeCycleId = nextCycle.id;

    return {
      closedCycleId: cycle.id,
      openedCycleId: nextCycle.id,
      rewardPool,
      distributions: [...distribution.entries()].map(([agent, amount]) => ({
        agent: agent as Address,
        amount
      })),
      finalizedDisputes
    };
  }

  overrideDispute(disputeId: string, result: "COMPLETED" | "NOT_COMPLETED"): Dispute {
    const dispute = this.getDispute(disputeId);
    if (result === "COMPLETED") {
      if (dispute.status !== DisputeStatus.RESOLVED_COMPLETED) {
        dispute.status = DisputeStatus.RESOLVED_COMPLETED;
        this.finalizeDisputeWithOutcome(dispute, VoteChoice.COMPLETED);
      }
    } else {
      // Admin can force the dispute back into supervision flow.
      dispute.status = DisputeStatus.OPEN;
    }
    dispute.updatedAt = this.nowIso();
    return dispute;
  }

  getCycleRewards(cycleId: string): CycleRewardsResponse {
    const cycle = this.requireCycle(cycleId);
    const workloads = [...this.cycleWorkloads.values()].filter((item) => item.cycleId === cycleId);
    const rewardPool = cycle.mintedAmount + cycle.taxPool + cycle.penaltyPool;
    const grouped = new Map<string, number>();
    for (const workload of workloads) {
      grouped.set(workload.agent, (grouped.get(workload.agent) ?? 0) + workload.workload);
    }

    return {
      cycle,
      rewardPool,
      distributions: [...allocateIntegerPool(rewardPool, grouped).entries()].map(([agent, amount]) => ({
        agent: agent as Address,
        amount
      })),
      workloads
    };
  }

  exportBridgeBatch(input: { addresses?: Address[] }): Array<{ address: Address; amount: number }> {
    const entries = [...this.balances.values()];
    const allowSet = input.addresses ? new Set(input.addresses) : null;
    return entries
      .filter((entry) => !allowSet || allowSet.has(entry.address))
      .map((entry) => ({ address: entry.address, amount: entry.available }));
  }

  private evaluateDispute(disputeId: string): void {
    const dispute = this.getDispute(disputeId);
    if (dispute.status !== DisputeStatus.OPEN) {
      return;
    }
    const votes = [...this.votes.values()].filter((item) => item.disputeId === disputeId);
    if (votes.length < this.config.disputeQuorum) {
      return;
    }
    const totalWeight = votes.reduce((acc, item) => acc + item.weightSnapshot, 0);
    if (totalWeight <= 0) {
      return;
    }
    const completedWeight = votes
      .filter((item) => item.vote === VoteChoice.COMPLETED)
      .reduce((acc, item) => acc + item.weightSnapshot, 0);
    const completedBps = Math.floor((completedWeight * 10_000) / totalWeight);
    if (completedBps >= this.config.disputeApprovalBps) {
      dispute.status = DisputeStatus.RESOLVED_COMPLETED;
      dispute.updatedAt = this.nowIso();
      this.finalizeDisputeWithOutcome(dispute, VoteChoice.COMPLETED);
      return;
    }
    // Unresolved disputes remain open and continue accumulating votes across cycles.
  }

  private finalizeDisputeWithOutcome(dispute: Dispute, outcome: VoteChoice): void {
    const submission = this.requireSubmission(dispute.submissionId);
    const task = this.getTask(dispute.taskId);
    if (outcome === VoteChoice.COMPLETED) {
      if (submission.status !== SubmissionStatus.CONFIRMED) {
        this.confirmSubmissionInternal(submission, task, task.publisher);
      }
    }

    const votes = [...this.votes.values()].filter((item) => item.disputeId === dispute.id);
    for (const vote of votes) {
      if (vote.vote === outcome) {
        this.shiftReputation(vote.agent, "supervisor", 1);
      } else {
        this.shiftReputation(vote.agent, "supervisor", -1);
      }
    }
  }

  private autoConfirmStaleSubmissions(): void {
    const now = this.clock.now().getTime();
    const thresholdMs = this.config.submissionTimeoutHours * 3_600_000;
    for (const submission of this.submissions.values()) {
      if (submission.status !== SubmissionStatus.SUBMITTED) {
        continue;
      }
      const age = now - new Date(submission.createdAt).getTime();
      if (age < thresholdMs) {
        continue;
      }
      const task = this.getTask(submission.taskId);
      if (task.status === TaskStatus.TERMINATED || task.status === TaskStatus.CLOSED) {
        continue;
      }
      const confirmedSlots = this.getConfirmedSlots(task);
      if (confirmedSlots >= task.slotsTotal || task.rewardEscrowRemaining < task.rewardPerSlot) {
        task.status = TaskStatus.CLOSED;
        task.updatedAt = this.nowIso();
        continue;
      }
      this.confirmSubmissionInternal(submission, task, task.publisher);
    }
  }

  private confirmSubmissionInternal(submission: Submission, task: Task, actor: Address): void {
    if (submission.status === SubmissionStatus.CONFIRMED) {
      return;
    }
    if (submission.status !== SubmissionStatus.SUBMITTED && submission.status !== SubmissionStatus.REJECTED) {
      throw new DomainError("SUBMISSION_NOT_CONFIRMABLE", "submission cannot be confirmed from this state", 409);
    }
    if (!task.allowRepeatCompletionsBySameAgent && task.completedAgents.includes(submission.agent)) {
      throw new DomainError(
        "REPEAT_COMPLETION_NOT_ALLOWED",
        "agent already completed this non-repeatable task",
        409
      );
    }
    const confirmedSlotsBefore = this.getConfirmedSlots(task);
    if (confirmedSlotsBefore >= task.slotsTotal || task.rewardEscrowRemaining < task.rewardPerSlot) {
      task.status = TaskStatus.CLOSED;
      task.updatedAt = this.nowIso();
      throw new DomainError("SUBMISSION_NOT_CONFIRMABLE", "task has no remaining payable slots", 409);
    }

    submission.status = SubmissionStatus.CONFIRMED;
    submission.updatedAt = this.nowIso();
    task.rewardEscrowRemaining -= task.rewardPerSlot;
    task.competitionRatio = this.computeCompetitionRatio(task.intentCount, this.getRemainingSlots(task));
    const confirmedSlots = this.getConfirmedSlots(task);
    if (!task.completedAgents.includes(submission.agent)) {
      task.completedAgents.push(submission.agent);
    }
    if (confirmedSlots >= task.slotsTotal) {
      task.status = TaskStatus.CLOSED;
    }
    task.updatedAt = this.nowIso();

    const workerBalance = this.requireBalance(submission.agent);
    workerBalance.available += task.rewardPerSlot;
    workerBalance.updatedAt = this.nowIso();
    const workerProfile = this.requireAgent(submission.agent);
    workerProfile.stats.tasksCompleted += 1;
    this.shiftReputation(submission.agent, "worker", 2);
    this.shiftReputation(task.publisher, "publisher", 1);
    this.recordActivity({
      type: ActivityEventType.TASK_COMPLETED,
      taskId: task.id,
      disputeId: null,
      actor
    });
  }

  private getConfirmedSlots(task: Task): number {
    if (task.rewardPerSlot <= 0 || task.slotsTotal <= 0) {
      throw new DomainError(
        "TASK_SETTLEMENT_INVARIANT_BROKEN",
        "task slot or reward invariant is invalid",
        500
      );
    }

    const totalEscrow = task.slotsTotal * task.rewardPerSlot;
    if (task.rewardEscrowRemaining < 0 || task.rewardEscrowRemaining > totalEscrow) {
      throw new DomainError(
        "TASK_ESCROW_INVARIANT_BROKEN",
        "task escrow remaining is outside allowed bounds",
        500
      );
    }

    const spent = totalEscrow - task.rewardEscrowRemaining;
    if (spent % task.rewardPerSlot !== 0) {
      throw new DomainError(
        "TASK_SETTLEMENT_INVARIANT_BROKEN",
        "task reward escrow is not aligned to slot reward",
        500
      );
    }
    const confirmedSlots = Math.floor(spent / task.rewardPerSlot);
    if (confirmedSlots < 0 || confirmedSlots > task.slotsTotal) {
      throw new DomainError(
        "TASK_SETTLEMENT_INVARIANT_BROKEN",
        "confirmed slot count is outside allowed bounds",
        500
      );
    }
    return confirmedSlots;
  }

  private isValidTimeZone(value: string): boolean {
    if (value.trim().length === 0) {
      return false;
    }
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }

  private createCycle(cycleId: string): Cycle {
    return {
      id: cycleId,
      status: CycleStatus.OPEN,
      mintedAmount: this.config.mintPerCycle,
      taxPool: 0,
      penaltyPool: 0,
      startedAt: this.nowIso(),
      closedAt: null
    };
  }

  private recordActivity(input: {
    type: ActivityEventType;
    taskId: string | null;
    disputeId: string | null;
    actor: Address;
  }): ActivityEvent {
    const event: ActivityEvent = {
      id: nanoid(),
      type: input.type,
      cycleId: this.activeCycleId,
      taskId: input.taskId,
      disputeId: input.disputeId,
      actor: input.actor,
      createdAt: this.nowIso()
    };
    this.activities.set(event.id, event);
    return event;
  }

  private nowIso(): string {
    return this.clock.now().toISOString();
  }

  private requireSubmission(submissionId: string): Submission {
    const submission = this.submissions.get(submissionId);
    if (!submission) {
      throw new DomainError("SUBMISSION_NOT_FOUND", `Submission ${submissionId} not found`, 404);
    }
    if (!Array.isArray(submission.attachments)) {
      submission.attachments = [];
    }
    return submission;
  }

  private requireCycle(cycleId: string): Cycle {
    const cycle = this.cycles.get(cycleId);
    if (!cycle) {
      throw new DomainError("CYCLE_NOT_FOUND", `Cycle ${cycleId} not found`, 404);
    }
    return cycle;
  }

  private requireAgent(address: Address): AgentProfile {
    let profile = this.profiles.get(address);
    if (!profile) {
      const now = this.nowIso();
      profile = {
        address,
        name: "",
        bio: "",
        reputation: { publisher: 50, worker: 50, supervisor: 50 },
        stats: {
          tasksPublished: 0,
          tasksIntented: 0,
          tasksCompleted: 0,
          tasksTerminated: 0,
          submissionsRejected: 0,
          supervisionVotes: 0
        },
        createdAt: now,
        updatedAt: now
      };
      this.profiles.set(address, profile);
    }
    if (!this.balances.has(address)) {
      this.balances.set(address, {
        address,
        available: INITIAL_AGENT_BALANCE,
        updatedAt: this.nowIso()
      });
    }
    return profile;
  }

  private requireBalance(address: Address): LedgerBalance {
    this.requireAgent(address);
    const balance = this.balances.get(address);
    if (!balance) {
      throw new DomainError("LEDGER_NOT_FOUND", `Ledger for ${address} not found`, 404);
    }
    return balance;
  }

  private shiftReputation(
    address: Address,
    dimension: keyof AgentProfile["reputation"],
    delta: number
  ): void {
    const profile = this.requireAgent(address);
    profile.reputation[dimension] = clampReputation(profile.reputation[dimension] + delta);
    profile.updatedAt = this.nowIso();
  }

  private restoreFromSnapshot(snapshot: EngineStateSnapshot): void {
    this.profiles = new Map(snapshot.profiles.map((item) => [item.address, item]));
    this.balances = new Map(snapshot.balances.map((item) => [item.address, item]));
    this.tasks = new Map(snapshot.tasks.map((item) => [item.id, item]));
    this.submissions = new Map(
      snapshot.submissions.map((item) => [
        item.id,
        {
          ...item,
          attachments: Array.isArray(item.attachments) ? item.attachments : []
        }
      ])
    );
    this.disputes = new Map(snapshot.disputes.map((item) => [item.id, item]));
    this.votes = new Map(snapshot.votes.map((item) => [item.id, item]));
    this.votesByDisputeAndAgent = new Map(snapshot.votesByDisputeAndAgent);
    this.cycleWorkloads = new Map(snapshot.cycleWorkloads.map((item) => [item.id, item]));
    this.cycles = new Map(snapshot.cycles.map((item) => [item.id, item]));
    this.activities = new Map(snapshot.activities.map((item) => [item.id, item]));
    this.taskIntentions = new Map(
      (snapshot.intentions ?? []).map((item) => [`${item.taskId}:${item.agent}`, item])
    );
    this.latestSubmissionByTaskAndAgent = new Map(snapshot.latestSubmissionByTaskAndAgent);
    this.activeCycleId = snapshot.activeCycleId;

    for (const task of this.tasks.values()) {
      task.intentCount = this.countTaskIntentions(task.id);
      task.competitionRatio = this.computeCompetitionRatio(task.intentCount, this.getRemainingSlots(task));
    }

    if (!this.activeCycleId || !this.cycles.has(this.activeCycleId)) {
      const firstCycle = this.createCycle("cycle-1");
      this.cycles.set(firstCycle.id, firstCycle);
      this.activeCycleId = firstCycle.id;
    }
  }

  private countTaskIntentions(taskId: string): number {
    let count = 0;
    for (const item of this.taskIntentions.values()) {
      if (item.taskId === taskId) {
        count += 1;
      }
    }
    return count;
  }

  private getRemainingSlots(task: Task): number {
    const confirmedSlots = this.getConfirmedSlots(task);
    return Math.max(0, task.slotsTotal - confirmedSlots);
  }

  private computeCompetitionRatio(intentCount: number, remainingSlots: number): number {
    if (remainingSlots <= 0) {
      return 0;
    }
    return Number((intentCount / remainingSlots).toFixed(4));
  }

  private validateSubmissionAttachments(attachments: SubmissionAttachment[]): void {
    if (attachments.length > this.config.taskSubmissionAttachmentMaxCount) {
      throw new DomainError(
        "INVALID_SUBMISSION_ATTACHMENTS",
        `attachments must contain <= ${this.config.taskSubmissionAttachmentMaxCount} items`,
        400
      );
    }

    for (const attachment of attachments) {
      if (attachment.name.trim().length === 0) {
        throw new DomainError(
          "INVALID_SUBMISSION_ATTACHMENTS",
          "attachment name must be non-empty",
          400
        );
      }
      if (attachment.name.length > this.config.taskSubmissionAttachmentNameMaxLength) {
        throw new DomainError(
          "INVALID_SUBMISSION_ATTACHMENTS",
          `attachment name must be <= ${this.config.taskSubmissionAttachmentNameMaxLength} chars`,
          400
        );
      }
      if (attachment.url.length > this.config.taskSubmissionAttachmentUrlMaxLength) {
        throw new DomainError(
          "INVALID_SUBMISSION_ATTACHMENTS",
          `attachment url must be <= ${this.config.taskSubmissionAttachmentUrlMaxLength} chars`,
          400
        );
      }
      try {
        const parsed = new URL(attachment.url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new Error("invalid protocol");
        }
      } catch {
        throw new DomainError(
          "INVALID_SUBMISSION_ATTACHMENTS",
          "attachment url must be a valid http(s) URL",
          400
        );
      }
      if (attachment.mimeType !== undefined && attachment.mimeType.trim().length === 0) {
        throw new DomainError(
          "INVALID_SUBMISSION_ATTACHMENTS",
          "attachment mimeType must be non-empty when provided",
          400
        );
      }
      if (attachment.sizeBytes !== undefined) {
        if (!Number.isSafeInteger(attachment.sizeBytes) || attachment.sizeBytes < 0) {
          throw new DomainError(
            "INVALID_SUBMISSION_ATTACHMENTS",
            "attachment sizeBytes must be a non-negative safe integer",
            400
          );
        }
        if (attachment.sizeBytes > this.config.taskSubmissionAttachmentMaxSizeBytes) {
          throw new DomainError(
            "INVALID_SUBMISSION_ATTACHMENTS",
            `attachment sizeBytes must be <= ${this.config.taskSubmissionAttachmentMaxSizeBytes}`,
            400
          );
        }
      }
    }
  }
}
