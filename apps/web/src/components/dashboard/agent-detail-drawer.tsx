import type { ActivityEvent, AgentProfile, LedgerBalance } from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import { formatDateTime, shortAddress } from "../../lib/dashboard-format";
import { renderSafeMarkdown } from "../../lib/markdown";
import { EVENT_LABELS } from "./shared";

interface AgentDetailDrawerProps {
  locale: SupportedLocale;
  timeZone: string;
  agentDetail: {
    loading: boolean;
    error: boolean;
    profile: AgentProfile | null;
    ledger: LedgerBalance | null;
    activities: ActivityEvent[];
  };
  onRetry: () => void;
}

export const AgentDetailDrawer = ({ locale, timeZone, agentDetail, onRetry }: AgentDetailDrawerProps) => {
  if (agentDetail.loading) {
    return <p className="empty-line">{locale === "zh" ? "加载中..." : "Loading..."}</p>;
  }

  if (agentDetail.error) {
    return (
      <div className="inline-error" data-testid="agent-detail-error">
        <p className="empty-line">
          {locale === "zh" ? "Agent 详情加载失败，请重试。" : "Agent details failed to load. Retry."}
        </p>
        <button type="button" className="link-btn" data-testid="retry-agent-detail" onClick={onRetry}>
          {locale === "zh" ? "重试" : "Retry"}
        </button>
      </div>
    );
  }

  if (!agentDetail.profile) {
    return <p className="empty-line">{locale === "zh" ? "Agent 不存在" : "Agent not found"}</p>;
  }

  return (
    <div className="detail-block">
      <h3>{agentDetail.profile.name || shortAddress(agentDetail.profile.address)}</h3>
      <p className="muted">{agentDetail.profile.address}</p>
      <div className="detail-grid">
        <div className="detail-card">
          <h4>{locale === "zh" ? "余额与信誉" : "Balance & Reputation"}</h4>
          <div className="metric-line"><span>{locale === "zh" ? "当前余额" : "Balance"}</span><strong>{agentDetail.ledger?.available ?? 0} AGC</strong></div>
          <div className="metric-line"><span>{locale === "zh" ? "发布信誉" : "Publisher Rep"}</span><strong>{agentDetail.profile.reputation.publisher}</strong></div>
          <div className="metric-line"><span>{locale === "zh" ? "执行信誉" : "Worker Rep"}</span><strong>{agentDetail.profile.reputation.worker}</strong></div>
          <div className="metric-line"><span>{locale === "zh" ? "监督信誉" : "Supervisor Rep"}</span><strong>{agentDetail.profile.reputation.supervisor}</strong></div>
        </div>
        <div className="detail-card">
          <h4>{locale === "zh" ? "统计" : "Stats"}</h4>
          <ul className="detail-list compact-list">
            <li>{locale === "zh" ? "发布" : "Published"}: {agentDetail.profile.stats.tasksPublished}</li>
            <li>{locale === "zh" ? "接单" : "Accepted"}: {agentDetail.profile.stats.tasksAccepted}</li>
            <li>{locale === "zh" ? "完成" : "Completed"}: {agentDetail.profile.stats.tasksCompleted}</li>
            <li>{locale === "zh" ? "终止" : "Terminated"}: {agentDetail.profile.stats.tasksTerminated}</li>
            <li>{locale === "zh" ? "被拒提交" : "Rejected"}: {agentDetail.profile.stats.submissionsRejected}</li>
            <li>{locale === "zh" ? "监督投票" : "Votes"}: {agentDetail.profile.stats.supervisionVotes}</li>
          </ul>
        </div>
      </div>
      <div className="markdown">{renderSafeMarkdown(agentDetail.profile.bio || "-")}</div>
      <h4>{locale === "zh" ? "事件时间线" : "Activity timeline"}</h4>
      {agentDetail.activities.length > 0 ? (
        <ul className="detail-list">
          {agentDetail.activities.map((item) => (
            <li key={item.id} className="detail-list-row">
              <span>{EVENT_LABELS[item.type][locale]}</span>
              <strong>{formatDateTime(item.createdAt, locale, timeZone)}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-line">{locale === "zh" ? "暂无事件" : "No activity yet"}</p>
      )}
    </div>
  );
};
