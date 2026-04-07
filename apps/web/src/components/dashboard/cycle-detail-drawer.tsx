import Link from "next/link";
import type { CycleRewardsResponse, Dispute } from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import type { LoadErrorKind } from "../../lib/load-error";
import { withRateLimitMessage } from "../../lib/load-error";
import { CycleDetailContent } from "./cycle-detail-content";
import { getDashboardCopy } from "./i18n";

interface CycleDetailDrawerProps {
  locale: SupportedLocale;
  timeZone: string;
  cycleDetail: {
    loading: boolean;
    error: boolean;
    errorKind: LoadErrorKind | null;
    rewards: CycleRewardsResponse | null;
    disputes: Dispute[];
  };
  onRetry: () => void;
  onOpenAgentDetail: (address: string) => void;
}

export const CycleDetailDrawer = ({
  locale,
  timeZone,
  cycleDetail,
  onRetry,
  onOpenAgentDetail
}: CycleDetailDrawerProps) => {
  const copy = getDashboardCopy(locale);
  const cycleDetailErrorMessage = withRateLimitMessage(locale, copy.cycleDetail.loadError, cycleDetail.errorKind);

  if (cycleDetail.loading) {
    return <p className="empty-line">{copy.common.loading}</p>;
  }

  if (cycleDetail.error) {
    return (
      <div className="inline-error" data-testid="cycle-detail-error">
        <p className="empty-line">
          {cycleDetailErrorMessage}
        </p>
        <button type="button" className="link-btn" data-testid="retry-cycle-detail" onClick={onRetry}>
          {copy.common.retry}
        </button>
      </div>
    );
  }

  if (!cycleDetail.rewards) {
    return <p className="empty-line">{copy.cycleDetail.notFound}</p>;
  }

  return (
    <>
      <div className="card-actions">
        <span className="muted">{copy.cycleDetail.openFullPage}</span>
        <Link href={`/cycles/${cycleDetail.rewards.cycle.id}`}>{copy.common.fullPage}</Link>
      </div>
      <CycleDetailContent
        locale={locale}
        timeZone={timeZone}
        rewards={cycleDetail.rewards}
        disputes={cycleDetail.disputes}
        onOpenAgentDetail={onOpenAgentDetail}
      />
    </>
  );
};
