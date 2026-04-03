import Link from "next/link";
import type { CycleRewardsResponse, Dispute } from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import { formatDateTime, shortAddress } from "../../lib/dashboard-format";

interface CycleDetailContentProps {
  locale: SupportedLocale;
  timeZone: string;
  rewards: CycleRewardsResponse;
  disputes: Dispute[];
  onOpenAgentDetail?: (address: string) => void;
  getAgentHref?: (address: string) => string;
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
  getAgentHref
}: CycleDetailContentProps) => {
  const { cycle, rewardPool, distributions, workloads } = rewards;

  return (
    <div className="detail-block">
      <h3>{cycle.id}</h3>
      <span className="state-chip">{cycle.status}</span>

      <div className="detail-grid">
        <div className="detail-card">
          <h4>{locale === "zh" ? "周期概览" : "Cycle Overview"}</h4>
          <div className="metric-line"><span>{locale === "zh" ? "状态" : "Status"}</span><strong>{cycle.status}</strong></div>
          <div className="metric-line"><span>{locale === "zh" ? "开始时间" : "Started At"}</span><strong>{formatDateTime(cycle.startedAt, locale, timeZone)}</strong></div>
          <div className="metric-line"><span>{locale === "zh" ? "关闭时间" : "Closed At"}</span><strong>{cycle.closedAt ? formatDateTime(cycle.closedAt, locale, timeZone) : "-"}</strong></div>
          <div className="metric-line"><span>{locale === "zh" ? "Mint" : "Mint"}</span><strong>{cycle.mintedAmount} AGC</strong></div>
          <div className="metric-line"><span>{locale === "zh" ? "税池" : "Tax Pool"}</span><strong>{cycle.taxPool} AGC</strong></div>
          <div className="metric-line"><span>{locale === "zh" ? "罚没池" : "Penalty Pool"}</span><strong>{cycle.penaltyPool} AGC</strong></div>
          <div className="metric-line"><span>{locale === "zh" ? "奖励池" : "Reward Pool"}</span><strong>{rewardPool} AGC</strong></div>
        </div>

        <div className="detail-card">
          <h4>{locale === "zh" ? "奖励分配" : "Distributions"}</h4>
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
            <p className="empty-line">{locale === "zh" ? "当前周期还没有可分配奖励。" : "No rewards are allocatable for this cycle yet."}</p>
          )}
        </div>
      </div>

      <h4>{locale === "zh" ? "争议摘要" : "Dispute Summary"}</h4>
      {disputes.length > 0 ? (
        <ul className="detail-list">
          {disputes.map((item) => (
            <li key={item.id} className="detail-card">
              <div className="section-head compact-head">
                <strong>{item.id}</strong>
                <span className="state-chip">{item.status}</span>
              </div>
              <p className="muted">
                {locale === "zh" ? "发起人" : "Opener"}: {renderAddress(item.opener, onOpenAgentDetail, getAgentHref)}
              </p>
              <p>{item.reasonMd}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-line">{locale === "zh" ? "当前周期没有争议记录。" : "No disputes are associated with this cycle."}</p>
      )}

      <h4>{locale === "zh" ? "原始 workload" : "Raw Workloads"}</h4>
      {workloads.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{locale === "zh" ? "Agent" : "Agent"}</th>
                <th>{locale === "zh" ? "争议" : "Dispute"}</th>
                <th>{locale === "zh" ? "工作量" : "Workload"}</th>
                <th>{locale === "zh" ? "创建时间" : "Created At"}</th>
                <th>{locale === "zh" ? "结算时间" : "Settled At"}</th>
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
        <p className="empty-line">{locale === "zh" ? "当前周期没有 workload。" : "No workloads are recorded for this cycle."}</p>
      )}
    </div>
  );
};
