import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { ActivityEventType, CycleStatus, DisputeStatus, TaskStatus, VoteChoice, type AgentProfile, type CycleRewardsResponse, type Dispute, type Task } from "@agentrade/types";
import { AgentDetailDrawer } from "./agent-detail-drawer";
import { CycleDetailContent } from "./cycle-detail-content";
import { CycleListPanel } from "./cycle-list-panel";
import { DisputeDetailContent } from "./dispute-detail-content";
import { DisputeListPanel } from "./dispute-list-panel";
import { TaskDetailDrawer } from "./task-detail-drawer";
import { TaskListPanel } from "./task-list-panel";

const ADDRESS_A = "0x1111111111111111111111111111111111111111";
const ADDRESS_B = "0x2222222222222222222222222222222222222222";
const ADDRESS_C = "0x3333333333333333333333333333333333333333";

const render = (node: ReactElement): string => renderToStaticMarkup(node);

describe("dashboard detail panels", () => {
  it("renders cycle list and enriched cycle detail content", () => {
    const rewards: CycleRewardsResponse = {
      cycle: {
        id: "cycle-9",
        status: CycleStatus.CLOSED,
        mintedAmount: 1000,
        taxPool: 80,
        penaltyPool: 10,
        startedAt: "2026-03-28T00:00:00.000Z",
        closedAt: "2026-03-31T00:00:00.000Z"
      },
      rewardPool: 1090,
      distributions: [{ agent: ADDRESS_B, amount: 1090 }],
      workloads: [
        {
          id: "workload-1",
          cycleId: "cycle-9",
          disputeId: "dispute-1",
          agent: ADDRESS_B,
          workload: 3,
          createdAt: "2026-03-30T00:00:00.000Z",
          settledAt: "2026-03-31T00:00:00.000Z"
        }
      ]
    };
    const disputes: Dispute[] = [
      {
        id: "dispute-1",
        taskId: "task-1",
        submissionId: "submission-1",
        opener: ADDRESS_A,
        reasonMd: "Quality mismatch",
        status: DisputeStatus.OPEN,
        createdAt: "2026-03-30T00:00:00.000Z",
        updatedAt: "2026-03-30T00:00:00.000Z"
      }
    ];

    const listHtml = render(
      <CycleListPanel
        locale="en"
        timeZone="UTC"
        cycles={[rewards.cycle]}
        loadingCycles={false}
        loadingMoreCycles={false}
        cycleLoadError={false}
        cycleLoadErrorKind={null}
        nextCursor="2"
        cycleSentinelRef={{ current: null }}
        onOpenCycleDetail={() => undefined}
        onRefresh={() => undefined}
        onLoadMore={() => undefined}
      />
    );
    const detailHtml = render(
      <CycleDetailContent
        locale="en"
        timeZone="UTC"
        rewards={rewards}
        disputes={disputes}
        getAgentHref={(address) => `/agents/${address}`}
      />
    );

    expect(listHtml).toContain("cycle-9");
    expect(listHtml).toContain("Load more cycles");
    expect(listHtml).toContain("Closed");
    expect(detailHtml).toContain("Reward Pool");
    expect(detailHtml).toContain("1090 AGC");
    expect(detailHtml).toContain("Closed");
    expect(detailHtml).toContain("Settlement Summary");
    expect(detailHtml).toContain(`/agents/${ADDRESS_B}`);
    expect(detailHtml).toContain("Quality mismatch");
  });

  it("orders cycle cards from newest to oldest by startedAt", () => {
    const listHtml = render(
      <CycleListPanel
        locale="en"
        timeZone="UTC"
        cycles={[
          {
            id: "cycle-1",
            status: CycleStatus.CLOSED,
            mintedAmount: 1000,
            taxPool: 80,
            penaltyPool: 10,
            startedAt: "2026-03-28T00:00:00.000Z",
            closedAt: "2026-03-31T00:00:00.000Z"
          },
          {
            id: "cycle-2",
            status: CycleStatus.OPEN,
            mintedAmount: 1000,
            taxPool: 2,
            penaltyPool: 0,
            startedAt: "2026-04-05T21:00:43.000Z",
            closedAt: null
          }
        ]}
        loadingCycles={false}
        loadingMoreCycles={false}
        cycleLoadError={false}
        cycleLoadErrorKind={null}
        nextCursor={null}
        cycleSentinelRef={{ current: null }}
        onOpenCycleDetail={() => undefined}
        onRefresh={() => undefined}
        onLoadMore={() => undefined}
      />
    );

    const newerIndex = listHtml.indexOf("cycle-2");
    const olderIndex = listHtml.indexOf("cycle-1");
    expect(newerIndex).toBeGreaterThan(-1);
    expect(olderIndex).toBeGreaterThan(-1);
    expect(newerIndex).toBeLessThan(olderIndex);
    expect(listHtml).toContain("Remaining");
  });

  it("shows remaining time in cycle detail when cycle is open", () => {
    const openRewards: CycleRewardsResponse = {
      cycle: {
        id: "cycle-open",
        status: CycleStatus.OPEN,
        mintedAmount: 1000,
        taxPool: 0,
        penaltyPool: 0,
        startedAt: "2026-04-10T00:00:00.000Z",
        closedAt: null
      },
      rewardPool: 1000,
      distributions: [],
      workloads: []
    };

    const html = render(
      <CycleDetailContent
        locale="en"
        timeZone="UTC"
        rewards={openRewards}
        disputes={[]}
      />
    );

    expect(html).toContain("Remaining");
  });

  it("renders explicit 429 hint when cycle list is rate-limited", () => {
    const html = render(
      <CycleListPanel
        locale="en"
        timeZone="UTC"
        cycles={[]}
        loadingCycles={false}
        loadingMoreCycles={false}
        cycleLoadError
        cycleLoadErrorKind="rate_limit"
        nextCursor={null}
        cycleSentinelRef={{ current: null }}
        onOpenCycleDetail={() => undefined}
        onRefresh={() => undefined}
        onLoadMore={() => undefined}
      />
    );

    expect(html).toContain("Rate limited (HTTP 429)");
  });

  it("renders enriched task detail fields", () => {
    const task: Task = {
      id: "task-1",
      publisher: ADDRESS_A,
      title: "Alpha Review",
      descriptionMd: "Review alpha output.",
      acceptanceCriteria: "Clear findings.",
      status: TaskStatus.IN_PROGRESS,
      deadlineUtc: "2026-04-01T00:00:00.000Z",
      displayTimezone: "UTC",
      slotsTotal: 2,
      rewardPerSlot: 25,
      allowRepeatCompletionsBySameAgent: false,
      taxAmount: 3,
      rewardEscrowRemaining: 25,
      intentCount: 1,
      competitionRatio: 0.5,
      completedAgents: [ADDRESS_C],
      createdAt: "2026-03-30T00:00:00.000Z",
      updatedAt: "2026-03-31T00:00:00.000Z"
    };
    const html = render(
      <TaskDetailDrawer
        locale="en"
        timeZone="UTC"
        taskDetail={{
          loading: false,
          error: false,
          errorKind: null,
          task,
          intentions: [
            {
              id: "intention-1",
              taskId: task.id,
              agent: ADDRESS_B,
              createdAt: "2026-03-30T12:00:00.000Z"
            }
          ],
          disputes: [
            {
              id: "dispute-1",
              taskId: "task-1",
              submissionId: "submission-1",
              opener: ADDRESS_A,
              reasonMd: "Needs another review",
              status: DisputeStatus.OPEN,
              createdAt: "2026-03-31T00:00:00.000Z",
              updatedAt: "2026-03-31T00:00:00.000Z"
            }
          ],
          activities: [
            {
              id: "activity-1",
              type: ActivityEventType.TASK_INTENDED,
              cycleId: "cycle-9",
              taskId: "task-1",
              disputeId: null,
              actor: ADDRESS_B,
              createdAt: "2026-03-31T00:00:00.000Z"
            }
          ]
        }}
        onRetry={() => undefined}
        onOpenAgentDetail={() => undefined}
      />
    );

    expect(html).toContain("Escrow Remaining");
    expect(html).toContain("Slot Progress");
    expect(html).toContain("Needs another review");
    expect(html).toContain("Open dispute");
    expect(html).toContain("Task Intended");
    expect(html).toContain("In progress");
    expect(html).not.toContain(">IN_PROGRESS<");
  });

  it("keeps task status counts stable when current tab is filtered", () => {
    const html = render(
      <TaskListPanel
        locale="en"
        timeZone="UTC"
        tasks={[
          {
            id: "task-a",
            publisher: ADDRESS_A,
            title: "In progress A",
            descriptionMd: "A",
            acceptanceCriteria: "A",
            status: TaskStatus.IN_PROGRESS,
            deadlineUtc: "2026-04-01T00:00:00.000Z",
            displayTimezone: "UTC",
            slotsTotal: 1,
            rewardPerSlot: 10,
            allowRepeatCompletionsBySameAgent: false,
            taxAmount: 1,
            rewardEscrowRemaining: 10,
            intentCount: 0,
            competitionRatio: 0,
            completedAgents: [],
            createdAt: "2026-03-30T00:00:00.000Z",
            updatedAt: "2026-03-31T00:00:00.000Z"
          },
          {
            id: "task-b",
            publisher: ADDRESS_A,
            title: "In progress B",
            descriptionMd: "B",
            acceptanceCriteria: "B",
            status: TaskStatus.IN_PROGRESS,
            deadlineUtc: "2026-04-01T00:00:00.000Z",
            displayTimezone: "UTC",
            slotsTotal: 1,
            rewardPerSlot: 10,
            allowRepeatCompletionsBySameAgent: false,
            taxAmount: 1,
            rewardEscrowRemaining: 10,
            intentCount: 0,
            competitionRatio: 0,
            completedAgents: [],
            createdAt: "2026-03-30T00:00:00.000Z",
            updatedAt: "2026-03-31T00:00:00.000Z"
          }
        ]}
        taskAllCount={20}
        taskStatus={TaskStatus.IN_PROGRESS}
        taskStatusCounts={{
          OPEN: 18,
          IN_PROGRESS: 2,
          CLOSED: 0,
          TERMINATED: 0
        }}
        hasTaskFilters
        loadingTasks={false}
        loadingMoreTasks={false}
        taskLoadError={false}
        taskLoadErrorKind={null}
        nextCursor={null}
        taskSentinelRef={{ current: null }}
        onOpenTaskDetail={() => undefined}
        onSetTaskStatus={() => undefined}
        onRefresh={() => undefined}
        onLoadMore={() => undefined}
      />
    );

    expect(html).toContain("All (20)");
    expect(html).toContain("Open (18)");
    expect(html).toContain("In progress (2)");
  });

  it("renders agent balance and stats", () => {
    const profile: AgentProfile = {
      address: ADDRESS_A,
      name: "Agent Alpha",
      bio: "Focus on QA.",
      reputation: { publisher: 1.2, worker: 2.1, supervisor: 1.4 },
      stats: {
        tasksPublished: 2,
        tasksIntented: 5,
        tasksCompleted: 4,
        tasksTerminated: 1,
        submissionsRejected: 1,
        supervisionVotes: 3
      },
      createdAt: "2026-03-20T00:00:00.000Z",
      updatedAt: "2026-03-31T00:00:00.000Z"
    };
    const html = render(
      <AgentDetailDrawer
        locale="en"
        timeZone="UTC"
        agentDetail={{
          loading: false,
          error: false,
          errorKind: null,
          profile,
          ledger: {
            address: ADDRESS_A,
            available: 42,
            updatedAt: "2026-03-31T00:00:00.000Z"
          },
          activities: [
            {
              id: "activity-1",
              type: ActivityEventType.TASK_COMPLETED,
              cycleId: "cycle-9",
              taskId: "task-1",
              disputeId: null,
              actor: ADDRESS_A,
              createdAt: "2026-03-31T00:00:00.000Z"
            }
          ]
        }}
        onRetry={() => undefined}
      />
    );

    expect(html).toContain("Balance &amp; Reputation");
    expect(html).toContain("42 AGC");
    expect(html).toContain("Published");
    expect(html).toContain("Task Completed");
  });

  it("renders dispute list and dispute detail content", () => {
    const dispute: Dispute = {
      id: "dispute-1",
      taskId: "task-1",
      submissionId: "submission-1",
      opener: ADDRESS_A,
      reasonMd: "Output quality mismatch",
      counterpartyResponder: ADDRESS_B,
      counterpartyReasonMd: "Counterparty evidence attached",
      status: DisputeStatus.OPEN,
      createdAt: "2026-03-31T00:00:00.000Z",
      updatedAt: "2026-03-31T00:00:00.000Z"
    };

    const listHtml = render(
      <DisputeListPanel
        locale="en"
        timeZone="UTC"
        disputes={[dispute]}
        disputeStatus={DisputeStatus.OPEN}
        disputeStatusCounts={{ OPEN: 1 }}
        hasDisputeFilters
        loadingDisputes={false}
        loadingMoreDisputes={false}
        disputeLoadError={false}
        disputeLoadErrorKind={null}
        nextCursor="2"
        disputeSentinelRef={{ current: null }}
        onOpenDisputeDetail={() => undefined}
        onSetDisputeStatus={() => undefined}
        onRefresh={() => undefined}
        onLoadMore={() => undefined}
      />
    );

    const detailHtml = render(
      <DisputeDetailContent
        locale="en"
        timeZone="UTC"
        dispute={dispute}
        task={{
          id: "task-1",
          publisher: ADDRESS_A,
          title: "Alpha Review",
          descriptionMd: "Review alpha output.",
          acceptanceCriteria: "Clear findings.",
          status: TaskStatus.IN_PROGRESS,
          deadlineUtc: "2026-04-01T00:00:00.000Z",
          displayTimezone: "UTC",
          slotsTotal: 2,
          rewardPerSlot: 25,
          allowRepeatCompletionsBySameAgent: false,
          taxAmount: 3,
          rewardEscrowRemaining: 25,
          intentCount: 1,
          competitionRatio: 0.5,
          completedAgents: [ADDRESS_C],
          createdAt: "2026-03-30T00:00:00.000Z",
          updatedAt: "2026-03-31T00:00:00.000Z"
        }}
        activities={[
          {
            id: "activity-1",
            type: ActivityEventType.DISPUTE_OPENED,
            cycleId: "cycle-9",
            taskId: "task-1",
            disputeId: "dispute-1",
            actor: ADDRESS_A,
            createdAt: "2026-03-31T00:00:00.000Z"
          }
        ]}
        getAgentHref={(address) => `/agents/${address}`}
        getTaskHref={(taskId) => `/tasks/${taskId}`}
      />
    );

    expect(listHtml).toContain("Output quality mismatch");
    expect(listHtml).toContain("Open");
    expect(listHtml).toContain("Load more disputes");
    expect(detailHtml).toContain("Dispute Overview");
    expect(detailHtml).toContain("Task Context");
    expect(detailHtml).toContain("Dispute detail navigation");
    expect(detailHtml).toContain("Dispute Opened");
    expect(detailHtml).not.toContain("DISPUTE_OPENED");
    expect(detailHtml).toContain("Counterparty evidence attached");
    expect(detailHtml).toContain("/tasks/task-1");
  });

  it("renders resolution summary for resolved disputes", () => {
    const dispute: Dispute = {
      id: "dispute-2",
      taskId: "task-2",
      submissionId: "submission-2",
      opener: ADDRESS_A,
      reasonMd: "finalized",
      status: DisputeStatus.RESOLVED_COMPLETED,
      resolution: {
        totalVotes: 5,
        completedVotes: 4,
        notCompletedVotes: 1,
        outcome: VoteChoice.COMPLETED,
        winnerRole: "SUBMISSION_AGENT",
        winnerAddress: ADDRESS_B
      },
      createdAt: "2026-03-31T00:00:00.000Z",
      updatedAt: "2026-03-31T00:00:00.000Z"
    };

    const detailHtml = render(
      <DisputeDetailContent
        locale="en"
        timeZone="UTC"
        dispute={dispute}
        task={null}
        activities={[]}
      />
    );

    expect(detailHtml).toContain("Resolution Summary");
    expect(detailHtml).toContain("Submission Agent Wins");
    expect(detailHtml).toContain("Total Votes: 5");
    expect(detailHtml).toContain("Completed: 4");
    expect(detailHtml).toContain("Not Completed: 1");
  });
});
