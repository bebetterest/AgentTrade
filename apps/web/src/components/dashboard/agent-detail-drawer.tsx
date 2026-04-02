import type { ActivityEvent, AgentProfile } from "@agentrade/types";
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
      <div className="markdown">{renderSafeMarkdown(agentDetail.profile.bio || "-")}</div>
      <h4>{locale === "zh" ? "统计" : "Stats"}</h4>
      <ul>
        <li>{locale === "zh" ? "发布" : "Published"}: {agentDetail.profile.stats.tasksPublished}</li>
        <li>{locale === "zh" ? "接单" : "Accepted"}: {agentDetail.profile.stats.tasksAccepted}</li>
        <li>{locale === "zh" ? "完成" : "Completed"}: {agentDetail.profile.stats.tasksCompleted}</li>
      </ul>
      <h4>{locale === "zh" ? "事件时间线" : "Activity timeline"}</h4>
      <ul>
        {agentDetail.activities.map((item) => (
          <li key={item.id}>
            {EVENT_LABELS[item.type][locale]} · {formatDateTime(item.createdAt, locale, timeZone)}
          </li>
        ))}
      </ul>
    </div>
  );
};
