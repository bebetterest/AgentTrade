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
  taskSubmissionAttachmentMaxCount: 10,
  taskSubmissionAttachmentNameMaxLength: 200,
  taskSubmissionAttachmentUrlMaxLength: 2000,
  taskSubmissionAttachmentMaxSizeBytes: 104857600,
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
  scoreWeightReputationBps: 4500,
  scoreWeightCompletionBps: 3500,
  scoreWeightQualityBps: 2000,
  bridgeChain: "base-sepolia",
  bridgeMode: "OFFCHAIN_EXPORT_ONLY"
};

describe("MethodologyPanels", () => {
  it("renders score and settlement formulas in english", () => {
    const html = renderToStaticMarkup(<MethodologyPanels locale="en" economy={economy} />);

    expect(html).toContain("Reputation &amp; Score Formula");
    expect(html).toContain("Composite Score");
    expect(html).toContain("Publisher Reputation");
    expect(html).toContain("clamp(publisher rep + published×1 + completed-confirmed×1 - terminated×1, 0, 100)");
    expect(html).toContain("clamp(worker rep + completed-confirmed×2 - rejected×1, 0, 100)");
    expect(html).toContain(
      "clamp(supervisor rep + supervision-votes×0.5 + aligned-votes×1 - misaligned-votes×1, 0, 100)"
    );
    expect(html).toContain(
      "round((4500 × reputation average + 3500 × completion rate + 2000 × quality rate) / 10000, 2)"
    );
    expect(html).toContain(
      "(publisher reputation × 2000 + worker reputation × 3000 + supervisor reputation × 5000) / 10000"
    );
    expect(html).toContain("votes &gt;= 3 AND completed vote weight / total weight &gt;= 60%");
    expect(html).toContain("Cycle Reward Pool Composition");
    expect(html).toContain("1000 + taxPool + penaltyPool");
    expect(html).toContain(
      "agent reward = floor(cycle reward pool × agent workload / total workload); remainder goes by largest fractional part, then address lexicographic order"
    );
    expect(html).toContain("max(1, floor(escrow total × 500 / 10000))");
    expect(html).toContain("max(1, floor(remaining escrow × 2000 / 10000))");
  });

  it("renders chinese labels for methodology cards", () => {
    const html = renderToStaticMarkup(<MethodologyPanels locale="zh" economy={economy} />);

    expect(html).toContain("信誉分与综合分公式");
    expect(html).toContain("结算与监督规则");
    expect(html).toContain("发布信誉");
    expect(html).toContain("clamp(发布信誉 + 发布任务×1 + 确认完成×1 - 终止任务×1, 0, 100)");
    expect(html).toContain("clamp(执行信誉 + 确认完成×2 - 被拒提交×1, 0, 100)");
    expect(html).toContain("clamp(监督信誉 + 监督投票×0.5 + 判定一致票×1 - 判定不一致票×1, 0, 100)");
    expect(html).toContain("round((4500 × 信誉均值 + 3500 × 完成率 + 2000 × 质量率) / 10000, 2)");
    expect(html).toContain("票数 &gt;= 3 且 完成票权重 / 总权重 &gt;= 60%");
    expect(html).toContain("周期奖励池构成");
    expect(html).toContain("1000 + taxPool + penaltyPool");
    expect(html).toContain("每个代理奖励 = floor(周期奖励池 × 代理工作量 / 总工作量)，余数按小数部分从高到低、地址字典序补齐");
    expect(html).toContain("max(1, floor(托管总额 × 500 / 10000))");
    expect(html).toContain("max(1, floor(剩余托管 × 2000 / 10000))");
  });

  it("falls back to default numeric formulas when economy params are unavailable", () => {
    const html = renderToStaticMarkup(<MethodologyPanels locale="en" economy={null} />);

    expect(html).toContain(
      "(publisher reputation × 2000 + worker reputation × 3000 + supervisor reputation × 5000) / 10000"
    );
    expect(html).toContain("votes &gt;= 5 AND completed vote weight / total weight &gt;= 60%");
    expect(html).toContain("10000 + taxPool + penaltyPool");
    expect(html).toContain("max(1, floor(escrow total × 500 / 10000))");
    expect(html).toContain("max(1, floor(remaining escrow × 1000 / 10000))");
    expect(html).not.toContain("wPub");
    expect(html).not.toContain("quorum");
    expect(html).not.toContain("taxRate");
    expect(html).not.toContain("penaltyRate");
  });
});
