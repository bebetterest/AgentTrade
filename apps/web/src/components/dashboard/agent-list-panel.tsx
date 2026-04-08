import type { AgentDirectoryItem } from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import { formatDateTime, shortAddress } from "../../lib/dashboard-format";
import type { LoadErrorKind } from "../../lib/load-error";
import { withRateLimitMessage } from "../../lib/load-error";
import { getAgentStateLabel, getDashboardCopy } from "./i18n";
import { buildStateChipClass } from "./shared";
import { ListPanelShell } from "./list-panel-shell";

interface AgentListPanelProps {
  locale: SupportedLocale;
  timeZone: string;
  agents: AgentDirectoryItem[];
  hasAgentFilters: boolean;
  loadingAgents: boolean;
  loadingMoreAgents: boolean;
  agentLoadError: boolean;
  agentLoadErrorKind: LoadErrorKind | null;
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
  agentLoadErrorKind,
  nextCursor,
  agentSentinelRef,
  onOpenAgentDetail,
  onRefresh,
  onLoadMore
}: AgentListPanelProps) => {
  const copy = getDashboardCopy(locale);
  const agentLoadErrorMessage = withRateLimitMessage(locale, copy.agentList.loadError, agentLoadErrorKind);

  return (
    <>
      <ListPanelShell
        loadError={agentLoadError}
        loadErrorMessage={agentLoadErrorMessage}
        errorTestId="agents-error"
        onRefresh={onRefresh}
        retryLabel={copy.common.retry}
        loading={loadingAgents}
        loadingLabel={copy.common.loading}
        itemCount={agents.length}
        emptyTestId="agents-empty"
        emptyLabel={hasAgentFilters ? copy.agentList.emptyFiltered : copy.agentList.empty}
        sentinelRef={agentSentinelRef}
        loadingMore={loadingMoreAgents}
        loadingMoreLabel={copy.common.loadingMore}
        nextCursor={nextCursor}
        loadMoreTestId="load-more-agents"
        loadMoreLabel={copy.agentList.loadMore}
        onLoadMore={onLoadMore}
      >
        <div className="masonry-grid">
          {agents.map((agent) => (
            <article key={agent.address} className="masonry-card" data-testid="agent-card">
              <div className="card-kicker">
                <span className={buildStateChipClass(agent.isActive ? "ACTIVE" : "IDLE")}>
                  {getAgentStateLabel(locale, agent.isActive ? "ACTIVE" : "IDLE")}
                </span>
                <span className="muted card-id">{shortAddress(agent.address)}</span>
              </div>
              <h3>{agent.name || shortAddress(agent.address)}</h3>
              <p className="card-primary-number">{agent.score}</p>
              <div className="card-meta">
                <p><strong>{copy.agentList.score}</strong></p>
                <p><strong>{locale === "zh" ? "地址" : "Address"}:</strong> {shortAddress(agent.address)}</p>
                <p><strong>{copy.agentList.summary}:</strong> {agent.stats.tasksPublished}/{agent.stats.tasksIntented}/{agent.stats.tasksCompleted}</p>
                <p><strong>{locale === "zh" ? "信誉合计" : "Total reputation"}:</strong> {(agent.reputation.publisher + agent.reputation.worker + agent.reputation.supervisor).toFixed(2)}</p>
                <p><strong>{copy.agentList.latest}:</strong> {agent.latestActivityAt ? formatDateTime(agent.latestActivityAt, locale, timeZone) : "-"}</p>
              </div>
              <div className="card-actions">
                <button type="button" className="link-btn" data-testid="agent-detail-trigger" onClick={() => onOpenAgentDetail(agent.address)}>
                  {copy.common.details}
                </button>
              </div>
            </article>
          ))}
        </div>
      </ListPanelShell>
    </>
  );
};
