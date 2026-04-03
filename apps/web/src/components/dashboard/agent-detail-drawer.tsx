import type { ActivityEvent, AgentProfile, LedgerBalance } from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import { formatDateTime, shortAddress } from "../../lib/dashboard-format";
import { renderSafeMarkdown } from "../../lib/markdown";
import { getDashboardCopy } from "./i18n";

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
  const copy = getDashboardCopy(locale);

  if (agentDetail.loading) {
    return <p className="empty-line">{copy.common.loading}</p>;
  }

  if (agentDetail.error) {
    return (
      <div className="inline-error" data-testid="agent-detail-error">
        <p className="empty-line">
          {copy.agentDetail.loadError}
        </p>
        <button type="button" className="link-btn" data-testid="retry-agent-detail" onClick={onRetry}>
          {copy.common.retry}
        </button>
      </div>
    );
  }

  if (!agentDetail.profile) {
    return <p className="empty-line">{copy.agentDetail.notFound}</p>;
  }

  return (
    <div className="detail-block">
      <h3>{agentDetail.profile.name || shortAddress(agentDetail.profile.address)}</h3>
      <p className="muted">{agentDetail.profile.address}</p>
      <div className="detail-grid">
        <div className="detail-card">
          <h4>{copy.agentDetail.balanceAndReputation}</h4>
          <div className="metric-line"><span>{copy.agentDetail.balance}</span><strong>{agentDetail.ledger?.available ?? 0} AGC</strong></div>
          <div className="metric-line"><span>{copy.agentDetail.publisherRep}</span><strong>{agentDetail.profile.reputation.publisher}</strong></div>
          <div className="metric-line"><span>{copy.agentDetail.workerRep}</span><strong>{agentDetail.profile.reputation.worker}</strong></div>
          <div className="metric-line"><span>{copy.agentDetail.supervisorRep}</span><strong>{agentDetail.profile.reputation.supervisor}</strong></div>
        </div>
        <div className="detail-card">
          <h4>{copy.agentDetail.stats}</h4>
          <ul className="detail-list compact-list">
            <li>{copy.agentDetail.published}: {agentDetail.profile.stats.tasksPublished}</li>
            <li>{copy.agentDetail.accepted}: {agentDetail.profile.stats.tasksAccepted}</li>
            <li>{copy.agentDetail.completed}: {agentDetail.profile.stats.tasksCompleted}</li>
            <li>{copy.agentDetail.terminated}: {agentDetail.profile.stats.tasksTerminated}</li>
            <li>{copy.agentDetail.rejected}: {agentDetail.profile.stats.submissionsRejected}</li>
            <li>{copy.agentDetail.votes}: {agentDetail.profile.stats.supervisionVotes}</li>
          </ul>
        </div>
      </div>
      <div className="markdown">{renderSafeMarkdown(agentDetail.profile.bio || "-")}</div>
      <h4>{copy.agentDetail.activityTimeline}</h4>
      {agentDetail.activities.length > 0 ? (
        <ul className="detail-list">
          {agentDetail.activities.map((item) => (
            <li key={item.id} className="detail-list-row">
              <span>{copy.events[item.type]}</span>
              <strong>{formatDateTime(item.createdAt, locale, timeZone)}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-line">{copy.common.noActivityYet}</p>
      )}
    </div>
  );
};
