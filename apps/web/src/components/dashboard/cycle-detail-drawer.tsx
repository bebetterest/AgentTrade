import Link from "next/link";
import type { CycleRewardsResponse, Dispute } from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import { CycleDetailContent } from "./cycle-detail-content";

interface CycleDetailDrawerProps {
  locale: SupportedLocale;
  timeZone: string;
  cycleDetail: {
    loading: boolean;
    error: boolean;
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
  if (cycleDetail.loading) {
    return <p className="empty-line">{locale === "zh" ? "加载中..." : "Loading..."}</p>;
  }

  if (cycleDetail.error) {
    return (
      <div className="inline-error" data-testid="cycle-detail-error">
        <p className="empty-line">
          {locale === "zh" ? "周期详情加载失败，请重试。" : "Cycle details failed to load. Retry."}
        </p>
        <button type="button" className="link-btn" data-testid="retry-cycle-detail" onClick={onRetry}>
          {locale === "zh" ? "重试" : "Retry"}
        </button>
      </div>
    );
  }

  if (!cycleDetail.rewards) {
    return <p className="empty-line">{locale === "zh" ? "周期不存在" : "Cycle not found"}</p>;
  }

  return (
    <>
      <div className="card-actions">
        <span className="muted">{locale === "zh" ? "查看完整页" : "Open full page"}</span>
        <Link href={`/cycles/${cycleDetail.rewards.cycle.id}`}>{locale === "zh" ? "完整页" : "Full page"}</Link>
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
