import type { Cycle } from "@agentrade/types";
import type { SupportedLocale } from "@agentrade/i18n";
import { formatDateTime } from "../../lib/dashboard-format";
import type { LoadErrorKind } from "../../lib/load-error";
import { withRateLimitMessage } from "../../lib/load-error";
import { getCycleStatusLabel, getDashboardCopy } from "./i18n";
import { buildStateChipClass } from "./shared";
import { ListPanelShell } from "./list-panel-shell";

interface CycleListPanelProps {
  locale: SupportedLocale;
  timeZone: string;
  cycles: Cycle[];
  loadingCycles: boolean;
  loadingMoreCycles: boolean;
  cycleLoadError: boolean;
  cycleLoadErrorKind: LoadErrorKind | null;
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
  cycleLoadErrorKind,
  nextCursor,
  cycleSentinelRef,
  onOpenCycleDetail,
  onRefresh,
  onLoadMore
}: CycleListPanelProps) => {
  const copy = getDashboardCopy(locale);
  const cycleLoadErrorMessage = withRateLimitMessage(locale, copy.cycleList.loadError, cycleLoadErrorKind);
  const orderedCycles = [...cycles].sort((left, right) => {
    const leftTs = Number.isFinite(Date.parse(left.startedAt)) ? Date.parse(left.startedAt) : 0;
    const rightTs = Number.isFinite(Date.parse(right.startedAt)) ? Date.parse(right.startedAt) : 0;
    if (rightTs !== leftTs) {
      return rightTs - leftTs;
    }
    return right.id.localeCompare(left.id);
  });

  return (
    <>
      <ListPanelShell
        loadError={cycleLoadError}
        loadErrorMessage={cycleLoadErrorMessage}
        errorTestId="cycles-error"
        onRefresh={onRefresh}
        retryLabel={copy.common.retry}
        loading={loadingCycles}
        loadingLabel={copy.common.loading}
        itemCount={cycles.length}
        emptyTestId="cycles-empty"
        emptyLabel={copy.cycleList.empty}
        sentinelRef={cycleSentinelRef}
        loadingMore={loadingMoreCycles}
        loadingMoreLabel={copy.common.loadingMore}
        nextCursor={nextCursor}
        loadMoreTestId="load-more-cycles"
        loadMoreLabel={copy.cycleList.loadMore}
        onLoadMore={onLoadMore}
      >
        <div className="masonry-grid">
          {orderedCycles.map((cycle) => (
            <article key={cycle.id} className="masonry-card" data-testid="cycle-card">
              <div className="card-kicker">
                <span className={buildStateChipClass(cycle.status)}>{getCycleStatusLabel(locale, cycle.status)}</span>
                <span className="muted card-id">{cycle.id}</span>
              </div>
              <h3>{cycle.id}</h3>
              <p className="card-primary-number">{cycle.mintedAmount} AGC</p>
              <div className="card-meta">
                <p><strong>{copy.cycleList.started}:</strong> {formatDateTime(cycle.startedAt, locale, timeZone)}</p>
                <p><strong>{locale === "zh" ? "状态" : "Status"}:</strong> {getCycleStatusLabel(locale, cycle.status)}</p>
                <p><strong>{copy.cycleList.tax}:</strong> {cycle.taxPool} AGC</p>
                <p><strong>{copy.cycleList.penalty}:</strong> {cycle.penaltyPool} AGC</p>
              </div>
              <div className="card-actions">
                <button type="button" className="link-btn" data-testid="cycle-detail-trigger" onClick={() => onOpenCycleDetail(cycle.id)}>
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
