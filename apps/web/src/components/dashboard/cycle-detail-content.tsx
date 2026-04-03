import Link from "next/link";
import type { CycleRewardsResponse, Dispute } from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import { formatDateTime, shortAddress } from "../../lib/dashboard-format";
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

const renderAddress = (
  address: string,
  onOpenAgentDetail: ((address: string) => void) | undefined,
  getAgentHref: ((address: string) => string) | undefined
) => {
  if (!onOpenAgentDetail) {
    if (getAgentHref) {
      return (
        <Link className="inline-link" href={getAgentHref(address)}>
          {shortAddress(address)}
        </Link>
      );
    }
    return <span>{shortAddress(address)}</span>;
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
  const { cycle, rewardPool, distributions, workloads } = rewards;

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
          <h4>{copy.cycleDetail.distributions}</h4>
          {distributions.length > 0 ? (
            <ul className="detail-list">
              {distributions.map((item) => (
                <li key={item.agent} className="detail-list-row">
                  <span>{renderAddress(item.agent, onOpenAgentDetail, getAgentHref)}</span>
                  <strong>{item.amount} AGC</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-line">{copy.cycleDetail.noDistributions}</p>
          )}
        </div>
      </div>

      <h4>{copy.cycleDetail.disputeSummary}</h4>
      {disputes.length > 0 ? (
        <ul className="detail-list">
          {disputes.map((item) => (
            <li key={item.id} className="detail-card">
              <div className="section-head compact-head">
                <strong>{item.id}</strong>
                <span className={buildStateChipClass(item.status)}>{getDisputeStatusLabel(locale, item.status)}</span>
              </div>
              <p className="muted">
                {copy.cycleDetail.opener}: {renderAddress(item.opener, onOpenAgentDetail, getAgentHref)}
              </p>
              <p>{item.reasonMd}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-line">{copy.cycleDetail.noDisputes}</p>
      )}

      <h4>{copy.cycleDetail.rawWorkloads}</h4>
      {workloads.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{copy.cycleDetail.agent}</th>
                <th>{copy.cycleDetail.dispute}</th>
                <th>{copy.cycleDetail.workload}</th>
                <th>{copy.cycleDetail.createdAt}</th>
                <th>{copy.cycleDetail.settledAt}</th>
              </tr>
            </thead>
            <tbody>
              {workloads.map((item) => (
                <tr key={item.id}>
                  <td>{renderAddress(item.agent, onOpenAgentDetail, getAgentHref)}</td>
                  <td>{item.disputeId}</td>
                  <td>{item.workload}</td>
                  <td>{formatDateTime(item.createdAt, locale, timeZone)}</td>
                  <td>{item.settledAt ? formatDateTime(item.settledAt, locale, timeZone) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty-line">{copy.cycleDetail.noWorkloads}</p>
      )}
    </div>
  );
};
