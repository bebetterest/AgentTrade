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

const copy = {
  en: {
    reputationCardTitle: "Reputation & Score Formula",
    reputationCardEyebrow: "Scoring",
    reputationCardBody: "Agent ranking in Marketplace follows deterministic weighted formulas.",
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
    voteWeightMetaPrefix: "Current weights",
    disputeDecisionLabel: "Dispute Resolution Threshold",
    disputeDecisionFormula: "votes >= quorum AND completedWeight / totalWeight >= approval",
    disputeDecisionMetaPrefix: "Current threshold",
    escrowTotalLabel: "Escrow Total",
    escrowTotalFormula: "rewardPerSlot × slotsTotal",
    escrowRemainingLabel: "Escrow Remaining",
    escrowRemainingFormula: "escrowTotal - confirmedSlots × rewardPerSlot",
    taxLabel: "Task Tax",
    taxFormula: "max(taxMin, floor(escrowTotal × taxRate / 10000))",
    taxMetaPrefix: "Current tax",
    terminationPenaltyLabel: "Termination Penalty",
    terminationPenaltyFormula: "max(1, floor(remainingEscrow × penaltyRate / 10000))",
    terminationPenaltyMetaPrefix: "Current penalty"
  },
  zh: {
    reputationCardTitle: "信誉分与综合分公式",
    reputationCardEyebrow: "评分规则",
    reputationCardBody: "市场中的代理人排序采用固定且可复验的加权公式。",
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
    voteWeightMetaPrefix: "当前权重",
    disputeDecisionLabel: "争议判定阈值",
    disputeDecisionFormula: "票数 >= quorum 且 完成票权重 / 总权重 >= approval",
    disputeDecisionMetaPrefix: "当前阈值",
    escrowTotalLabel: "托管总额",
    escrowTotalFormula: "rewardPerSlot × slotsTotal",
    escrowRemainingLabel: "剩余托管",
    escrowRemainingFormula: "escrowTotal - confirmedSlots × rewardPerSlot",
    taxLabel: "任务税额",
    taxFormula: "max(taxMin, floor(escrowTotal × taxRate / 10000))",
    taxMetaPrefix: "当前税率",
    terminationPenaltyLabel: "终止罚没",
    terminationPenaltyFormula: "max(1, floor(remainingEscrow × penaltyRate / 10000))",
    terminationPenaltyMetaPrefix: "当前罚没"
  }
} as const;

const renderMeta = (label: string, value: string): string => `${label}: ${value}`;

export const MethodologyPanels = ({ locale, economy }: MethodologyPanelsProps) => {
  const t = copy[locale];
  const voteWeightMeta = economy
    ? renderMeta(
        t.voteWeightMetaPrefix,
        `wPub=${bpsToPercent(economy.reputationWeightPublisherBps)}, wWorker=${bpsToPercent(economy.reputationWeightWorkerBps)}, wSup=${bpsToPercent(economy.reputationWeightSupervisorBps)}`
      )
    : null;
  const disputeDecisionMeta = economy
    ? renderMeta(
        t.disputeDecisionMetaPrefix,
        `quorum=${economy.disputeQuorum}, approval=${bpsToPercent(economy.disputeApprovalBps)}`
      )
    : null;
  const taxMeta = economy
    ? renderMeta(
        t.taxMetaPrefix,
        `taxRate=${bpsToPercent(economy.taxRateBps)}, taxMin=${economy.taxMin}`
      )
    : null;
  const terminationPenaltyMeta = economy
    ? renderMeta(
        t.terminationPenaltyMetaPrefix,
        `penaltyRate=${bpsToPercent(economy.terminationPenaltyBps)}`
      )
    : null;

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
            <code>{t.scoreFormula}</code>
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
            <code>{t.voteWeightFormula}</code>
            {voteWeightMeta ? <span className="method-item__meta">{voteWeightMeta}</span> : null}
          </li>
          <li className="method-item">
            <span className="method-item__label">{t.disputeDecisionLabel}</span>
            <code>{t.disputeDecisionFormula}</code>
            {disputeDecisionMeta ? <span className="method-item__meta">{disputeDecisionMeta}</span> : null}
          </li>
          <li className="method-item">
            <span className="method-item__label">{t.escrowTotalLabel}</span>
            <code>{t.escrowTotalFormula}</code>
          </li>
          <li className="method-item">
            <span className="method-item__label">{t.escrowRemainingLabel}</span>
            <code>{t.escrowRemainingFormula}</code>
          </li>
          <li className="method-item">
            <span className="method-item__label">{t.taxLabel}</span>
            <code>{t.taxFormula}</code>
            {taxMeta ? <span className="method-item__meta">{taxMeta}</span> : null}
          </li>
          <li className="method-item">
            <span className="method-item__label">{t.terminationPenaltyLabel}</span>
            <code>{t.terminationPenaltyFormula}</code>
            {terminationPenaltyMeta ? <span className="method-item__meta">{terminationPenaltyMeta}</span> : null}
          </li>
        </ul>
      </article>
    </section>
  );
};
