import { describe, expect, it } from "vitest";
import { AgentStatus, CycleStatus, DisputeStatus, TaskStatus, type AgentDirectoryItem, type Dispute, type Task } from "@agentrade/types";
import { filterAgentsBySearchFallback, filterDisputesBySearchFallback, filterTasksBySearchFallback } from "./dashboard-search";

const BASE_TASK: Task = {
  id: "task-1",
  publisher: "0x1111111111111111111111111111111111111111",
  title: "Audit bot output",
  descriptionMd: "Review long-form report quality and consistency.",
  acceptanceCriteria: "Evidence-backed findings",
  status: TaskStatus.OPEN,
  deadlineUtc: "2026-04-20T00:00:00.000Z",
  displayTimezone: "UTC",
  slotsTotal: 2,
  rewardPerSlot: 100,
  allowRepeatCompletionsBySameAgent: false,
  taxAmount: 5,
  rewardEscrowRemaining: 200,
  intentCount: 0,
  competitionRatio: 0,
  completedAgents: [],
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z"
};

const BASE_AGENT: AgentDirectoryItem = {
  address: "0x2222222222222222222222222222222222222222",
  name: "Agent Delta",
  bio: "Specialized in performance diagnostics and tracing.",
  status: AgentStatus.ACTIVE,
  bannedAt: null,
  banReasonCode: null,
  reputation: { publisher: 1, worker: 2, supervisor: 3 },
  stats: {
    tasksPublished: 1,
    tasksIntented: 2,
    tasksCompleted: 3,
    tasksTerminated: 0,
    submissionsRejected: 0,
    supervisionVotes: 1
  },
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
  latestActivityAt: "2026-04-01T00:00:00.000Z",
  score: 88,
  isActive: true
};

const BASE_DISPUTE: Dispute = {
  id: "dispute-1",
  taskId: "task-1",
  submissionId: "submission-1",
  opener: "0x3333333333333333333333333333333333333333",
  reasonMd: "Result omitted critical latency regression evidence.",
  status: DisputeStatus.OPEN,
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z"
};

describe("dashboard search fallback filters", () => {
  it("matches tasks by description and acceptance criteria", () => {
    expect(filterTasksBySearchFallback([BASE_TASK], "consistency")).toHaveLength(1);
    expect(filterTasksBySearchFallback([BASE_TASK], "evidence-backed")).toHaveLength(1);
    expect(filterTasksBySearchFallback([BASE_TASK], "non-existent")).toHaveLength(0);
  });

  it("matches agents by bio", () => {
    expect(filterAgentsBySearchFallback([BASE_AGENT], "diagnostics")).toHaveLength(1);
    expect(filterAgentsBySearchFallback([BASE_AGENT], "unknown")).toHaveLength(0);
  });

  it("matches disputes by reason markdown", () => {
    expect(filterDisputesBySearchFallback([BASE_DISPUTE], "latency regression")).toHaveLength(1);
    expect(filterDisputesBySearchFallback([BASE_DISPUTE], "something else")).toHaveLength(0);
  });
});
