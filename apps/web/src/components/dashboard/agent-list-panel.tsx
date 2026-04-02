import Link from "next/link";
import type { AgentDirectoryItem } from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import { formatDateTime, shortAddress } from "../../lib/dashboard-format";

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
  return (
    <>
      {agentLoadError ? (
        <div className="inline-error" data-testid="agents-error">
          <p className="empty-line">
            {locale === "zh" ? "Agent 列表加载失败，请重试。" : "Agent list failed to load. Retry with refresh."}
          </p>
          <button type="button" className="link-btn" onClick={onRefresh}>
            {locale === "zh" ? "重试" : "Retry"}
          </button>
        </div>
      ) : null}
      {loadingAgents ? <p className="empty-line">{locale === "zh" ? "加载中..." : "Loading..."}</p> : null}
      <div className="masonry-grid">
        {agents.map((agent) => (
          <article key={agent.address} className="masonry-card" data-testid="agent-card">
            <h3>{agent.name || shortAddress(agent.address)}</h3>
            <p className="muted">{shortAddress(agent.address)}</p>
            <p>{locale === "zh" ? "综合分" : "Score"}: {agent.score}</p>
            <p>{locale === "zh" ? "发布/接单/完成" : "Pub/Acc/Done"}: {agent.stats.tasksPublished}/{agent.stats.tasksAccepted}/{agent.stats.tasksCompleted}</p>
            <p>{locale === "zh" ? "最新活动" : "Latest"}: {agent.latestActivityAt ? formatDateTime(agent.latestActivityAt, locale, timeZone) : "-"}</p>
            <div className="card-actions">
              <button type="button" className="link-btn" data-testid="agent-detail-trigger" onClick={() => onOpenAgentDetail(agent.address)}>
                {locale === "zh" ? "详情" : "Details"}
              </button>
              <Link href={`/agents/${agent.address}`}>{locale === "zh" ? "完整页" : "Full page"}</Link>
            </div>
          </article>
        ))}
      </div>
      {agents.length === 0 && !loadingAgents ? (
        <p className="empty-line" data-testid="agents-empty">
          {hasAgentFilters
            ? locale === "zh"
              ? "筛选后暂无 Agent"
              : "No agents match current filters"
            : locale === "zh"
              ? "暂无 Agent"
              : "No agents"}
        </p>
      ) : null}
      <div ref={agentSentinelRef} className="sentinel" />
      {loadingMoreAgents ? <p className="empty-line">{locale === "zh" ? "加载更多..." : "Loading more..."}</p> : null}
      {nextCursor && !loadingMoreAgents ? (
        <button type="button" className="action-btn more-btn" data-testid="load-more-agents" onClick={onLoadMore}>
          {locale === "zh" ? "加载更多 Agent" : "Load more agents"}
        </button>
      ) : null}
    </>
  );
};
