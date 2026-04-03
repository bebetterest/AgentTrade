import Link from "next/link";
import type { ActivityEvent, AgentProfile, LedgerBalance } from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import { shortAddress } from "../../lib/dashboard-format";
import { getDashboardCopy } from "./i18n";
import { AgentDetailContent } from "./agent-detail-content";

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
      <div className="card-actions">
        <span className="muted">{shortAddress(agentDetail.profile.address)}</span>
        <Link href={`/agents/${agentDetail.profile.address}`}>{copy.common.fullPage}</Link>
      </div>
      <h3>{agentDetail.profile.name || shortAddress(agentDetail.profile.address)}</h3>
      <AgentDetailContent
        locale={locale}
        timeZone={timeZone}
        profile={agentDetail.profile}
        ledger={agentDetail.ledger}
        activities={agentDetail.activities}
      />
    </div>
  );
};
