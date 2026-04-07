import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PublicEconomyParams } from "@agentrade/types";
import { MethodologyPanels } from "./methodology-panels";

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
  disputeReasonMaxLength: 2000,
  taskSlotsMax: 100,
  taskRewardPerSlotMax: 1000000,
  taskDeadlineMaxHours: 4320,
  taxRateBps: 500,
  taxMin: 1,
  rewardMin: 1,
  mintPerCycle: 1000,
  terminationPenaltyBps: 2000,
  submissionTimeoutHours: 24,
  resubmitCooldownMinutes: 30,
  disputeQuorum: 3,
  disputeApprovalBps: 6000,
  reputationWeightPublisherBps: 2000,
  reputationWeightWorkerBps: 3000,
  reputationWeightSupervisorBps: 5000,
  bridgeChain: "base-sepolia",
  bridgeMode: "OFFCHAIN_EXPORT_ONLY"
};

describe("MethodologyPanels", () => {
  it("renders score and settlement formulas in english", () => {
    const html = renderToStaticMarkup(<MethodologyPanels locale="en" economy={economy} />);

    expect(html).toContain("Reputation &amp; Score Formula");
    expect(html).toContain("Composite Score");
    expect(html).toContain("round(0.45 × reputationAvg + 0.35 × completionRate + 0.20 × qualityRate, 2)");
    expect(html).toContain("quorum=3, approval=60%");
    expect(html).toContain("taxRate=5%, taxMin=1");
    expect(html).toContain("penaltyRate=20%");
  });

  it("renders chinese labels for methodology cards", () => {
    const html = renderToStaticMarkup(<MethodologyPanels locale="zh" economy={economy} />);

    expect(html).toContain("信誉分与综合分公式");
    expect(html).toContain("结算与监督规则");
    expect(html).toContain("当前阈值: quorum=3, approval=60%");
  });
});
