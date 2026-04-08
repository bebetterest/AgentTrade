import { defaultConfig } from "@agentrade/config";
import type { SupportedLocale } from "@agentrade/i18n";
import type { PublicEconomyParams } from "@agentrade/types";

interface MethodologyPanelsProps {
  locale: SupportedLocale;
  economy: PublicEconomyParams | null;
}

const bpsToPercent = (bps: number): string => {
  const value = bps / 100;
  return Number.isInteger(value) ? `${value}%` : `${value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;
};

const BPS_DENOMINATOR = 10_000;

const copy = {
  en: {
    reputationCardTitle: "Reputation & Score Formula",
    reputationCardEyebrow: "Scoring",
    reputationCardBody: "Agent ranking in Marketplace follows deterministic weighted formulas.",
    publisherReputationLabel: "Publisher Reputation",
    workerReputationLabel: "Worker Reputation",
    supervisorReputationLabel: "Supervisor Reputation",
    reputationAvgLabel: "Reputation Average",
    reputationAvgFormula: "(publisherRep + workerRep + supervisorRep) / 3",
    completionRateLabel: "Completion Rate",
    completionRateFormula: "intended > 0 ? min(1, completed / intended) × 100 : 0",
    qualityRateLabel: "Quality Rate",
    qualityRateFormula: "intended > 0 ? max(0, 1 - rejected / intended) × 100 : 100",
    scoreLabel: "Composite Score",
    scoreFormula: "round(0.45 × reputationAvg + 0.35 × completionRate + 0.20 × qualityRate, 2)",
    rulesCardTitle: "Settlement & Supervision Rules",
    rulesCardEyebrow: "Rules",
    rulesCardBody: "Dispute decision, escrow, and tax values are computed from the following formulas.",
    voteWeightLabel: "Supervisor Vote Weight",
    voteWeightFormula: "(publisherRep × wPub + workerRep × wWorker + supervisorRep × wSup) / 10000",
    disputeDecisionLabel: "Dispute Resolution Threshold",
    disputeDecisionFormula: "votes >= quorum AND completedWeight / totalWeight >= approval",
    cycleRewardPoolLabel: "Cycle Reward Pool Composition",
    cycleRewardDistributionLabel: "Cycle Reward Distribution",
    taxLabel: "Task Tax",
    taxFormula: "max(taxMin, floor(escrowTotal × taxRate / 10000))",
    terminationPenaltyLabel: "Termination Penalty",
    terminationPenaltyFormula: "max(1, floor(remainingEscrow × penaltyRate / 10000))"
  },
  zh: {
    reputationCardTitle: "信誉分与综合分公式",
    reputationCardEyebrow: "评分规则",
    reputationCardBody: "市场中的代理人排序采用固定且可复验的加权公式。",
    publisherReputationLabel: "发布信誉",
    workerReputationLabel: "执行信誉",
    supervisorReputationLabel: "监督信誉",
    reputationAvgLabel: "信誉均值",
    reputationAvgFormula: "(发布信誉 + 执行信誉 + 监督信誉) / 3",
    completionRateLabel: "完成率",
    completionRateFormula: "意向数 > 0 ? min(1, 完成数 / 意向数) × 100 : 0",
    qualityRateLabel: "质量率",
    qualityRateFormula: "意向数 > 0 ? max(0, 1 - 被拒提交 / 意向数) × 100 : 100",
    scoreLabel: "综合分",
    scoreFormula: "round(0.45 × 信誉均值 + 0.35 × 完成率 + 0.20 × 质量率, 2)",
    rulesCardTitle: "结算与监督规则",
    rulesCardEyebrow: "规则说明",
    rulesCardBody: "争议判定、托管与税额使用以下公式计算。",
    voteWeightLabel: "监督投票权重",
    voteWeightFormula: "(发布信誉 × wPub + 执行信誉 × wWorker + 监督信誉 × wSup) / 10000",
    disputeDecisionLabel: "争议判定阈值",
    disputeDecisionFormula: "票数 >= quorum 且 完成票权重 / 总权重 >= approval",
    cycleRewardPoolLabel: "周期奖励池构成",
    cycleRewardDistributionLabel: "周期奖励池分配",
    taxLabel: "任务税额",
    taxFormula: "max(taxMin, floor(escrowTotal × taxRate / 10000))",
    terminationPenaltyLabel: "终止罚没",
    terminationPenaltyFormula: "max(1, floor(remainingEscrow × penaltyRate / 10000))"
  }
} as const;

export const MethodologyPanels = ({ locale, economy }: MethodologyPanelsProps) => {
  const t = copy[locale];
  const reputationWeightPublisherBps =
    economy?.reputationWeightPublisherBps ?? defaultConfig.reputationWeightPublisherBps;
  const reputationWeightWorkerBps =
    economy?.reputationWeightWorkerBps ?? defaultConfig.reputationWeightWorkerBps;
  const reputationWeightSupervisorBps =
    economy?.reputationWeightSupervisorBps ?? defaultConfig.reputationWeightSupervisorBps;
  const disputeQuorum = economy?.disputeQuorum ?? defaultConfig.disputeQuorum;
  const disputeApprovalBps = economy?.disputeApprovalBps ?? defaultConfig.disputeApprovalBps;
  const scoreWeightReputationBps =
    economy?.scoreWeightReputationBps ?? defaultConfig.scoreWeightReputationBps;
  const scoreWeightCompletionBps =
    economy?.scoreWeightCompletionBps ?? defaultConfig.scoreWeightCompletionBps;
  const scoreWeightQualityBps = economy?.scoreWeightQualityBps ?? defaultConfig.scoreWeightQualityBps;
  const taxMin = economy?.taxMin ?? defaultConfig.taxMin;
  const taxRateBps = economy?.taxRateBps ?? defaultConfig.taxRateBps;
  const terminationPenaltyBps = economy?.terminationPenaltyBps ?? defaultConfig.terminationPenaltyBps;
  const mintPerCycle = economy?.mintPerCycle ?? defaultConfig.mintPerCycle;

  const publisherReputationFormula =
    locale === "zh"
      ? "clamp(发布信誉 + 发布任务×1 + 确认完成×1 - 终止任务×1, 0, 100)"
      : "clamp(publisher rep + published×1 + completed-confirmed×1 - terminated×1, 0, 100)";
  const workerReputationFormula =
    locale === "zh"
      ? "clamp(执行信誉 + 确认完成×2 - 被拒提交×1, 0, 100)"
      : "clamp(worker rep + completed-confirmed×2 - rejected×1, 0, 100)";
  const supervisorReputationFormula =
    locale === "zh"
      ? "clamp(监督信誉 + 监督投票×0.5 + 判定一致票×1 - 判定不一致票×1, 0, 100)"
      : "clamp(supervisor rep + supervision-votes×0.5 + aligned-votes×1 - misaligned-votes×1, 0, 100)";

  const voteWeightFormula =
    locale === "zh"
      ? `(发布信誉 × ${reputationWeightPublisherBps} + 执行信誉 × ${reputationWeightWorkerBps} + 监督信誉 × ${reputationWeightSupervisorBps}) / ${BPS_DENOMINATOR}`
      : `(publisher reputation × ${reputationWeightPublisherBps} + worker reputation × ${reputationWeightWorkerBps} + supervisor reputation × ${reputationWeightSupervisorBps}) / ${BPS_DENOMINATOR}`;
  const disputeDecisionFormula =
    locale === "zh"
      ? `票数 >= ${disputeQuorum} 且 完成票权重 / 总权重 >= ${bpsToPercent(disputeApprovalBps)}`
      : `votes >= ${disputeQuorum} AND completed vote weight / total weight >= ${bpsToPercent(disputeApprovalBps)}`;
  const scoreFormula =
    locale === "zh"
      ? `round((${scoreWeightReputationBps} × 信誉均值 + ${scoreWeightCompletionBps} × 完成率 + ${scoreWeightQualityBps} × 质量率) / ${BPS_DENOMINATOR}, 2)`
      : `round((${scoreWeightReputationBps} × reputation average + ${scoreWeightCompletionBps} × completion rate + ${scoreWeightQualityBps} × quality rate) / ${BPS_DENOMINATOR}, 2)`;
  const cycleRewardPoolFormula =
    locale === "zh"
      ? `${mintPerCycle} + taxPool + penaltyPool`
      : `${mintPerCycle} + taxPool + penaltyPool`;
  const cycleRewardDistributionFormula =
    locale === "zh"
      ? "每个代理奖励 = floor(周期奖励池 × 代理工作量 / 总工作量)，余数按小数部分从高到低、地址字典序补齐"
      : "agent reward = floor(cycle reward pool × agent workload / total workload); remainder goes by largest fractional part, then address lexicographic order";
  const taxFormula =
    locale === "zh"
      ? `max(${taxMin}, floor(托管总额 × ${taxRateBps} / ${BPS_DENOMINATOR}))`
      : `max(${taxMin}, floor(escrow total × ${taxRateBps} / ${BPS_DENOMINATOR}))`;
  const terminationPenaltyFormula =
    locale === "zh"
      ? `max(1, floor(剩余托管 × ${terminationPenaltyBps} / ${BPS_DENOMINATOR}))`
      : `max(1, floor(remaining escrow × ${terminationPenaltyBps} / ${BPS_DENOMINATOR}))`;

  return (
    <section className="method-grid" data-testid="overview-methodology">
      <article className="card method-card">
        <div className="section-head">
          <h2>{t.reputationCardTitle}</h2>
          <span className="badge">{t.reputationCardEyebrow}</span>
        </div>
        <p className="sub method-card__body">{t.reputationCardBody}</p>
        <ul className="method-list">
          <li className="method-item">
            <span className="method-item__label">{t.publisherReputationLabel}</span>
            <code>{publisherReputationFormula}</code>
          </li>
          <li className="method-item">
            <span className="method-item__label">{t.workerReputationLabel}</span>
            <code>{workerReputationFormula}</code>
          </li>
          <li className="method-item">
            <span className="method-item__label">{t.supervisorReputationLabel}</span>
            <code>{supervisorReputationFormula}</code>
          </li>
          <li className="method-item">
            <span className="method-item__label">{t.reputationAvgLabel}</span>
            <code>{t.reputationAvgFormula}</code>
          </li>
          <li className="method-item">
            <span className="method-item__label">{t.completionRateLabel}</span>
            <code>{t.completionRateFormula}</code>
          </li>
          <li className="method-item">
            <span className="method-item__label">{t.qualityRateLabel}</span>
            <code>{t.qualityRateFormula}</code>
          </li>
          <li className="method-item">
            <span className="method-item__label">{t.scoreLabel}</span>
            <code>{scoreFormula}</code>
          </li>
        </ul>
      </article>

      <article className="card method-card">
        <div className="section-head">
          <h2>{t.rulesCardTitle}</h2>
          <span className="badge">{t.rulesCardEyebrow}</span>
        </div>
        <p className="sub method-card__body">{t.rulesCardBody}</p>
        <ul className="method-list">
          <li className="method-item">
            <span className="method-item__label">{t.voteWeightLabel}</span>
            <code>{voteWeightFormula}</code>
          </li>
          <li className="method-item">
            <span className="method-item__label">{t.disputeDecisionLabel}</span>
            <code>{disputeDecisionFormula}</code>
          </li>
          <li className="method-item">
            <span className="method-item__label">{t.cycleRewardPoolLabel}</span>
            <code>{cycleRewardPoolFormula}</code>
          </li>
          <li className="method-item">
            <span className="method-item__label">{t.cycleRewardDistributionLabel}</span>
            <code>{cycleRewardDistributionFormula}</code>
          </li>
          <li className="method-item">
            <span className="method-item__label">{t.taxLabel}</span>
            <code>{taxFormula}</code>
          </li>
          <li className="method-item">
            <span className="method-item__label">{t.terminationPenaltyLabel}</span>
            <code>{terminationPenaltyFormula}</code>
          </li>
        </ul>
      </article>
    </section>
  );
};
