import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivityEventType, CycleStatus, DisputeStatus, TaskStatus, type ActivityEvent, type AgentDirectoryItem, type Cycle, type DashboardSummaryResponse, type DashboardTrendsResponse, type Dispute, type Task } from "@agentrade/types";
import { PublicHomeView } from "./public-home-view";

const ADDRESS_A = "0x1111111111111111111111111111111111111111";

const summary: DashboardSummaryResponse = {
  timezone: "UTC",
  generatedAt: "2026-04-03T00:00:00.000Z",
  activeCycleId: "cycle-9",
  today: { tasksPublished: 2, tasksAccepted: 1, tasksCompleted: 1, disputesOpened: 1 },
  currentCycle: { tasksPublished: 6, tasksAccepted: 4, tasksCompleted: 3, disputesOpened: 2 },
  totals: { tasks: 12, disputes: 3, agents: 6 }
};

const trends: DashboardTrendsResponse = {
  timezone: "UTC",
  generatedAt: "2026-04-03T00:00:00.000Z",
  window: "7d",
  points: [
    { bucketStart: "2026-04-01T00:00:00.000Z", label: "04-01", tasksPublished: 1, tasksAccepted: 0, tasksCompleted: 0, disputesOpened: 0 },
    { bucketStart: "2026-04-02T00:00:00.000Z", label: "04-02", tasksPublished: 2, tasksAccepted: 1, tasksCompleted: 1, disputesOpened: 1 }
  ]
};

const activeCycle: Cycle = {
  id: "cycle-9",
  status: CycleStatus.OPEN,
  mintedAmount: 1000,
  taxPool: 80,
  penaltyPool: 10,
  startedAt: "2026-04-01T00:00:00.000Z",
  closedAt: null
};

const leaders: AgentDirectoryItem[] = [
  {
    address: ADDRESS_A,
    name: "Agent Alpha",
    bio: "Focus on QA.",
    reputation: { publisher: 1, worker: 1, supervisor: 1 },
    stats: {
      tasksPublished: 1,
      tasksAccepted: 2,
      tasksCompleted: 2,
      tasksTerminated: 0,
      submissionsRejected: 0,
      supervisionVotes: 0
    },
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-03T00:00:00.000Z",
    latestActivityAt: "2026-04-03T00:00:00.000Z",
    score: 91,
    isActive: true
  }
];

const tasks: Task[] = [
  {
    id: "task-1",
    publisher: ADDRESS_A,
    title: "Alpha Review",
    descriptionMd: "Review alpha output.",
    acceptanceCriteria: "Clear findings.",
    status: TaskStatus.OPEN,
    deadlineUtc: "2026-04-04T00:00:00.000Z",
    displayTimezone: "UTC",
    slotsTotal: 2,
    rewardPerSlot: 25,
    allowRepeatCompletionsBySameAgent: false,
    taxAmount: 3,
    rewardEscrowRemaining: 50,
    acceptedAgents: [],
    completedAgents: [],
    createdAt: "2026-04-02T00:00:00.000Z",
    updatedAt: "2026-04-03T00:00:00.000Z"
  }
];

const disputes: Dispute[] = [
  {
    id: "dispute-1",
    taskId: "task-1",
    submissionId: "submission-1",
    opener: ADDRESS_A,
    reasonMd: "Output quality mismatch.",
    status: DisputeStatus.OPEN,
    createdAt: "2026-04-03T00:00:00.000Z",
    updatedAt: "2026-04-03T00:00:00.000Z"
  }
];

const activities: ActivityEvent[] = [
  {
    id: "activity-1",
    type: ActivityEventType.DISPUTE_OPENED,
    cycleId: "cycle-9",
    taskId: "task-1",
    disputeId: "dispute-1",
    actor: ADDRESS_A,
    createdAt: "2026-04-03T00:00:00.000Z"
  }
];

describe("PublicHomeView", () => {
  it("renders home modules in English", () => {
    const html = renderToStaticMarkup(
      <PublicHomeView
        locale="en"
        timeZone="UTC"
        summary={summary}
        trends={trends}
        activeCycle={activeCycle}
        leaders={leaders}
        activities={{ items: activities, nextCursor: null }}
        tasks={{ items: tasks, nextCursor: null }}
        disputes={{ items: disputes, nextCursor: null }}
        cycles={{ items: [activeCycle], nextCursor: null }}
        economy={{
          appName: "Agentrade",
          enablePersistence: true,
          enableRedisRateLimit: false,
          authChallengeTtlMinutes: 10,
          rateLimitPerMinute: 60,
          rateLimitBurst: 120,
          taskTitleMaxLength: 120,
          taskDescriptionMaxLength: 4000,
          taskAcceptanceCriteriaMaxLength: 2000,
          taskSubmissionPayloadMaxLength: 5000,
          disputeReasonMaxLength: 2000,
          taskSlotsMax: 5,
          taskRewardPerSlotMax: 500,
          taskDeadlineMaxHours: 72,
          taxRateBps: 500,
          taxMin: 1,
          rewardMin: 1,
          mintPerCycle: 1000,
          terminationPenaltyBps: 2000,
          submissionTimeoutHours: 24,
          resubmitCooldownMinutes: 10,
          disputeQuorum: 3,
          disputeApprovalBps: 6000,
          reputationWeightPublisherBps: 3000,
          reputationWeightWorkerBps: 5000,
          reputationWeightSupervisorBps: 2000,
          bridgeChain: "base-sepolia",
          bridgeMode: "OFFCHAIN_EXPORT_ONLY"
        }}
        health={{ ok: true, service: "agentrade-server" }}
      />
    );

    expect(html).toContain("Transparent task, dispute, and settlement signals");
    expect(html).toContain("How It Works");
    expect(html).toContain("Economy &amp; Rules");
    expect(html).toContain("Dispute Opened");
    expect(html).toContain("Open");
    expect(html).toContain("packages/contracts -&gt; /v2");
  });

  it("renders core Chinese copy", () => {
    const html = renderToStaticMarkup(
      <PublicHomeView
        locale="zh"
        timeZone="UTC"
        summary={summary}
        trends={trends}
        activeCycle={activeCycle}
        leaders={leaders}
        activities={{ items: activities, nextCursor: null }}
        tasks={{ items: tasks, nextCursor: null }}
        disputes={{ items: disputes, nextCursor: null }}
        cycles={{ items: [activeCycle], nextCursor: null }}
        economy={null}
        health={null}
      />
    );

    expect(html).toContain("公开信息站");
    expect(html).toContain("运行方式");
    expect(html).toContain("可信度与透明性");
  });
});
