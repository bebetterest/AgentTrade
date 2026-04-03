import Link from "next/link";
import type { Cycle } from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import { formatDateTime } from "../../lib/dashboard-format";
import { getCycleStatusLabel, getDashboardCopy } from "./i18n";
import { buildStateChipClass } from "./shared";

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
  const copy = getDashboardCopy(locale);

  return (
    <>
      {cycleLoadError ? (
        <div className="inline-error" data-testid="cycles-error">
          <p className="empty-line">
            {copy.cycleList.loadError}
          </p>
          <button type="button" className="link-btn" onClick={onRefresh}>
            {copy.common.retry}
          </button>
        </div>
      ) : null}
      {loadingCycles ? <p className="empty-line">{copy.common.loading}</p> : null}
      <div className="masonry-grid">
        {cycles.map((cycle) => (
          <article key={cycle.id} className="masonry-card" data-testid="cycle-card">
            <div className="card-kicker">
              <span className={buildStateChipClass(cycle.status)}>{getCycleStatusLabel(locale, cycle.status)}</span>
              <span className="muted">{cycle.id}</span>
            </div>
            <h3>{cycle.id}</h3>
            <p className="card-primary-number">{cycle.mintedAmount} AGC</p>
            <div className="card-meta">
              <p>{copy.cycleList.started}: {formatDateTime(cycle.startedAt, locale, timeZone)}</p>
              <p>{copy.cycleList.tax}: {cycle.taxPool} AGC</p>
              <p>{copy.cycleList.penalty}: {cycle.penaltyPool} AGC</p>
            </div>
            <div className="card-actions">
              <button type="button" className="link-btn" data-testid="cycle-detail-trigger" onClick={() => onOpenCycleDetail(cycle.id)}>
                {copy.common.details}
              </button>
              <Link href={`/cycles/${cycle.id}`}>{copy.common.fullPage}</Link>
            </div>
          </article>
        ))}
      </div>
      {cycles.length === 0 && !loadingCycles ? (
        <p className="empty-line" data-testid="cycles-empty">
          {copy.cycleList.empty}
        </p>
      ) : null}
      <div ref={cycleSentinelRef} className="sentinel" />
      {loadingMoreCycles ? <p className="empty-line">{copy.common.loadingMore}</p> : null}
      {nextCursor && !loadingMoreCycles ? (
        <button type="button" className="action-btn more-btn" data-testid="load-more-cycles" onClick={onLoadMore}>
          {copy.cycleList.loadMore}
        </button>
      ) : null}
    </>
  );
};
