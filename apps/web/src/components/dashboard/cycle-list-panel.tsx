import Link from "next/link";
import type { Cycle } from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import { formatDateTime } from "../../lib/dashboard-format";

interface CycleListPanelProps {
  locale: SupportedLocale;
  timeZone: string;
  cycles: Cycle[];
  loadingCycles: boolean;
  loadingMoreCycles: boolean;
  cycleLoadError: boolean;
  nextCursor: string | null;
  cycleSentinelRef: React.RefObject<HTMLDivElement | null>;
  onOpenCycleDetail: (cycleId: string) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
}

export const CycleListPanel = ({
  locale,
  timeZone,
  cycles,
  loadingCycles,
  loadingMoreCycles,
  cycleLoadError,
  nextCursor,
  cycleSentinelRef,
  onOpenCycleDetail,
  onRefresh,
  onLoadMore
}: CycleListPanelProps) => {
  return (
    <>
      {cycleLoadError ? (
        <div className="inline-error" data-testid="cycles-error">
          <p className="empty-line">
            {locale === "zh" ? "周期列表加载失败，请重试。" : "Cycle list failed to load. Retry with refresh."}
          </p>
          <button type="button" className="link-btn" onClick={onRefresh}>
            {locale === "zh" ? "重试" : "Retry"}
          </button>
        </div>
      ) : null}
      {loadingCycles ? <p className="empty-line">{locale === "zh" ? "加载中..." : "Loading..."}</p> : null}
      <div className="masonry-grid">
        {cycles.map((cycle) => (
          <article key={cycle.id} className="masonry-card" data-testid="cycle-card">
            <h3>{cycle.id}</h3>
            <span className="state-chip">{cycle.status}</span>
            <p>{locale === "zh" ? "开始时间" : "Started"}: {formatDateTime(cycle.startedAt, locale, timeZone)}</p>
            <p>{locale === "zh" ? "Mint" : "Mint"}: {cycle.mintedAmount} AGC</p>
            <p>{locale === "zh" ? "税池" : "Tax"}: {cycle.taxPool} AGC</p>
            <p>{locale === "zh" ? "罚没池" : "Penalty"}: {cycle.penaltyPool} AGC</p>
            <div className="card-actions">
              <button type="button" className="link-btn" data-testid="cycle-detail-trigger" onClick={() => onOpenCycleDetail(cycle.id)}>
                {locale === "zh" ? "详情" : "Details"}
              </button>
              <Link href={`/cycles/${cycle.id}`}>{locale === "zh" ? "完整页" : "Full page"}</Link>
            </div>
          </article>
        ))}
      </div>
      {cycles.length === 0 && !loadingCycles ? (
        <p className="empty-line" data-testid="cycles-empty">
          {locale === "zh" ? "暂无周期" : "No cycles"}
        </p>
      ) : null}
      <div ref={cycleSentinelRef} className="sentinel" />
      {loadingMoreCycles ? <p className="empty-line">{locale === "zh" ? "加载更多..." : "Loading more..."}</p> : null}
      {nextCursor && !loadingMoreCycles ? (
        <button type="button" className="action-btn more-btn" data-testid="load-more-cycles" onClick={onLoadMore}>
          {locale === "zh" ? "加载更多周期" : "Load more cycles"}
        </button>
      ) : null}
    </>
  );
};
