import Link from "next/link";
import type { ActivityEvent, Dispute, Task } from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import type { LoadErrorKind } from "../../lib/load-error";
import { withRateLimitMessage } from "../../lib/load-error";
import { DisputeDetailContent } from "./dispute-detail-content";
import { getDashboardCopy } from "./i18n";

interface DisputeDetailDrawerProps {
  locale: SupportedLocale;
  timeZone: string;
  disputeDetail: {
    loading: boolean;
    error: boolean;
    errorKind: LoadErrorKind | null;
    dispute: Dispute | null;
    task: Task | null;
    activities: ActivityEvent[];
  };
  onRetry: () => void;
  onOpenAgentDetail: (address: string) => void;
}

const copy = {
  en: {
    loadError: "Dispute details failed to load. Retry.",
    notFound: "Dispute not found",
    openFullPage: "Open full page"
  },
  zh: {
    loadError: "争议详情加载失败，请重试。",
    notFound: "争议不存在",
    openFullPage: "打开完整页"
  }
} as const;

export const DisputeDetailDrawer = ({
  locale,
  timeZone,
  disputeDetail,
  onRetry,
  onOpenAgentDetail
}: DisputeDetailDrawerProps) => {
  const t = copy[locale];
  const dashboardCopy = getDashboardCopy(locale);
  const disputeDetailErrorMessage = withRateLimitMessage(locale, t.loadError, disputeDetail.errorKind);

  if (disputeDetail.loading) {
    return <p className="empty-line">{dashboardCopy.common.loading}</p>;
  }

  if (disputeDetail.error) {
    return (
      <div className="inline-error" data-testid="dispute-detail-error">
        <p className="empty-line">{disputeDetailErrorMessage}</p>
        <button type="button" className="link-btn" data-testid="retry-dispute-detail" onClick={onRetry}>
          {dashboardCopy.common.retry}
        </button>
      </div>
    );
  }

  if (!disputeDetail.dispute) {
    return <p className="empty-line">{t.notFound}</p>;
  }

  return (
    <>
      <div className="card-actions">
        <span className="muted">{t.openFullPage}</span>
        <Link href={`/disputes/${disputeDetail.dispute.id}`}>{dashboardCopy.common.fullPage}</Link>
      </div>
      <DisputeDetailContent
        locale={locale}
        timeZone={timeZone}
        dispute={disputeDetail.dispute}
        task={disputeDetail.task}
        activities={disputeDetail.activities}
        onOpenAgentDetail={onOpenAgentDetail}
        getTaskHref={(taskId) => `/tasks/${taskId}`}
      />
    </>
  );
};
