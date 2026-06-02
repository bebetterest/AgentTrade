import { defaultConfig, type AppConfig } from "@agentrade/config";
import {
  ActivityEventType,
  AgentBanReason,
  AgentStatus,
  type CloseCycleResult,
  CycleStatus,
  DisputePayoutSource,
  DisputeStatus,
  SubmissionStatus,
  TaskStatus,
  TaskTargetMentionStatus,
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
  type TaskIntention,
  type TaskTargetMention
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

interface DisputeResolutionMetaRecord {
  disputeId: string;
  payoutSource: DisputePayoutSource;
  payoutAmount: number;
  payoutShortfallAmount: number;
  publisherBanned: boolean;
  rollback?: DisputeResolutionRollbackRecord | null;
}

interface ForcedTerminationRollbackRecord {
  taskId: string;
  cycleId: string;
  previousStatus: TaskStatus;
  previousRewardEscrowRemaining: number;
  penalty: number;
  refund: number;
}

interface DisputeResolutionRollbackRecord {
  resolutionCycleId: string;
  taskStatusBeforeResolution: TaskStatus;
  taskRewardEscrowRemainingBeforeResolution: number;
  publisherWasBannedBeforeResolution: boolean;
  publisherBanSourceDisputeIdBeforeResolution: string | null;
  forcedTerminations: ForcedTerminationRollbackRecord[];
}

interface DisputeRollbackHistoryRecord {
  id: string;
  disputeId: string;
  previousStatus: DisputeStatus;
  previousResolution: DisputeResolutionMetaRecord | null;
  archivedVotes: SupervisionVote[];
  archivedWorkloads: CycleWorkload[];
  archivedActivities: ActivityEvent[];
  reopenedAt: string;
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
  disputeResolutionMeta?: DisputeResolutionMetaRecord[];
  disputeRollbackHistory?: DisputeRollbackHistoryRecord[];
  intentions?: TaskIntention[];
  targetMentions?: TaskTargetMention[];
  latestSubmissionByTaskAndAgent: Array<[string, string]>;
  banSourceDisputeByPublisher?: Array<[Address, string]>;
}

export class AgentradeEngine {
  private readonly config: AppConfig;
  private readonly clock: Clock;

  private profiles = new Map<Address, AgentProfile>();
  private balances = new Map<Address, LedgerBalance>();
  private tasks = new Map<string, Task>();
  private submissions = new Map<string, Submission>();
  private disputes = new Map<string, Dispute>();
  private disputeResolutionMeta = new Map<string, DisputeResolutionMetaRecord>();
  private votes = new Map<string, SupervisionVote>();
  private votesByDisputeAndAgent = new Map<string, string>();
  private cycleWorkloads = new Map<string, CycleWorkload>();
  private cycles = new Map<string, Cycle>();
  private activities = new Map<string, ActivityEvent>();
  private disputeRollbackHistory: DisputeRollbackHistoryRecord[] = [];
  private taskIntentions = new Map<string, TaskIntention>();
  private taskTargetMentions = new Map<string, TaskTargetMention>();
  private latestSubmissionByTaskAndAgent = new Map<string, string>();
  private banSourceDisputeByPublisher = new Map<Address, string>();
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
      disputeResolutionMeta: [...this.disputeResolutionMeta.values()],
      disputeRollbackHistory: this.disputeRollbackHistory.map((item) => this.cloneJson(item)),
      intentions: [...this.taskIntentions.values()],
      targetMentions: [...this.taskTargetMentions.values()],
      latestSubmissionByTaskAndAgent: [...this.latestSubmissionByTaskAndAgent.entries()],
      banSourceDisputeByPublisher: [...this.banSourceDisputeByPublisher.entries()]
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
    const resolutionMeta = this.disputeResolutionMeta.get(disputeId) ?? {
      disputeId,
      payoutSource: DisputePayoutSource.ESCROW,
      payoutAmount: task.rewardPerSlot,
      payoutShortfallAmount: 0,
      publisherBanned: false
    };

    return {
      totalVotes: votes.length,
      completedVotes,
      notCompletedVotes,
      outcome,
      winnerRole,
      winnerAddress,
      payoutSource: resolutionMeta.payoutSource,
      payoutAmount: resolutionMeta.payoutAmount,
      payoutShortfallAmount: resolutionMeta.payoutShortfallAmount,
      publisherBanned: resolutionMeta.publisherBanned
    };
  }

  getAgent(address: Address): AgentProfile {
    return this.requireAgent(address);
  }

  findAgent(address: Address): AgentProfile | null {
    return this.profiles.get(address) ?? null;
  }

  updateAgentProfile(address: Address, payload: UpdateProfilePayload): AgentProfile {
    this.requireActiveAgentForWrite(address);
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
    targetAgentAddresses?: Address[];
  }): Task {
    this.requireActiveAgentForWrite(input.publisher);
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
    const targetAgentAddresses = input.targetAgentAddresses ?? [];
    if (targetAgentAddresses.length > this.config.taskTargetMentionMaxCount) {
      throw new DomainError(
        "INVALID_TASK_TARGET_MENTIONS",
        `targetAgentAddresses must contain <= ${this.config.taskTargetMentionMaxCount} items`,
        400
      );
    }
    const seenTargetAddresses = new Set<string>();
    const targetProfilesByLower = new Map(
      [...this.profiles.values()].map((profile) => [profile.address.toLowerCase(), profile])
    );
    const resolvedTargetAgentAddresses: Address[] = [];
    for (const targetAddress of targetAgentAddresses) {
      const normalizedTarget = targetAddress.toLowerCase();
      if (seenTargetAddresses.has(normalizedTarget)) {
        throw new DomainError(
          "INVALID_TASK_TARGET_MENTIONS",
          "targetAgentAddresses must not contain duplicates",
          400
        );
      }
      seenTargetAddresses.add(normalizedTarget);
      if (normalizedTarget === input.publisher.toLowerCase()) {
        throw new DomainError("INVALID_TASK_TARGET_MENTIONS", "publisher cannot target itself", 400);
      }
      const targetProfile = targetProfilesByLower.get(normalizedTarget);
      if (!targetProfile || targetProfile.status !== AgentStatus.ACTIVE) {
        throw new DomainError(
          "TASK_TARGET_AGENT_NOT_FOUND",
          "target agents must exist and be active",
          400
        );
      }
      resolvedTargetAgentAddresses.push(targetProfile.address);
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
      targetMentions: [],
      createdAt: timestamp,
      updatedAt: timestamp
    };
    task.targetMentions = resolvedTargetAgentAddresses.map((targetAddress) => ({
      id: nanoid(),
      taskId: task.id,
      publisher: input.publisher,
      targetAgent: targetAddress,
      status: TaskTargetMentionStatus.OPEN,
      createdAt: timestamp,
      updatedAt: timestamp,
      dismissedAt: null
    }));
    for (const mention of task.targetMentions) {
      this.taskTargetMentions.set(mention.id, mention);
    }
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

  dismissTaskTargetMention(mentionId: string, targetAgent: Address): TaskTargetMention {
    this.requireActiveAgentForWrite(targetAgent);
    const mention = this.taskTargetMentions.get(mentionId);
    if (!mention) {
      throw new DomainError("TASK_MENTION_NOT_FOUND", `Task mention ${mentionId} not found`, 404);
    }
    if (mention.targetAgent.toLowerCase() !== targetAgent.toLowerCase()) {
      throw new DomainError("FORBIDDEN", "only the targeted agent can dismiss this task mention", 403);
    }
    if (mention.status === TaskTargetMentionStatus.DISMISSED) {
      return mention;
    }
    const now = this.nowIso();
    mention.status = TaskTargetMentionStatus.DISMISSED;
    mention.dismissedAt = now;
    mention.updatedAt = now;
    const task = this.tasks.get(mention.taskId);
    if (task) {
      task.targetMentions = task.targetMentions.map((item) =>
        item.id === mention.id ? mention : item
      );
    }
    return mention;
  }

  addTaskIntention(taskId: string, agent: Address): TaskIntention {
    this.requireActiveAgentForWrite(agent);
    const task = this.getTask(taskId);
    if (task.status === TaskStatus.TERMINATED || task.status === TaskStatus.CLOSED) {
      throw new DomainError("TASK_NOT_INTENTABLE", "task is not open for intentions", 409);
    }
    if (this.isTaskFrozen(task)) {
      throw new DomainError("TASK_FROZEN", "task is frozen because publisher account is banned", 409);
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
    this.requireActiveAgentForWrite(agent);
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
    if (this.isTaskFrozen(task)) {
      throw new DomainError("TASK_FROZEN", "task is frozen because publisher account is banned", 409);
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
      rejectReasonMd: null,
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
    this.requireActiveAgentForWrite(publisher);
    const submission = this.requireSubmission(submissionId);
    const task = this.getTask(submission.taskId);
    if (task.publisher !== publisher) {
      throw new DomainError("FORBIDDEN", "only the publisher can confirm submission", 403);
    }
    if (this.hasOpenDisputeForSubmission(submission.id)) {
      throw new DomainError(
        "SUBMISSION_NOT_CONFIRMABLE",
        "submission has an open dispute and cannot be manually confirmed",
        409
      );
    }
    this.confirmSubmissionInternal(submission, task, publisher);
    return submission;
  }

  rejectSubmission(submissionId: string, publisher: Address, reasonMd: string): Submission {
    this.requireActiveAgentForWrite(publisher);
    const submission = this.requireSubmission(submissionId);
    const task = this.getTask(submission.taskId);
    if (task.publisher !== publisher) {
      throw new DomainError("FORBIDDEN", "only the publisher can reject submission", 403);
    }
    if (reasonMd.trim().length === 0 || reasonMd.length > this.config.disputeReasonMaxLength) {
      throw new DomainError(
        "INVALID_REJECT_REASON",
        `reasonMd must be non-empty and <= ${this.config.disputeReasonMaxLength} chars`,
        400
      );
    }
    if (submission.status !== SubmissionStatus.SUBMITTED) {
      throw new DomainError("SUBMISSION_NOT_PENDING", "submission is not in submitted state", 409);
    }
    submission.status = SubmissionStatus.REJECTED;
    submission.rejectReasonMd = reasonMd;
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
    this.requireActiveAgentForWrite(publisher);
    const task = this.getTask(taskId);
    if (task.publisher !== publisher) {
      throw new DomainError("FORBIDDEN", "only the publisher can terminate task", 403);
    }
    if (this.hasOpenDisputeForTask(task.id)) {
      throw new DomainError(
        "TASK_NOT_TERMINABLE",
        "task has an open dispute and cannot be manually terminated",
        409
      );
    }
    return this.terminateTaskInternal(task, publisher).task;
  }

  openDispute(input: {
    taskId: string;
    submissionId: string;
    opener: Address;
    reasonMd: string;
  }): Dispute {
    this.requireActiveAgentForWrite(input.opener);
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
    if (task.status === TaskStatus.TERMINATED) {
      throw new DomainError(
        "SUBMISSION_NOT_DISPUTABLE",
        "submission cannot be disputed after parent task is terminated",
        409
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
      counterpartyResponder: null,
      counterpartyReasonMd: null,
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
    this.requireActiveAgentForWrite(input.agent);
    const dispute = this.getDispute(input.disputeId);
    if (dispute.status !== DisputeStatus.OPEN) {
      throw new DomainError("DISPUTE_CLOSED", "dispute is already resolved", 409);
    }
    const parties = this.resolveDisputeParties(dispute);
    if (input.agent === parties.publisher || input.agent === parties.submissionAgent) {
      throw new DomainError(
        "DISPUTE_PARTY_CANNOT_VOTE",
        "dispute parties cannot vote; only third-party supervisors can vote",
        403
      );
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
      taskId: null,
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

  respondDispute(input: {
    disputeId: string;
    responder: Address;
    reasonMd: string;
  }): Dispute {
    this.requireActiveAgentForWrite(input.responder);
    const dispute = this.getDispute(input.disputeId);
    if (dispute.status !== DisputeStatus.OPEN) {
      throw new DomainError("DISPUTE_CLOSED", "dispute is already resolved", 409);
    }
    if (input.reasonMd.trim().length === 0 || input.reasonMd.length > this.config.disputeReasonMaxLength) {
      throw new DomainError(
        "INVALID_DISPUTE_REASON",
        `reasonMd must be non-empty and <= ${this.config.disputeReasonMaxLength} chars`,
        400
      );
    }
    const parties = this.resolveDisputeParties(dispute);
    if (input.responder !== parties.counterparty) {
      throw new DomainError(
        "DISPUTE_COUNTERPARTY_ONLY",
        "only the non-opener party can submit dispute counterparty reason",
        403
      );
    }
    if (dispute.counterpartyReasonMd && dispute.counterpartyReasonMd.trim().length > 0) {
      throw new DomainError(
        "DISPUTE_COUNTERPARTY_REASON_ALREADY_EXISTS",
        "counterparty reason already submitted",
        409
      );
    }
    dispute.counterpartyResponder = input.responder;
    dispute.counterpartyReasonMd = input.reasonMd;
    dispute.updatedAt = this.nowIso();
    return dispute;
  }

  closeCurrentCycle(): CloseCycleResult {
    this.autoConfirmStaleSubmissions();
    this.sweepBannedPublisherCleanTasks();
    const finalizedDisputes: string[] = [];
    for (const dispute of this.disputes.values()) {
      const before = dispute.status;
      this.evaluateDispute(dispute.id);
      if (before !== dispute.status) {
        finalizedDisputes.push(dispute.id);
      }
    }
    this.sweepBannedPublisherCleanTasks();
    this.autoTerminateExpiredCleanTasks();

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
    const now = this.nowIso();
    if (result === "COMPLETED") {
      if (dispute.status !== DisputeStatus.RESOLVED_COMPLETED) {
        dispute.status = DisputeStatus.RESOLVED_COMPLETED;
        this.finalizeDisputeWithOutcome(dispute, VoteChoice.COMPLETED);
      }
    } else {
      const affectedCycleIds = this.collectDisputeAffectedCycleIds(dispute.id);
      const distributionsBefore = this.captureClosedCycleDistributions(affectedCycleIds);
      const wasResolvedCompleted = dispute.status === DisputeStatus.RESOLVED_COMPLETED;
      const rollbackHistory = this.captureDisputeRollbackHistory(dispute.id, now);
      let publisherRemainsBanned = false;
      if (wasResolvedCompleted) {
        publisherRemainsBanned = this.rollbackResolvedCompletedDispute(dispute);
      }
      this.clearDisputeVotes(dispute.id, {
        reverseResolvedOutcome: wasResolvedCompleted,
        now
      });
      if (rollbackHistory) {
        this.disputeRollbackHistory.push(rollbackHistory);
      }
      dispute.status = DisputeStatus.OPEN;
      this.reconcileClosedCycleDistributions(distributionsBefore);
      if (publisherRemainsBanned) {
        this.sweepBannedPublisherCleanTasks();
      }
    }
    dispute.updatedAt = now;
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

  private resolveDisputeParties(dispute: Dispute): {
    publisher: Address;
    submissionAgent: Address;
    counterparty: Address;
  } {
    const task = this.getTask(dispute.taskId);
    const submission = this.requireSubmission(dispute.submissionId);
    const publisher = task.publisher;
    const submissionAgent = submission.agent;
    if (dispute.opener !== publisher && dispute.opener !== submissionAgent) {
      throw new DomainError("MISMATCH", "dispute opener does not match task/submission parties", 400);
    }
    return {
      publisher,
      submissionAgent,
      counterparty: dispute.opener === publisher ? submissionAgent : publisher
    };
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
    const now = this.nowIso();
    const submission = this.requireSubmission(dispute.submissionId);
    const task = this.getTask(dispute.taskId);
    if (outcome === VoteChoice.COMPLETED) {
      if (
        submission.status !== SubmissionStatus.CONFIRMED &&
        submission.status !== SubmissionStatus.DISPUTE_COMPLETED
      ) {
        const rollback: DisputeResolutionRollbackRecord = {
          resolutionCycleId: this.activeCycleId,
          taskStatusBeforeResolution: task.status,
          taskRewardEscrowRemainingBeforeResolution: task.rewardEscrowRemaining,
          publisherWasBannedBeforeResolution: this.requireAgent(task.publisher).status === AgentStatus.BANNED,
          publisherBanSourceDisputeIdBeforeResolution: this.getBanSourceDisputeId(task.publisher),
          forcedTerminations: []
        };
        if (this.hasPayableSlot(task)) {
          this.confirmSubmissionInternal(submission, task, task.publisher, {
            grantPublisherCredits: false,
            disputeId: dispute.id
          });
          this.disputeResolutionMeta.set(dispute.id, {
            disputeId: dispute.id,
            payoutSource: DisputePayoutSource.ESCROW,
            payoutAmount: task.rewardPerSlot,
            payoutShortfallAmount: 0,
            publisherBanned: this.requireAgent(task.publisher).status === AgentStatus.BANNED,
            rollback
          });
        } else {
          this.resolveCompletedDisputeFromPublisherWallet(dispute, submission, task, rollback);
        }
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
    if (outcome === VoteChoice.COMPLETED && this.hasReopenHistoryForDispute(dispute.id)) {
      const negativeBalanceAddresses = this.banNegativeBalanceAgentsAffectedByReopenedDisputeSettlement(
        dispute.id,
        now
      );
      if (this.hasActiveTaskForAnyPublisher(negativeBalanceAddresses)) {
        this.sweepBannedPublisherCleanTasks();
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
      if (!this.hasPayableSlot(task)) {
        task.status = TaskStatus.CLOSED;
        task.updatedAt = this.nowIso();
        continue;
      }
      this.confirmSubmissionInternal(submission, task, task.publisher);
    }
  }

  private confirmSubmissionInternal(
    submission: Submission,
    task: Task,
    actor: Address,
    options?: {
      grantPublisherCredits?: boolean;
      disputeId?: string | null;
    }
  ): void {
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
    if (!this.hasPayableSlot(task)) {
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
    if (options?.grantPublisherCredits ?? true) {
      this.shiftReputation(task.publisher, "publisher", 1);
      this.recordCycleWorkload({
        cycleId: this.activeCycleId,
        taskId: task.id,
        disputeId: null,
        agent: task.publisher,
        workload: this.config.taskCompletionPublisherWorkload
      });
    }
    this.recordCycleWorkload({
      cycleId: this.activeCycleId,
      taskId: task.id,
      disputeId: options?.disputeId ?? null,
      agent: submission.agent,
      workload: this.config.taskCompletionWorkerWorkload
    });
    this.recordActivity({
      type: ActivityEventType.TASK_COMPLETED,
      taskId: task.id,
      disputeId: options?.disputeId ?? null,
      actor
    });
  }

  private resolveCompletedDisputeFromPublisherWallet(
    dispute: Dispute,
    submission: Submission,
    task: Task,
    rollback: DisputeResolutionRollbackRecord
  ): void {
    const now = this.nowIso();
    const publisherBalance = this.requireBalance(task.publisher);
    const payoutAmount = Math.max(0, Math.min(task.rewardPerSlot, publisherBalance.available));
    const payoutShortfallAmount = Math.max(0, task.rewardPerSlot - payoutAmount);

    publisherBalance.available -= payoutAmount;
    publisherBalance.updatedAt = now;

    submission.status = SubmissionStatus.DISPUTE_COMPLETED;
    submission.updatedAt = now;
    if (!task.completedAgents.includes(submission.agent)) {
      task.completedAgents.push(submission.agent);
    }
    if (!this.hasPayableSlot(task)) {
      task.status = TaskStatus.CLOSED;
    }
    task.competitionRatio = this.computeCompetitionRatio(task.intentCount, this.getRemainingSlots(task));
    task.updatedAt = now;

    const workerBalance = this.requireBalance(submission.agent);
    workerBalance.available += payoutAmount;
    workerBalance.updatedAt = now;
    const workerProfile = this.requireAgent(submission.agent);
    workerProfile.stats.tasksCompleted += 1;
    this.shiftReputation(submission.agent, "worker", 2);
    this.recordCycleWorkload({
      cycleId: this.activeCycleId,
      taskId: task.id,
      disputeId: dispute.id,
      agent: submission.agent,
      workload: this.config.taskCompletionWorkerWorkload
    });
    this.recordActivity({
      type: ActivityEventType.TASK_COMPLETED,
      taskId: task.id,
      disputeId: dispute.id,
      actor: task.publisher
    });

    if (payoutShortfallAmount > 0) {
      this.banAgent(task.publisher, AgentBanReason.DISPUTE_INSOLVENCY, dispute.id);
      rollback.forcedTerminations = this.sweepBannedPublisherCleanTasks(dispute.id);
    }

    this.disputeResolutionMeta.set(dispute.id, {
      disputeId: dispute.id,
      payoutSource:
        payoutShortfallAmount > 0
          ? DisputePayoutSource.PUBLISHER_WALLET_PARTIAL
          : DisputePayoutSource.PUBLISHER_WALLET,
      payoutAmount,
      payoutShortfallAmount,
      publisherBanned: this.requireAgent(task.publisher).status === AgentStatus.BANNED,
      rollback
    });
  }

  private collectDisputeAffectedCycleIds(disputeId: string): Set<string> {
    const cycleIds = new Set<string>();
    for (const vote of this.votes.values()) {
      if (vote.disputeId === disputeId) {
        cycleIds.add(vote.createdCycleId);
      }
    }
    for (const workload of this.cycleWorkloads.values()) {
      if (workload.disputeId === disputeId) {
        cycleIds.add(workload.cycleId);
      }
    }
    const rollback = this.disputeResolutionMeta.get(disputeId)?.rollback;
    for (const item of rollback?.forcedTerminations ?? []) {
      cycleIds.add(item.cycleId);
    }
    return cycleIds;
  }

  private captureDisputeRollbackHistory(
    disputeId: string,
    reopenedAt: string
  ): DisputeRollbackHistoryRecord | null {
    const dispute = this.getDispute(disputeId);
    const archivedVotes = [...this.votes.values()]
      .filter((item) => item.disputeId === disputeId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map((item) => ({ ...item }));
    const archivedWorkloads = [...this.cycleWorkloads.values()]
      .filter((item) => item.disputeId === disputeId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map((item) => ({ ...item }));
    const archivedActivities = [...this.activities.values()]
      .filter(
        (item) =>
          item.disputeId === disputeId &&
          (item.type === ActivityEventType.TASK_COMPLETED || item.type === ActivityEventType.TASK_TERMINATED)
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map((item) => ({ ...item }));
    const previousResolution = this.disputeResolutionMeta.get(disputeId);
    if (
      dispute.status === DisputeStatus.OPEN &&
      archivedVotes.length === 0 &&
      archivedWorkloads.length === 0 &&
      archivedActivities.length === 0 &&
      !previousResolution
    ) {
      return null;
    }
    return {
      id: nanoid(),
      disputeId,
      previousStatus: dispute.status,
      previousResolution: previousResolution ? this.cloneJson(previousResolution) : null,
      archivedVotes,
      archivedWorkloads,
      archivedActivities,
      reopenedAt
    };
  }

  private captureClosedCycleDistributions(
    cycleIds: Iterable<string>
  ): Map<string, Map<Address, number>> {
    const snapshot = new Map<string, Map<Address, number>>();
    for (const cycleId of cycleIds) {
      const cycle = this.cycles.get(cycleId);
      if (!cycle || cycle.status !== CycleStatus.CLOSED) {
        continue;
      }
      snapshot.set(cycleId, this.computeCycleDistribution(cycleId));
    }
    return snapshot;
  }

  private reconcileClosedCycleDistributions(
    distributionsBefore: Map<string, Map<Address, number>>
  ): void {
    const now = this.nowIso();
    for (const [cycleId, before] of distributionsBefore.entries()) {
      const after = this.computeCycleDistribution(cycleId);
      const agents = new Set<Address>([...before.keys(), ...after.keys()]);
      for (const agent of agents) {
        const delta = (after.get(agent) ?? 0) - (before.get(agent) ?? 0);
        if (delta === 0) {
          continue;
        }
        const balance = this.requireBalance(agent);
        balance.available += delta;
        balance.updatedAt = now;
      }
    }
  }

  private computeCycleDistribution(cycleId: string): Map<Address, number> {
    const cycle = this.requireCycle(cycleId);
    const rewardPool = cycle.mintedAmount + cycle.taxPool + cycle.penaltyPool;
    const grouped = new Map<string, number>();
    for (const workload of this.cycleWorkloads.values()) {
      if (workload.cycleId !== cycleId) {
        continue;
      }
      grouped.set(workload.agent, (grouped.get(workload.agent) ?? 0) + workload.workload);
    }
    return new Map(
      [...allocateIntegerPool(rewardPool, grouped).entries()].map(([agent, amount]) => [agent as Address, amount])
    );
  }

  private rollbackResolvedCompletedDispute(dispute: Dispute): boolean {
    const meta = this.disputeResolutionMeta.get(dispute.id);
    const submission = this.requireSubmission(dispute.submissionId);
    const task = this.getTask(dispute.taskId);
    const rollback = meta?.rollback;
    const now = this.nowIso();
    const payoutAmount = meta?.payoutAmount ?? (submission.status === SubmissionStatus.CONFIRMED ? task.rewardPerSlot : 0);
    const payoutSource = meta?.payoutSource ?? DisputePayoutSource.ESCROW;

    if (
      submission.status === SubmissionStatus.CONFIRMED ||
      submission.status === SubmissionStatus.DISPUTE_COMPLETED
    ) {
      submission.status = SubmissionStatus.REJECTED;
      submission.updatedAt = now;
    }

    task.rewardEscrowRemaining = rollback?.taskRewardEscrowRemainingBeforeResolution ?? task.rewardEscrowRemaining;
    task.status = rollback?.taskStatusBeforeResolution ?? TaskStatus.IN_PROGRESS;
    this.removeCompletedAgentIfUnreferenced(task, submission.agent, submission.id);
    task.competitionRatio = this.computeCompetitionRatio(task.intentCount, this.getRemainingSlots(task));
    task.updatedAt = now;

    const workerBalance = this.requireBalance(submission.agent);
    workerBalance.available -= payoutAmount;
    workerBalance.updatedAt = now;
    if (payoutSource !== DisputePayoutSource.ESCROW) {
      const publisherBalance = this.requireBalance(task.publisher);
      publisherBalance.available += payoutAmount;
      publisherBalance.updatedAt = now;
    }

    const workerProfile = this.requireAgent(submission.agent);
    workerProfile.stats.tasksCompleted = Math.max(0, workerProfile.stats.tasksCompleted - 1);
    this.shiftReputation(submission.agent, "worker", -2);

    this.removeDisputeCompletionArtifacts(dispute.id);
    for (const forcedTermination of rollback?.forcedTerminations ?? []) {
      this.rollbackForcedTermination(dispute.id, forcedTermination);
    }
    const publisherRemainsBanned = this.restorePublisherBanState(task.publisher, dispute.id, rollback, now);
    this.disputeResolutionMeta.delete(dispute.id);
    return publisherRemainsBanned;
  }

  private rollbackForcedTermination(disputeId: string, rollback: ForcedTerminationRollbackRecord): void {
    const task = this.getTask(rollback.taskId);
    const now = this.nowIso();
    const publisherBalance = this.requireBalance(task.publisher);
    publisherBalance.available -= rollback.refund;
    publisherBalance.updatedAt = now;

    const cycle = this.requireCycle(rollback.cycleId);
    cycle.penaltyPool -= rollback.penalty;

    task.rewardEscrowRemaining = rollback.previousRewardEscrowRemaining;
    task.status = rollback.previousStatus;
    task.competitionRatio = this.computeCompetitionRatio(task.intentCount, this.getRemainingSlots(task));
    task.updatedAt = now;

    const publisherProfile = this.requireAgent(task.publisher);
    publisherProfile.stats.tasksTerminated = Math.max(0, publisherProfile.stats.tasksTerminated - 1);
    this.shiftReputation(task.publisher, "publisher", 1);

    for (const [activityId, activity] of this.activities.entries()) {
      if (
        activity.type === ActivityEventType.TASK_TERMINATED &&
        activity.disputeId === disputeId &&
        activity.taskId === task.id
      ) {
        this.activities.delete(activityId);
      }
    }
  }

  private removeDisputeCompletionArtifacts(disputeId: string): void {
    for (const [workloadId, workload] of this.cycleWorkloads.entries()) {
      if (workload.disputeId === disputeId && workload.taskId !== null) {
        this.cycleWorkloads.delete(workloadId);
      }
    }
    for (const [activityId, activity] of this.activities.entries()) {
      if (activity.type === ActivityEventType.TASK_COMPLETED && activity.disputeId === disputeId) {
        this.activities.delete(activityId);
      }
    }
  }

  private clearDisputeVotes(
    disputeId: string,
    options: { reverseResolvedOutcome: boolean; now: string }
  ): void {
    const votes = [...this.votes.values()].filter((item) => item.disputeId === disputeId);
    for (const vote of votes) {
      const profile = this.requireAgent(vote.agent);
      profile.stats.supervisionVotes = Math.max(0, profile.stats.supervisionVotes - 1);
      this.shiftReputation(vote.agent, "supervisor", -0.5);
      if (options.reverseResolvedOutcome) {
        this.shiftReputation(vote.agent, "supervisor", vote.vote === VoteChoice.COMPLETED ? -1 : 1);
      }
      this.votes.delete(vote.id);
      this.votesByDisputeAndAgent.delete(`${disputeId}:${vote.agent}`);
    }
    for (const [workloadId, workload] of this.cycleWorkloads.entries()) {
      if (workload.disputeId === disputeId && workload.taskId === null) {
        this.cycleWorkloads.delete(workloadId);
      }
    }
  }

  private removeCompletedAgentIfUnreferenced(task: Task, agent: Address, revertedSubmissionId: string): void {
    if (!task.completedAgents.includes(agent)) {
      return;
    }
    const hasOtherCompletion = [...this.submissions.values()].some(
      (item) =>
        item.id !== revertedSubmissionId &&
        item.taskId === task.id &&
        item.agent === agent &&
        (item.status === SubmissionStatus.CONFIRMED || item.status === SubmissionStatus.DISPUTE_COMPLETED)
    );
    if (!hasOtherCompletion) {
      task.completedAgents = task.completedAgents.filter((item) => item !== agent);
    }
  }

  private restorePublisherBanState(
    publisher: Address,
    disputeId: string,
    rollback: DisputeResolutionRollbackRecord | null | undefined,
    now: string
  ): boolean {
    const profile = this.requireAgent(publisher);
    const alternateBanSourceDisputeId = this.findAlternateBanSourceDisputeId(publisher, disputeId);
    if (rollback?.publisherWasBannedBeforeResolution) {
      profile.status = AgentStatus.BANNED;
      profile.updatedAt = now;
      const restoredBanSourceDisputeId =
        rollback.publisherBanSourceDisputeIdBeforeResolution ?? alternateBanSourceDisputeId;
      if (restoredBanSourceDisputeId) {
        this.banSourceDisputeByPublisher.set(publisher, restoredBanSourceDisputeId);
      } else {
        this.banSourceDisputeByPublisher.delete(publisher);
      }
      return true;
    }
    if (alternateBanSourceDisputeId) {
      profile.status = AgentStatus.BANNED;
      profile.banReasonCode = AgentBanReason.DISPUTE_INSOLVENCY;
      profile.updatedAt = now;
      this.banSourceDisputeByPublisher.set(publisher, alternateBanSourceDisputeId);
      return true;
    }
    if (this.getBanSourceDisputeId(publisher) !== disputeId) {
      return profile.status === AgentStatus.BANNED;
    }
    profile.status = AgentStatus.ACTIVE;
    profile.bannedAt = null;
    profile.banReasonCode = null;
    profile.updatedAt = now;
    this.banSourceDisputeByPublisher.delete(publisher);
    return false;
  }

  private appendForcedTerminationRollback(disputeId: string, rollback: ForcedTerminationRollbackRecord): void {
    const existing = this.disputeResolutionMeta.get(disputeId);
    if (!existing) {
      return;
    }
    const nextRollback = existing.rollback ?? {
      resolutionCycleId: this.activeCycleId,
      taskStatusBeforeResolution: TaskStatus.IN_PROGRESS,
      taskRewardEscrowRemainingBeforeResolution: 0,
      publisherWasBannedBeforeResolution: false,
      publisherBanSourceDisputeIdBeforeResolution: null,
      forcedTerminations: []
    };
    nextRollback.forcedTerminations.push(rollback);
    existing.rollback = nextRollback;
    this.disputeResolutionMeta.set(disputeId, existing);
  }

  private getBanSourceDisputeId(publisher: Address): string | null {
    return this.banSourceDisputeByPublisher.get(publisher) ?? null;
  }

  private findAlternateBanSourceDisputeId(publisher: Address, excludingDisputeId: string): string | null {
    for (const dispute of this.disputes.values()) {
      if (dispute.id === excludingDisputeId || dispute.status !== DisputeStatus.RESOLVED_COMPLETED) {
        continue;
      }
      if (this.getTask(dispute.taskId).publisher !== publisher) {
        continue;
      }
      if (this.disputeResolutionMeta.get(dispute.id)?.payoutSource === DisputePayoutSource.PUBLISHER_WALLET_PARTIAL) {
        return dispute.id;
      }
    }
    return null;
  }

  private hasReopenHistoryForDispute(disputeId: string): boolean {
    return this.disputeRollbackHistory.some((item) => item.disputeId === disputeId);
  }

  private collectAddressesAffectedByReopenedDispute(disputeId: string): Set<Address> {
    const dispute = this.getDispute(disputeId);
    const submission = this.requireSubmission(dispute.submissionId);
    const task = this.getTask(dispute.taskId);
    const addresses = new Set<Address>([submission.agent, task.publisher]);
    const affectedCycleIds = new Set<string>();

    for (const history of this.disputeRollbackHistory) {
      if (history.disputeId !== disputeId) {
        continue;
      }
      for (const vote of history.archivedVotes) {
        affectedCycleIds.add(vote.createdCycleId);
      }
      for (const workload of history.archivedWorkloads) {
        affectedCycleIds.add(workload.cycleId);
        addresses.add(workload.agent);
      }
      for (const forcedTermination of history.previousResolution?.rollback?.forcedTerminations ?? []) {
        affectedCycleIds.add(forcedTermination.cycleId);
      }
    }

    for (const workload of this.cycleWorkloads.values()) {
      if (affectedCycleIds.has(workload.cycleId)) {
        addresses.add(workload.agent);
      }
    }

    return addresses;
  }

  private banNegativeBalanceAgentsAffectedByReopenedDisputeSettlement(
    disputeId: string,
    now: string
  ): Set<Address> {
    const addresses = new Set<Address>();
    for (const address of this.collectAddressesAffectedByReopenedDispute(disputeId)) {
      const balance = this.balances.get(address);
      if (!balance || balance.available >= 0) {
        continue;
      }
      addresses.add(address);
      const profile = this.requireAgent(address);
      if (profile.status === AgentStatus.BANNED) {
        if (!profile.banReasonCode) {
          profile.banReasonCode = AgentBanReason.REOPEN_NEGATIVE_BALANCE;
          profile.updatedAt = now;
        }
        continue;
      }
      profile.status = AgentStatus.BANNED;
      profile.bannedAt = now;
      profile.banReasonCode = AgentBanReason.REOPEN_NEGATIVE_BALANCE;
      profile.updatedAt = now;
    }
    return addresses;
  }

  private hasActiveTaskForAnyPublisher(addresses: Iterable<Address>): boolean {
    const publisherSet = new Set(addresses);
    if (publisherSet.size === 0) {
      return false;
    }
    for (const task of this.tasks.values()) {
      if (publisherSet.has(task.publisher) && this.isTaskActive(task)) {
        return true;
      }
    }
    return false;
  }

  private hasPayableSlot(task: Task): boolean {
    return this.getConfirmedSlots(task) < task.slotsTotal && task.rewardEscrowRemaining >= task.rewardPerSlot;
  }

  private isTaskFrozen(task: Task): boolean {
    return this.requireAgent(task.publisher).status === AgentStatus.BANNED;
  }

  private isTaskActive(task: Task): boolean {
    return task.status === TaskStatus.OPEN || task.status === TaskStatus.IN_PROGRESS;
  }

  private isTaskCleanForForcedTermination(task: Task): boolean {
    for (const submission of this.submissions.values()) {
      if (submission.taskId === task.id && submission.status === SubmissionStatus.SUBMITTED) {
        return false;
      }
    }
    for (const dispute of this.disputes.values()) {
      if (dispute.taskId === task.id && dispute.status === DisputeStatus.OPEN) {
        return false;
      }
    }
    return true;
  }

  private hasOpenDisputeForSubmission(submissionId: string): boolean {
    return [...this.disputes.values()].some(
      (item) => item.submissionId === submissionId && item.status === DisputeStatus.OPEN
    );
  }

  private hasOpenDisputeForTask(taskId: string): boolean {
    return [...this.disputes.values()].some(
      (item) => item.taskId === taskId && item.status === DisputeStatus.OPEN
    );
  }

  private sweepBannedPublisherCleanTasks(disputeIdOverride?: string): ForcedTerminationRollbackRecord[] {
    const forcedTerminations: ForcedTerminationRollbackRecord[] = [];
    for (const task of this.tasks.values()) {
      if (!this.isTaskActive(task) || !this.isTaskFrozen(task) || !this.isTaskCleanForForcedTermination(task)) {
        continue;
      }
      const disputeId = disputeIdOverride ?? this.getBanSourceDisputeId(task.publisher);
      const terminated = this.terminateTaskInternal(task, task.publisher, {
        disputeId
      });
      if (!disputeId || !terminated.rollback) {
        continue;
      }
      if (disputeIdOverride) {
        forcedTerminations.push(terminated.rollback);
      } else {
        this.appendForcedTerminationRollback(disputeId, terminated.rollback);
      }
    }
    return forcedTerminations;
  }

  private autoTerminateExpiredCleanTasks(): void {
    const nowMs = this.clock.now().getTime();
    for (const task of this.tasks.values()) {
      if (!this.isTaskActive(task) || !this.isTaskCleanForForcedTermination(task)) {
        continue;
      }
      if (new Date(task.deadlineUtc).getTime() > nowMs) {
        continue;
      }
      this.terminateTaskInternal(task, task.publisher);
    }
  }

  private terminateTaskInternal(
    task: Task,
    actor: Address,
    options?: { disputeId?: string | null }
  ): { task: Task; rollback: ForcedTerminationRollbackRecord | null } {
    if (task.status === TaskStatus.TERMINATED || task.status === TaskStatus.CLOSED) {
      throw new DomainError("TASK_NOT_TERMINABLE", "task is already closed", 409);
    }

    const previousStatus = task.status;
    const previousRewardEscrowRemaining = task.rewardEscrowRemaining;
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
      disputeId: options?.disputeId ?? null,
      actor
    });
    return {
      task,
      rollback:
        options?.disputeId
          ? {
              taskId: task.id,
              cycleId: this.activeCycleId,
              previousStatus,
              previousRewardEscrowRemaining,
              penalty,
              refund
            }
          : null
    };
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

  private recordCycleWorkload(input: {
    cycleId: string;
    disputeId: string | null;
    taskId: string | null;
    agent: Address;
    workload: number;
  }): void {
    if (!Number.isFinite(input.workload) || input.workload <= 0) {
      return;
    }
    const now = this.nowIso();
    const workload: CycleWorkload = {
      id: nanoid(),
      cycleId: input.cycleId,
      disputeId: input.disputeId,
      taskId: input.taskId,
      agent: input.agent,
      workload: input.workload,
      createdAt: now,
      settledAt: null
    };
    this.cycleWorkloads.set(workload.id, workload);
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

  private requireActiveAgentForWrite(address: Address): AgentProfile {
    const profile = this.requireAgent(address);
    if (profile.status === AgentStatus.BANNED) {
      throw new DomainError("ACCOUNT_BANNED", "account is banned from active operations", 403);
    }
    return profile;
  }

  private requireAgent(address: Address): AgentProfile {
    let profile = this.profiles.get(address);
    if (!profile) {
      const now = this.nowIso();
      profile = {
        address,
        name: "",
        bio: "",
        status: AgentStatus.ACTIVE,
        bannedAt: null,
        banReasonCode: null,
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
        available: this.config.initialAgentBalance,
        updatedAt: this.nowIso()
      });
    }
    return profile;
  }

  private banAgent(address: Address, reason: AgentBanReason, sourceDisputeId?: string): AgentProfile {
    const profile = this.requireAgent(address);
    if (profile.status !== AgentStatus.BANNED) {
      profile.status = AgentStatus.BANNED;
      profile.bannedAt = this.nowIso();
      profile.banReasonCode = reason;
      profile.updatedAt = this.nowIso();
      if (sourceDisputeId) {
        this.banSourceDisputeByPublisher.set(address, sourceDisputeId);
      }
    } else if (!profile.banReasonCode) {
      profile.banReasonCode = reason;
      profile.updatedAt = this.nowIso();
    }
    if (sourceDisputeId && !this.banSourceDisputeByPublisher.has(address)) {
      this.banSourceDisputeByPublisher.set(address, sourceDisputeId);
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
    this.profiles = new Map(
      snapshot.profiles.map((item) => [
        item.address,
        {
          ...item,
          status: item.status ?? AgentStatus.ACTIVE,
          bannedAt: item.bannedAt ?? null,
          banReasonCode: item.banReasonCode ?? null
        }
      ])
    );
    this.balances = new Map(snapshot.balances.map((item) => [item.address, item]));
    this.tasks = new Map(
      snapshot.tasks.map((item) => [
        item.id,
        {
          ...item,
          targetMentions: Array.isArray(item.targetMentions) ? item.targetMentions : []
        }
      ])
    );
    this.submissions = new Map(
      snapshot.submissions.map((item) => [
        item.id,
        {
          ...item,
          attachments: Array.isArray(item.attachments) ? item.attachments : [],
          rejectReasonMd: typeof item.rejectReasonMd === "string" ? item.rejectReasonMd : null
        }
      ])
    );
    this.disputes = new Map(
      snapshot.disputes.map((item) => [
        item.id,
        {
          ...item,
          counterpartyResponder:
            typeof item.counterpartyResponder === "string" ? item.counterpartyResponder : null,
          counterpartyReasonMd:
            typeof item.counterpartyReasonMd === "string" ? item.counterpartyReasonMd : null
        }
      ])
    );
    this.disputeResolutionMeta = new Map(
      (snapshot.disputeResolutionMeta ?? []).map((item) => [item.disputeId, item])
    );
    this.votes = new Map(snapshot.votes.map((item) => [item.id, item]));
    this.votesByDisputeAndAgent = new Map(snapshot.votesByDisputeAndAgent);
    this.cycleWorkloads = new Map(snapshot.cycleWorkloads.map((item) => [item.id, item]));
    this.cycles = new Map(snapshot.cycles.map((item) => [item.id, item]));
    this.activities = new Map(snapshot.activities.map((item) => [item.id, item]));
    this.disputeRollbackHistory = (snapshot.disputeRollbackHistory ?? []).map((item) => this.cloneJson(item));
    this.taskIntentions = new Map(
      (snapshot.intentions ?? []).map((item) => [`${item.taskId}:${item.agent}`, item])
    );
    const restoredMentions =
      snapshot.targetMentions ??
      [...this.tasks.values()].flatMap((task) => task.targetMentions ?? []);
    this.taskTargetMentions = new Map(restoredMentions.map((item) => [item.id, item]));
    for (const task of this.tasks.values()) {
      task.targetMentions = restoredMentions.filter((item) => item.taskId === task.id);
    }
    this.latestSubmissionByTaskAndAgent = new Map(snapshot.latestSubmissionByTaskAndAgent);
    this.banSourceDisputeByPublisher = new Map(snapshot.banSourceDisputeByPublisher ?? []);
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

  private cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
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
