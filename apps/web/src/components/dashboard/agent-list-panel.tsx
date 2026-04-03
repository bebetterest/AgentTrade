import Link from "next/link";
import type { AgentDirectoryItem } from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import { formatDateTime, shortAddress } from "../../lib/dashboard-format";
import { getAgentStateLabel, getDashboardCopy } from "./i18n";
import { buildStateChipClass } from "./shared";

interface AgentListPanelProps {
  locale: SupportedLocale;
  timeZone: string;
  agents: AgentDirectoryItem[];
  hasAgentFilters: boolean;
  loadingAgents: boolean;
  loadingMoreAgents: boolean;
  agentLoadError: boolean;
  nextCursor: string | null;
  agentSentinelRef: React.RefObject<HTMLDivElement | null>;
  onOpenAgentDetail: (address: string) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
}

export const AgentListPanel = ({
  locale,
  timeZone,
  agents,
  hasAgentFilters,
  loadingAgents,
  loadingMoreAgents,
  agentLoadError,
  nextCursor,
  agentSentinelRef,
  onOpenAgentDetail,
  onRefresh,
  onLoadMore
}: AgentListPanelProps) => {
  const copy = getDashboardCopy(locale);

  return (
    <>
      {agentLoadError ? (
        <div className="inline-error" data-testid="agents-error">
          <p className="empty-line">
            {copy.agentList.loadError}
          </p>
          <button type="button" className="link-btn" onClick={onRefresh}>
            {copy.common.retry}
          </button>
        </div>
      ) : null}
      {loadingAgents ? <p className="empty-line">{copy.common.loading}</p> : null}
      <div className="masonry-grid">
        {agents.map((agent) => (
          <article key={agent.address} className="masonry-card" data-testid="agent-card">
            <div className="card-kicker">
              <span className={buildStateChipClass(agent.isActive ? "ACTIVE" : "IDLE")}>
                {getAgentStateLabel(locale, agent.isActive ? "ACTIVE" : "IDLE")}
              </span>
              <span className="muted">{shortAddress(agent.address)}</span>
            </div>
            <h3>{agent.name || shortAddress(agent.address)}</h3>
            <p className="card-primary-number">{agent.score}</p>
            <div className="card-meta">
              <p>{copy.agentList.score}</p>
              <p>{copy.agentList.summary}: {agent.stats.tasksPublished}/{agent.stats.tasksAccepted}/{agent.stats.tasksCompleted}</p>
              <p>{copy.agentList.latest}: {agent.latestActivityAt ? formatDateTime(agent.latestActivityAt, locale, timeZone) : "-"}</p>
            </div>
            <div className="card-actions">
              <button type="button" className="link-btn" data-testid="agent-detail-trigger" onClick={() => onOpenAgentDetail(agent.address)}>
                {copy.common.details}
              </button>
              <Link href={`/agents/${agent.address}`}>{copy.common.fullPage}</Link>
            </div>
          </article>
        ))}
      </div>
      {agents.length === 0 && !loadingAgents ? (
        <p className="empty-line" data-testid="agents-empty">
          {hasAgentFilters ? copy.agentList.emptyFiltered : copy.agentList.empty}
        </p>
      ) : null}
      <div ref={agentSentinelRef} className="sentinel" />
      {loadingMoreAgents ? <p className="empty-line">{copy.common.loadingMore}</p> : null}
      {nextCursor && !loadingMoreAgents ? (
        <button type="button" className="action-btn more-btn" data-testid="load-more-agents" onClick={onLoadMore}>
          {copy.agentList.loadMore}
        </button>
      ) : null}
    </>
  );
};
