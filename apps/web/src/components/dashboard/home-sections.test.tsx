import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CycleStatus, type Cycle, type DashboardSummaryResponse, type HealthStatus, type PublicEconomyParams } from "@agentrade/types";
import { MetricsPanels } from "./metrics-panels";

describe("home sections", () => {
  it("renders metrics panels grouped by boundary, health, and runtime", () => {
    const summary: DashboardSummaryResponse = {
      timezone: "UTC",
      generatedAt: "2026-03-31T12:00:00.000Z",
      activeCycleId: "cycle-9",
      today: { tasksPublished: 2, tasksIntented: 3, tasksCompleted: 1, disputesOpened: 1 },
      currentCycle: { tasksPublished: 7, tasksIntented: 5, tasksCompleted: 4, disputesOpened: 2 },
      totals: { tasks: 10, disputes: 3, agents: 6 }
    };
    const activeCycle: Cycle = {
      id: "cycle-9",
      status: CycleStatus.OPEN,
      mintedAmount: 1000,
      taxPool: 80,
      penaltyPool: 10,
      startedAt: "2026-03-28T00:00:00.000Z",
      closedAt: null
    };
    const health: HealthStatus = { ok: true, service: "agentrade-server" };
    const economy: PublicEconomyParams = {
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
      taskSubmissionAttachmentMaxCount: 10,
      taskSubmissionAttachmentNameMaxLength: 200,
      taskSubmissionAttachmentUrlMaxLength: 2000,
      taskSubmissionAttachmentMaxSizeBytes: 104857600,
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
    };

    const html = renderToStaticMarkup(
      <MetricsPanels
        locale="en"
        timeZone="UTC"
        summary={summary}
        activeCycle={activeCycle}
        cycleUptime="3d 2h"
        health={health}
        economy={economy}
        onOpenCycleDetail={() => undefined}
      />
    );

    expect(html).toContain("System Status");
    expect(html).toContain("Runtime Signals");
    expect(html).toContain("Cycle Runtime");
    expect(html).toContain("Components");
    expect(html).toContain("status-kpi-grid");
    expect(html).toContain("status-mini-grid");
    expect(html).toContain("status-card__actions");
  });

  it("uses summary active cycle id as settlement fallback when active cycle detail is missing", () => {
    const summary: DashboardSummaryResponse = {
      timezone: "UTC",
      generatedAt: "2026-03-31T12:00:00.000Z",
      activeCycleId: "cycle-42",
      today: { tasksPublished: 0, tasksIntented: 0, tasksCompleted: 0, disputesOpened: 0 },
      currentCycle: { tasksPublished: 0, tasksIntented: 0, tasksCompleted: 0, disputesOpened: 0 },
      totals: { tasks: 0, disputes: 0, agents: 0 }
    };
    const health: HealthStatus = { ok: true, service: "agentrade-server" };
    const economy: PublicEconomyParams = {
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
      taskSubmissionAttachmentMaxCount: 10,
      taskSubmissionAttachmentNameMaxLength: 200,
      taskSubmissionAttachmentUrlMaxLength: 2000,
      taskSubmissionAttachmentMaxSizeBytes: 104857600,
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
    };

    const html = renderToStaticMarkup(
      <MetricsPanels
        locale="en"
        timeZone="UTC"
        summary={summary}
        activeCycle={null}
        cycleUptime="-"
        health={health}
        economy={economy}
        onOpenCycleDetail={() => undefined}
      />
    );

    expect(html).toContain("Cycle Settlement");
    expect(html).toContain("cycle-42");
    expect(html).not.toContain("Maintenance");
  });

  it("shows unknown component status when metrics data is unavailable", () => {
    const html = renderToStaticMarkup(
      <MetricsPanels
        locale="en"
        timeZone="UTC"
        summary={null}
        activeCycle={null}
        cycleUptime="-"
        health={null}
        economy={null}
        onOpenCycleDetail={() => undefined}
      />
    );

    expect(html).toContain("System Status");
    expect(html).toContain("Unknown");
    expect(html).not.toContain("In-memory mode");
    expect(html).not.toContain("Maintenance");
  });
});
