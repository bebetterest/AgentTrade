"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { CycleRewardsResponse, Dispute } from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import { formatDateTime, shortAddress } from "../../lib/dashboard-format";
import { renderSafeMarkdown } from "../../lib/markdown";
import { getCycleStatusLabel, getDashboardCopy, getDisputeStatusLabel } from "./i18n";
import { buildStateChipClass } from "./shared";

interface CycleDetailContentProps {
  locale: SupportedLocale;
  timeZone: string;
  rewards: CycleRewardsResponse;
  disputes: Dispute[];
  onOpenAgentDetail?: (address: string) => void;
  getAgentHref?: (address: string) => string;
  showHeading?: boolean;
}

const DISTRIBUTION_BATCH_SIZE = 12;
const DISPUTE_BATCH_SIZE = 6;
const WORKLOAD_BATCH_SIZE = 20;

const renderAddress = (
  address: string,
  onOpenAgentDetail: ((address: string) => void) | undefined,
  getAgentHref: ((address: string) => string) | undefined
) => {
  if (!onOpenAgentDetail) {
    return (
      <Link className="inline-link" href={(getAgentHref?.(address) ?? `/agents/${address}`)}>
        {shortAddress(address)}
      </Link>
    );
  }
  return (
    <button type="button" className="link-btn inline-link" onClick={() => onOpenAgentDetail(address)}>
      {shortAddress(address)}
    </button>
  );
};

export const CycleDetailContent = ({
  locale,
  timeZone,
  rewards,
  disputes,
  onOpenAgentDetail,
  getAgentHref,
  showHeading = true
}: CycleDetailContentProps) => {
  const copy = getDashboardCopy(locale);
  const loadMoreLabel = locale === "zh" ? "继续加载" : "Load more";
  const { cycle, rewardPool, distributions, workloads } = rewards;
  const [visibleDistributions, setVisibleDistributions] = useState(DISTRIBUTION_BATCH_SIZE);
  const [visibleDisputes, setVisibleDisputes] = useState(DISPUTE_BATCH_SIZE);
  const [visibleWorkloads, setVisibleWorkloads] = useState(WORKLOAD_BATCH_SIZE);

  useEffect(() => {
    setVisibleDistributions(DISTRIBUTION_BATCH_SIZE);
    setVisibleDisputes(DISPUTE_BATCH_SIZE);
    setVisibleWorkloads(WORKLOAD_BATCH_SIZE);
  }, [cycle.id, distributions.length, disputes.length, workloads.length]);

  const visibleDistributionItems = distributions.slice(0, visibleDistributions);
  const visibleDisputeItems = disputes.slice(0, visibleDisputes);
  const visibleWorkloadItems = workloads.slice(0, visibleWorkloads);
  const hasMoreDistributions = visibleDistributionItems.length < distributions.length;
  const hasMoreDisputes = visibleDisputeItems.length < disputes.length;
  const hasMoreWorkloads = visibleWorkloadItems.length < workloads.length;
  const quickSummaryTitle = locale === "zh" ? "结算摘要" : "Settlement Summary";
  const distributionCountLabel = locale === "zh" ? "分配项" : "Distribution Rows";

  return (
    <div className="detail-block">
      {showHeading ? (
        <>
          <h3>{cycle.id}</h3>
          <span className={buildStateChipClass(cycle.status)}>{getCycleStatusLabel(locale, cycle.status)}</span>
        </>
      ) : null}

      <div className="detail-grid">
        <div className="detail-card">
          <h4>{copy.cycleDetail.cycleOverview}</h4>
          <div className="metric-line"><span>{copy.cycleDetail.status}</span><strong>{getCycleStatusLabel(locale, cycle.status)}</strong></div>
          <div className="metric-line"><span>{copy.cycleDetail.startedAt}</span><strong>{formatDateTime(cycle.startedAt, locale, timeZone)}</strong></div>
          <div className="metric-line"><span>{copy.cycleDetail.closedAt}</span><strong>{cycle.closedAt ? formatDateTime(cycle.closedAt, locale, timeZone) : "-"}</strong></div>
          <div className="metric-line"><span>{copy.cycleDetail.mint}</span><strong>{cycle.mintedAmount} AGC</strong></div>
          <div className="metric-line"><span>{copy.cycleDetail.taxPool}</span><strong>{cycle.taxPool} AGC</strong></div>
          <div className="metric-line"><span>{copy.cycleDetail.penaltyPool}</span><strong>{cycle.penaltyPool} AGC</strong></div>
          <div className="metric-line"><span>{copy.cycleDetail.rewardPool}</span><strong>{rewardPool} AGC</strong></div>
        </div>

        <div className="detail-card">
          <h4>{quickSummaryTitle}</h4>
          <div className="metric-line"><span>{copy.cycleDetail.rewardPool}</span><strong>{rewardPool} AGC</strong></div>
          <div className="metric-line"><span>{distributionCountLabel}</span><strong>{distributions.length}</strong></div>
          <div className="metric-line"><span>{copy.cycleDetail.disputeSummary}</span><strong>{disputes.length}</strong></div>
          <div className="metric-line"><span>{copy.cycleDetail.rawWorkloads}</span><strong>{workloads.length}</strong></div>
        </div>
      </div>

      <div className="detail-grid">
        <div className="detail-card">
          <h4>{copy.cycleDetail.distributions}</h4>
          {distributions.length > 0 ? (
            <>
              <ul className="detail-list">
                {visibleDistributionItems.map((item) => (
                  <li key={item.agent} className="detail-list-row">
                    <span>{renderAddress(item.agent, onOpenAgentDetail, getAgentHref)}</span>
                    <strong>{item.amount} AGC</strong>
                  </li>
                ))}
              </ul>
              {hasMoreDistributions ? (
                <button
                  type="button"
                  className="action-btn more-btn"
                  onClick={() => setVisibleDistributions((count) => Math.min(count + DISTRIBUTION_BATCH_SIZE, distributions.length))}
                >
                  {loadMoreLabel}
                </button>
              ) : null}
            </>
          ) : (
            <p className="empty-line">{copy.cycleDetail.noDistributions}</p>
          )}
        </div>

        <div className="detail-card">
          <h4>{copy.cycleDetail.disputeSummary}</h4>
          {disputes.length > 0 ? (
            <>
              <ul className="detail-list">
                {visibleDisputeItems.map((item) => (
                  <li key={item.id} className="detail-card">
                    <div className="section-head compact-head">
                      <strong>{item.id}</strong>
                      <span className={buildStateChipClass(item.status)}>{getDisputeStatusLabel(locale, item.status)}</span>
                    </div>
                    <p className="muted">
                      {copy.cycleDetail.opener}: {renderAddress(item.opener, onOpenAgentDetail, getAgentHref)}
                    </p>
                    <div className="markdown markdown--compact">{renderSafeMarkdown(item.reasonMd)}</div>
                  </li>
                ))}
              </ul>
              {hasMoreDisputes ? (
                <button
                  type="button"
                  className="action-btn more-btn"
                  onClick={() => setVisibleDisputes((count) => Math.min(count + DISPUTE_BATCH_SIZE, disputes.length))}
                >
                  {loadMoreLabel}
                </button>
              ) : null}
            </>
          ) : (
            <p className="empty-line">{copy.cycleDetail.noDisputes}</p>
          )}
        </div>
      </div>

      <h4>{copy.cycleDetail.rawWorkloads}</h4>
      {workloads.length > 0 ? (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{copy.cycleDetail.agent}</th>
                  <th>{copy.cycleDetail.dispute}</th>
                  <th className="table-col--number">{copy.cycleDetail.workload}</th>
                  <th className="table-col--time">{copy.cycleDetail.createdAt}</th>
                  <th className="table-col--time">{copy.cycleDetail.settledAt}</th>
                </tr>
              </thead>
              <tbody>
                {visibleWorkloadItems.map((item) => (
                  <tr key={item.id}>
                    <td>{renderAddress(item.agent, onOpenAgentDetail, getAgentHref)}</td>
                    <td>{item.disputeId ?? "-"}</td>
                    <td className="table-col--number">{item.workload}</td>
                    <td className="table-col--time">{formatDateTime(item.createdAt, locale, timeZone)}</td>
                    <td className="table-col--time">{item.settledAt ? formatDateTime(item.settledAt, locale, timeZone) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasMoreWorkloads ? (
            <button
              type="button"
              className="action-btn more-btn"
              onClick={() => setVisibleWorkloads((count) => Math.min(count + WORKLOAD_BATCH_SIZE, workloads.length))}
            >
              {loadMoreLabel}
            </button>
          ) : null}
        </>
      ) : (
        <p className="empty-line">{copy.cycleDetail.noWorkloads}</p>
      )}
    </div>
  );
};
